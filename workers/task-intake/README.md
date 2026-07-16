# Task Intake Worker

Cloudflare Worker：对外接收 JSON 请求，并在部署者配置的 GitHub 目标任务仓库创建**待分类的原始任务** Issue。

## Cloudflare Deploy Button

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/mtpark-ai/agent-tasks/tree/main/workers/task-intake)

Cloudflare 会把本目录当作独立模板仓库复制到部署者自己的 GitHub/GitLab 账号，再通过 Workers Builds 部署。源仓库必须是 public；目标任务仓库可以是 private。

### 部署前准备

1. 一个用于接收任务 Issues 的 GitHub 仓库；
2. 一个仅授权该仓库的 fine-grained PAT：
   - `Metadata: Read`
   - `Issues: Read and write`
3. 一个至少 32 字节的随机 Intake Token，并先保存到密码管理器：

```bash
openssl rand -base64 32
```

### Cloudflare 页面填写

- `GITHUB_OWNER`：目标任务仓库 owner；
- `GITHUB_REPO`：目标任务仓库名称；
- `GITHUB_TOKEN`：上面的 fine-grained PAT；
- `AUTH_TOKEN`：上面生成的随机 Intake Token；
- `ISSUE_LABELS`、`MAX_BODY_BYTES`：建议保留默认值。

部署后先初始化固定 labels：

```bash
curl -fsS -X POST https://<worker>.workers.dev/bootstrap \
  -H "Authorization: Bearer $AUTH_TOKEN"
```

然后验证：

```bash
curl -fsS https://<worker>.workers.dev/ready \
  -H "Authorization: Bearer $AUTH_TOKEN"
```

`POST /bootstrap` 是幂等初始化操作：它只会创建或规范化程序内固定的 raw-task labels，并验证 PAT 具有 Issues 写权限。它不会创建任务或触发 Agent。

最后把 Worker endpoint 和同一个 `AUTH_TOKEN` 填入 iOS Shortcut。

## CLI 自部署

需要本地预检、自动生成 `AUTH_TOKEN` 和持久化部署配置时：

```bash
npm install
npm run setup
```

setup 会：

1. 验证 GitHub 仓库和 Wrangler 登录账号；
2. 生成被 git 忽略的 `.task-intake.deploy.jsonc`，持久保存真实非敏感配置；
3. 创建缺失的 raw-task labels；
4. 先部署 tracked 占位符配置，使初始化过程 fail closed；
5. 生成强随机 `AUTH_TOKEN`；
6. 通过 stdin 写入 `GITHUB_TOKEN` 和 `AUTH_TOKEN`；
7. 最后部署真实配置并验证 `/health` 和 `/ready`；
8. 把 endpoint 和 Token 保存到被 git 忽略的 `.task-intake.local.json`。POSIX 权限为 `0600`；Windows 使用用户目录继承 ACL。

后续代码更新运行：

```bash
npm run deploy:managed
```

该命令使用 `.task-intake.deploy.jsonc`，不会轮换现有 Token；配置文件不存在时会拒绝部署。重新运行 setup 才会重新配置实例并轮换 `AUTH_TOKEN`。

标准 Cloudflare/Deploy Button 部署命令是：

```bash
npm run deploy
```

它直接执行 `wrangler deploy`，读取 tracked `wrangler.jsonc` 和 Cloudflare 页面中的 bindings/secrets。

Dry run：

```bash
npm run setup -- --repo your-org/your-task-repo --dry-run
```

## API

### `GET /health`

无需鉴权：

```json
{"ok":true}
```

### `POST /bootstrap`

需要 Bearer 鉴权，无请求体：

```http
POST /bootstrap
Authorization: Bearer <AUTH_TOKEN>
```

成功返回：

```json
{
  "ok": true,
  "repository": "your-org/your-task-repo",
  "created_labels": ["agent:unassigned"],
  "updated_labels": ["status:needs-triage", "type:raw", "source:external"],
  "labels": ["status:needs-triage", "agent:unassigned", "type:raw", "source:external"],
  "ready": true
}
```

### `GET /ready`

需要 Bearer 鉴权，检查：

- 部署配置不是占位符；
- GitHub Token 能访问目标仓库；
- `ISSUE_LABELS` 中配置的 labels 都存在。

### `POST /tasks`

```http
POST /tasks
Authorization: Bearer <AUTH_TOKEN>
Content-Type: application/json
```

请求体可以是任意合法 JSON，不限定字段名：

```json
{
  "source": "ios-shortcut",
  "dictation": "请记录这个任务",
  "captured_at": "2026-07-16T12:00:00Z"
}
```

成功返回 `201`：

```json
{
  "ok": true,
  "request_id": "UUID",
  "issue_number": 123,
  "issue_url": "https://github.com/your-org/your-task-repo/issues/123"
}
```

创建的 Issue 默认带有：

- `status:needs-triage`
- `agent:unassigned`
- `type:raw`
- `source:external`

Issue 创建只表示收到原始任务，**不代表已审核、批准或允许 Agent 执行**。

## 配置策略

Tracked `wrangler.jsonc` 使用安全占位符：

- `GITHUB_OWNER=REPLACE_WITH_GITHUB_OWNER`
- `GITHUB_REPO=REPLACE_WITH_GITHUB_REPO`
- `ISSUE_LABELS=status:needs-triage,agent:unassigned,type:raw,source:external`
- `MAX_BODY_BYTES=50000`

`.dev.vars.example` 只声明 Deploy Button 要求用户填写的 runtime secrets：

- `AUTH_TOKEN`
- `GITHUB_TOKEN`

完整本地开发模板位于 `.dev.vars.local.example`。

Worker 会在配置缺失或仍是占位符时 fail closed。不要把任何 token 写入 `wrangler.jsonc`、README、Shortcut 模板或 Issue。

## 本地开发

```bash
cp .dev.vars.local.example .dev.vars
# 替换 owner/repo 和本地测试凭据
npm install
npm run cf-typegen
npm test
npm run typecheck
npm run dev
```

检查：

```bash
npm run check
```

`npm run check` 会运行：

1. Wrangler Env 类型生成；
2. TypeScript 类型检查；
3. Workers Runtime Vitest 测试；
4. setup helper Node 测试；
5. Wrangler dry-run 构建。

## 安全行为

- Bearer Token 先 SHA-256，再 timing-safe 比较；
- `/tasks` 只接受 `application/json`；
- 请求体使用 streaming reader，硬上限 50,000 字节；
- `/bootstrap` 只管理程序内硬编码的协议 labels，不接受客户端自定义 label；
- 不记录 Authorization Header、GitHub Token 或完整原始请求；
- GitHub 错误不会原样返回给调用者；
- 原始 JSON 在 Issue 中明确标记为不可信输入；
- 不启用 permissive CORS。

完整项目文档：<https://github.com/mtpark-ai/agent-tasks>。
