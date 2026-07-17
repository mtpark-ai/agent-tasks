import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBootstrapPayload,
  buildFriendlyInstallSummary,
  buildGitHubTokenUrl,
  buildInstallSummary,
  buildRepositorySettingsUrl,
  parseOnboardArgs,
} from "../scripts/onboard-lib.mjs";

test("parseOnboardArgs parses explicit security choices", () => {
  assert.deepEqual(parseOnboardArgs([
    "--endpoint", "https://worker.example",
    "--repo", "octo/tasks",
    "--worker-name", "octo-intake",
    "--device-name", "my-iphone",
    "--shortcut-url", "https://www.icloud.com/shortcuts/example",
    "--allow-public-repo",
    "--json",
    "--yes",
  ]), {
    endpoint: "https://worker.example",
    repo: "octo/tasks",
    workerName: "octo-intake",
    deviceName: "my-iphone",
    shortcutUrl: "https://www.icloud.com/shortcuts/example",
    allowPublicRepository: true,
    skipTestTask: false,
    json: true,
    yes: true,
    dryRun: false,
  });
});

test("buildGitHubTokenUrl pre-fills only the required repository permissions", () => {
  const url = new URL(buildGitHubTokenUrl({ owner: "octo", repo: "tasks" }));
  assert.equal(url.origin, "https://github.com");
  assert.equal(url.pathname, "/settings/personal-access-tokens/new");
  assert.equal(url.searchParams.get("name"), "Agent Tasks Worker");
  assert.equal(url.searchParams.get("target_name"), "octo");
  assert.equal(url.searchParams.get("expires_in"), "365");
  assert.equal(url.searchParams.get("issues"), "write");
  assert.equal(url.searchParams.get("metadata"), "read");
  assert.equal(url.searchParams.has("contents"), false);
  assert.equal(url.searchParams.has("administration"), false);
  assert.match(url.searchParams.get("description"), /octo\/tasks/);
});

test("buildRepositorySettingsUrl points to the exact repository settings page", () => {
  assert.equal(
    buildRepositorySettingsUrl({ owner: "octo", repo: "tasks" }),
    "https://github.com/octo/tasks/settings",
  );
});

test("buildBootstrapPayload only confirms a public repository explicitly", () => {
  assert.deepEqual(buildBootstrapPayload({
    owner: "octo",
    repo: "tasks",
    visibility: "private",
    allowPublicRepository: false,
  }), {
    github_owner: "octo",
    github_repo: "tasks",
    allow_public_repository: false,
  });
  assert.equal(buildBootstrapPayload({
    owner: "octo",
    repo: "tasks",
    visibility: "public",
    allowPublicRepository: true,
  }).allow_public_repository, true);
});

test("buildInstallSummary points the user back to the self-hosted portal", () => {
  const summary = buildInstallSummary({
    endpointUrl: "https://worker.example",
    repository: "octo/tasks",
    workerName: "octo-intake",
    device: { id: "d1", name: "iphone" },
    tokenFile: ".task-intake.local.json",
  });
  assert.equal(summary.shortcut_url, "https://worker.example/shortcut");
  assert.match(summary.next_step, /iPhone 配置码/);
});

test("buildFriendlyInstallSummary exposes the device token but not an admin token", () => {
  const output = buildFriendlyInstallSummary({
    endpointUrl: "https://worker.example",
    deviceToken: "atd_device-secret",
    tokenFile: ".task-intake.local.json",
    testIssue: { issue_url: "https://github.com/octo/tasks/issues/1" },
  });
  assert.match(output, /✅ 设置完成/);
  assert.match(output, /atd_device-secret/);
  assert.match(output, /https:\/\/worker\.example\/shortcut/);
  assert.match(output, /issues\/1/);
  assert.doesNotMatch(output, /ata_[A-Za-z0-9_-]+/);
});
