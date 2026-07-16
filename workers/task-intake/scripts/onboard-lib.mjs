export function parseOnboardArgs(argv) {
  const options = {
    yes: false,
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
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`未知参数: ${arg}`);
  }
  return options;
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
    next_step: `在 iPhone 打开 ${endpointUrl}，安装 Shortcut；Endpoint 使用 ${endpointUrl}，Device Token 从 ${tokenFile} 复制。`,
  };
}
