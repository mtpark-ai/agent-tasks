import persistentWorker from "./persistent-worker";

const encoder = new TextEncoder();
const MAX_GITHUB_WEBHOOK_BODY_BYTES = 1_000_000;
const COMMENT_PREVIEW_LIMIT = 1_200;
const DELIVERY_RETRY_DELAYS_MS = [0, 1_000, 3_000] as const;
const DELIVERY_ID_PATTERN = /^[A-Za-z0-9-]{1,128}$/u;
const SUPPORTED_ISSUE_ACTIONS = new Set([
  "opened",
  "reopened",
  "closed",
  "labeled",
  "unlabeled",
  "assigned",
]);
const PLACEHOLDER_VALUES = new Set([
  "",
  "replace-with-a-github-webhook-secret",
  "replace-with-an-outbound-webhook-url",
  "replace-with-an-outbound-authorization-value",
]);

interface WebhookEnv extends Env {
  ADMIN_TOKEN?: string;
  AUTH_TOKEN?: string;
  GITHUB_WEBHOOK_SECRET?: string;
  OUTBOUND_WEBHOOK_URL?: string;
  OUTBOUND_WEBHOOK_KIND?: string;
  OUTBOUND_WEBHOOK_AUTHORIZATION?: string;
}

type JsonRecord = Record<string, unknown>;
type DeliveryStatus = "received" | "ignored" | "queued" | "delivered" | "failed";
type OutboundKind = "generic" | "feishu";

type NormalizedEvent = {
  schema_version: 1;
  event_id: string;
  source: "github";
  event: string;
  action: string;
  occurred_at: string;
  repository: {
    full_name: string;
    private: boolean | null;
    url: string | null;
  };
  actor: {
    login: string;
    type: string | null;
    url: string | null;
  };
  issue: {
    number: number;
    title: string;
    state: string;
    url: string | null;
    labels: string[];
  };
  comment?: {
    id: number | null;
    author: string;
    body: string;
    url: string | null;
  };
  label?: {
    name: string;
    color: string | null;
  };
  assignee?: {
    login: string;
  };
};

type NormalizationResult =
  | { kind: "forward"; event: NormalizedEvent }
  | { kind: "ignored"; reason: string; event?: NormalizedEvent }
  | { kind: "ping" };

class WebhookBodyTooLargeError extends Error {}
class WebhookStorageNotReadyError extends Error {}

function securityHeaders(headers?: HeadersInit): Headers {
  const result = new Headers(headers);
  result.set("x-content-type-options", "nosniff");
  result.set("referrer-policy", "no-referrer");
  result.set("permissions-policy", "camera=(), geolocation=(), microphone=()");
  result.set("x-frame-options", "DENY");
  return result;
}

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  const responseHeaders = securityHeaders(headers);
  responseHeaders.set("content-type", "application/json; charset=utf-8");
  responseHeaders.set("cache-control", "no-store");
  return Response.json(body, { status, headers: responseHeaders });
}

function configuredSecret(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return PLACEHOLDER_VALUES.has(trimmed) ? null : trimmed;
}

function getBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/iu);
  return match?.[1]?.trim() || null;
}

async function constantTimeEqual(left: string, right: string): Promise<boolean> {
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  return crypto.subtle.timingSafeEqual(leftHash, rightHash);
}

async function readBodyWithLimit(request: Request, limit: number): Promise<Uint8Array> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    throw new WebhookBodyTooLargeError();
  }
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel("github webhook body too large");
        throw new WebhookBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function verifyGitHubSignature(secret: string, body: Uint8Array, signature: string | null): Promise<boolean> {
  if (!signature || !/^sha256=[0-9a-f]{64}$/iu.test(signature)) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, body);
  return constantTimeEqual(signature.toLowerCase(), `sha256=${hex(digest)}`);
}

