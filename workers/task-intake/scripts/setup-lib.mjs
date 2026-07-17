import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

export const DEFAULT_LABELS = [
  { name: "status:needs-triage", color: "fbca04", description: "外部接入的原始任务等待分类" },
  { name: "agent:unassigned", color: "ededed", description: "尚未指派执行 Agent" },
  { name: "type:raw", color: "d4c5f9", description: "未经人工整理的原始任务" },
  { name: "source:external", color: "bfdadc", description: "来自外部 Task Intake API" },
];

export const DEPLOY_CONFIG_PATH = ".task-intake.deploy.jsonc";
export const DEFAULT_BOOTSTRAP_RETRY_DELAYS_MS = [750, 1500, 2500, 4000, 6000, 8000, 10_000, 12_000];

const TRANSIENT_BOOTSTRAP_ERRORS = new Set([
  "admin_not_configured",
  "github_token_not_configured",
  "unauthorized",
]);

export function parseRepoSlug(input) {
  const value = String(input ?? "").trim();
  let slug = value;

  const githubUrl = value.match(/^https:\/\/github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:[/?#].*)?$/i);
  const sshUrl = value.match(/^git@github\.com:([^/\s]+)\/([^/\s#?]+?)(?:\.git)?$/i);
  const sshScheme = value.match(/^ssh:\/\/git@github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?$/i);
  if (githubUrl) slug = `${githubUrl[1]}/${githubUrl[2]}`;
  else if (sshUrl) slug = `${sshUrl[1]}/${sshUrl[2]}`;
  else if (sshScheme) slug = `${sshScheme[1]}/${sshScheme[2]}`;

  const match = slug.match(/^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9_.-]{1,100})$/);
  if (!match || match[2].endsWith(".")) {
    throw new Error("GitHub 仓库必须是 owner/repo 或标准 GitHub HTTPS/SSH URL");
  }
  return { owner: match[1], repo: match[2] };
}

export function normalizeEndpointUrl(input) {
  const url = new URL(String(input ?? "").trim());
  const isLocalhost = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalhost)) {
    throw new Error("生产 Endpoint 必须使用 HTTPS；仅 localhost 可以使用 HTTP");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function parseWranglerDeployUrl(output) {
  const match = String(output).match(/https:\/\/[a-z0-9][a-z0-9.-]*\.workers\.dev\b/i);
  return match ? match[0] : null;
}

export function generateAuthToken(byteLength = 32, random = randomBytes) {
  return Buffer.from(random(byteLength)).toString("base64url");
}

export function buildWranglerVarArgs({ owner, repo, labels = DEFAULT_LABELS, maxBodyBytes = 50_000 }) {
  return [
    "--var", `GITHUB_OWNER:${owner}`,
    "--var", `GITHUB_REPO:${repo}`,
    "--var", `ISSUE_LABELS:${labels.map((label) => label.name).join(",")}`,
    "--var", `MAX_BODY_BYTES:${maxBodyBytes}`,
  ];
}

export function normalizeWorkerName(input) {
  const value = String(input ?? "").trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value)) {
    throw new Error("Worker 名称只能包含小写字母、数字和连字符，且不能以连字符开头或结尾");
  }
  return value;
}

export function wranglerInvocation(cwd = process.cwd(), execPath = process.execPath) {
  return {
    command: execPath,
    prefixArgs: [path.join(cwd, "node_modules", "wrangler", "bin", "wrangler.js")],
  };
}

export function runCommand(command, args, { cwd = process.cwd(), input, env = process.env } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      resolve({ code: 1, stdout, stderr: `${stderr}${error.message}` });
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.stdin.end(input === undefined ? undefined : `${input}\n`);
  });
}

export async function runWrangler(args, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const invocation = options.command
    ? { command: options.command, prefixArgs: [] }
    : (options.invocation ?? wranglerInvocation(cwd, options.execPath));
  const commandArgs = [...invocation.prefixArgs, ...args];
  const result = await (options.runCommand ?? runCommand)(invocation.command, commandArgs, {
    cwd,
    input: options.input,
    env: options.env,
  });
  if (result.code !== 0) {
    throw new Error(`wrangler ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result;
}

export async function runGit(args, options = {}) {
  const result = await (options.runCommand ?? runCommand)("git", args, {
    cwd: options.cwd ?? process.cwd(),
    env: options.env,
  });
  if (result.code !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result;
}

export async function detectGitHubRepository({ cwd = process.cwd(), runCommand: commandRunner } = {}) {
  const result = await runGit(["remote", "get-url", "origin"], { cwd, runCommand: commandRunner });
  return parseRepoSlug(result.stdout.trim());
}

function stripJsonComments(input) {
  return input
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

export async function readWorkerName(configPath = "wrangler.jsonc") {
  const parsed = JSON.parse(stripJsonComments(await readFile(configPath, "utf8")));
  return normalizeWorkerName(parsed.name ?? "agent-task-intake");
}

export async function writeDeploymentConfig({
  templatePath = "wrangler.jsonc",
  outputPath = DEPLOY_CONFIG_PATH,
  workerName = "agent-task-intake",
  owner,
  repo,
  labels = DEFAULT_LABELS,
  maxBodyBytes = 50_000,
}) {
  const template = JSON.parse(stripJsonComments(await readFile(templatePath, "utf8")));
  const config = {
    ...template,
    name: normalizeWorkerName(workerName),
    vars: {
      ...(template.vars ?? {}),
      GITHUB_OWNER: owner,
      GITHUB_REPO: repo,
      ISSUE_LABELS: labels.map((label) => label.name).join(","),
      MAX_BODY_BYTES: String(maxBodyBytes),
    },
  };
  await writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  if (process.platform !== "win32") await chmod(outputPath, 0o600);
  return outputPath;
}

async function githubRequest(fetchImpl, token, pathName, init = {}) {
  return fetchImpl(`https://api.github.com${pathName}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "agent-task-intake-setup",
      "x-github-api-version": "2022-11-28",
      ...(init.headers ?? {}),
    },
  });
}

