#!/usr/bin/env node
import { confirm, input, password } from "@inquirer/prompts";
import {
  detectGitHubRepository,
  generateAuthToken,
  normalizeEndpointUrl,
  normalizeWorkerName,
  parseRepoSlug,
  readWorkerName,
  requestJson,
  runWrangler,
  verifyGitHubRepository,
  writeLocalInstallFile,
} from "./setup-lib.mjs";
import { buildBootstrapPayload, buildInstallSummary, parseOnboardArgs } from "./onboard-lib.mjs";

const TOKEN_FILE = ".task-intake.local.json";

function usage() {
  return `Usage:
  npm run onboard -- --endpoint https://<worker>.workers.dev

Options:
  --endpoint URL          已部署 Worker 的 HTTPS URL（必填；localhost 可用 HTTP）
  --repo owner/repo       目标任务仓库；默认从 git remote origin 推导
  --worker-name NAME      Worker 名称；默认读取 wrangler.jsonc
  --device-name NAME      首个 iPhone 设备名称，默认 personal-iphone
  --shortcut-url URL      可选：已审核的 iCloud Shortcut 或 .shortcut HTTPS URL
  --allow-public-repo     明确允许把任务写入公开仓库
  --skip-test-task       不创建端到端安装测试 Issue
  --yes, -y               跳过普通确认（不会隐式批准公开仓库）
  --dry-run               只显示计划，不访问 GitHub/Cloudflare、不写 secrets
`;
}

async function main() {
  const options = parseOnboardArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const endpointInput = options.endpoint || await input({
    message: "已部署 Worker Endpoint",
    validate: (value) => value.trim().length > 0 || "Endpoint 不能为空",
  });
  const endpointUrl = normalizeEndpointUrl(endpointInput);

  let repository;
  if (options.repo) repository = parseRepoSlug(options.repo);
  else {
    try {
      repository = await detectGitHubRepository();
    } catch {
      const answer = await input({ message: "GitHub 目标任务仓库 owner/repo" });
      repository = parseRepoSlug(answer);
    }
  }

  const workerName = normalizeWorkerName(options.workerName || await readWorkerName());
  const repositorySlug = `${repository.owner}/${repository.repo}`;

  if (options.dryRun) {
    console.log(JSON.stringify({
      ok: true,
      dry_run: true,
      endpoint_url: endpointUrl,
      worker_name: workerName,
      repository: repositorySlug,
      device_name: options.deviceName,
      shortcut_url: options.shortcutUrl ?? null,
      sequence: [
        "verify Wrangler account",
        "verify fine-grained GitHub PAT and repository visibility",
        "apply D1 migrations",
        "write GITHUB_TOKEN and ADMIN_TOKEN as Worker secrets",
        "bootstrap fixed GitHub labels and D1 settings",
        "create one per-device Shortcut token",
        `write ${TOKEN_FILE} with mode 0600 on POSIX`,
      ],
    }, null, 2));
    return;
  }

  console.log("验证 Wrangler 登录状态和 Cloudflare 账号...");
  const whoami = await runWrangler(["whoami", "--json"]);
  console.log(whoami.stdout.trim());
  if (!options.yes) {
    const approved = await confirm({
      message: `确认配置上述 Cloudflare 账号中的 Worker “${workerName}”？`,
      default: false,
    });
    if (!approved) throw new Error("用户取消配置");
  }

  console.log("请输入仅授权目标仓库、具有 Metadata: Read 与 Issues: Read and write 的 GitHub fine-grained PAT。");
  const githubToken = await password({
    message: "GitHub PAT",
    mask: "*",
    validate: (value) => value.trim().length > 0 || "GitHub PAT 不能为空",
  });

  console.log(`验证 GitHub 仓库 ${repositorySlug}...`);
  const repositoryInfo = await verifyGitHubRepository({
    owner: repository.owner,
    repo: repository.repo,
    githubToken,
  });

  let allowPublicRepository = options.allowPublicRepository;
  if (repositoryInfo.visibility === "public" && !allowPublicRepository) {
    const approved = await confirm({
      message: `${repositorySlug} 是公开仓库，语音任务可能包含内部信息。仍然使用它作为任务 Issue 仓库？`,
      default: false,
    });
    if (!approved) {
      throw new Error("请选择私有任务仓库，或在明确接受风险后使用 --allow-public-repo");
    }
    allowPublicRepository = true;
  }

  console.log("应用 D1 migrations...");
  await runWrangler(["d1", "migrations", "apply", "DB", "--remote"]);

  const adminToken = `ata_${generateAuthToken(32)}`;
  console.log("通过 stdin 写入 Worker Secrets: GITHUB_TOKEN, ADMIN_TOKEN...");
  await runWrangler(["secret", "put", "GITHUB_TOKEN", "--name", workerName], { input: githubToken });
  await runWrangler(["secret", "put", "ADMIN_TOKEN", "--name", workerName], { input: adminToken });

  console.log("初始化 GitHub labels 与应用设置...");
  const bootstrap = await requestJson(`${endpointUrl}/api/admin/bootstrap`, {
    method: "POST",
    token: adminToken,
    body: buildBootstrapPayload({
      ...repository,
      visibility: repositoryInfo.visibility,
      allowPublicRepository,
      shortcutUrl: options.shortcutUrl,
    }),
  });

  console.log(`创建设备 Token：${options.deviceName}...`);
  const deviceResult = await requestJson(`${endpointUrl}/api/admin/devices`, {
    method: "POST",
    token: adminToken,
    body: { name: options.deviceName },
  });

  await writeLocalInstallFile(TOKEN_FILE, {
    endpoint_url: endpointUrl,
    admin_token: adminToken,
    device_token: deviceResult.token,
    device_id: deviceResult.device.id,
    device_name: deviceResult.device.name,
    github_repository: repositorySlug,
    worker_name: workerName,
    repository_visibility: bootstrap.repository_visibility,
  });

  const status = await requestJson(`${endpointUrl}/ready`, { token: adminToken });
  if (status?.ok !== true) throw new Error("Worker readiness 验证未返回 ok=true");

  let testIssue = null;
  let createTestTask = !options.skipTestTask;
  if (createTestTask && !options.yes) {
    createTestTask = await confirm({
      message: "创建一条 ‘安装测试，请勿执行’ Issue，验证端到端链路？",
      default: true,
    });
  }
  if (createTestTask) {
    testIssue = await requestJson(`${endpointUrl}/api/admin/test-task`, {
      method: "POST",
      token: adminToken,
    });
    console.log(`端到端测试 Issue: ${testIssue.issue_url}`);
  }

  console.log(JSON.stringify(buildInstallSummary({
    endpointUrl,
    repository: repositorySlug,
    workerName,
    device: deviceResult.device,
    tokenFile: TOKEN_FILE,
    testIssue,
  }), null, 2));
  console.log(`\n已将 ADMIN_TOKEN 与 Device Token 保存到 ${TOKEN_FILE}。不要提交或分享该文件。`);
  console.log(`在浏览器打开：${endpointUrl}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
