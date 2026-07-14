import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";

const env: Env = {
  AUTH_TOKEN: "intake-secret",
  GITHUB_TOKEN: "github-secret",
  GITHUB_OWNER: "mtpark-ai",
  GITHUB_REPO: "agent-tasks",
  ISSUE_LABELS: "status:needs-triage,agent:unassigned,type:raw,source:external",
  MAX_BODY_BYTES: "50000",
};

const ctx = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
  props: {},
} as unknown as ExecutionContext;

function taskRequest(body: unknown, token = env.AUTH_TOKEN): Request<unknown, IncomingRequestCfProperties> {
  return new Request("https://intake.example/tasks", {
    method: "POST",
    headers: {
      authorization: "Bear" + "er " + token,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  }) as Request<unknown, IncomingRequestCfProperties>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("agent task intake HTTP endpoint", () => {
  it("reports health without authentication", async () => {
    const response = await worker.fetch!(new Request("https://intake.example/health"), env, ctx);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("rejects missing or invalid bearer credentials before calling GitHub", async () => {
    const github = vi.fn();
    vi.stubGlobal("fetch", github);

    const missing = await worker.fetch!(
      new Request("https://intake.example/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      env,
      ctx,
    );
    const invalid = await worker.fetch!(taskRequest({}, "wrong-token"), env, ctx);

    expect(missing.status).toBe(401);
    expect(invalid.status).toBe(401);
    expect(missing.headers.get("www-authenticate")).toBe("Bearer");
    expect(github).not.toHaveBeenCalled();
  });

  it("stores arbitrary JSON verbatim in a raw, untriaged GitHub issue", async () => {
    const github = vi.fn().mockResolvedValue(
      Response.json(
        { number: 42, html_url: "https://github.com/mtpark-ai/agent-tasks/issues/42" },
        { status: 201 },
      ),
    );
    vi.stubGlobal("fetch", github);
    vi.spyOn(crypto, "randomUUID").mockReturnValue("12345678-1234-4234-8234-123456789abc");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T01:02:03.000Z"));

    const payload = {
      whatever_field: "无需预定义字段",
      nested: { intent: "让 Agent 自己理解", count: 3 },
      list: [true, null, 7],
    };
    const response = await worker.fetch!(taskRequest(payload), env, ctx);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      request_id: "12345678-1234-4234-8234-123456789abc",
      issue_number: 42,
      issue_url: "https://github.com/mtpark-ai/agent-tasks/issues/42",
    });
    expect(github).toHaveBeenCalledOnce();
    const [url, init] = github.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/mtpark-ai/agent-tasks/issues");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer github-secret");
    const issue = JSON.parse(String(init.body));
    expect(issue.title).toBe("[Raw Task] 2026-07-14T01:02:03.000Z · 12345678");
    expect(issue.labels).toEqual([
      "status:needs-triage",
      "agent:unassigned",
      "type:raw",
      "source:external",
    ]);
    expect(issue.body).toContain("```json\n" + JSON.stringify(payload, null, 2) + "\n```");
    expect(issue.body).toContain("Request ID: `12345678-1234-4234-8234-123456789abc`");

    vi.useRealTimers();
  });

  it("rejects non-JSON content, malformed JSON, oversized input, and unsupported routes", async () => {
    const github = vi.fn();
    vi.stubGlobal("fetch", github);

    const wrongType = await worker.fetch!(
      new Request("https://intake.example/tasks", {
        method: "POST",
        headers: { authorization: `Bearer ${env.AUTH_TOKEN}`, "content-type": "text/plain" },
        body: "hello",
      }),
      env,
      ctx,
    );
    const malformed = await worker.fetch!(
      new Request("https://intake.example/tasks", {
        method: "POST",
        headers: { authorization: `Bearer ${env.AUTH_TOKEN}`, "content-type": "application/json" },
        body: "{not-json",
      }),
      env,
      ctx,
    );
    const oversizedEnv = { ...env, MAX_BODY_BYTES: "10" } as unknown as Env;
    const oversized = await worker.fetch!(taskRequest({ value: "too long" }), oversizedEnv, ctx);
    const wrongMethod = await worker.fetch!(
      new Request("https://intake.example/tasks", { method: "GET" }),
      env,
      ctx,
    );
    const unknown = await worker.fetch!(new Request("https://intake.example/unknown"), env, ctx);

    expect(wrongType.status).toBe(415);
    expect(malformed.status).toBe(400);
    expect(oversized.status).toBe(413);
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("allow")).toBe("POST");
    expect(unknown.status).toBe(404);
    expect(github).not.toHaveBeenCalled();
  });

  it("returns a safe gateway error when GitHub rejects issue creation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ message: "Bad credentials" }, { status: 401 })));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await worker.fetch!(taskRequest({ raw: "task" }), env, ctx);

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "github_issue_creation_failed",
    });
  });
});