function record(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function truncate(value: string, limit = COMMENT_PREVIEW_LIMIT): string {
  const normalized = value.replace(/\r\n?/gu, "\n").trim();
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1)}…`;
}

function labelsFromIssue(issue: JsonRecord): string[] {
  if (!Array.isArray(issue.labels)) return [];
  return issue.labels
    .map((entry) => typeof entry === "string" ? entry : stringValue(record(entry)?.name))
    .filter((entry): entry is string => Boolean(entry));
}

function isBotIdentity(user: JsonRecord | null): boolean {
  if (!user) return false;
  const login = stringValue(user.login) ?? "";
  const type = stringValue(user.type) ?? "";
  return type.toLowerCase() === "bot" || login.toLowerCase().endsWith("[bot]");
}

function normalizeGitHubEvent(
  eventType: string,
  deliveryId: string,
  payload: JsonRecord,
): NormalizationResult {
  if (eventType === "ping") return { kind: "ping" };

  const action = stringValue(payload.action) ?? "unknown";
  if (eventType === "issues" && !SUPPORTED_ISSUE_ACTIONS.has(action)) {
    return { kind: "ignored", reason: `unsupported_issues_action:${action}` };
  }
  if (eventType === "issue_comment" && action !== "created") {
    return { kind: "ignored", reason: `unsupported_issue_comment_action:${action}` };
  }
  if (eventType !== "issues" && eventType !== "issue_comment") {
    return { kind: "ignored", reason: `unsupported_event:${eventType}` };
  }

  const repository = record(payload.repository);
  const issue = record(payload.issue);
  const sender = record(payload.sender);
  if (!repository || !issue || !sender) {
    return { kind: "ignored", reason: "missing_repository_issue_or_sender" };
  }
  if (eventType === "issue_comment" && record(issue.pull_request)) {
    return { kind: "ignored", reason: "pull_request_comment" };
  }

  const comment = eventType === "issue_comment" ? record(payload.comment) : null;
  const commentUser = comment ? record(comment.user) : null;
  if (isBotIdentity(sender) || isBotIdentity(commentUser)) {
    return { kind: "ignored", reason: "bot_generated" };
  }
  const commentBody = comment ? stringValue(comment.body) ?? "" : "";
  if (commentBody.includes("<!-- agent-tasks:bot -->")) {
    return { kind: "ignored", reason: "agent_tasks_bot_marker" };
  }

  const repositoryName = stringValue(repository.full_name);
  const issueNumber = numberValue(issue.number);
  const issueTitle = stringValue(issue.title);
  const actorLogin = stringValue(sender.login);
  if (!repositoryName || issueNumber === null || !issueTitle || !actorLogin) {
    return { kind: "ignored", reason: "missing_required_fields" };
  }

  const normalized: NormalizedEvent = {
    schema_version: 1,
    event_id: deliveryId,
    source: "github",
    event: eventType === "issues" ? `issue.${action}` : "issue.comment.created",
    action,
    occurred_at: stringValue(comment?.updated_at) ?? stringValue(issue.updated_at) ?? new Date().toISOString(),
    repository: {
      full_name: repositoryName,
      private: typeof repository.private === "boolean" ? repository.private : null,
      url: stringValue(repository.html_url),
    },
    actor: {
      login: actorLogin,
      type: stringValue(sender.type),
      url: stringValue(sender.html_url),
    },
    issue: {
      number: issueNumber,
      title: issueTitle,
      state: stringValue(issue.state) ?? "unknown",
      url: stringValue(issue.html_url),
      labels: labelsFromIssue(issue),
    },
  };

  if (comment) {
    normalized.comment = {
      id: numberValue(comment.id),
      author: stringValue(commentUser?.login) ?? actorLogin,
      body: truncate(commentBody),
      url: stringValue(comment.html_url),
    };
  }

  const label = record(payload.label);
  const labelName = stringValue(label?.name);
  if (labelName) {
    normalized.label = {
      name: labelName,
      color: stringValue(label?.color),
    };
  }

  const assignee = record(payload.assignee);
  const assigneeLogin = stringValue(assignee?.login);
  if (assigneeLogin) normalized.assignee = { login: assigneeLogin };

  return { kind: "forward", event: normalized };
}

function outboundKind(value: string | undefined): OutboundKind | null {
  const normalized = (value ?? "generic").trim().toLowerCase();
  return normalized === "generic" || normalized === "feishu" ? normalized : null;
}

function destinationUrl(value: string | undefined): string | null {
  const configured = configuredSecret(value);
  if (!configured) return null;
  try {
    const url = new URL(configured);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function renderPlainText(event: NormalizedEvent): string {
  const lines = [
    event.event === "issue.opened" ? "🆕 新的 Agent 任务" : "🔔 Agent 任务更新",
    "",
    `仓库：${event.repository.full_name}`,
    `任务：#${event.issue.number} ${event.issue.title}`,
    `事件：${event.event}`,
    `操作人：${event.actor.login}`,
  ];
  if (event.label?.name) lines.push(`标签：${event.label.name}`);
  if (event.assignee?.login) lines.push(`指派给：${event.assignee.login}`);
  if (event.comment?.body) lines.push("", `评论：${event.comment.body}`);
  if (event.issue.url) lines.push("", event.issue.url);
  return lines.join("\n");
}

