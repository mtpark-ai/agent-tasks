# 自部署指南

本项目不提供中心服务。每个部署者使用自己的 Cloudflare 账号、GitHub 目标任务仓库、fine-grained PAT 和随机 Intake Bearer Token。

支持两条安装路径：

- **Cloudflare Deploy Button**：快速安装，部署后调用一次 `/bootstrap`；
- **本地 CLI setup**：严格预检、自动生成 Token、持久化本地部署配置。

## 方案 A：Cloudflare Deploy Button

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/mtpark-ai/agent-tasks/tree/main/workers/task-intake)

### 前置条件

1. 一个用于接收任务 Issues 的 GitHub 仓库；
2. 一个仅授权该仓库的 fine-grained PAT，权限见 [GITHUB_TOKEN.md](GITHUB_TOKEN.md)；
3. 一个至少 32 字节的随机 `AUTH_TOKEN`，并在部署前保存到密码管理器。

生成 Token：

```bash
openssl rand -base64 32
```

也可以使用：

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

### Cloudflare 配置

在 Deploy Button 页面填写：

- `GITHUB_OWNER`：目标任务仓库 owner；
- `GITHUB_REPO`：目标任务仓库名称；
- `GITHUB_TOKEN`：fine-grained PAT；
- `AUTH_TOKEN`：刚生成并保存的随机 Token；
- `ISSUE_LABELS`：保留默认值；
- `MAX_BODY_BYTES`：保留默认值 `50000`。

Cloudflare 会读取：

- `wrangler.jsonc` 中的非敏感 vars；
- `.dev.vars.example` 中声明的 runtime secrets；
- `package.json` 中的 binding 说明和标准 `deploy` 脚本。

### 初始化目标仓库

部署完成后调用一次：

```bash
export ENDPOINT="https://<worker>.workers.dev"
export AUTH_TOKEN="<部署时保存的随机 Token>"

curl -fsS -X POST "$ENDPOINT/bootstrap" \
  -H "Authorization: Bearer $AUTH_TOKEN"
```

`POST /bootstrap` 会：

1. 验证 GitHub Token 能访问目标仓库；
2. 创建缺失的固定 raw-task labels；
3. 规范化已有固定 labels 的名称、颜色和说明；
4. 通过 label 写入验证 PAT 具有 `Issues: Read and write`；
5. 再次执行 readiness 检查。

它不会：

- 创建任务 Issue；
- 批准或派发任务；
- 触发 Agent；
- 接受客户端指定任意 label；
- 修改仓库设置或代码。

随后验证：

```bash
curl -fsS "$ENDPOINT/ready" \
  -H "Authorization: Bearer $AUTH_TOKEN"
```

最后根据 [Shortcut 指南](../shortcut/README.md) 填入 endpoint 和同一个 `AUTH_TOKEN`。

### Deploy Button 的边界

Deploy Button 不能替用户：

- 创建 GitHub 目标任务仓库；
- 创建 fine-grained PAT；
- 自动生成并再次显示 `AUTH_TOKEN` 明文；
- 配置 iOS Shortcut；
- 自动同步上游模板的后续安全更新。

另外：

- Cloudflare 要求 Deploy Button 的**源码仓库为 public**；目标任务仓库仍可为 private；
- Cloudflare 将 `workers/task-intake` 子目录视为复制后仓库的根目录，因此该目录必须完全独立；
- 一个按钮只部署一个 Worker；
- 模板被复制到用户自己的 Git 仓库后，上游更新不会自动合并。

## 方案 B：本地 CLI setup

### 前置条件

- Node.js 22+；
- 已登录 Wrangler：`npx wrangler login`；
- 一个用于接收任务的 GitHub 仓库；
- 一个 fine-grained PAT，权限见 [GITHUB_TOKEN.md](GITHUB_TOKEN.md)。

### 首次 setup

```bash
cd workers/task-intake
npm install
npm run setup
```

setup 会：

