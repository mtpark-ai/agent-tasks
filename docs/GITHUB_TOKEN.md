# GitHub Token 权限

Task Intake Worker 需要 GitHub fine-grained Personal Access Token。不要使用 classic PAT、管理员 token 或 `gh auth token` 作为生产 Worker Secret。

## 推荐权限

创建 fine-grained PAT 时选择：

- Resource owner：你的个人账号或组织；
- Repository access：只选择目标任务仓库；
- Repository permissions：
  - Metadata: Read
  - Issues: Read and write

`Issues: Read and write` 用于：

- `POST /bootstrap` 创建或规范化固定协议 labels，并验证写权限；
- `POST /tasks` 创建 raw task Issues；
- CLI setup 创建缺失 labels。

`GET /ready` 只读取仓库和 label 状态，但不能替代 `/bootstrap` 的写权限验证。

## 轮换

1. 在 GitHub 创建新的 fine-grained PAT；
2. CLI setup 管理的实例本地执行：

```bash
cd workers/task-intake
npx wrangler secret put GITHUB_TOKEN --config .task-intake.deploy.jsonc
```

Deploy Button/Workers Builds 管理的实例可在 Cloudflare Dashboard 中更新 Worker Secret。

3. 初始化并验证：

```bash
curl -fsS -X POST https://<worker>.workers.dev/bootstrap \
  -H "Authorization: Bearer $AUTH_TOKEN"

curl -fsS https://<worker>.workers.dev/ready \
  -H "Authorization: Bearer $AUTH_TOKEN"
```

4. 删除旧 PAT。

## 安全注意

- 不要把 PAT 粘贴到 Issue、PR、README、Shortcut 或聊天记录；
- 不要把 PAT 放进 `wrangler.jsonc`；
- 不要把生产 PAT 写入 `.dev.vars`；
- 不要把 runtime PAT 再配置为 Workers Builds 的 build secret；
- 如果怀疑泄露，立即撤销并轮换。
