import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  detectGitHubRepository,
  generateAuthToken,
  normalizeEndpointUrl,
  normalizeWorkerName,
  parseRepoSlug,
  requestJson,
  writeLocalInstallFile,
} from "../scripts/setup-lib.mjs";

test("parseRepoSlug accepts slugs and GitHub HTTPS/SSH URLs", () => {
  assert.deepEqual(parseRepoSlug("octo-org/tasks"), { owner: "octo-org", repo: "tasks" });
  assert.deepEqual(parseRepoSlug("https://github.com/octo-org/tasks.git"), { owner: "octo-org", repo: "tasks" });
  assert.deepEqual(parseRepoSlug("git@github.com:octo-org/tasks.git"), { owner: "octo-org", repo: "tasks" });
  assert.throws(() => parseRepoSlug("not-a-slug"), /GitHub/);
});

test("normalizeEndpointUrl requires HTTPS outside localhost", () => {
  assert.equal(normalizeEndpointUrl("https://worker.example/"), "https://worker.example");
  assert.equal(normalizeEndpointUrl("http://localhost:8787/"), "http://localhost:8787");
  assert.throws(() => normalizeEndpointUrl("http://worker.example"), /HTTPS/);
});

test("generateAuthToken returns base64url cryptographic material", () => {
  const token = generateAuthToken(32, (size) => Buffer.alloc(size, 1));
  assert.equal(token, "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE");
  assert.match(token, /^[A-Za-z0-9_-]+$/);
});

test("normalizeWorkerName rejects unsafe names", () => {
  assert.equal(normalizeWorkerName("My-Task-Intake"), "my-task-intake");
  assert.throws(() => normalizeWorkerName("bad_name"), /Worker/);
});

test("detectGitHubRepository reads origin without shell interpolation", async () => {
  const repository = await detectGitHubRepository({
    runCommand: async (command, args) => {
      assert.equal(command, "git");
      assert.deepEqual(args, ["remote", "get-url", "origin"]);
      return { code: 0, stdout: "git@github.com:octo/tasks.git\n", stderr: "" };
    },
  });
  assert.deepEqual(repository, { owner: "octo", repo: "tasks" });
});

test("requestJson sends bearer auth and normalizes API failures", async () => {
  const ok = await requestJson("https://worker.example/api/admin/status", {
    token: "secret",
    fetchImpl: async (_url, init) => {
      assert.equal(init.headers.authorization, "Bearer secret");
      return Response.json({ ok: true });
    },
  });
  assert.deepEqual(ok, { ok: true });

  await assert.rejects(() => requestJson("https://worker.example/fail", {
    fetchImpl: async () => Response.json({ error: "bad" }, { status: 400 }),
  }), /bad/);
});

test("requestJson retries transient bootstrap errors while Worker secrets propagate", async () => {
  const responses = [
    Response.json({ ok: false, error: "admin_not_configured" }, { status: 503 }),
    Response.json({ ok: false, error: "unauthorized" }, { status: 401 }),
    Response.json({ ok: false, error: "github_token_not_configured" }, { status: 503 }),
    Response.json({ ok: true, ready: true }),
  ];
  const delays = [];
  const retries = [];
  let calls = 0;

  const result = await requestJson("https://worker.example/api/admin/bootstrap", {
    method: "POST",
    token: "new-admin-token",
    body: { github_owner: "octo", github_repo: "tasks" },
    retryDelays: [1, 2, 3],
    sleepImpl: async (delayMs) => { delays.push(delayMs); },
    onRetry: (event) => { retries.push(event); },
    fetchImpl: async () => responses[calls++],
  });

  assert.deepEqual(result, { ok: true, ready: true });
  assert.equal(calls, 4);
  assert.deepEqual(delays, [1, 2, 3]);
  assert.deepEqual(retries.map((event) => event.errorCode), [
    "admin_not_configured",
    "unauthorized",
    "github_token_not_configured",
  ]);
});

test("requestJson does not retry admin errors outside bootstrap", async () => {
  let calls = 0;
  await assert.rejects(() => requestJson("https://worker.example/api/admin/devices", {
    method: "POST",
    token: "wrong-token",
    body: { name: "iphone" },
    retryDelays: [1, 2],
    sleepImpl: async () => { throw new Error("sleep should not run"); },
    onRetry: () => { throw new Error("retry should not run"); },
    fetchImpl: async () => {
      calls += 1;
      return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
    },
  }), /unauthorized/);
  assert.equal(calls, 1);
});

test("requestJson reports a useful error after bootstrap propagation timeout", async () => {
  await assert.rejects(() => requestJson("https://worker.example/api/admin/bootstrap", {
    method: "POST",
    token: "new-admin-token",
    body: {},
    retryDelays: [1, 2],
    sleepImpl: async () => undefined,
    onRetry: null,
    fetchImpl: async () => Response.json({ ok: false, error: "admin_not_configured" }, { status: 503 }),
  }), /Wrangler 登录账号、Worker 名称和 CLOUDFLARE_ENV/);
});

test("writeLocalInstallFile uses 0600 permissions on POSIX", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agent-tasks-"));
  const filePath = path.join(directory, "install.json");
  await writeLocalInstallFile(filePath, { device_token: "secret" });
  assert.deepEqual(JSON.parse(await readFile(filePath, "utf8")), { device_token: "secret" });
  if (process.platform !== "win32") assert.equal((await stat(filePath)).mode & 0o777, 0o600);
});
