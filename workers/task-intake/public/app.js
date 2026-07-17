const endpoint = window.location.origin;

const statusPill = document.querySelector("#overall-status");
const statusText = document.querySelector("#overall-status-text");
const errorPanel = document.querySelector("#error-panel");
const errorMessage = document.querySelector("#error-message");
const errorRetry = document.querySelector("#error-retry");
const refreshStatusButton = document.querySelector("#refresh-status");
const currentStepLabel = document.querySelector("#current-step-label");
const nextAction = document.querySelector("#next-action");
const nextActionTitle = document.querySelector("#next-action-title");
const nextActionDescription = document.querySelector("#next-action-description");
const nextActionButton = document.querySelector("#next-action-button");
const repoInput = document.querySelector("#repo-url");
const repoMessage = document.querySelector("#repo-message");
const repoHelp = document.querySelector("#repo-help");
const setupCommand = document.querySelector("#setup-command");
const commandCaption = document.querySelector("#command-caption");
const copyCommandButton = document.querySelector("#copy-command");
const codePanel = document.querySelector(".code-panel");
const platformHelp = document.querySelector("#platform-help");
const afterCopy = document.querySelector("#after-copy");
const iphoneContent = document.querySelector("#iphone-content");
const iphoneLocked = document.querySelector("#iphone-locked");
const iphoneStatus = document.querySelector("#iphone-status");
const shortcutLink = document.querySelector("#shortcut-link");
const shortcutDescription = document.querySelector("#shortcut-description");

const stateGuidance = {
  deployed_unconfigured: {
    step: "电脑设置",
    title: "请在电脑上完成一次设置",
    description: "复制下方命令并按提示回答。设置完成后，页面会自动解锁 iPhone 安装步骤。",
    action: "开始电脑设置",
    href: "#computer-setup",
  },
  database_not_ready: {
    step: "电脑设置",
    title: "电脑设置还没有完成",
    description: "数据库仍在等待初始化。重新运行下方同一段命令即可继续，不会重复创建任务。",
    action: "查看电脑命令",
    href: "#computer-setup",
  },
  admin_secret_missing: {
    step: "电脑设置",
    title: "请继续完成电脑设置",
    description: "安全配置尚未写入。重新运行下方命令，按终端提示完成 Cloudflare 登录。",
    action: "继续电脑设置",
    href: "#computer-setup",
  },
  github_secret_missing: {
    step: "电脑设置",
    title: "还需要连接 GitHub",
    description: "请重新运行下方命令，并粘贴只允许访问任务仓库的 GitHub 授权码。",
    action: "继续电脑设置",
    href: "#computer-setup",
  },
  repository_unconfigured: {
    step: "电脑设置",
    title: "还需要选择任务仓库",
    description: "在下方粘贴 Cloudflare 新建的 GitHub 仓库地址，然后复制并运行生成的命令。",
    action: "填写仓库地址",
    href: "#computer-setup",
  },
  github_unverified: {
    step: "电脑设置",
    title: "GitHub 连接还差一步",
    description: "请重新运行设置命令。它会检查授权并准备任务标签。",
    action: "继续电脑设置",
    href: "#computer-setup",
  },
  ready_for_device: {
    step: "电脑设置",
    title: "还差 iPhone 配置码",
    description: "服务已经连接 GitHub。重新运行设置命令，它会生成一段以 atd_ 开头的 iPhone 配置码。",
    action: "完成最后一步",
    href: "#computer-setup",
  },
  ready_without_shortcut: {
    step: "iPhone 设置",
    title: "电脑设置完成",
    description: "现在用 iPhone 打开本页并安装快捷指令。若尚无一键安装链接，按钮会打开手工指南。",
    action: "前往 iPhone 安装",
    href: "#iphone-setup",
  },
  ready: {
    step: "iPhone 设置",
    title: "电脑设置完成，可以安装到 iPhone",
    description: "安装快捷指令，填写服务地址和终端显示的 iPhone 配置码，然后绑定操作按钮。",
    action: "安装到 iPhone",
    href: "#iphone-setup",
  },
};

const platformGuidance = {
  macos: {
    label: "Mac",
    openTerminal: "按 ⌘ + 空格，输入“终端”，然后打开它。",
    afterCopy: "回到“终端”，按 ⌘ + V 粘贴整段命令，再按回车。",
  },
  windows: {
    label: "Windows",
    openTerminal: "打开“开始”菜单，搜索 PowerShell，然后打开它。",
    afterCopy: "回到 PowerShell，右键或按 Ctrl + V 粘贴整段命令，再按回车。",
  },
  linux: {
    label: "Linux",
    openTerminal: "打开系统的 Terminal（终端）应用。",
    afterCopy: "回到终端，按 Ctrl + Shift + V 粘贴整段命令，再按回车。",
  },
};

