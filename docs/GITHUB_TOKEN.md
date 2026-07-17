# GitHub Token 权限

Task Intake Worker 当前使用 GitHub fine-grained Personal Access Token。Onboarding 页面和本地命令会生成一个预填链接，自动填好 Token 名称、资源所有者、有效期和所需权限。

## 用户仍需手工确认的内容

GitHub 目前不能通过 URL 预先选择某一个具体仓库，因此创建 Token 时仍需确认：

1. **Resource owner**：目标任务仓库所属的个人账号或组织；
2. **Repository access**：选择 `Only select repositories`；
3. **Selected repositories**：只选择目标任务仓库；
4. **Repository permissions**：
   - `Issues: Read and write`
   - `Metadata: Read-only`
5. **Account permissions**：保持 `0`。

最终页面应接近：

```text
Repository access
  Only select repositories
  └─ 只选择 owner/agent-tasks

Repository permissions
  Issues      Read and write
  Metadata    Read-only

Account permissions
  0
```

## 不要选择 “Agent tasks”

GitHub 权限列表中可能出现一个名为 `Agent tasks` 的权限。它与本项目名称碰巧相似，但不是 GitHub Issues 权限，**不要选择它**。

Worker 也不需要：

- Contents
- Pull requests
- Actions
- Administration
- Secrets 或 Agent secrets
- Agent variables
- 任何 Account permissions

`Issues: Read and write` 用于创建 raw Issue、创建或规范化 labels，以及 readiness 检查。`Metadata: Read-only` 用于读取目标仓库的基本信息。Worker 不需要代码读取或仓库管理权限。

## Onboarding 中的处理

- 根据目标仓库动态生成预填 PAT 链接；
- 在交互模式下尝试自动打开 GitHub 创建页面；
- PAT 使用隐藏输入，粘贴时终端不会显示字符；
- 先读取仓库 metadata 验证访问范围和可见性；
- 通过 stdin 写入 `wrangler secret put GITHUB_TOKEN`；
- 不写入 `.task-intake.local.json`；
- 不出现在命令参数、README、Issue 或日志；
- bootstrap 对固定 label 执行写操作，以确认 Token 确实具有 Issues 写权限。

如果目标仓库属于组织，fine-grained PAT 可能显示为 `Pending`。在组织管理员批准之前，它可能无法访问组织的私有仓库。

## 权限不足时

若 onboarding 报告授权码无法访问仓库，请重新创建并确认：

- Resource owner 与仓库 owner 一致；
- Repository access 是 `Only select repositories`；
- 选择了正确的目标仓库；
- Issues 是 `Read and write`；
- Metadata 是 `Read-only`；
- Account permissions 为 `0`；
- 没有误选 `Agent tasks`。

## 轮换

```bash
cd <your-worker-repo>
npx wrangler secret put GITHUB_TOKEN
```

然后验证：

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
