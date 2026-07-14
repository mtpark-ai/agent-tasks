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

export function parseRepoSlug(input) {
  const value = String(input ?? "").trim();
  const githubUrl = value.match(/^https:\/\/github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:[/?#].*)?$/i);
  const slug = githubUrl ? `${githubUrl[1]}/${githubUrl[2]}` : value;
  const match = slug.match(/^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9_.-]{1,100})$/);
  if (!match || match[2].endsWith(".")) {
    throw new Error("GitHub 仓库必须是 owner/repo 或 https://github.com/owner/repo");
  }
  return { owner: match[1], repo: match[2] };
}

export function normalizeEndpointUrl(input) {
  const url = new URL(String(input ?? "").trim());
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Endpoint URL 必须使用 http 或 https");
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
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      resolve({ code: 1, stdout, stderr: `${stderr}${error.message}` });
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
    if (input !== undefined) {
      child.stdin.end(`${input}\n`);
    } else {
      child.stdin.end();
    }
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

export async function writeDeploymentConfig({
  templatePath = "wrangler.jsonc",
  outputPath = DEPLOY_CONFIG_PATH,
  workerName = "agent-task-intake",
  owner,
  repo,
  labels = DEFAULT_LABELS,
  maxBodyBytes = 50_000,
}) {
  const template = JSON.parse(await readFile(templatePath, "utf8"));
  const config = {
    ...template,
    name: normalizeWorkerName(workerName),
    vars: {
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
  const response = await fetchImpl(`https://api.github.com${pathName}`, {
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
  return response;
}

export async function verifyGitHubRepository({ fetchImpl = fetch, owner, repo, githubToken }) {
  const response = await githubRequest(fetchImpl, githubToken, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
  if (!response.ok) {
    throw new Error(`无法访问 GitHub 仓库 ${owner}/${repo}，GitHub status=${response.status}`);
  }
  return true;
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
    const create = await githubRequest(
      fetchImpl,
      githubToken,
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/labels`,
      {
        method: "POST",
        body: JSON.stringify(label),
      },
    );
    if (!create.ok) {
      throw new Error(`创建 GitHub label ${label.name} 失败，GitHub status=${create.status}`);
    }
    created.push(label.name);
  }
  return { existing, created, wouldCreate };
}

export async function verifyEndpoint({ fetchImpl = fetch, endpointUrl, authToken }) {
  const base = normalizeEndpointUrl(endpointUrl);
  const health = await fetchImpl(`${base}/health`);
  if (!health.ok) {
    throw new Error(`/health 验证失败，status=${health.status}`);
  }
  const ready = await fetchImpl(`${base}/ready`, {
    headers: { authorization: `Bearer ${authToken}` },
  });
  if (!ready.ok) {
    throw new Error(`/ready 验证失败，status=${ready.status}`);
  }
  return true;
}

export async function writeLocalInstallFile(filePath, data) {
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  if (process.platform !== "win32") await chmod(filePath, 0o600);
}
