import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBootstrapPayload,
  buildFriendlyInstallSummary,
  buildInstallSummary,
  parseOnboardArgs,
} from "../scripts/onboard-lib.mjs";

test("parseOnboardArgs parses explicit security and output choices", () => {
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
    yes: true,
    json: true,
    dryRun: false,
  });
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

test("buildFriendlyInstallSummary shows only the low-privilege phone handoff", () => {
  const output = buildFriendlyInstallSummary({
    endpointUrl: "https://worker.example",
    deviceToken: "atd_phone-token",
    tokenFile: ".task-intake.local.json",
    testIssue: { issue_url: "https://github.com/octo/tasks/issues/1" },
  });

  assert.match(output, /设置完成/);
  assert.match(output, /https:\/\/worker\.example\/shortcut/);
  assert.match(output, /iPhone 配置码：atd_phone-token/);
  assert.match(output, /安装测试任务/);
  assert.doesNotMatch(output, /ata_/);
});
