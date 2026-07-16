const endpoint = window.location.origin;
const statusPill = document.querySelector("#overall-status");
const statusText = document.querySelector("#overall-status-text");
const errorPanel = document.querySelector("#error-panel");
const errorMessage = document.querySelector("#error-message");
const repoInput = document.querySelector("#repo-url");
const setupCommand = document.querySelector("#setup-command");
const shortcutDescription = document.querySelector("#shortcut-description");

const stateLabels = {
  deployed_unconfigured: "等待本地初始化",
  database_not_ready: "需要应用 D1 migrations",
  admin_secret_missing: "需要配置 Admin Secret",
  github_secret_missing: "需要配置 GitHub Secret",
  repository_unconfigured: "需要配置任务仓库",
  github_unverified: "需要初始化 GitHub",
  ready_for_device: "需要创建设备 Token",
  ready_without_shortcut: "Worker 已就绪，Shortcut 尚未发布",
  ready: "全部就绪",
};

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function repoDirectory(value) {
  const trimmed = value.trim().replace(/\/$/, "").replace(/\.git$/i, "");
  return trimmed.split(/[/:]/).filter(Boolean).at(-1) || "agent-tasks";
}

function generateCommand() {
  const repoUrl = repoInput.value.trim();
  if (!/^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/i.test(repoUrl) &&
      !/^git@github\.com:[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/i.test(repoUrl)) {
    setupCommand.textContent = "# 请输入 Cloudflare 创建的 GitHub HTTPS 或 SSH clone URL";
    return;
  }
  window.localStorage.setItem("agent-tasks-repo-url", repoUrl);
  const directory = repoDirectory(repoUrl);
  setupCommand.textContent = [
    `git clone ${shellQuote(repoUrl)}`,
    `cd ${shellQuote(directory)}`,
    "npm install",
    `npm run onboard -- --endpoint ${shellQuote(endpoint)}`,
  ].join("\n");
}

async function copyText(targetId, button) {
  const node = document.getElementById(targetId);
  const value = node?.textContent?.trim();
  if (!value) return;
  await navigator.clipboard.writeText(value);
  const previous = button.textContent;
  button.textContent = "已复制";
  window.setTimeout(() => { button.textContent = previous; }, 1300);
}

function setStep(name, done) {
  const node = document.querySelector(`[data-step="${name}"]`);
  if (!node) return;
  node.classList.toggle("done", Boolean(done));
  node.classList.toggle("pending", !done);
}

function applyStatus(payload) {
  errorPanel.hidden = true;
  statusText.textContent = stateLabels[payload.state] || payload.state || "状态未知";
  const ready = payload.state === "ready" || payload.state === "ready_without_shortcut";
  statusPill.dataset.state = ready ? "ready" : "warning";
  document.querySelector("#version").textContent = payload.version ? `v${payload.version}` : "";

  const steps = payload.steps || {};
  setStep("worker", true);
  setStep("database", steps.database);
  setStep("secrets", steps.admin_secret && steps.github_secret);
  setStep("bootstrap", steps.bootstrap);
  setStep("device", steps.device);
  setStep("shortcut", steps.shortcut);

  shortcutDescription.textContent = payload.shortcut_available
    ? "Shortcut 已发布。安装后填写当前 Endpoint 与 onboarding 生成的 Device Token。"
    : "Worker 已能提供安装入口，但还没有配置审核过的 Shortcut URL；按钮会打开手工构建指南。";
}

async function refreshStatus() {
  statusPill.dataset.state = "loading";
  statusText.textContent = "正在检查 Worker…";
  try {
    const response = await fetch("/api/public/status", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok || payload.ok !== true) throw new Error(payload.error || `HTTP ${response.status}`);
    applyStatus(payload);
  } catch (error) {
    statusPill.dataset.state = "error";
    statusText.textContent = "无法读取状态";
    errorMessage.textContent = error instanceof Error ? error.message : String(error);
    errorPanel.hidden = false;
  }
}

document.querySelector("#endpoint-value").textContent = endpoint;
document.querySelector("#generate-command").addEventListener("click", generateCommand);
document.querySelector("#refresh-status").addEventListener("click", refreshStatus);
repoInput.addEventListener("input", generateCommand);
for (const button of document.querySelectorAll("[data-copy-target]")) {
  button.addEventListener("click", () => copyText(button.dataset.copyTarget, button));
}

repoInput.value = window.localStorage.getItem("agent-tasks-repo-url") || "";
generateCommand();
refreshStatus();
window.setInterval(refreshStatus, 15000);
