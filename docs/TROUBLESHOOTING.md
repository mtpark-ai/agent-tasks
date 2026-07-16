# 故障排查

## `/ready` 返回 `configuration_not_ready`

说明 Worker 缺少配置或仍使用占位符。

Deploy Button 用户应在 Cloudflare Worker 设置中检查：

- `GITHUB_OWNER`
- `GITHUB_REPO`
- `ISSUE_LABELS`
- `MAX_BODY_BYTES`
- Secrets `AUTH_TOKEN`、`GITHUB_TOKEN`

CLI setup 用户首次部署/重新配置运行：

```bash
cd workers/task-intake
npm run setup
```

如果 setup 已成功生成 `.task-intake.deploy.jsonc`，而某次标准 `npm run deploy` 意外覆盖了 vars，可直接恢复：

```bash
npm run deploy:managed
```

重新运行 setup 会轮换 `AUTH_TOKEN`，因此不要把它当作普通代码更新命令。

## `/bootstrap` 返回 `github_repository_unreachable`

常见原因：

- `GITHUB_TOKEN` 已过期；
- PAT 没有授权目标任务仓库；
- `GITHUB_OWNER` / `GITHUB_REPO` 写错；
- 组织策略尚未批准该 PAT。

更新 Secret 后重试：

```bash
npx wrangler secret put GITHUB_TOKEN --config .task-intake.deploy.jsonc
```

Deploy Button/Workers Builds 用户也可以在 Cloudflare Dashboard 中更新 Worker Secret。

## `/bootstrap` 返回 `github_label_bootstrap_failed`

如果 `github_status` 为 `403`，通常表示 PAT 可以读取仓库，但缺少 `Issues: Read and write`。重新创建或调整 fine-grained PAT，并确保只授权目标任务仓库。

`/bootstrap` 只管理程序内固定的四个协议 labels，不接受任意客户端 label。

## `/ready` 返回 `github_labels_missing`

先运行：

```bash
curl -fsS -X POST https://<worker>.workers.dev/bootstrap \
  -H "Authorization: Bearer $AUTH_TOKEN"
```

`/bootstrap` 会创建或规范化固定协议 labels。若你在 `ISSUE_LABELS` 中加入了额外 label，需要先在 GitHub 仓库手工创建该额外 label。

## `POST /tasks` 或 `/bootstrap` 返回 401

检查请求头：

```http
Authorization: Bearer <AUTH_TOKEN>
```

不要使用 GitHub PAT 调用 intake API；这里需要 Worker 的 `AUTH_TOKEN`。

## `POST /tasks` 返回 413

请求体超过 50,000 字节。V1 只接收小型 JSON payload，大附件应放在外部系统并只传链接。

## Deploy Button 无法读取源码仓库

Cloudflare 要求 Deploy Button 的源仓库为 public，并且只支持 GitHub.com 或 GitLab.com。目标任务仓库可以是 private。

本项目使用 `workers/task-intake` 子目录作为模板根目录；该目录必须保持依赖、配置、README、LICENSE 和 CI 自包含。

## Deploy Button 部署后找不到 `AUTH_TOKEN`

Cloudflare 不会再次显示 runtime secret 明文。部署前必须把自行生成的 `AUTH_TOKEN` 保存到密码管理器，再把同一个值填入 Shortcut。

如果明文已经丢失，只能生成新 Token、更新 Worker Secret，并同步更新所有 Shortcut。

## setup 无法解析部署 URL

某些 Wrangler 输出格式可能变化。重新运行时手动传入：

```bash
npm run setup -- --endpoint-url https://<worker>.workers.dev
```

## CI 中 typegen 变化

修改 `wrangler.jsonc` 或 `.dev.vars.example` 后运行：

```bash
cd workers/task-intake
npm run cf-typegen
```

并提交更新后的 `worker-configuration.d.ts`。
