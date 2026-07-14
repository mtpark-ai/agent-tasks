# Task Intake Worker

Cloudflare Worker：对外接收任意 JSON 请求，并在部署者配置的 GitHub 目标任务仓库创建**待分类的原始任务** Issue。

## 自部署

```bash
npm install
npm run setup
```

setup 会提示目标仓库、Worker 名称和隐藏输入的 GitHub fine-grained PAT，并显示当前 Cloudflare 账号供确认。

脚本会：

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
npm run deploy
```

该命令使用 `.task-intake.deploy.jsonc`，不会轮换现有 Token；配置文件不存在时会拒绝部署。重新运行 setup 才会重新配置实例并轮换 `AUTH_TOKEN`。

dry-run：

```bash
npm run setup -- --repo your-org/your-task-repo --dry-run
```

## API

### `GET /health`

无需鉴权：

```json
{"ok":true}
```

### `GET /ready`

需要 Bearer 鉴权：

```http
GET /ready
Authorization: Bearer <AUTH_TOKEN>
```

检查项：

- 部署配置不是占位符；
- GitHub Token 能访问目标仓库；
- `ISSUE_LABELS` 中配置的 labels 都存在。

成功返回非敏感 JSON：

```json
{
  "ok": true,
  "repository": "your-org/your-task-repo",
  "labels": ["status:needs-triage", "agent:unassigned", "type:raw", "source:external"],
  "max_body_bytes": 50000
}
```

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
  "location": {"latitude": 37.7, "longitude": -122.4},
  "captured_at": "2026-07-14T12:00:00Z"
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

Worker 会在配置缺失或仍是占位符时 fail closed。真实部署由 setup 生成 `.task-intake.deploy.jsonc`，后续 `npm run deploy` 始终使用该文件，避免裸 `wrangler deploy` 用 tracked 占位符覆盖线上配置。初始化/重新配置按“占位符部署 → Secrets → 真实配置部署”的顺序执行。

Secrets：

- `AUTH_TOKEN`：setup 随机生成；
- `GITHUB_TOKEN`：部署者自己的 fine-grained PAT。

不要把任何 token 写入 `wrangler.jsonc`、README、Shortcut 模板或 Issue。

## 本地开发

```bash
cp .dev.vars.example .dev.vars
# 替换 owner/repo 和本地测试凭据；.dev.vars 会覆盖 tracked config 中的占位值
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
- 只接受 `application/json`；
- 请求体使用 streaming reader，硬上限 50,000 字节；
- 不记录 Authorization Header、GitHub Token 或完整原始请求；
- GitHub 错误不会原样返回给调用者；
- 原始 JSON 在 Issue 中明确标记为不可信输入；
- 不启用 permissive CORS。
