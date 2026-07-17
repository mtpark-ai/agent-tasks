#!/usr/bin/env node
import { spawn } from "node:child_process";
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
import {
  buildBootstrapPayload,
  buildFriendlyInstallSummary,
  buildGitHubTokenUrl,
  buildInstallSummary,
  parseOnboardArgs,
} from "./onboard-lib.mjs";

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
  --skip-test-task        不创建端到端安装测试 Issue
  --yes, -y               跳过普通确认（不会隐式批准公开仓库）
  --json                  最后输出机器可读 JSON；进度信息写入 stderr
  --dry-run               只显示计划，不访问 GitHub/Cloudflare、不写 secrets
`;
}

function describeWranglerAccount(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    const email = parsed?.email || parsed?.user?.email || parsed?.userEmail;
    const accountNames = Array.isArray(parsed?.accounts)
      ? parsed.accounts.map((account) => account?.name).filter(Boolean)
      : [];
    const lines = [];
    if (email) lines.push(`登录邮箱：${email}`);
    if (accountNames.length > 0) lines.push(`Cloudflare 账户：${accountNames.join("、")}`);
    return lines.length > 0 ? lines.join("\n") : stdout.trim();
  } catch {
    return stdout.trim();
  }
}

async function ensureWranglerLogin({ yes, log }) {
  try {
    return await runWrangler(["whoami", "--json"]);
  } catch (originalError) {
    if (yes) {
      throw new Error("尚未登录 Cloudflare。请先运行 npx wrangler login，然后重新执行 onboarding。");
    }

    log("尚未检测到 Cloudflare 登录。接下来会打开浏览器，请使用刚才部署 Worker 的账号登录。");
    const approved = await confirm({
      message: "现在打开浏览器登录 Cloudflare？",
      default: true,
    });
    if (!approved) throw new Error("需要先登录 Cloudflare 才能继续设置");

    try {
      await runWrangler(["login"]);
      return await runWrangler(["whoami", "--json"]);
    } catch (loginError) {
      const message = loginError instanceof Error ? loginError.message : String(loginError);
      throw new Error(`Cloudflare 登录未完成：${message || String(originalError)}`);
    }
  }
}

function openExternalUrl(url) {
  const launch = process.platform === "darwin"
    ? { command: "open", args: [url] }
    : process.platform === "win32"
      ? { command: "rundll32", args: ["url.dll,FileProtocolHandler", url] }
      : { command: "xdg-open", args: [url] };

  return new Promise((resolve) => {
    let settled = false;
    const finish = (opened) => {
      if (settled) return;
      settled = true;
      resolve(opened);
    };

    try {
      const child = spawn(launch.command, launch.args, {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.once("error", () => finish(false));
      child.once("spawn", () => {
        child.unref();
        finish(true);
      });
    } catch {
      finish(false);
    }
  });
}

function explainGitHubAuthorizationError(error, repositorySlug) {
  const original = error instanceof Error ? error.message : String(error);
  if (!/GitHub status=(401|403|404)/u.test(original)) {
    return `GitHub 连接检查失败：${original}`;
  }

  return [
    `GitHub 授权码无法访问 ${repositorySlug}。`,
    "",
    "请重新打开刚才的授权链接，并确认：",
    "- Resource owner 是仓库所属账号或组织；",
    "- Repository access 选择 Only select repositories；",
    `- Selected repositories 只选择 ${repositorySlug}；`,
    "- Issues 是 Read and write；Metadata 是 Read-only；",
    "- Account permissions 保持 0；",
    "- 不要选择 Agent tasks，也不要添加 Contents、Actions、Administration 或 Secrets。",
    "",
    "如果仓库属于组织，授权码可能处于 Pending，需要组织管理员批准后才能使用。",
  ].join("\n");
}

async function main() {
  const options = parseOnboardArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const log = options.json ? console.error : console.log;

  const endpointInput = options.endpoint || await input({
    message: "已部署的服务地址",
    validate: (value) => value.trim().length > 0 || "服务地址不能为空",
  });
  const endpointUrl = normalizeEndpointUrl(endpointInput);

  let repository;
  if (options.repo) repository = parseRepoSlug(options.repo);
  else {
    try {
      repository = await detectGitHubRepository();
    } catch {
      const answer = await input({ message: "GitHub 任务仓库（owner/repo）" });
      repository = parseRepoSlug(answer);
    }
  }

  const workerName = normalizeWorkerName(options.workerName || await readWorkerName());
  const repositorySlug = `${repository.owner}/${repository.repo}`;
  const githubTokenUrl = buildGitHubTokenUrl(repository);

  if (options.dryRun) {
    console.log(JSON.stringify({
      ok: true,
      dry_run: true,
      endpoint_url: endpointUrl,
      worker_name: workerName,
      repository: repositorySlug,
      github_token_url: githubTokenUrl,
      device_name: options.deviceName,
      shortcut_url: options.shortcutUrl ?? null,
      sequence: [
        "verify or start Wrangler login",
        "open a pre-filled fine-grained GitHub PAT page for one selected repository",
        "verify GitHub PAT and repository visibility",
        "apply D1 migrations",
        "write GITHUB_TOKEN and ADMIN_TOKEN as Worker secrets",
        "bootstrap fixed GitHub labels and D1 settings",
        "create one per-device Shortcut token",
        `write ${TOKEN_FILE} with mode 0600 on POSIX`,
      ],
    }, null, 2));
    return;
  }

  log("\nAgent Tasks 电脑设置");
  log("按照提示完成即可，不需要理解命令或代码。\n");

  log("[1/5] 确认 Cloudflare 账号");
  const whoami = await ensureWranglerLogin({ yes: options.yes, log });
  log(describeWranglerAccount(whoami.stdout));
  if (!options.yes) {
    const approved = await confirm({
      message: `确认使用这个账号配置 Agent Tasks（${workerName}）？`,
      default: true,
    });
    if (!approved) throw new Error("你取消了 Cloudflare 账号确认");
  }

  log("\n[2/5] 连接 GitHub 任务仓库");
  log(`目标仓库：${repositorySlug}`);
  log("GitHub 页面会自动填好名称、有效期和所需权限。");

  let tokenPageOpened = false;
  if (!options.yes) {
    const shouldOpen = await confirm({
      message: "现在打开 GitHub 创建授权码页面？",
      default: true,
    });
    if (shouldOpen) {
      tokenPageOpened = await openExternalUrl(githubTokenUrl);
    }
  }

  log(tokenPageOpened
    ? "已尝试在浏览器打开 GitHub。若没有打开，请复制下面链接："
    : "请打开下面链接：");
  log(githubTokenUrl);
  log("");
  log("GitHub 页面里只需确认：");
  log(`1. Resource owner：${repository.owner}`);
  log("2. Repository access：Only select repositories");
  log(`3. Selected repositories：只选择 ${repositorySlug}`);
  log("4. Repository permissions：Issues = Read and write；Metadata = Read-only");
  log("5. Account permissions：0");
  log("不要选择 Agent tasks，也不要添加 Contents、Administration、Actions、Secrets 或其他权限。\n");

  const githubToken = await password({
    message: "生成后复制授权码，回到这里粘贴（输入内容会被隐藏）",
    mask: "*",
    validate: (value) => value.trim().length > 0 || "GitHub 授权码不能为空",
  });

  log("正在检查 GitHub 授权…");
  let repositoryInfo;
  try {
    repositoryInfo = await verifyGitHubRepository({
      owner: repository.owner,
      repo: repository.repo,
      githubToken,
    });
  } catch (error) {
    throw new Error(explainGitHubAuthorizationError(error, repositorySlug));
  }

  let allowPublicRepository = options.allowPublicRepository;
  if (repositoryInfo.visibility === "public" && !allowPublicRepository) {
    log("\n⚠️ 这个仓库是公开的。语音任务可能包含项目名称、错误信息或内部说明。");
    const approved = await confirm({
      message: "仍然把语音任务写入这个公开仓库？",
      default: false,
    });
    if (!approved) {
      throw new Error("请先把任务仓库设为私有，或明确使用 --allow-public-repo");
    }
    allowPublicRepository = true;
  }

  log("\n[3/5] 准备你的服务");
  log("正在初始化安全存储和任务设置…");
  await runWrangler(["d1", "migrations", "apply", "DB", "--remote"]);

  const adminToken = `ata_${generateAuthToken(32)}`;
  await runWrangler(["secret", "put", "GITHUB_TOKEN", "--name", workerName], { input: githubToken });
  await runWrangler(["secret", "put", "ADMIN_TOKEN", "--name", workerName], { input: adminToken });

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

  log("\n[4/5] 生成 iPhone 配置码");
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

  log("\n[5/5] 验证安装结果");
  const status = await requestJson(`${endpointUrl}/ready`, { token: adminToken });
  if (status?.ok !== true) throw new Error("服务验证没有返回成功状态");

  let testIssue = null;
  let createTestTask = !options.skipTestTask;
  if (createTestTask && !options.yes) {
    createTestTask = await confirm({
      message: "创建一条“安装测试，请勿执行”任务，确认 GitHub 连接正常？",
      default: true,
    });
  }
  if (createTestTask) {
    testIssue = await requestJson(`${endpointUrl}/api/admin/test-task`, {
      method: "POST",
      token: adminToken,
    });
  }

  const summary = buildInstallSummary({
    endpointUrl,
    repository: repositorySlug,
    workerName,
    device: deviceResult.device,
    tokenFile: TOKEN_FILE,
    testIssue,
  });

  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(buildFriendlyInstallSummary({
      endpointUrl,
      deviceToken: deviceResult.token,
      tokenFile: TOKEN_FILE,
      testIssue,
    }));
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n❌ 设置未完成：${message}`);
  console.error("修正问题后重新运行同一段命令即可，已经完成的步骤不会丢失。\n");
  process.exitCode = 1;
});
