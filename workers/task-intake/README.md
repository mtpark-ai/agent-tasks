# Agent Task Intake Worker

Cloudflare Worker：对外接收任意 JSON 请求，并在 `mtpark-ai/agent-tasks` 创建一个**待分类的原始任务** Issue。

## API

### 健康检查

```http
GET /health
```

无需鉴权，返回：

```json
{"ok":true}
```

### 创建原始任务

```http
POST /tasks
Authorization: Bearer <TASK_INTAKE_TOKEN>
Content-Type: application/json
```

请求体可以是任意合法 JSON，不限定字段名。例如：

```json
{
  "source": "external-system",
  "anything": {
    "intent": "Agent 根据完整 JSON 自行理解任务意图"
  },
  "items": [1, 2, 3]
}
```

成功返回 `201`：

```json
{
  "ok": true,
  "request_id": "UUID",
  "issue_number": 123,
  "issue_url": "https://github.com/mtpark-ai/agent-tasks/issues/123"
}
```

创建的 Issue 默认带有：

- `status:needs-triage`
- `agent:unassigned`
- `type:raw`
- `source:external`

Issue 创建只表示收到原始任务，**不代表已审核、批准或允许 Agent 执行**。

## 安全设计

- Bearer Token 通过 Worker Secret `AUTH_TOKEN` 注入；
- GitHub Token 通过 Worker Secret `GITHUB_TOKEN` 注入；
- 鉴权 Token 先进行 SHA-256，再使用 Workers `timingSafeEqual` 比较；
- 只接受 `application/json`；
- 请求体上限默认 50,000 字节；
- 不记录 Authorization Header、GitHub Token 或完整原始请求；
- GitHub 错误不会原样返回给调用者；
- 原始 JSON 在 Issue 中明确标记为不可信输入。

## GitHub Token 权限

建议创建 Fine-grained Personal Access Token，只授权：

- Repository access：仅 `mtpark-ai/agent-tasks`
- Repository permissions：
  - Metadata: Read
  - Issues: Read and write

不要使用个人全量 Classic PAT 或 `gh auth token` 作为生产 Worker Secret。

## 本地开发

```bash
cp .dev.vars.example .dev.vars
# 编辑 .dev.vars，填入本地测试值
npm install
npm run cf-typegen
npm test
npm run typecheck
npm run dev
```

`.dev.vars` 已被 Git 忽略，不要提交真实凭据。

## 检查

```bash
npm run check
```

依次运行：

1. Wrangler Env 类型生成；
2. TypeScript 类型检查；
3. Workers Runtime Vitest 测试；
4. Wrangler dry-run 构建。

## 配置 Secrets

```bash
npx wrangler secret put AUTH_TOKEN
npx wrangler secret put GITHUB_TOKEN
```

## 部署

```bash
npm run deploy
```

部署后测试：

```bash
curl -fsS https://<worker-domain>/health

curl -fsS https://<worker-domain>/tasks \
  -H "Authorization: Bearer $TASK_INTAKE_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"message":"请将此原始请求分类"}'
```

## 配置

非敏感配置位于 `wrangler.jsonc`：

- `GITHUB_OWNER`
- `GITHUB_REPO`
- `ISSUE_LABELS`
- `MAX_BODY_BYTES`

修改配置后运行：

```bash
npm run cf-typegen
```
