import baseWorker from "./index";

const encoder = new TextEncoder();
const DEFAULT_MAX_BODY_BYTES = 50_000;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const PLACEHOLDER_VALUES = new Set([
  "",
  "replace-with-a-random-bearer-token",
  "replace-with-a-random-local-bearer-token",
]);

interface PersistentEnv extends Env {
  ADMIN_TOKEN?: string;
  AUTH_TOKEN?: string;
  MAX_BODY_BYTES?: string;
}

type DeviceIdentity = {
  kind: "device" | "legacy";
  id: string;
  name: string;
};

type BodySnapshot = {
  rawBody: string | null;
  bodySize: number;
  payloadHash: string | null;
};

type TaskResultPayload = {
  error?: unknown;
  duplicate?: unknown;
  issue_number?: unknown;
  issue_url?: unknown;
  request_id?: unknown;
};

class PersistenceNotReadyError extends Error {}

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

function parseMaxBodyBytes(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_BODY_BYTES;
  return Math.min(parsed, DEFAULT_MAX_BODY_BYTES);
}

function getBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/iu);
  return match?.[1]?.trim() || null;
}

async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function constantTimeEqual(left: string, right: string): Promise<boolean> {
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  return crypto.subtle.timingSafeEqual(leftHash, rightHash);
}

async function ensureTaskRequestStorage(env: PersistentEnv): Promise<void> {
  try {
    await env.DB.prepare("SELECT id FROM task_requests LIMIT 1").first();
  } catch {
    throw new PersistenceNotReadyError("task request migration has not been applied");
  }
}

async function resolveDeviceIdentity(request: Request, env: PersistentEnv): Promise<DeviceIdentity | null> {
  const token = getBearerToken(request);
  if (!token) return null;

  try {
    const tokenHash = await sha256Hex(token);
    const device = await env.DB.prepare(
      "SELECT id, name FROM devices WHERE token_hash = ? AND revoked_at IS NULL LIMIT 1",
    ).bind(tokenHash).first<{ id: string; name: string }>();
    if (device) return { kind: "device", id: device.id, name: device.name };
  } catch {
    throw new PersistenceNotReadyError("device storage is not ready");
  }

  const legacyToken = configuredSecret(env.AUTH_TOKEN);
  if (legacyToken && await constantTimeEqual(token, legacyToken)) {
    return { kind: "legacy", id: "legacy", name: "legacy-auth-token" };
  }

  return null;
}

async function readBodySnapshot(request: Request, maxBytes: number): Promise<BodySnapshot> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return { rawBody: null, bodySize: declaredLength, payloadHash: null };
  }

  const clone = request.clone();
  if (!clone.body) {
    return { rawBody: "", bodySize: 0, payloadHash: await sha256Hex("") };
  }

  const reader = clone.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("request body exceeds persistence limit");
        return { rawBody: null, bodySize: total, payloadHash: null };
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

  return {
    rawBody: new TextDecoder().decode(body),
    bodySize: total,
    payloadHash: await sha256Hex(body),
  };
}

function extractTaskText(rawBody: string | null): string | null {
  if (rawBody === null) return null;
  try {
    const payload: unknown = JSON.parse(rawBody || "{}");
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
    const record = payload as Record<string, unknown>;
    const task = typeof record.task === "object" && record.task !== null && !Array.isArray(record.task)
      ? record.task as Record<string, unknown>
      : null;
    const candidates = [task?.text, record.text, record.dictation, record.instruction, record.message];
    for (const candidate of candidates) {
      if (typeof candidate !== "string") continue;
      const normalized = candidate.replace(/\s+/gu, " ").trim();
      if (normalized) return normalized.slice(0, 500);
    }
  } catch {
    return null;
  }
  return null;
}

function requestStatus(response: Response): "completed" | "rejected" | "failed" {
  if (response.ok) return "completed";
  return response.status >= 500 ? "failed" : "rejected";
}

