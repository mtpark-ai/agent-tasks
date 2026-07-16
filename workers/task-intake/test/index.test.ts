import { applyD1Migrations, createExecutionContext, env, type D1Migration } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";

const testEnv = env as Env & { ADMIN_TOKEN: string; GITHUB_TOKEN: string; TEST_MIGRATIONS: D1Migration[] };
const adminHeaders = { authorization: "Bearer admin-secret" };

function adminRequest(path: string, method = "GET", body?: unknown): Request {
  return new Request(`https://intake.example${path}`, {
    method,
    headers: {
      ...adminHeaders,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function deviceRequest(token: string, body: unknown, key = "voice-task-0001"): Request {
  return new Request("https://intake.example/tasks", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": key,
    },
    body: JSON.stringify(body),
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
    testEnv.DB.prepare("INSERT INTO settings (key, value) VALUES ('bootstrap_completed_at', '2026-07-16T00:00:00Z')"),
  ]);
}

async function createDevice(name = "personal-iphone"): Promise<{ id: string; token: string }> {
  const response = await dispatch(adminRequest("/api/admin/devices", "POST", { name }));
  expect(response.status).toBe(201);
  const payload = await response.json<{ device: { id: string }; token: string }>();
  return { id: payload.device.id, token: payload.token };
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
  ]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("setup portal and task intake", () => {
  it("exposes health and a safe coarse-grained public status", async () => {
    const health = await dispatch(new Request("https://intake.example/health"));
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({ ok: true, version: "0.2.0" });

    const status = await dispatch(new Request("https://intake.example/api/public/status"));
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toMatchObject({
      ok: true,
      state: "repository_unconfigured",
      version: "0.2.0",
      shortcut_available: false,
      steps: {
        database: true,
        admin_secret: true,
        github_secret: true,
        repository: false,
        device: false,
      },
    });
  });

  it("requires the admin secret for all management routes", async () => {
    const response = await dispatch(new Request("https://intake.example/api/admin/status"));
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    await expect(response.json()).resolves.toEqual({ ok: false, error: "unauthorized" });
  });

  it("bootstraps only the fixed labels and persists private repository settings", async () => {
    const github = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      const method = init.method ?? "GET";
      if (url === "https://api.github.com/repos/example-owner/task-repo" && method === "GET") {
        return Response.json({ visibility: "private", private: true });
      }
      if (url.includes("/labels/") && method === "PATCH") {
        return Response.json({ ok: true });
      }
      return Response.json({ unexpected: { url, method } }, { status: 500 });
    });
    vi.stubGlobal("fetch", github);

    const response = await dispatch(adminRequest("/api/admin/bootstrap", "POST", {
      github_owner: "example-owner",
      github_repo: "task-repo",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      repository: "example-owner/task-repo",
      repository_visibility: "private",
      created_labels: [],
      updated_labels: [
        "status:needs-triage",
        "agent:unassigned",
        "type:raw",
        "source:external",
      ],
      ready: true,
    });

    const stored = await testEnv.DB.prepare(
      "SELECT value FROM settings WHERE key = 'github_owner'",
    ).first<{ value: string }>();
    expect(stored?.value).toBe("example-owner");
    const mutations = github.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "PATCH");
    expect(mutations).toHaveLength(4);
  });

  it("requires an explicit confirmation before using a public task repository", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ visibility: "public", private: false })));

    const response = await dispatch(adminRequest("/api/admin/bootstrap", "POST", {
      github_owner: "example-owner",
      github_repo: "public-tasks",
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "public_repository_requires_confirmation",
      repository: "example-owner/public-tasks",
    });
    const stored = await testEnv.DB.prepare("SELECT COUNT(*) AS count FROM settings").first<{ count: number }>();
    expect(stored?.count).toBe(0);
  });

  it("creates one-time per-device tokens and stores only their hashes", async () => {
    const device = await createDevice();
    expect(device.token).toMatch(/^atd_[A-Za-z0-9_-]{40,}$/);

    const stored = await testEnv.DB.prepare(
      "SELECT token_hash FROM devices WHERE id = ?",
    ).bind(device.id).first<{ token_hash: string }>();
    expect(stored?.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored?.token_hash).not.toContain(device.token);

    const list = await dispatch(adminRequest("/api/admin/devices"));
    const payload = await list.json<{ devices: Array<Record<string, unknown>> }>();
    expect(payload.devices[0]).not.toHaveProperty("token_hash");
  });

  it("creates a task once for an idempotency key and returns the original Issue on retry", async () => {
    await configureRepository();
    const device = await createDevice();
    const github = vi.fn().mockResolvedValue(Response.json({
      number: 42,
      html_url: "https://github.com/example-owner/task-repo/issues/42",
    }, { status: 201 }));
    vi.stubGlobal("fetch", github);

    const payload = { task: { text: "修复登录页崩溃并创建 Draft PR" }, source: "ios-shortcut" };
    const first = await dispatch(deviceRequest(device.token, payload));
    expect(first.status).toBe(201);
    await expect(first.json()).resolves.toMatchObject({
      ok: true,
      request_id: "voice-task-0001",
      issue_number: 42,
    });

    const retry = await dispatch(deviceRequest(device.token, payload));
    expect(retry.status).toBe(200);
    await expect(retry.json()).resolves.toMatchObject({
      ok: true,
      duplicate: true,
      issue_number: 42,
    });
    expect(github).toHaveBeenCalledOnce();

    const [, init] = github.mock.calls[0] as [string, RequestInit];
    const issue = JSON.parse(String(init.body));
    expect(issue.title).toContain("修复登录页崩溃并创建 Draft PR");
    expect(issue.body).toContain("Device: `personal-iphone`");
    expect(issue.body).toContain("Request ID: `voice-task-0001`");

    const conflict = await dispatch(deviceRequest(device.token, { task: { text: "另一个任务" } }));
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toEqual({ ok: false, error: "idempotency_conflict" });
  });

  it("rejects a revoked device token before calling GitHub", async () => {
    await configureRepository();
    const device = await createDevice();
    const revoke = await dispatch(adminRequest(`/api/admin/devices/${device.id}`, "DELETE"));
    expect(revoke.status).toBe(200);

    const github = vi.fn();
    vi.stubGlobal("fetch", github);
    const response = await dispatch(deviceRequest(device.token, { task: { text: "不应创建" } }, "voice-task-0002"));
    expect(response.status).toBe(401);
    expect(github).not.toHaveBeenCalled();
  });

  it("redirects the Shortcut endpoint to the guide until a reviewed URL is configured", async () => {
    const guide = await dispatch(new Request("https://intake.example/shortcut"));
    expect(guide.status).toBe(302);
    expect(guide.headers.get("location")).toBe("https://intake.example/shortcut-guide.html");

    await testEnv.DB.prepare("INSERT INTO settings (key, value) VALUES ('shortcut_url', ?)")
      .bind("https://www.icloud.com/shortcuts/example").run();
    const configured = await dispatch(new Request("https://intake.example/shortcut"));
    expect(configured.status).toBe(302);
    expect(configured.headers.get("location")).toBe("https://www.icloud.com/shortcuts/example");
  });
});
