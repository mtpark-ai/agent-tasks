import {
  applyD1Migrations,
  createExecutionContext,
  env,
  waitOnExecutionContext,
  type D1Migration,
} from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/github-webhook-worker";

const testEnv = env as Env & {
  ADMIN_TOKEN: string;
  GITHUB_WEBHOOK_SECRET: string;
  OUTBOUND_WEBHOOK_URL: string;
  OUTBOUND_WEBHOOK_KIND: string;
  OUTBOUND_WEBHOOK_AUTHORIZATION: string;
  TEST_MIGRATIONS: D1Migration[];
};

const adminHeaders = { authorization: "Bearer admin-secret" };

function issuePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    action: "opened",
    repository: {
      full_name: "example-owner/task-repo",
      private: true,
      html_url: "https://github.com/example-owner/task-repo",
    },
    issue: {
      number: 42,
      title: "修复登录问题",
      state: "open",
      html_url: "https://github.com/example-owner/task-repo/issues/42",
      updated_at: "2026-07-17T12:00:00Z",
      labels: [{ name: "status:needs-triage" }],
    },
    sender: {
      login: "blue-bear",
      type: "User",
      html_url: "https://github.com/blue-bear",
    },
    ...overrides,
  };
}

async function signature(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const value = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `sha256=${value}`;
}

async function githubWebhookRequest({
  deliveryId = "11111111-1111-4111-8111-111111111111",
  eventType = "issues",
  payload = issuePayload(),
  signatureOverride,
}: {
  deliveryId?: string;
  eventType?: string;
  payload?: Record<string, unknown>;
  signatureOverride?: string;
} = {}): Promise<Request> {
  const body = JSON.stringify(payload);
  return new Request("https://intake.example/webhooks/github", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-delivery": deliveryId,
      "x-github-event": eventType,
      "x-hub-signature-256": signatureOverride ?? await signature(testEnv.GITHUB_WEBHOOK_SECRET, body),
    },
    body,
  });
}