async function insertTaskRequest(
  env: PersistentEnv,
  input: {
    id: string;
    requestId: string;
    idempotencyKey: string | null;
    device: DeviceIdentity;
    contentType: string | null;
    taskText: string | null;
    snapshot: BodySnapshot;
    receivedAt: string;
  },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO task_requests (
       id, request_id, idempotency_key, device_id, device_name, device_kind,
       method, content_type, task_text, raw_body, body_size, payload_hash,
       status, received_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'POST', ?, ?, ?, ?, ?, 'received', ?, CURRENT_TIMESTAMP)`,
  ).bind(
    input.id,
    input.requestId,
    input.idempotencyKey,
    input.device.id,
    input.device.name,
    input.device.kind,
    input.contentType,
    input.taskText,
    input.snapshot.rawBody,
    input.snapshot.bodySize,
    input.snapshot.payloadHash,
    input.receivedAt,
  ).run();
}

async function finalizeTaskRequest(
  env: PersistentEnv,
  id: string,
  response: Response,
  payload: TaskResultPayload | null,
): Promise<void> {
  const status = requestStatus(response);
  const errorCode = typeof payload?.error === "string" ? payload.error : null;
  const duplicate = payload?.duplicate === true ? 1 : 0;
  const issueNumber = typeof payload?.issue_number === "number" ? payload.issue_number : null;
  const issueUrl = typeof payload?.issue_url === "string" ? payload.issue_url : null;
  const completedAt = new Date().toISOString();

  await env.DB.prepare(
    `UPDATE task_requests
     SET status = ?, response_status = ?, error_code = ?, duplicate = ?,
         issue_number = ?, issue_url = ?, completed_at = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  ).bind(
    status,
    response.status,
    errorCode,
    duplicate,
    issueNumber,
    issueUrl,
    completedAt,
    id,
  ).run();
}

async function parseResponsePayload(response: Response): Promise<TaskResultPayload | null> {
  try {
    const payload: unknown = await response.clone().json();
    return typeof payload === "object" && payload !== null && !Array.isArray(payload)
      ? payload as TaskResultPayload
      : null;
  } catch {
    return null;
  }
}

async function handlePersistedTaskRequest(
  request: Request,
  env: PersistentEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  let device: DeviceIdentity | null;
  try {
    device = await resolveDeviceIdentity(request, env);
  } catch (error) {
    if (error instanceof PersistenceNotReadyError) {
      return jsonResponse({ ok: false, error: "database_not_ready", action: "run_d1_migrations" }, 503);
    }
    throw error;
  }

  if (!device) {
    return baseWorker.fetch!(request, env, ctx);
  }

  try {
    await ensureTaskRequestStorage(env);
  } catch (error) {
    if (error instanceof PersistenceNotReadyError) {
      return jsonResponse({ ok: false, error: "database_not_ready", action: "run_d1_migrations" }, 503);
    }
    throw error;
  }

  const suppliedIdempotencyKey = request.headers.get("idempotency-key")?.trim() || null;
  const validSuppliedKey = suppliedIdempotencyKey && IDEMPOTENCY_KEY_PATTERN.test(suppliedIdempotencyKey)
    ? suppliedIdempotencyKey
    : null;
  const requestId = validSuppliedKey ?? crypto.randomUUID();
  const snapshot = await readBodySnapshot(request, parseMaxBodyBytes(env.MAX_BODY_BYTES));
  const headers = new Headers(request.headers);
  if (!suppliedIdempotencyKey) headers.set("idempotency-key", requestId);
  const forwardedRequest = suppliedIdempotencyKey ? request : new Request(request, { headers });
  const recordId = crypto.randomUUID();
  const receivedAt = new Date().toISOString();

  try {
    await insertTaskRequest(env, {
      id: recordId,
      requestId,
      idempotencyKey: suppliedIdempotencyKey?.slice(0, 256) ?? null,
      device,
      contentType: request.headers.get("content-type"),
      taskText: extractTaskText(snapshot.rawBody),
      snapshot,
      receivedAt,
    });
  } catch {
    console.error(JSON.stringify({ event: "task_request_persistence_failed", request_id: requestId }));
    return jsonResponse({ ok: false, error: "request_persistence_failed" }, 503);
  }

  const response = await baseWorker.fetch!(forwardedRequest, env, ctx);
  const payload = await parseResponsePayload(response);

  try {
    await finalizeTaskRequest(env, recordId, response, payload);
  } catch {
    console.error(JSON.stringify({ event: "task_request_finalize_failed", request_id: requestId }));
  }

  return response;
}