export async function verifyGitHubRepository({ fetchImpl = fetch, owner, repo, githubToken }) {
  const response = await githubRequest(fetchImpl, githubToken, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
  if (!response.ok) {
    throw new Error(`无法访问 GitHub 仓库 ${owner}/${repo}，GitHub status=${response.status}`);
  }
  const body = await response.json();
  const visibility = typeof body?.visibility === "string" ? body.visibility : body?.private === true ? "private" : "public";
  return { visibility, private: visibility === "private" };
}

export async function ensureGitHubLabels({
  fetchImpl = fetch,
  owner,
  repo,
  githubToken,
  labels = DEFAULT_LABELS,
  dryRun = false,
}) {
  const created = [];
  const existing = [];
  const wouldCreate = [];
  for (const label of labels) {
    const labelPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/labels/${encodeURIComponent(label.name)}`;
    const lookup = await githubRequest(fetchImpl, githubToken, labelPath);
    if (lookup.ok) {
      existing.push(label.name);
      continue;
    }
    if (lookup.status !== 404) {
      throw new Error(`检查 GitHub label ${label.name} 失败，GitHub status=${lookup.status}`);
    }
    if (dryRun) {
      wouldCreate.push(label.name);
      continue;
    }
    const create = await githubRequest(fetchImpl, githubToken, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/labels`, {
      method: "POST",
      body: JSON.stringify(label),
    });
    if (!create.ok) {
      throw new Error(`创建 GitHub label ${label.name} 失败，GitHub status=${create.status}`);
    }
    created.push(label.name);
  }
  return { existing, created, wouldCreate };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isBootstrapRequest(url, method) {
  if (method !== "POST") return false;
  try {
    return new URL(url).pathname === "/api/admin/bootstrap";
  } catch {
    return false;
  }
}

function defaultRetryReporter({ errorCode, delayMs, attempt, total }) {
  const seconds = Math.max(1, Math.ceil(delayMs / 1000));
  console.error(
    `Cloudflare 正在同步安全配置（${errorCode}），${seconds} 秒后自动重试 ` +
    `(${attempt}/${total})。无需重新运行命令。`,
  );
}

export async function requestJson(url, {
  method = "GET",
  token,
  body,
  fetchImpl = fetch,
  retryDelays = DEFAULT_BOOTSTRAP_RETRY_DELAYS_MS,
  sleepImpl = sleep,
  onRetry = defaultRetryReporter,
} = {}) {
  const headers = { accept: "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const serializedBody = body === undefined ? undefined : JSON.stringify(body);
  const retryableBootstrap = isBootstrapRequest(url, method);
  const totalWaitMs = retryDelays.reduce((total, delayMs) => total + delayMs, 0);

  for (let attempt = 0; ; attempt += 1) {
    const response = await fetchImpl(url, {
      method,
      headers,
      body: serializedBody,
    });
    let payload = null;
    try { payload = await response.json(); } catch { /* non-JSON errors are normalized below */ }
    if (response.ok) return payload;

    const errorCode = payload && typeof payload === "object" && typeof payload.error === "string"
      ? payload.error
      : null;
    const canRetry = retryableBootstrap && errorCode && TRANSIENT_BOOTSTRAP_ERRORS.has(errorCode);
    if (canRetry && attempt < retryDelays.length) {
      const delayMs = retryDelays[attempt];
      if (typeof onRetry === "function") {
        onRetry({
          errorCode,
          delayMs,
          attempt: attempt + 1,
          total: retryDelays.length,
        });
      }
      await sleepImpl(delayMs);
      continue;
    }

    const detail = payload && typeof payload === "object" ? JSON.stringify(payload) : `status=${response.status}`;
    if (canRetry) {
      const waitedSeconds = Math.max(1, Math.ceil(totalWaitMs / 1000));
      throw new Error([
        `Cloudflare 安全配置在等待约 ${waitedSeconds} 秒后仍未生效。`,
        `最后响应：${detail}`,
        "请确认 Wrangler 登录账号、Worker 名称和 CLOUDFLARE_ENV 与当前服务地址一致。",
      ].join(" "));
    }
    throw new Error(`${method} ${url} failed: ${detail}`);
  }
}

export async function verifyEndpoint({ fetchImpl = fetch, endpointUrl, authToken }) {
  const base = normalizeEndpointUrl(endpointUrl);
  const health = await fetchImpl(`${base}/health`);
  if (!health.ok) throw new Error(`/health 验证失败，status=${health.status}`);
  const ready = await fetchImpl(`${base}/ready`, {
    headers: { authorization: `Bearer ${authToken}` },
  });
  if (!ready.ok) throw new Error(`/ready 验证失败，status=${ready.status}`);
  const body = await ready.json();
  if (body?.ok !== true) throw new Error("/ready 未返回 ok=true");
  return body;
}

export async function writeLocalInstallFile(filePath, data) {
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  if (process.platform !== "win32") await chmod(filePath, 0o600);
}
