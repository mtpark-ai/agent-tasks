import { applyD1Migrations, createExecutionContext, env, type D1Migration } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/persistent-worker";

const testEnv = env as Env & {
  ADMIN_TOKEN: string;
  GITHUB_TOKEN: string;
  TEST_MIGRATIONS: D1Migration[];
};

function adminRequest(path: string): Request {
  return new Request(`https://intake.example${path}`, {
    headers: { authorization: "Bearer admin-secret" },
  });
}

async function dispatch(request: Request): Promise<Response> {
  return worker.fetch!(request as Request<unknown, IncomingRequestCfProperties>, testEnv, createExecutionContext());
}

async function configureRepository(): Promise<void> {
  await testEnv.DB.batch([
    testEnv.DB.prepare("INSERT INTO settings (key, value) VALUES ('github_owner', 'example-owner')"),
    testEnv.DB.prepare("INSERT INTO settings (key, value) VALUES ('github_repo', 'task-repo')"),
    testEnv.DB.prepare("INSERT INTO settings (key, value) VALUES ('repository_visibility', 'private')"),
    testEnv.DB.prepare("INSERT INTO settings (key, value) VALUES ('bootstrap_completed_at', '2026-07-17T00:00:00Z')"),
  ]);
}

async function createDevice(): Promise<string> {
  const response = await dispatch(new Request("https://intake.example/api/admin/devices", {
    method: "POST",
    headers: {
      authorization: "Bearer admin-secret",
      "content-type": "application/json",
    },
    body: JSON.stringify({ name: "personal-iphone" }),
  }));
  expect(response.status).toBe(201);
  const payload = await response.json<{ token: string }>();
  return payload.token;
}

function taskRequest(token: string, key = "voice-task-persist-0001"): Request {
  return new Request("https://intake.example/tasks", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": key,
    },
    body: JSON.stringify({
      source: "ios-shortcut",
      task: { text: "把这个请求保存到 D1" },
    }),
  });
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
  ]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("D1 task request persistence", () => {
  it("stores an authenticated request before creating the GitHub Issue and records the result", async () => {
    await configureRepository();
    const token = await createDevice();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      number: 42,
      html_url: "https://github.com/example-owner/task-repo/issues/42",
    }, { status: 201 })));

    const response = await dispatch(taskRequest(token));
    expect(response.status).toBe(201);

    const row = await testEnv.DB.prepare(
      `SELECT request_id, device_name, task_text, raw_body, status, response_status,
              duplicate, issue_number, issue_url
       FROM task_requests LIMIT 1`,
    ).first<Record<string, unknown>>();

    expect(row).toMatchObject({
      request_id: "voice-task-persist-0001",
      device_name: "personal-iphone",
      task_text: "把这个请求保存到 D1",
      status: "completed",
      response_status: 201,
      duplicate: 0,
      issue_number: 42,
      issue_url: "https://github.com/example-owner/task-repo/issues/42",
    });
    expect(JSON.parse(String(row?.raw_body))).toMatchObject({ task: { text: "把这个请求保存到 D1" } });
  });

  it("keeps one D1 row per HTTP attempt while GitHub idempotency still creates one Issue", async () => {
    await configureRepository();
    const token = await createDevice();
    const github = vi.fn().mockResolvedValue(Response.json({
      number: 43,
      html_url: "https://github.com/example-owner/task-repo/issues/43",
    }, { status: 201 }));
    vi.stubGlobal("fetch", github);

    const first = await dispatch(taskRequest(token, "voice-task-persist-0002"));
    const retry = await dispatch(taskRequest(token, "voice-task-persist-0002"));
    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(github).toHaveBeenCalledOnce();

    const rows = await testEnv.DB.prepare(
      `SELECT request_id, duplicate, issue_number, status
       FROM task_requests ORDER BY received_at ASC, id ASC`,
    ).all<Record<string, unknown>>();
    expect(rows.results).toHaveLength(2);
    expect(rows.results[0]).toMatchObject({
      request_id: "voice-task-persist-0002",
      duplicate: 0,
      issue_number: 43,
      status: "completed",
    });
    expect(rows.results[1]).toMatchObject({
      request_id: "voice-task-persist-0002",
      duplicate: 1,
      issue_number: 43,
      status: "completed",
    });
  });

  it("records rejected authenticated requests without storing bearer credentials", async () => {
    await configureRepository();
    const token = await createDevice();
    const response = await dispatch(new Request("https://intake.example/tasks", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "text/plain",
      },
      body: "not-json",
    }));
    expect(response.status).toBe(415);

    const row = await testEnv.DB.prepare(
      "SELECT raw_body, status, response_status, error_code FROM task_requests LIMIT 1",
    ).first<Record<string, unknown>>();
    expect(row).toMatchObject({
      raw_body: "not-json",
      status: "rejected",
      response_status: 415,
      error_code: "content_type_must_be_application_json",
    });
    expect(String(row?.raw_body)).not.toContain(token);
  });

  it("does not persist unauthenticated traffic", async () => {
    const response = await dispatch(new Request("https://intake.example/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task: { text: "unauthorized" } }),
    }));
    expect(response.status).toBe(401);

    const count = await testEnv.DB.prepare("SELECT COUNT(*) AS count FROM task_requests")
      .first<{ count: number }>();
    expect(Number(count?.count ?? 0)).toBe(0);
  });

  it("exposes persisted history only through authenticated admin routes", async () => {
    await configureRepository();
    const token = await createDevice();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      number: 44,
      html_url: "https://github.com/example-owner/task-repo/issues/44",
    }, { status: 201 })));
    await dispatch(taskRequest(token, "voice-task-persist-0003"));

    const unauthorized = await dispatch(new Request("https://intake.example/api/admin/task-requests"));
    expect(unauthorized.status).toBe(401);

    const list = await dispatch(adminRequest("/api/admin/task-requests?limit=10"));
    expect(list.status).toBe(200);
    const listPayload = await list.json<{ requests: Array<{ id: string; request_id: string }> }>();
    expect(listPayload.requests).toHaveLength(1);
    expect(listPayload.requests[0].request_id).toBe("voice-task-persist-0003");

    const detail = await dispatch(adminRequest(`/api/admin/task-requests/${listPayload.requests[0].id}`));
    expect(detail.status).toBe(200);
    await expect(detail.json()).resolves.toMatchObject({
      ok: true,
      request: {
        request_id: "voice-task-persist-0003",
        payload: { task: { text: "把这个请求保存到 D1" } },
      },
    });
  });
});
