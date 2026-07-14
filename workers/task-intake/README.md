# Task Intake Worker

Cloudflare Worker：对外接收任意 JSON 请求，并在部署者配置的 GitHub 目标任务仓库创建**待分类的原始任务** Issue。

## 自部署

```bash
npm install
npm run setup
```

setup 会提示：

- GitHub 目标任务仓库：`owner/repo`
- GitHub fine-grained PAT：隐藏输入，仅用于验证仓库、补齐 labels、写入 Worker Secret

脚本会：

1. 验证 GitHub 仓库可访问；
2. 创建缺失的 raw-task labels；
3. 验证 `wrangler whoami`；
4. 使用 `wrangler deploy --var ...` 部署，避免改写 tracked `wrangler.jsonc`；
5. 生成强随机 `AUTH_TOKEN`；
6. 通过 stdin 执行 `wrangler secret put GITHUB_TOKEN` 和 `wrangler secret put AUTH_TOKEN`；
7. 验证 `/health` 和 `/ready`；
8. 把 endpoint 和生成的 `AUTH_TOKEN` 保存到被 git 忽略的 `.task-intake.local.json`（`0600`），供配置 Shortcut 后删除。

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

Worker 会在配置缺失或仍是占位符时 fail closed。真实部署建议使用 `npm run setup`，由 Wrangler `--var` 注入部署者自己的 owner/repo/labels/max body bytes。这样避免对 JSONC 做脆弱字符串改写，同时保留 `wrangler types` 从 tracked config 生成类型。

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