async function dispatch(request: Request): Promise<{ response: Response; context: ExecutionContext }> {
  const context = createExecutionContext();
  const response = await worker.fetch!(request as Request<unknown, IncomingRequestCfProperties>, testEnv, context);
  return { response, context };
}

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await testEnv.DB.batch([
    testEnv.DB.prepare("DELETE FROM settings"),
    testEnv.DB.prepare("DELETE FROM devices"),
    testEnv.DB.prepare("DELETE FROM idempotency_keys"),
    testEnv.DB.prepare("DELETE FROM audit_events"),
    testEnv.DB.prepare("DELETE FROM task_requests"),
    testEnv.DB.prepare("DELETE FROM github_webhook_deliveries"),
  ]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GitHub webhook forwarding MVP", () => {
  it("verifies, normalizes, persists, and forwards an Issue event", async () => {
    const outbound = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      expect(String(input)).toBe("https://bot.example/hooks/agent-tasks");
      expect(init.method).toBe("POST");
      const headers = new Headers(init.headers);
      expect(headers.get("authorization")).toBe("Bearer bot-secret");
      expect(headers.get("x-agent-tasks-event")).toBe("issue.opened");
      const payload = JSON.parse(String(init.body));
      expect(payload).toMatchObject({
        schema_version: 1,
        source: "github",
        event: "issue.opened",
        repository: { full_name: "example-owner/task-repo" },
        issue: { number: 42, title: "修复登录问题" },
      });
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", outbound);

    const { response, context } = await dispatch(await githubWebhookRequest());
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ ok: true, accepted: true });
    await waitOnExecutionContext(context);

    expect(outbound).toHaveBeenCalledOnce();
    const row = await testEnv.DB.prepare(
      `SELECT event_type, action, repository, issue_number, status, response_status,
              attempt_count, normalized_json
       FROM github_webhook_deliveries LIMIT 1`,
    ).first<Record<string, unknown>>();
    expect(row).toMatchObject({
      event_type: "issues",
      action: "opened",
      repository: "example-owner/task-repo",
      issue_number: 42,
      status: "delivered",
      response_status: 204,
      attempt_count: 1,
    });
    expect(JSON.parse(String(row?.normalized_json))).toMatchObject({ event: "issue.opened" });
  });

  it("rejects an invalid signature without persisting or forwarding", async () => {
    const outbound = vi.fn();
    vi.stubGlobal("fetch", outbound);

    const { response } = await dispatch(await githubWebhookRequest({ signatureOverride: `sha256=${"0".repeat(64)}` }));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "invalid_github_signature" });
    const count = await testEnv.DB.prepare("SELECT COUNT(*) AS count FROM github_webhook_deliveries")
      .first<{ count: number }>();
    expect(Number(count?.count ?? 0)).toBe(0);
    expect(outbound).not.toHaveBeenCalled();
  });

  it("deduplicates repeated GitHub delivery IDs", async () => {
    const outbound = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", outbound);
    const request = await githubWebhookRequest({ deliveryId: "22222222-2222-4222-8222-222222222222" });

    const first = await dispatch(request);
    expect(first.response.status).toBe(202);
    await waitOnExecutionContext(first.context);

    const second = await dispatch(await githubWebhookRequest({
      deliveryId: "22222222-2222-4222-8222-222222222222",
    }));
    expect(second.response.status).toBe(200);
    await expect(second.response.json()).resolves.toMatchObject({ ok: true, duplicate: true });
    expect(outbound).toHaveBeenCalledOnce();

    const count = await testEnv.DB.prepare("SELECT COUNT(*) AS count FROM github_webhook_deliveries")
      .first<{ count: number }>();
    expect(Number(count?.count ?? 0)).toBe(1);
  });

  it("ignores bot-authored comments to prevent notification loops", async () => {
    const outbound = vi.fn();
    vi.stubGlobal("fetch", outbound);
    const payload = issuePayload({
      action: "created",
      comment: {
        id: 99,
        body: "自动更新",
        html_url: "https://github.com/example-owner/task-repo/issues/42#issuecomment-99",
        updated_at: "2026-07-17T12:01:00Z",
        user: { login: "agent-tasks[bot]", type: "Bot" },
      },
      sender: { login: "agent-tasks[bot]", type: "Bot" },
    });

    const { response } = await dispatch(await githubWebhookRequest({
      deliveryId: "33333333-3333-4333-8333-333333333333",
      eventType: "issue_comment",
      payload,
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      ignored: true,
      reason: "bot_generated",
    });
    expect(outbound).not.toHaveBeenCalled();

    const row = await testEnv.DB.prepare(
      "SELECT status, error_code FROM github_webhook_deliveries LIMIT 1",
    ).first<Record<string, unknown>>();
    expect(row).toMatchObject({ status: "ignored", error_code: "bot_generated" });
  });

  it("exposes delivery history only through admin-authenticated routes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    const forwarded = await dispatch(await githubWebhookRequest({
      deliveryId: "44444444-4444-4444-8444-444444444444",
    }));
    await waitOnExecutionContext(forwarded.context);

    const unauthorized = await dispatch(new Request("https://intake.example/api/admin/github-webhooks"));
    expect(unauthorized.response.status).toBe(401);

    const list = await dispatch(new Request("https://intake.example/api/admin/github-webhooks?limit=10", {
      headers: adminHeaders,
    }));
    expect(list.response.status).toBe(200);
    const payload = await list.response.json<{ deliveries: Array<{ delivery_id: string }> }>();
    expect(payload.deliveries).toHaveLength(1);
    expect(payload.deliveries[0].delivery_id).toBe("44444444-4444-4444-8444-444444444444");

    const detail = await dispatch(new Request(
      `https://intake.example/api/admin/github-webhooks/${payload.deliveries[0].delivery_id}`,
      { headers: adminHeaders },
    ));
    expect(detail.response.status).toBe(200);
    await expect(detail.response.json()).resolves.toMatchObject({
      ok: true,
      delivery: {
        delivery_id: "44444444-4444-4444-8444-444444444444",
        normalized: { event: "issue.opened" },
      },
    });
  });
});
