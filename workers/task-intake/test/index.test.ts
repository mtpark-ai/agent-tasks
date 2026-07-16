import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";

const env: Env = {
  AUTH_TOKEN: "intake-secret",
  GITHUB_TOKEN: "github-secret",
  GITHUB_OWNER: "example-owner",
  GITHUB_REPO: "task-repo",
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

function authenticatedRequest(path: string, method = "GET", token = env.AUTH_TOKEN): Request {
  return new Request(`https://intake.example${path}`, {
    method,
    headers: { authorization: `Bearer ${token}` },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
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
    const bootstrapMissing = await worker.fetch!(
      new Request("https://intake.example/bootstrap", { method: "POST" }),
      env,
      ctx,
    );

    expect(missing.status).toBe(401);
    expect(invalid.status).toBe(401);
    expect(bootstrapMissing.status).toBe(401);
    expect(missing.headers.get("www-authenticate")).toBe("Bearer");
    expect(github).not.toHaveBeenCalled();
  });

  it("stores arbitrary JSON verbatim in a raw, untriaged GitHub issue", async () => {
    const github = vi.fn().mockResolvedValue(
      Response.json(
        { number: 42, html_url: "https://github.com/example-owner/task-repo/issues/42" },
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
      issue_url: "https://github.com/example-owner/task-repo/issues/42",
    });
    expect(github).toHaveBeenCalledOnce();
    const [url, init] = github.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/example-owner/task-repo/issues");
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
    const wrongTaskMethod = await worker.fetch!(
      new Request("https://intake.example/tasks", { method: "GET" }),
      env,
      ctx,
    );
    const wrongBootstrapMethod = await worker.fetch!(
      new Request("https://intake.example/bootstrap", { method: "GET" }),
      env,
      ctx,
    );
    const unknown = await worker.fetch!(new Request("https://intake.example/unknown"), env, ctx);

    expect(wrongType.status).toBe(415);
    expect(malformed.status).toBe(400);
    expect(oversized.status).toBe(413);
    expect(wrongTaskMethod.status).toBe(405);
    expect(wrongTaskMethod.headers.get("allow")).toBe("POST");
    expect(wrongBootstrapMethod.status).toBe(405);
    expect(wrongBootstrapMethod.headers.get("allow")).toBe("POST");
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

  it("fails closed before GitHub when deployment-specific config is missing or a placeholder", async () => {
    const github = vi.fn();
    vi.stubGlobal("fetch", github);
    const placeholderEnv: Env = {
      ...env,
      GITHUB_OWNER: "REPLACE_WITH_GITHUB_OWNER",
    };

    const response = await worker.fetch!(taskRequest({ raw: "task" }), placeholderEnv, ctx);
    const localExampleResponse = await worker.fetch!(taskRequest({ raw: "task" }), {
      ...env,
      GITHUB_OWNER: "your-github-owner",
      GITHUB_REPO: "your-task-repository",
    }, ctx);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "configuration_not_ready",
      invalid: ["GITHUB_OWNER"],
    });
    expect(localExampleResponse.status).toBe(503);
    await expect(localExampleResponse.json()).resolves.toMatchObject({
      ok: false,
      error: "configuration_not_ready",
      invalid: ["GITHUB_OWNER", "GITHUB_REPO"],
    });
    expect(github).not.toHaveBeenCalled();
  });

  it("does not reveal non-auth configuration problems to invalid bearer tokens", async () => {
    const github = vi.fn();
    vi.stubGlobal("fetch", github);
    const placeholderEnv: Env = {
      ...env,
      GITHUB_OWNER: "REPLACE_WITH_GITHUB_OWNER",
    };

    const response = await worker.fetch!(taskRequest({ raw: "task" }, "wrong-token"), placeholderEnv, ctx);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "unauthorized" });
    expect(github).not.toHaveBeenCalled();
  });

  it("requires bearer auth for readiness and bootstrap checks", async () => {
    const github = vi.fn();
    vi.stubGlobal("fetch", github);

    const readinessMissing = await worker.fetch!(new Request("https://intake.example/ready"), env, ctx);
    const readinessInvalid = await worker.fetch!(authenticatedRequest("/ready", "GET", "wrong-token"), env, ctx);
    const bootstrapInvalid = await worker.fetch!(authenticatedRequest("/bootstrap", "POST", "wrong-token"), env, ctx);

    expect(readinessMissing.status).toBe(401);
    expect(readinessInvalid.status).toBe(401);
    expect(bootstrapInvalid.status).toBe(401);
    expect(github).not.toHaveBeenCalled();
  });

  it("bootstraps fixed protocol labels, verifies write access, and finishes ready", async () => {
    const labelNames = [
      "status:needs-triage",
      "agent:unassigned",
      "type:raw",
      "source:external",
    ];
    let repositoryReads = 0;
    const github = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = String(input);
      const method = init.method ?? "GET";

      if (url === "https://api.github.com/repos/example-owner/task-repo" && method === "GET") {
        repositoryReads += 1;
        return Response.json({ id: 1 });
      }

      if (repositoryReads > 1 && method === "GET" && url.includes("/labels/")) {
        return Response.json({ name: decodeURIComponent(url.split("/").at(-1) ?? "") });
      }

      if (method === "PATCH" && url.endsWith("/labels/agent%3Aunassigned")) {
        return Response.json({ message: "Not Found" }, { status: 404 });
      }
      if (method === "POST" && url.endsWith("/labels")) {
        return Response.json({ name: "agent:unassigned" }, { status: 201 });
      }
      if (method === "PATCH" && url.includes("/labels/")) {
        return Response.json({ ok: true });
      }

      return Response.json({ unexpected: { url, method } }, { status: 500 });
    });
    vi.stubGlobal("fetch", github);

    const response = await worker.fetch!(authenticatedRequest("/bootstrap", "POST"), env, ctx);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      repository: "example-owner/task-repo",
      created_labels: ["agent:unassigned"],
      updated_labels: ["status:needs-triage", "type:raw", "source:external"],
      labels: labelNames,
      ready: true,
    });

    const mutations = github.mock.calls
      .map(([url, init]) => ({ url: String(url), method: (init as RequestInit | undefined)?.method ?? "GET", body: (init as RequestInit | undefined)?.body }))
      .filter(({ method }) => method === "PATCH" || method === "POST");
    expect(mutations).toHaveLength(5);
    expect(mutations.filter(({ method }) => method === "PATCH")).toHaveLength(4);
    expect(mutations.filter(({ method }) => method === "POST")).toHaveLength(1);

    const createdBody = JSON.parse(String(mutations.find(({ method }) => method === "POST")?.body));
    expect(createdBody).toEqual({
      name: "agent:unassigned",
      color: "ededed",
      description: "尚未指派执行 Agent",
    });
  });

  it("returns a safe bootstrap error when the GitHub token cannot write labels", async () => {
    const github = vi.fn()
      .mockResolvedValueOnce(Response.json({ id: 1 }))
      .mockResolvedValueOnce(Response.json({ message: "Resource not accessible" }, { status: 403 }));
    vi.stubGlobal("fetch", github);

    const response = await worker.fetch!(authenticatedRequest("/bootstrap", "POST"), env, ctx);

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "github_label_bootstrap_failed",
      label: "status:needs-triage",
      github_status: 403,
    });
  });

  it("verifies GitHub repository access and configured labels on readiness checks", async () => {
    const github = vi.fn().mockResolvedValue(Response.json({ id: 1 }, { status: 200 }));
    vi.stubGlobal("fetch", github);

    const response = await worker.fetch!(authenticatedRequest("/ready"), env, ctx);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      repository: "example-owner/task-repo",
      labels: ["status:needs-triage", "agent:unassigned", "type:raw", "source:external"],
      max_body_bytes: 50000,
    });
    expect(github).toHaveBeenCalledTimes(5);
    expect(github.mock.calls.map(([url]) => url)).toEqual([
      "https://api.github.com/repos/example-owner/task-repo",
      "https://api.github.com/repos/example-owner/task-repo/labels/status%3Aneeds-triage",
      "https://api.github.com/repos/example-owner/task-repo/labels/agent%3Aunassigned",
      "https://api.github.com/repos/example-owner/task-repo/labels/type%3Araw",
      "https://api.github.com/repos/example-owner/task-repo/labels/source%3Aexternal",
    ]);
  });

  it("returns safe readiness errors for missing labels and repository failures", async () => {
    const missingLabelFetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ id: 1 }, { status: 200 }))
      .mockResolvedValueOnce(Response.json({ name: "status:needs-triage" }, { status: 200 }))
      .mockResolvedValueOnce(Response.json({ message: "Not Found" }, { status: 404 }))
      .mockResolvedValue(Response.json({ name: "ok" }, { status: 200 }));
    vi.stubGlobal("fetch", missingLabelFetch);

    const missingLabel = await worker.fetch!(authenticatedRequest("/ready"), env, ctx);

    expect(missingLabel.status).toBe(502);
    await expect(missingLabel.json()).resolves.toEqual({
      ok: false,
      error: "github_labels_missing",
      missing_labels: ["agent:unassigned"],
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ message: "Bad credentials" }, { status: 401 })));
    const inaccessibleRepo = await worker.fetch!(authenticatedRequest("/ready"), env, ctx);

    expect(inaccessibleRepo.status).toBe(502);
    await expect(inaccessibleRepo.json()).resolves.toEqual({
      ok: false,
      error: "github_repository_unreachable",
      github_status: 401,
    });
  });
});
