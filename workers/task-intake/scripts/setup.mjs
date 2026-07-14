#!/usr/bin/env node
import { input, password } from "@inquirer/prompts";
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
  verifyGitHubRepository,
  writeLocalInstallFile,
} from "./setup-lib.mjs";

function parseArgs(argv) {
  const options = { dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--repo") options.repo = argv[++index];
    else if (arg === "--endpoint-url") options.endpointUrl = argv[++index];
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`未知参数: ${arg}`);
  }
  return options;
}

function usage() {
  return `Usage:
  npm run setup
  npm run setup -- --repo owner/repo --dry-run

Options:
  --repo owner/repo        目标任务仓库，也可使用 https://github.com/owner/repo
  --endpoint-url URL       Wrangler 输出中无法解析 workers.dev URL 时手动提供
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
  const labels = DEFAULT_LABELS;

  if (options.dryRun) {
    console.log(JSON.stringify({
      ok: true,
      dry_run: true,
      repository: `${owner}/${repo}`,
      labels: labels.map((label) => label.name),
      wrangler_vars: buildWranglerVarArgs({ owner, repo, labels }),
      note: "dry-run 不访问 GitHub/Cloudflare，不部署，不写入 secrets。",
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

  console.log("检查并创建缺失的 raw-task labels...");
  const labelResult = await ensureGitHubLabels({ owner, repo, githubToken, labels });
  console.log(JSON.stringify(labelResult, null, 2));

  console.log("验证 Wrangler 登录状态...");
  await runWrangler(["whoami", "--json"]);

  console.log("部署 Worker，并通过 --var 注入非敏感部署配置...");
  const deploy = await runWrangler(["deploy", ...buildWranglerVarArgs({ owner, repo, labels })]);
  const parsedEndpoint = parseWranglerDeployUrl(`${deploy.stdout}\n${deploy.stderr}`);
  const endpointUrl = normalizeEndpointUrl(
    options.endpointUrl || parsedEndpoint || await ask("部署后的 Worker endpoint URL"),
  );

  const authToken = generateAuthToken();
  console.log("通过 stdin 写入 Worker Secrets: GITHUB_TOKEN, AUTH_TOKEN...");
  await runWrangler(["secret", "put", "GITHUB_TOKEN"], { input: githubToken });
  await runWrangler(["secret", "put", "AUTH_TOKEN"], { input: authToken });

  await writeLocalInstallFile(".task-intake.local.json", {
    endpoint_url: endpointUrl,
    auth_token: authToken,
    github_repository: `${owner}/${repo}`,
  });
  console.log("已将 endpoint 和生成 token 保存到 .task-intake.local.json（0600），即使后续验证失败也可用于排查。配置 Shortcut 后可删除该文件。");

  console.log("验证 /health 和 /ready...");
  await verifyEndpoint({ endpointUrl, authToken });

  console.log(JSON.stringify({
    ok: true,
    endpoint_url: endpointUrl,
    ready_url: `${endpointUrl}/ready`,
    repository: `${owner}/${repo}`,
    token_notice: "AUTH_TOKEN 已生成并写入 Worker Secret；如保存到本地文件，请按密钥处理。",
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