async function requireAdmin(request: Request, env: PersistentEnv): Promise<Response | null> {
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

async function listTaskRequests(request: Request, env: PersistentEnv): Promise<Response> {
  try {
    await ensureTaskRequestStorage(env);
    const url = new URL(request.url);
    const limit = parseLimit(url.searchParams.get("limit"));
    const requestId = url.searchParams.get("request_id")?.trim() || null;
    const status = url.searchParams.get("status")?.trim() || null;
    const clauses: string[] = [];
    const bindings: Array<string | number> = [];

    if (requestId) {
      clauses.push("request_id = ?");
      bindings.push(requestId);
    }
    if (status && ["received", "completed", "rejected", "failed"].includes(status)) {
      clauses.push("status = ?");
      bindings.push(status);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const statement = env.DB.prepare(
      `SELECT id, request_id, idempotency_key, device_id, device_name, device_kind,
              task_text, body_size, payload_hash, status, response_status, error_code,
              duplicate, issue_number, issue_url, received_at, completed_at, updated_at
       FROM task_requests
       ${where}
       ORDER BY received_at DESC, id DESC
       LIMIT ?`,
    ).bind(...bindings, limit);
    const result = await statement.all();
    return jsonResponse({ ok: true, requests: result.results, limit });
  } catch (error) {
    if (error instanceof PersistenceNotReadyError) {
      return jsonResponse({ ok: false, error: "database_not_ready", action: "run_d1_migrations" }, 503);
    }
    throw error;
  }
}

async function getTaskRequest(recordId: string, env: PersistentEnv): Promise<Response> {
  try {
    await ensureTaskRequestStorage(env);
    const row = await env.DB.prepare(
      `SELECT id, request_id, idempotency_key, device_id, device_name, device_kind,
              method, content_type, task_text, raw_body, body_size, payload_hash,
              status, response_status, error_code, duplicate, issue_number, issue_url,
              received_at, completed_at, updated_at
       FROM task_requests WHERE id = ? LIMIT 1`,
    ).bind(recordId).first<Record<string, unknown>>();
    if (!row) return jsonResponse({ ok: false, error: "task_request_not_found" }, 404);

    let payload: unknown = null;
    if (typeof row.raw_body === "string") {
      try { payload = JSON.parse(row.raw_body); } catch { payload = row.raw_body; }
    }
    const { raw_body: _rawBody, ...metadata } = row;
    return jsonResponse({ ok: true, request: { ...metadata, payload } });
  } catch (error) {
    if (error instanceof PersistenceNotReadyError) {
      return jsonResponse({ ok: false, error: "database_not_ready", action: "run_d1_migrations" }, 503);
    }
    throw error;
  }
}

const worker: ExportedHandler<PersistentEnv> = {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/tasks" && request.method === "POST") {
      return handlePersistedTaskRequest(request, env, ctx);
    }

    if (url.pathname === "/api/admin/task-requests" || url.pathname.startsWith("/api/admin/task-requests/")) {
      const authError = await requireAdmin(request, env);
      if (authError) return authError;
      if (request.method !== "GET") {
        return jsonResponse({ ok: false, error: "method_not_allowed" }, 405, { allow: "GET" });
      }
      if (url.pathname === "/api/admin/task-requests") return listTaskRequests(request, env);
      const recordId = decodeURIComponent(url.pathname.slice("/api/admin/task-requests/".length));
      return getTaskRequest(recordId, env);
    }

    return baseWorker.fetch!(request, env, ctx);
  },
};

export default worker;