let selectedPlatform = window.localStorage.getItem("agent-tasks-platform") || "macos";
let latestStatus = null;

function setStatusValue(id, done, doneText = "已完成", pendingText = "未完成") {
  const node = document.getElementById(id);
  if (!node) return;
  node.textContent = done ? doneText : pendingText;
  node.dataset.state = done ? "done" : "pending";
}

function setJourney(setupDone) {
  const computer = document.querySelector('[data-stage="computer"]');
  const iphone = document.querySelector('[data-stage="iphone"]');

  computer.classList.toggle("done", setupDone);
  computer.classList.toggle("current", !setupDone);
  iphone.classList.toggle("current", setupDone);
  iphone.classList.toggle("pending", !setupDone);
}

function isSetupComplete(steps = {}) {
  return Boolean(
    steps.database &&
    steps.admin_secret &&
    steps.github_secret &&
    steps.repository &&
    steps.bootstrap &&
    steps.device
  );
}

function renderStatus(payload) {
  latestStatus = payload;
  errorPanel.hidden = true;

  const steps = payload.steps || {};
  const setupDone = isSetupComplete(steps);
  const guidance = stateGuidance[payload.state] || {
    step: setupDone ? "iPhone 设置" : "电脑设置",
    title: setupDone ? "电脑设置完成" : "请继续完成设置",
    description: setupDone ? "继续安装到 iPhone。" : "请按照下方步骤完成电脑设置。",
    action: setupDone ? "前往 iPhone 安装" : "查看电脑设置",
    href: setupDone ? "#iphone-setup" : "#computer-setup",
  };

  statusText.textContent = setupDone ? "电脑设置已完成" : "等待你完成电脑设置";
  statusPill.dataset.state = setupDone ? "ready" : "warning";
  nextAction.dataset.state = setupDone ? "ready" : "warning";
  currentStepLabel.textContent = guidance.step;
  nextActionTitle.textContent = guidance.title;
  nextActionDescription.textContent = guidance.description;
  nextActionButton.textContent = guidance.action;
  nextActionButton.href = guidance.href;
  document.querySelector("#version").textContent = payload.version ? `v${payload.version}` : "";

  setJourney(setupDone);

  iphoneLocked.hidden = setupDone;
  iphoneContent.classList.toggle("is-locked", !setupDone);
  iphoneContent.setAttribute("aria-disabled", String(!setupDone));
  iphoneStatus.textContent = setupDone ? "可以继续" : "等待电脑设置";
  iphoneStatus.dataset.state = setupDone ? "ready" : "pending";

  shortcutLink.classList.toggle("disabled-link", !setupDone);
  shortcutLink.setAttribute("aria-disabled", String(!setupDone));
  shortcutDescription.textContent = !setupDone
    ? "电脑设置完成后，安装按钮会自动解锁。"
    : payload.shortcut_available
      ? "一键安装链接已准备好。导入时填写下面两项信息。"
      : "当前没有一键安装链接；按钮会打开手工构建指南。";

  setStatusValue("status-worker", true);
  setStatusValue("status-database", Boolean(steps.database));
  setStatusValue("status-secrets", Boolean(steps.admin_secret && steps.github_secret));
  setStatusValue("status-github", Boolean(steps.repository && steps.bootstrap));
  setStatusValue("status-device", Boolean(steps.device));
  setStatusValue("status-shortcut", Boolean(steps.shortcut), "已发布", "未发布");
}

async function refreshStatus() {
  statusPill.dataset.state = "loading";
  statusText.textContent = "正在检查安装状态…";
  try {
    const response = await fetch("/api/public/status", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok || payload.ok !== true) throw new Error(payload.error || `HTTP ${response.status}`);
    renderStatus(payload);
  } catch (error) {
    statusPill.dataset.state = "error";
    statusText.textContent = "状态检查失败";
    nextAction.dataset.state = "error";
    currentStepLabel.textContent = "需要重试";
    nextActionTitle.textContent = "暂时无法读取安装状态";
    nextActionDescription.textContent = "检查网络连接后重新尝试。已经完成的设置不会丢失。";
    nextActionButton.textContent = "重新检查";
    nextActionButton.href = "#";
    errorMessage.textContent = error instanceof Error ? error.message : String(error);
    errorPanel.hidden = false;
  }
}

