#!/usr/bin/env node
import { confirm, input, password } from "@inquirer/prompts";
import {
  DEFAULT_LABELS,
  DEPLOY_CONFIG_PATH,
  buildWranglerVarArgs,
  ensureGitHubLabels,
  generateAuthToken,
  normalizeEndpointUrl,
  normalizeWorkerName,
  parseRepoSlug,
  parseWranglerDeployUrl,
  runWrangler,
  verifyEndpoint,
  verifyGitHubRepository,
  writeDeploymentConfig,
  writeLocalInstallFile,
} from "./setup-lib.mjs";

function parseArgs(argv) {
  const options = { dryRun: false, yes: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--yes" || arg === "-y") options.yes = true;
    else if (arg === "--repo") options.repo = argv[++index];
    else if (arg === "--worker-name") options.workerName = argv[++index];
    else if (arg === "--endpoint-url") options.endpointUrl = argv[++index];
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`未知参数: ${arg}`);
  }
  return options;
}

function usage() {
  return `Usage:
  npm run setup
  npm run setup -- --repo owner/repo --worker-name my-task-intake --dry-run

Options:
  --repo owner/repo        目标任务仓库，也可使用 https://github.com/owner/repo
  --worker-name NAME       Cloudflare Worker 名称，默认 agent-task-intake
  --endpoint-url URL       Wrangler 输出中无法解析 workers.dev URL 时手动提供
  --yes, -y                跳过 Cloudflare 账号和 Worker 名称确认
  --dry-run                只验证输入并展示计划，不访问 GitHub/Cloudflare
`;
}

async function ask(message, defaultValue) {
  return input({ message, default: defaultValue });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const repoInput = options.repo || await ask("GitHub 目标任务仓库 owner/repo");
  const { owner, repo } = parseRepoSlug(repoInput);
  const workerName = normalizeWorkerName(
    options.workerName || (options.dryRun ? "agent-task-intake" : await ask("Cloudflare Worker 名称", "agent-task-intake")),
  );
  const labels = DEFAULT_LABELS;

  if (options.dryRun) {
    console.log(JSON.stringify({
      ok: true,
      dry_run: true,
      worker_name: workerName,
      repository: `${owner}/${repo}`,
      labels: labels.map((label) => label.name),
      deployment_config: DEPLOY_CONFIG_PATH,
      wrangler_vars: buildWranglerVarArgs({ owner, repo, labels }),
      sequence: [
        "deploy placeholder config (fail closed)",
        "write GITHUB_TOKEN and AUTH_TOKEN secrets",
        "deploy generated real config",
        "verify /health and /ready",
      ],
      note: "dry-run 不访问 GitHub/Cloudflare，不创建文件，不部署，不写入 secrets。",
    }, null, 2));
    return;
  }

  console.log("请输入 GitHub fine-grained PAT。输入会被隐藏；脚本只用于本次验证和写入 Worker Secret，不会保存该 PAT。");
  const githubToken = await password({
    message: "GitHub PAT",
    mask: "*",
    validate: (value) => value.trim().length > 0 || "GitHub PAT 不能为空",
  });

  console.log(`验证 GitHub 仓库 ${owner}/${repo}...`);
  await verifyGitHubRepository({ owner, repo, githubToken });

  console.log("验证 Wrangler 登录状态和 Cloudflare 账号...");
  const whoami = await runWrangler(["whoami", "--json"]);
  console.log(whoami.stdout.trim());
  if (!options.yes) {
    const approved = await confirm({
      message: `确认在上述 Cloudflare 账号部署或更新 Worker “${workerName}”？`,
      default: false,
    });
    if (!approved) throw new Error("用户取消部署");
  }

  await writeDeploymentConfig({ workerName, owner, repo, labels });
  console.log(`已生成被 git 忽略的持久化部署配置 ${DEPLOY_CONFIG_PATH}。后续代码更新请使用 npm run deploy。`);

  console.log("检查并创建缺失的 raw-task labels...");
  const labelResult = await ensureGitHubLabels({ owner, repo, githubToken, labels });
  console.log(JSON.stringify(labelResult, null, 2));

  console.log("先部署占位符配置，使初始化或重新配置过程保持 fail closed...");
  const placeholderDeploy = await runWrangler(["deploy", "--name", workerName]);
  const parsedEndpoint = parseWranglerDeployUrl(`${placeholderDeploy.stdout}\n${placeholderDeploy.stderr}`);
  const endpointUrl = normalizeEndpointUrl(
    options.endpointUrl || parsedEndpoint || await ask("部署后的 Worker endpoint URL"),
  );

  const authToken = generateAuthToken();
  console.log("通过 stdin 写入 Worker Secrets: GITHUB_TOKEN, AUTH_TOKEN...");
  await runWrangler(["secret", "put", "GITHUB_TOKEN", "--name", workerName], { input: githubToken });
  await runWrangler(["secret", "put", "AUTH_TOKEN", "--name", workerName], { input: authToken });

  await writeLocalInstallFile(".task-intake.local.json", {
    endpoint_url: endpointUrl,
    auth_token: authToken,
    github_repository: `${owner}/${repo}`,
    worker_name: workerName,
  });
  console.log("已将 endpoint 和生成 token 保存到 .task-intake.local.json。POSIX 系统权限为 0600；Windows 使用用户目录继承 ACL，请确保当前目录仅本人可访问。配置 Shortcut 后可删除该文件。");

  console.log("部署真实配置；只有这一步成功后 Worker 才会离开 fail-closed 状态...");
  await runWrangler(["deploy", "--config", DEPLOY_CONFIG_PATH]);

  console.log("验证 /health 和 /ready...");
  await verifyEndpoint({ endpointUrl, authToken });

  console.log(JSON.stringify({
    ok: true,
    worker_name: workerName,
    endpoint_url: endpointUrl,
    ready_url: `${endpointUrl}/ready`,
    repository: `${owner}/${repo}`,
    deployment_config: DEPLOY_CONFIG_PATH,
    token_file: ".task-intake.local.json",
    token_notice: "AUTH_TOKEN 已写入 Worker Secret 和本地 0600/用户 ACL 文件；配置 Shortcut 后可删除本地文件。",
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
