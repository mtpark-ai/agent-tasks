export function parseOnboardArgs(argv) {
  const options = {
    yes: false,
    json: false,
    dryRun: false,
    allowPublicRepository: false,
    deviceName: "personal-iphone",
    skipTestTask: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--endpoint") options.endpoint = argv[++index];
    else if (arg === "--repo") options.repo = argv[++index];
    else if (arg === "--worker-name") options.workerName = argv[++index];
    else if (arg === "--device-name") options.deviceName = argv[++index];
    else if (arg === "--shortcut-url") options.shortcutUrl = argv[++index];
    else if (arg === "--allow-public-repo") options.allowPublicRepository = true;
    else if (arg === "--skip-test-task") options.skipTestTask = true;
    else if (arg === "--yes" || arg === "-y") options.yes = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`未知参数: ${arg}`);
  }
  return options;
}

export function buildGitHubTokenUrl({ owner, repo, expiresIn = 365 }) {
  const url = new URL("https://github.com/settings/personal-access-tokens/new");
  url.searchParams.set("name", "Agent Tasks Worker");
  url.searchParams.set(
    "description",
    `Create and manage task Issues for ${owner}/${repo}. No code access.`,
  );
  url.searchParams.set("target_name", owner);
  url.searchParams.set("expires_in", String(expiresIn));
  url.searchParams.set("issues", "write");
  url.searchParams.set("metadata", "read");
  return url.toString();
}

export function buildRepositorySettingsUrl({ owner, repo }) {
  const url = new URL(`https://github.com/${owner}/${repo}/settings`);
  return url.toString();
}

export function buildBootstrapPayload({ owner, repo, visibility, allowPublicRepository, shortcutUrl }) {
  return {
    github_owner: owner,
    github_repo: repo,
    allow_public_repository: visibility === "public" && allowPublicRepository,
    ...(shortcutUrl ? { shortcut_url: shortcutUrl } : {}),
  };
}

export function buildInstallSummary({ endpointUrl, repository, workerName, device, tokenFile, testIssue }) {
  return {
    ok: true,
    endpoint_url: endpointUrl,
    setup_portal: endpointUrl,
    ready_url: `${endpointUrl}/ready`,
    shortcut_url: `${endpointUrl}/shortcut`,
    github_repository: repository,
    worker_name: workerName,
    device_id: device.id,
    device_name: device.name,
    token_file: tokenFile,
    test_issue_url: testIssue?.issue_url ?? null,
    next_step: `在 iPhone 打开 ${endpointUrl}/shortcut，服务地址使用 ${endpointUrl}，iPhone 配置码已显示在终端并保存在 ${tokenFile}。`,
  };
}

export function buildFriendlyInstallSummary({ endpointUrl, deviceToken, tokenFile, testIssue }) {
  const lines = [
    "",
    "============================================================",
    "✅ 设置完成",
    "============================================================",
    "",
    "接下来请在 iPhone 打开：",
    `${endpointUrl}/shortcut`,
    "",
    "导入快捷指令时填写：",
    `服务地址：${endpointUrl}`,
    `iPhone 配置码：${deviceToken}`,
    "",
    "配置码以 atd_ 开头，只允许创建待审核的 GitHub 任务单。",
    "请勿把以 ata_ 开头的管理员配置码填入 iPhone。",
    "",
    `以上信息也保存在本机文件：${tokenFile}`,
  ];

  if (testIssue?.issue_url) {
    lines.push("", `安装测试任务：${testIssue.issue_url}`);
  }

  lines.push("", "回到浏览器中的安装向导，点击“重新检查状态”继续。", "");
  return lines.join("\n");
}
