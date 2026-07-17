# 故障排查

## Deploy Button 构建失败

检查构建日志中的两个阶段：

```text
npm run db:migrate
wrangler deploy
```

如果 D1 migration 报 database ID 无效，确认 Deploy Button 已自动创建 D1 并把真实 `database_id` 写入部署者仓库的 `wrangler.jsonc`。不要在上游模板中提交某个真实账号的 D1 ID。

## Cloudflare 创建的仓库是 Public

推荐的预防方式是在 Deploy Button 页面开启：

```text
Create private Git repository
```

如果已经创建为 Public：

1. 在 Setup Portal 填写仓库地址；
2. 点击“打开 GitHub 仓库设置”；
3. 在 GitHub 中进入 `Settings → General → Danger Zone`；
4. 选择 `Change repository visibility → Make private`；
5. 回到终端选择“已经改成 Private，重新检查”。

本地 onboarding 会默认暂停，不会继续创建测试 Issue。不要给 Worker PAT 增加 `Administration` 权限；修改可见性应使用用户本人的 GitHub 网页会话。

确实接受公开风险时才使用：

```bash
npm run onboard -- \
  --endpoint 'https://worker.example' \
  --allow-public-repo
```

## 无法把组织仓库改成 Private

组织策略可能只允许 Owner 修改仓库可见性。请让组织 Owner 完成修改，或选择一个你有管理权限的私有任务仓库。Worker 不会请求 `Administration: write` 来绕过组织策略。

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

Token 必须只授权目标仓库，并有 Metadata Read-only、Issues Read/Write；Account permissions 保持 0。

## GitHub 授权码无法访问仓库

重新打开 Setup Portal 或 CLI 生成的预填链接，并确认：

- Resource owner 与仓库 owner 一致；
- Repository access 是 `Only select repositories`；
- 只选择了目标任务仓库；
- Issues 是 `Read and write`；
- Metadata 是 `Read-only`；
- Account permissions 为 `0`；
- 没有误选名称相近的 `Agent tasks`；
- 组织仓库的 fine-grained PAT 不再是 `Pending`。

## Bootstrap 返回 403

通常表示 PAT 缺少 Issues 写权限，或组织策略尚未批准该 fine-grained PAT。修正后轮换 `GITHUB_TOKEN`，再重新调用 onboarding/bootstrap。

## Bootstrap 返回 `public_repository_requires_confirmation`

目标仓库仍是公开仓库。推荐先改为 Private。Admin API 只有在请求体明确提供以下字段时才接受公开仓库：

```json
{"allow_public_repository": true}
```

CLI 对应的高级选项是 `--allow-public-repo`。

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

Shortcut 必须发送稳定的单次运行唯一值：

```http
Idempotency-Key: <unique-value>
```

可以使用 UUID；没有 UUID 动作的 iOS 版本可以使用毫秒时间戳加随机数。网络重试必须复用同一个 key；新任务必须生成新 key。

## 返回 `idempotency_conflict`

同一个 key 已经与不同 payload 配对。不要修改 payload 后复用 key，生成新的唯一值。

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