function outboundPayload(kind: OutboundKind, event: NormalizedEvent): unknown {
  if (kind === "feishu") {
    return {
      msg_type: "text",
      content: { text: renderPlainText(event) },
    };
  }
  return event;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureWebhookStorage(env: WebhookEnv): Promise<void> {
  try {
    await env.DB.prepare("SELECT delivery_id FROM github_webhook_deliveries LIMIT 1").first();
  } catch {
    throw new WebhookStorageNotReadyError("github webhook migration has not been applied");
  }
}

async function insertDelivery(
  env: WebhookEnv,
  input: {
    deliveryId: string;
    eventType: string;
    action: string | null;
    repository: string | null;
    issueNumber: number | null;
    sender: string | null;
    normalizedJson: string | null;
    status: DeliveryStatus;
    errorCode?: string | null;
  },
): Promise<boolean> {
  const result = await env.DB.prepare(
    `INSERT OR IGNORE INTO github_webhook_deliveries (
       delivery_id, event_type, action, repository, issue_number, sender,
       normalized_json, status, error_code, received_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  ).bind(
    input.deliveryId,
    input.eventType,
    input.action,
    input.repository,
    input.issueNumber,
    input.sender,
    input.normalizedJson,
    input.status,
    input.errorCode ?? null,
  ).run();
  return (result.meta.changes ?? 0) > 0;
}

async function updateDelivery(
  env: WebhookEnv,
  deliveryId: string,
  input: {
    status: DeliveryStatus;
    responseStatus?: number | null;
    errorCode?: string | null;
    attemptCount?: number;
    deliveredAt?: string | null;
  },
): Promise<void> {
  await env.DB.prepare(
    `UPDATE github_webhook_deliveries
     SET status = ?, response_status = ?, error_code = ?, attempt_count = ?,
         delivered_at = ?, updated_at = CURRENT_TIMESTAMP
     WHERE delivery_id = ?`,
  ).bind(
    input.status,
    input.responseStatus ?? null,
    input.errorCode ?? null,
    input.attemptCount ?? 0,
    input.deliveredAt ?? null,
    deliveryId,
  ).run();
}

async function deliverOutbound(
  env: WebhookEnv,
  deliveryId: string,
  kind: OutboundKind,
  url: string,
  event: NormalizedEvent,
): Promise<void> {
  let lastStatus: number | null = null;
  let lastError = "outbound_delivery_failed";
  let attempts = 0;
  for (let index = 0; index < DELIVERY_RETRY_DELAYS_MS.length; index += 1) {
    const delay = DELIVERY_RETRY_DELAYS_MS[index];
    if (delay > 0) await sleep(delay);
    const attempt = index + 1;
    attempts = attempt;
    try {
      const headers = new Headers({
        "content-type": "application/json",
        "user-agent": "agent-tasks-webhook-forwarder",
        "x-agent-tasks-delivery": deliveryId,
        "x-agent-tasks-event": event.event,
      });
      const authorization = configuredSecret(env.OUTBOUND_WEBHOOK_AUTHORIZATION);
      if (authorization) headers.set("authorization", authorization);
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(outboundPayload(kind, event)),
      });
      lastStatus = response.status;
      if (response.ok) {
        try {
          await updateDelivery(env, deliveryId, {
            status: "delivered",
            responseStatus: response.status,
            attemptCount: attempt,
            deliveredAt: new Date().toISOString(),
          });
        } catch {
          console.error(JSON.stringify({ event: "github_webhook_status_update_failed", delivery_id: deliveryId }));
        }
        return;
      }
      lastError = `outbound_http_${response.status}`;
      if (response.status !== 429 && response.status < 500) break;
    } catch (error) {
      lastError = error instanceof Error ? `outbound_fetch:${error.name}` : "outbound_fetch_failed";
    }
  }

  try {
    await updateDelivery(env, deliveryId, {
      status: "failed",
      responseStatus: lastStatus,
      errorCode: lastError,
      attemptCount: attempts,
    });
  } catch {
    console.error(JSON.stringify({ event: "github_webhook_status_update_failed", delivery_id: deliveryId }));
  }
}

async function handleGitHubWebhook(request: Request, env: WebhookEnv, ctx: ExecutionContext): Promise<Response> {
  const webhookSecret = configuredSecret(env.GITHUB_WEBHOOK_SECRET);
  if (!webhookSecret) return jsonResponse({ ok: false, error: "github_webhook_not_configured" }, 503);

  const deliveryId = request.headers.get("x-github-delivery")?.trim() || null;
  const eventType = request.headers.get("x-github-event")?.trim() || null;
  if (!deliveryId || !DELIVERY_ID_PATTERN.test(deliveryId) || !eventType) {
    return jsonResponse({ ok: false, error: "missing_github_webhook_headers" }, 400);
  }

  let body: Uint8Array;
  try {
    body = await readBodyWithLimit(request, MAX_GITHUB_WEBHOOK_BODY_BYTES);
  } catch (error) {
    if (error instanceof WebhookBodyTooLargeError) {
      return jsonResponse({ ok: false, error: "github_webhook_body_too_large" }, 413);
    }
    throw error;
  }

  const signatureValid = await verifyGitHubSignature(
    webhookSecret,
    body,
    request.headers.get("x-hub-signature-256"),
  );
  if (!signatureValid) return jsonResponse({ ok: false, error: "invalid_github_signature" }, 401);

  let payload: JsonRecord;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(body) || "{}");
    const parsedRecord = record(parsed);
    if (!parsedRecord) throw new Error("payload must be an object");
    payload = parsedRecord;
  } catch {
    return jsonResponse({ ok: false, error: "invalid_json" }, 400);
  }

  try {
    await ensureWebhookStorage(env);
  } catch (error) {
    if (error instanceof WebhookStorageNotReadyError) {
      return jsonResponse({ ok: false, error: "database_not_ready", action: "run_d1_migrations" }, 503);
    }
    throw error;
  }

  const normalized = normalizeGitHubEvent(eventType, deliveryId, payload);
  const action = stringValue(payload.action);
  const repository = record(payload.repository);
  const issue = record(payload.issue);
  const sender = record(payload.sender);
  const baseMetadata = {
    deliveryId,
    eventType,
    action,
    repository: stringValue(repository?.full_name),
    issueNumber: numberValue(issue?.number),
    sender: stringValue(sender?.login),
  };

  if (normalized.kind === "ping") {
    const inserted = await insertDelivery(env, {
      ...baseMetadata,
      normalizedJson: null,
      status: "ignored",
      errorCode: "ping",
    });
    return jsonResponse({ ok: true, event: "ping", duplicate: !inserted });
  }

  if (normalized.kind === "ignored") {
    const inserted = await insertDelivery(env, {
      ...baseMetadata,
      normalizedJson: normalized.event ? JSON.stringify(normalized.event) : null,
      status: "ignored",
      errorCode: normalized.reason,
    });
    return jsonResponse({ ok: true, ignored: true, reason: normalized.reason, duplicate: !inserted });
  }

  const kind = outboundKind(env.OUTBOUND_WEBHOOK_KIND);
  const url = destinationUrl(env.OUTBOUND_WEBHOOK_URL);
  if (!kind) return jsonResponse({ ok: false, error: "invalid_outbound_webhook_kind" }, 503);
  if (!url) return jsonResponse({ ok: false, error: "outbound_webhook_not_configured" }, 503);

  const inserted = await insertDelivery(env, {
    ...baseMetadata,
    normalizedJson: JSON.stringify(normalized.event),
    status: "queued",
  });
  if (!inserted) {
    return jsonResponse({ ok: true, duplicate: true, delivery_id: deliveryId });
  }

  ctx.waitUntil(deliverOutbound(env, deliveryId, kind, url, normalized.event));
  return jsonResponse({ ok: true, accepted: true, delivery_id: deliveryId }, 202);
}

async function requireAdmin(request: Request, env: WebhookEnv): Promise<Response | null> {
  const expected = configuredSecret(env.ADMIN_TOKEN) ?? configuredSecret(env.AUTH_TOKEN);
  if (!expected) return jsonResponse({ ok: false, error: "admin_not_configured" }, 503);
  const actual = getBearerToken(request);
  if (!actual || !(await constantTimeEqual(actual, expected))) {
    return jsonResponse({ ok: false, error: "unauthorized" }, 401, { "www-authenticate": "Bearer" });
  }
  return null;
}

function parseLimit(value: string | null): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 25;
  return Math.min(parsed, 100);
}

async function listWebhookDeliveries(request: Request, env: WebhookEnv): Promise<Response> {
  try {
    await ensureWebhookStorage(env);
    const url = new URL(request.url);
    const limit = parseLimit(url.searchParams.get("limit"));
    const status = url.searchParams.get("status")?.trim() || null;
    const eventType = url.searchParams.get("event_type")?.trim() || null;
    const clauses: string[] = [];
    const bindings: Array<string | number> = [];
    if (status && ["received", "ignored", "queued", "delivered", "failed"].includes(status)) {
      clauses.push("status = ?");
      bindings.push(status);
    }
    if (eventType) {
      clauses.push("event_type = ?");
      bindings.push(eventType);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const result = await env.DB.prepare(
      `SELECT delivery_id, event_type, action, repository, issue_number, sender,
              status, response_status, error_code, attempt_count, received_at,
              delivered_at, updated_at
       FROM github_webhook_deliveries
       ${where}
       ORDER BY received_at DESC
       LIMIT ?`,
    ).bind(...bindings, limit).all();
    return jsonResponse({ ok: true, deliveries: result.results, limit });
  } catch (error) {
    if (error instanceof WebhookStorageNotReadyError) {
      return jsonResponse({ ok: false, error: "database_not_ready", action: "run_d1_migrations" }, 503);
    }
    throw error;
  }
}

async function getWebhookDelivery(deliveryId: string, env: WebhookEnv): Promise<Response> {
  try {
    await ensureWebhookStorage(env);
    const row = await env.DB.prepare(
      `SELECT delivery_id, event_type, action, repository, issue_number, sender,
              normalized_json, status, response_status, error_code, attempt_count,
              received_at, delivered_at, updated_at
       FROM github_webhook_deliveries WHERE delivery_id = ? LIMIT 1`,
    ).bind(deliveryId).first<Record<string, unknown>>();
    if (!row) return jsonResponse({ ok: false, error: "github_webhook_delivery_not_found" }, 404);
    let normalized: unknown = null;
    if (typeof row.normalized_json === "string") {
      try { normalized = JSON.parse(row.normalized_json); } catch { normalized = row.normalized_json; }
    }
    const { normalized_json: _normalizedJson, ...metadata } = row;
    return jsonResponse({ ok: true, delivery: { ...metadata, normalized } });
  } catch (error) {
    if (error instanceof WebhookStorageNotReadyError) {
      return jsonResponse({ ok: false, error: "database_not_ready", action: "run_d1_migrations" }, 503);
    }
    throw error;
  }
}

const worker: ExportedHandler<WebhookEnv> = {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/webhooks/github") {
      if (request.method !== "POST") {
        return jsonResponse({ ok: false, error: "method_not_allowed" }, 405, { allow: "POST" });
      }
      try {
        return await handleGitHubWebhook(request, env, ctx);
      } catch {
        console.error(JSON.stringify({ event: "github_webhook_handler_failed" }));
        return jsonResponse({ ok: false, error: "internal_error" }, 500);
      }
    }

    if (url.pathname === "/api/admin/github-webhooks" || url.pathname.startsWith("/api/admin/github-webhooks/")) {
      const authError = await requireAdmin(request, env);
      if (authError) return authError;
      if (request.method !== "GET") {
        return jsonResponse({ ok: false, error: "method_not_allowed" }, 405, { allow: "GET" });
      }
      if (url.pathname === "/api/admin/github-webhooks") return listWebhookDeliveries(request, env);
      const deliveryId = decodeURIComponent(url.pathname.slice("/api/admin/github-webhooks/".length));
      return getWebhookDelivery(deliveryId, env);
    }

    return persistentWorker.fetch!(request, env, ctx);
  },
};

export default worker;
