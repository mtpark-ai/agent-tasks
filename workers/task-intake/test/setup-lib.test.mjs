import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
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
  normalizeWorkerName,
  parseRepoSlug,
  parseWranglerDeployUrl,
  runWrangler,
  verifyEndpoint,
  writeDeploymentConfig,
  writeLocalInstallFile,
} from "../scripts/setup-lib.mjs";

test("parseRepoSlug accepts slugs and GitHub URLs", () => {
  assert.deepEqual(parseRepoSlug("octo-org/tasks"), { owner: "octo-org", repo: "tasks" });
  assert.deepEqual(parseRepoSlug("https://github.com/octo-org/tasks.git"), { owner: "octo-org", repo: "tasks" });
  assert.throws(() => parseRepoSlug("not-a-slug"), /owner\/repo/);
});

test("buildWranglerVarArgs describes deploy config without rewriting JSONC", () => {
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

test("normalizeWorkerName rejects unsafe Worker names", () => {
  assert.equal(normalizeWorkerName("My-Task-Intake"), "my-task-intake");
  assert.throws(() => normalizeWorkerName("-bad"), /Worker/);
  assert.throws(() => normalizeWorkerName("bad_name"), /Worker/);
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

test("runWrangler uses Node for Wrangler on every platform and keeps secrets out of args", async () => {
  const result = await runWrangler(["secret", "put", "AUTH_TOKEN"], {
    input: "generated-token",
    execPath: "/usr/bin/node",
    runCommand: async (command, args, options) => {
      assert.equal(command, "/usr/bin/node");
      assert.match(args[0], /node_modules[\\/]wrangler[\\/]bin[\\/]wrangler\.js$/);
      assert.deepEqual(args.slice(1), ["secret", "put", "AUTH_TOKEN"]);
      assert.equal(options.input, "generated-token");
      assert.equal(args.includes("generated-token"), false);
      return { code: 0, stdout: "ok", stderr: "" };
    },
  });
  assert.equal(result.stdout, "ok");
});

test("writeDeploymentConfig persists real non-secret vars without changing the template", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "task-intake-config-"));
  const templatePath = path.join(directory, "wrangler.jsonc");
  const outputPath = path.join(directory, ".task-intake.deploy.jsonc");
  await writeFile(templatePath, JSON.stringify({
    name: "agent-task-intake",
    main: "src/index.ts",
    vars: { GITHUB_OWNER: "REPLACE_WITH_GITHUB_OWNER" },
  }));

  await writeDeploymentConfig({
    templatePath,
    outputPath,
    workerName: "octo-intake",
    owner: "octo",
    repo: "tasks",
  });

  const generated = JSON.parse(await readFile(outputPath, "utf8"));
  assert.equal(generated.name, "octo-intake");
  assert.deepEqual(generated.vars, {
    GITHUB_OWNER: "octo",
    GITHUB_REPO: "tasks",
    ISSUE_LABELS: "status:needs-triage,agent:unassigned,type:raw,source:external",
    MAX_BODY_BYTES: "50000",
  });
  assert.match(await readFile(templatePath, "utf8"), /REPLACE_WITH_GITHUB_OWNER/);
  if (process.platform !== "win32") {
    assert.equal((await stat(outputPath)).mode & 0o777, 0o600);
  }
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

test("writeLocalInstallFile writes JSON with 0600 permissions on POSIX", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "task-intake-"));
  const filePath = path.join(directory, "install.json");
  await writeLocalInstallFile(filePath, { endpoint_url: "https://worker.example", auth_token: "secret" });

  assert.deepEqual(JSON.parse(await readFile(filePath, "utf8")), {
    endpoint_url: "https://worker.example",
    auth_token: "secret",
  });
  if (process.platform !== "win32") {
    assert.equal((await stat(filePath)).mode & 0o777, 0o600);
  }
});
