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

test("writeLocalInstallFile uses 0600 permissions on POSIX", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agent-tasks-"));
  const filePath = path.join(directory, "install.json");
  await writeLocalInstallFile(filePath, { device_token: "secret" });
  assert.deepEqual(JSON.parse(await readFile(filePath, "utf8")), { device_token: "secret" });
  if (process.platform !== "win32") assert.equal((await stat(filePath)).mode & 0o777, 0o600);
});