function normalizeRepositoryUrl(value) {
  const trimmed = String(value || "").trim().replace(/\/+$/u, "");
  const httpsMatch = trimmed.match(/^https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/iu);
  if (httpsMatch) {
    return {
      cloneUrl: `https://github.com/${httpsMatch[1]}/${httpsMatch[2]}.git`,
      directory: httpsMatch[2],
    };
  }

  const sshMatch = trimmed.match(/^git@github\.com:([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/iu);
  if (sshMatch) {
    return {
      cloneUrl: `git@github.com:${sshMatch[1]}/${sshMatch[2]}.git`,
      directory: sshMatch[2],
    };
  }

  return null;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function setRepoMessage(message, state = "neutral") {
  repoMessage.textContent = message;
  repoMessage.dataset.state = state;
}

function generateCommand() {
  const repository = normalizeRepositoryUrl(repoInput.value);
  const platform = platformGuidance[selectedPlatform] || platformGuidance.macos;
  platformHelp.textContent = platform.openTerminal;
  afterCopy.textContent = platform.afterCopy;

  if (!repository) {
    setupCommand.textContent = "# 先完成第 1 步，命令会自动生成";
    commandCaption.textContent = "等待填写仓库地址";
    copyCommandButton.disabled = true;
    codePanel.dataset.ready = "false";
    if (repoInput.value.trim()) {
      setRepoMessage("这个地址看起来不完整。请复制 GitHub 仓库首页地址。", "error");
    } else {
      setRepoMessage("请粘贴完整的 GitHub 仓库地址。", "neutral");
    }
    return;
  }

  window.localStorage.setItem("agent-tasks-repo-url", repoInput.value.trim());
  setupCommand.textContent = [
    `git clone ${shellQuote(repository.cloneUrl)}`,
    `cd ${shellQuote(repository.directory)}`,
    "npm install",
    `npm run onboard -- --endpoint ${shellQuote(endpoint)}`,
  ].join("\n");
  commandCaption.textContent = `复制到 ${platform.label} 终端`;
  copyCommandButton.disabled = false;
  codePanel.dataset.ready = "true";
  setRepoMessage("地址有效，命令已经生成。", "success");
}

function selectPlatform(platform) {
  if (!platformGuidance[platform]) return;
  selectedPlatform = platform;
  window.localStorage.setItem("agent-tasks-platform", platform);
  for (const button of document.querySelectorAll("[data-platform]")) {
    button.setAttribute("aria-pressed", String(button.dataset.platform === platform));
  }
  generateCommand();
}

async function writeClipboard(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

async function copyText(targetId, button) {
  const node = document.getElementById(targetId);
  const value = node?.textContent?.trim();
  if (!value) return;

  const previous = button.textContent;
  try {
    await writeClipboard(value);
    button.textContent = "已复制";
    button.dataset.state = "success";
  } catch {
    button.textContent = "请手动选择复制";
    button.dataset.state = "error";
  }
  window.setTimeout(() => {
    button.textContent = previous;
    delete button.dataset.state;
  }, 1800);
}

copyCommandButton.addEventListener("click", async () => {
  await copyText("setup-command", copyCommandButton);
});

repoInput.addEventListener("input", generateCommand);
document.querySelector("#use-example-help").addEventListener("click", () => {
  repoHelp.hidden = !repoHelp.hidden;
});

for (const button of document.querySelectorAll("[data-platform]")) {
  button.addEventListener("click", () => selectPlatform(button.dataset.platform));
}

for (const button of document.querySelectorAll("[data-copy-target]")) {
  button.addEventListener("click", () => copyText(button.dataset.copyTarget, button));
}

shortcutLink.addEventListener("click", (event) => {
  if (shortcutLink.getAttribute("aria-disabled") !== "true") return;
  event.preventDefault();
  document.querySelector("#computer-setup").scrollIntoView({ behavior: "smooth", block: "start" });
});

nextActionButton.addEventListener("click", (event) => {
  if (nextActionButton.getAttribute("href") !== "#") return;
  event.preventDefault();
  refreshStatus();
});

errorRetry.addEventListener("click", refreshStatus);
refreshStatusButton.addEventListener("click", refreshStatus);

document.querySelector("#endpoint-value").textContent = endpoint;
repoInput.value = window.localStorage.getItem("agent-tasks-repo-url") || "";
selectPlatform(selectedPlatform);
refreshStatus();
window.setInterval(() => {
  if (!document.hidden) refreshStatus();
}, 15000);