1. 询问目标仓库和 Worker 名称；
2. 隐藏输入 GitHub PAT，且不把 PAT 写入磁盘或命令参数；
3. 显示 `wrangler whoami --json` 的当前 Cloudflare 账号并要求确认；
4. 生成被 git 忽略的 `.task-intake.deploy.jsonc`，保存真实的非敏感 owner/repo/labels 配置；
5. 创建缺失的 raw-task labels；
6. 先部署 tracked 占位符配置，使 Worker 在初始化期间保持 fail closed；
7. 通过 stdin 写入 `GITHUB_TOKEN` 和新生成的 `AUTH_TOKEN`；
8. 最后部署真实配置，并验证 `/health` 与 `/ready`。

这种顺序避免重新配置时出现“旧 Token 已生效，但请求已写入新仓库”的中间状态。任一步失败时，Worker 会停留在占位符 fail-closed 状态，而不是带着部分新配置继续接收任务。

可指定 Worker 名称：

```bash
npm run setup -- --worker-name my-task-intake
```

自动化环境只有在已经核对 Cloudflare 账号后才能跳过确认：

```bash
npm run setup -- --repo your-org/tasks --worker-name my-task-intake --yes
```

重新运行 setup 会重新配置实例并轮换 `AUTH_TOKEN`，现有 Shortcut 中的旧 Token 随即失效。

### dry-run

```bash
npm run setup -- --repo your-org/your-task-repo \
  --worker-name my-task-intake \
  --dry-run
```

Dry run 只验证输入并展示计划，不访问 GitHub/Cloudflare、不创建文件、不部署、不写 Secrets。

### 后续代码更新

首次 setup 后，真实非敏感部署配置保存在：

```text
workers/task-intake/.task-intake.deploy.jsonc
```

该文件不包含 Token，已被 git 忽略。更新代码时运行：

```bash
cd workers/task-intake
npm install
npm run deploy:managed
```

`npm run deploy:managed` 只使用持久化配置更新代码，不轮换 `AUTH_TOKEN` 或 `GITHUB_TOKEN`。如果配置文件不存在，命令会 fail closed 并要求先运行 setup。

`npm run deploy` 是 Deploy Button/标准 Cloudflare 流程使用的直接 `wrangler deploy` 命令，不会读取 `.task-intake.deploy.jsonc`。CLI setup 用户不要用它覆盖线上 vars。

### 手工部署的安全顺序

如不使用 setup，必须保持同样的三阶段顺序：

```bash
# 1. 占位符配置：先让实例 fail closed
npx wrangler deploy --name my-task-intake

# 2. 写入 Secrets；值从 stdin 交互输入
npx wrangler secret put GITHUB_TOKEN --name my-task-intake
npx wrangler secret put AUTH_TOKEN --name my-task-intake

# 3. 创建包含真实非敏感 vars 的 ignored config，再部署它
npx wrangler deploy --config .task-intake.deploy.jsonc
```

不建议在 shell 历史里用 `--var` 重复维护生产配置；应以 ignored deploy config 作为 CLI 管理实例后续更新的唯一配置来源。

## 验证

```bash
curl -fsS https://<worker>.workers.dev/health

curl -fsS -X POST https://<worker>.workers.dev/bootstrap \
  -H "Authorization: Bearer ***"

curl -fsS https://<worker>.workers.dev/ready \
  -H "Authorization: Bearer ***"
```

发送测试任务：

```bash
curl -fsS https://<worker>.workers.dev/tasks \
  -H "Authorization: Bearer ***" \
  -H "Content-Type: application/json" \
  --data '{"message":"请将此原始请求分类"}'
```

## 本地安装文件

CLI setup 会写入 `workers/task-intake/.task-intake.local.json`，避免部署后无法恢复生成的 `AUTH_TOKEN`：

```json
{
  "endpoint_url": "https://<worker>.workers.dev",
  "auth_token": "<generated-token>",
  "github_repository": "your-org/your-task-repo",
  "worker_name": "my-task-intake"
}
```

- POSIX 系统：脚本创建文件后执行 `chmod 0600`；
- Windows：POSIX mode 不等同于 Windows ACL，文件使用当前用户目录继承 ACL。请在仅本人可访问的工作目录运行 setup，并检查文件属性/ACL。

不要分享或提交该文件。把 Token 填入 Shortcut 后可以删除；以后代码更新使用 `npm run deploy:managed`，只有明确需要轮换 Token 时才重新运行 setup。
