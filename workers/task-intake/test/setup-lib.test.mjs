import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LABELS,
  buildWranglerVarArgs,
  ensureGitHubLabels,
  generateAuthToken,
  normalizeEndpointUrl,
  parseRepoSlug,
  parseWranglerDeployUrl,
  runWrangler,
  verifyEndpoint,
  writeLocalInstallFile,
} from "../scripts/setup-lib.mjs";

test("parseRepoSlug accepts slugs and GitHub URLs", () => {
  assert.deepEqual(parseRepoSlug("octo-org/tasks"), { owner: "octo-org", repo: "tasks" });
  assert.deepEqual(parseRepoSlug("https://github.com/octo-org/tasks.git"), { owner: "octo-org", repo: "tasks" });
  assert.throws(() => parseRepoSlug("not-a-slug"), /owner\/repo/);
});

test("buildWranglerVarArgs passes deploy config without rewriting JSONC", () => {
  assert.deepEqual(buildWranglerVarArgs({ owner: "octo", repo: "tasks" }), [
    "--var",
    "GITHUB_OWNER:octo",
    "--var",
    "GITHUB_REPO:tasks",
    "--var",
    "ISSUE_LABELS:status:needs-triage,agent:unassigned,type:raw,source:external",
    "--var",
    "MAX_BODY_BYTES:50000",
  ]);
});

test("generateAuthToken returns base64url material from cryptographic bytes", () => {
  const token = generateAuthToken(32, (size) => Buffer.alloc(size, 1));
  assert.equal(token, "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE");
  assert.match(token, /^[A-Za-z0-9_-]+$/);
});

test("parseWranglerDeployUrl extracts workers.dev endpoint", () => {
  assert.equal(
    parseWranglerDeployUrl("Uploaded agent-task-intake\nhttps://agent-task-intake.example.workers.dev"),
    "https://agent-task-intake.example.workers.dev",
  );
  assert.equal(parseWranglerDeployUrl("no url here"), null);
});

test("ensureGitHubLabels creates only missing labels and supports dry-run", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    if (init.method === "POST") return Response.json({ ok: true }, { status: 201 });
    if (String(url).endsWith("/labels/status%3Aneeds-triage")) return Response.json({ name: "status:needs-triage" });
    return Response.json({ message: "Not Found" }, { status: 404 });
  };

  const dryRun = await ensureGitHubLabels({
    fetchImpl,
    owner: "octo",
    repo: "tasks",
    githubToken: "secret",
    labels: DEFAULT_LABELS.slice(0, 2),
    dryRun: true,
  });
  assert.deepEqual(dryRun, {
    existing: ["status:needs-triage"],
    created: [],
    wouldCreate: ["agent:unassigned"],
  });

  calls.length = 0;
  const created = await ensureGitHubLabels({
    fetchImpl,
    owner: "octo",
    repo: "tasks",
    githubToken: "secret",
    labels: DEFAULT_LABELS.slice(0, 2),
  });
  assert.deepEqual(created, {
    existing: ["status:needs-triage"],
    created: ["agent:unassigned"],
    wouldCreate: [],
  });
  assert.equal(calls.filter((call) => call.init.method === "POST").length, 1);
  assert.equal(JSON.parse(calls.find((call) => call.init.method === "POST").init.body).name, "agent:unassigned");
});

test("runWrangler injects command runner and stdin without exposing secrets in args", async () => {
  const result = await runWrangler(["secret", "put", "AUTH_TOKEN"], {
    input: "generated-token",
    runCommand: async (command, args, options) => {
      assert.match(command, /wrangler/);
      assert.deepEqual(args, ["secret", "put", "AUTH_TOKEN"]);
      assert.equal(options.input, "generated-token");
      return { code: 0, stdout: "ok", stderr: "" };
    },
  });
  assert.equal(result.stdout, "ok");
});

test("verifyEndpoint checks health and authenticated readiness", async () => {
  const calls = [];
  await verifyEndpoint({
    endpointUrl: normalizeEndpointUrl("https://worker.example/"),
    authToken: "secret",
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, init });
      return Response.json({ ok: true });
    },
  });
  assert.equal(calls[0].url, "https://worker.example/health");
  assert.equal(calls[1].url, "https://worker.example/ready");
  assert.equal(calls[1].init.headers.authorization, "Bearer secret");
});

test("writeLocalInstallFile writes JSON with 0600 permissions", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "task-intake-"));
  const filePath = path.join(directory, "install.json");
  await writeLocalInstallFile(filePath, { endpoint_url: "https://worker.example", auth_token: "secret" });

  assert.deepEqual(JSON.parse(await readFile(filePath, "utf8")), {
    endpoint_url: "https://worker.example",
    auth_token: "secret",
  });
  assert.equal((await stat(filePath)).mode & 0o777, 0o600);
});
