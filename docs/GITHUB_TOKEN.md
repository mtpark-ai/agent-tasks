# GitHub Token 权限

Task Intake Worker 当前使用 GitHub fine-grained Personal Access Token。

## 推荐配置

- Resource owner：目标仓库所属用户或组织；
- Repository access：Only select repositories；
- 只选择目标任务仓库；
- Repository permissions：
  - Metadata: Read
  - Issues: Read and write

`Issues: Read and write` 用于创建 raw Issue、创建或规范化 labels，以及 readiness 检查。Worker 不需要 Contents、Pull requests、Actions、Administration 或 Members 权限。

## Onboarding 中的处理

- PAT 使用隐藏输入；
- 先读取仓库 metadata 验证访问范围和可见性；
- 通过 stdin 写入 `wrangler secret put GITHUB_TOKEN`；
- 不写入 `.task-intake.local.json`；
- 不出现在命令参数、README、Issue 或日志；
- bootstrap 对固定 label 执行写操作，以确认 Token 确实具有 Issues 写权限。

## 轮换

```bash
cd <your-worker-repo>
npx wrangler secret put GITHUB_TOKEN
```

然后：

```bash
curl -fsS 'https://worker.example/ready' \
  -H 'Authorization: Bearer <ADMIN_TOKEN>'
```

验证成功后撤销旧 PAT。

## 不要使用

- classic PAT；
- 个人全量管理员 Token；
- `gh auth token`；
- 带 Contents/Administration 写权限的 Token；
- 多仓库共用的高权限 Token。
