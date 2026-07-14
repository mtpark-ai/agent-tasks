# GitHub Token 权限

Task Intake Worker 需要 GitHub fine-grained Personal Access Token。不要使用 classic PAT、管理员 token 或 `gh auth token` 作为生产 Worker Secret。

## 推荐权限

创建 fine-grained PAT 时选择：

- Resource owner：你的个人账号或组织；
- Repository access：只选择目标任务仓库；
- Repository permissions：
  - Metadata: Read
  - Issues: Read and write

setup 需要 `Issues: Read and write` 来创建缺失 labels 和 raw task Issues。`/ready` 会读取仓库和 label 状态。

## 轮换

1. 在 GitHub 创建新的 fine-grained PAT；
2. 本地执行：

```bash
cd workers/task-intake
npx wrangler secret put GITHUB_TOKEN --config .task-intake.deploy.jsonc
```

3. 验证：

```bash
curl -fsS https://<worker>.workers.dev/ready \
  -H "Authorization: Bearer $AUTH_TOKEN"
```

4. 删除旧 PAT。

## 安全注意

- 不要把 PAT 粘贴到 Issue、PR、README、Shortcut 或聊天记录；
- 不要把 PAT 放进 `wrangler.jsonc`；
- 不要把生产 PAT 写入 `.dev.vars`；
- 如果怀疑泄露，立即撤销并轮换。
