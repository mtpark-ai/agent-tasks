# 故障排查

## `/ready` 返回 `configuration_not_ready`

说明 Worker 缺少配置或仍使用占位符。使用 setup 重新部署：

```bash
cd workers/task-intake
npm run setup
```

或手工 deploy 时传入 `--var GITHUB_OWNER:... --var GITHUB_REPO:...`。

## `/ready` 返回 `github_repository_unreachable`

常见原因：

- `GITHUB_TOKEN` 已过期或权限不足；
- PAT 没有授权目标任务仓库；
- `GITHUB_OWNER` / `GITHUB_REPO` 写错。

处理：

```bash
npx wrangler secret put GITHUB_TOKEN
```

然后重新调用 `/ready`。

## `/ready` 返回 `github_labels_missing`

目标仓库缺少配置的 labels。运行：

```bash
npm run setup
```

或在 GitHub 仓库手工创建返回中列出的 labels。

## `POST /tasks` 返回 401

检查请求头：

```http
Authorization: Bearer <AUTH_TOKEN>
Content-Type: application/json
```

不要使用 GitHub PAT 调用 intake API；这里需要 Worker 的 `AUTH_TOKEN`。

## `POST /tasks` 返回 413

请求体超过 50,000 字节。V1 只接收小型 JSON payload，大附件应放在外部系统并只传链接。

## setup 无法解析部署 URL

某些 Wrangler 输出格式可能变化。重新运行时手动传入：

```bash
npm run setup -- --endpoint-url https://<worker>.workers.dev
```

## CI 中 typegen 变化

修改 `wrangler.jsonc` 后运行：

```bash
cd workers/task-intake
npm run cf-typegen
```

并提交更新后的 `worker-configuration.d.ts`。
