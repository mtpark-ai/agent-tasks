import test from "node:test";
import assert from "node:assert/strict";
import { buildBootstrapPayload, buildInstallSummary, parseOnboardArgs } from "../scripts/onboard-lib.mjs";

test("parseOnboardArgs parses explicit security choices", () => {
  assert.deepEqual(parseOnboardArgs([
    "--endpoint", "https://worker.example",
    "--repo", "octo/tasks",
    "--worker-name", "octo-intake",
    "--device-name", "my-iphone",
    "--shortcut-url", "https://www.icloud.com/shortcuts/example",
    "--allow-public-repo",
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
  assert.match(summary.next_step, /Device Token/);
});
