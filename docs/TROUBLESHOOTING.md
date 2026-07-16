# 故障排查

## Deploy Button 构建失败

检查构建日志中的两个阶段：

```text
npm run db:migrate
wrangler deploy
```

如果 D1 migration 报 database ID 无效，确认 Deploy Button 已自动创建 D1 并把真实 `database_id` 写入部署者仓库的 `wrangler.jsonc`。不要在上游模板中提交某个真实账号的 D1 ID。

## 首页存在，但状态是 `database_not_ready`

在部署者仓库运行：

```bash
npm install
npm run db:migrate
npm run deploy:worker
```

## 状态是 `admin_secret_missing`

运行完整 onboarding：

```bash
npm run onboard -- --endpoint 'https://worker.example'
```

或手工设置：

```bash
npx wrangler secret put ADMIN_TOKEN
```

## 状态是 `github_secret_missing`

```bash
npx wrangler secret put GITHUB_TOKEN
```

Token 必须只授权目标仓库，并有 Metadata Read、Issues Read/Write。

## Bootstrap 返回 403

通常表示 PAT 缺少 Issues 写权限，或组织策略尚未批准该 fine-grained PAT。修正后轮换 `GITHUB_TOKEN`，再重新调用 onboarding/bootstrap。

## Bootstrap 返回 `public_repository_requires_confirmation`

任务仓库是公开仓库。推荐切换到 private；若确实接受风险，在 CLI 使用：

```bash
npm run onboard -- --endpoint 'https://worker.example' --allow-public-repo
```

## `/tasks` 返回 401

- 确认使用的是 `device_token`，不是 Admin Token；
- 检查 Shortcut Header 是否为 `Authorization: Bearer ...`；
- 确认设备没有被撤销；
- Token 明文无法从 D1 恢复，丢失后需要创建新设备。

创建设备：

```bash
curl -fsS 'https://worker.example/api/admin/devices' \
  -X POST \
  -H 'Authorization: Bearer <ADMIN_TOKEN>' \
  -H 'Content-Type: application/json' \
  --data '{"name":"replacement-iphone"}'
```

## 重复创建 Issue

Shortcut 必须发送稳定的单次运行 UUID：

```http
Idempotency-Key: <UUID>
```

网络重试必须复用同一个 key；新任务必须生成新 key。

## 返回 `idempotency_conflict`

同一个 key 已经与不同 payload 配对。不要修改 payload 后复用 key，生成新的 UUID。

## `/shortcut` 打开手工指南

说明尚未配置审核过的 `shortcut_url`。维护者需要在真实 Apple 设备上构建、重新导入验证并发布 iCloud 链接或签名文件，然后通过 bootstrap 设置 URL。

## Portal 命令克隆后目录不对

Deploy Button 指向 `workers/task-intake` 子目录，因此新仓库根目录应该直接包含 `package.json`、`wrangler.jsonc`、`src/` 和 `public/`。命令应 `cd <new-repo-name>`，不要再追加 `workers/task-intake`。

## Onboarding 找不到 GitHub 仓库

确认本地仓库有 `origin`：

```bash
git remote -v
```

也可以明确指定：

```bash
npm run onboard -- --endpoint 'https://worker.example' --repo owner/repo
```

## 本地开发 D1 表不存在

```bash
npx wrangler d1 migrations apply DB --local
```
