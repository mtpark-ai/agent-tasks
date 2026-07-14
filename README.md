# Agent Tasks

开源的 Hermes Agent 人工审核任务队列模板。你可以把本仓库作为**源码仓库** fork/clone，然后把 Cloudflare Worker 自部署到自己的 Cloudflare 账号，并把外部任务写入你自己的 GitHub **目标任务仓库** Issues。

V1 没有中心账号服务：每个部署者使用自己的 Cloudflare 账号、GitHub 仓库、fine-grained PAT 和随机生成的 Intake Bearer Token。任何公开分发的文件都不得内嵌生产 endpoint 或 token。

## 快速自部署

```bash
cd workers/task-intake
npm install
npm run setup
```

setup 会提示输入目标任务仓库和 GitHub fine-grained PAT，验证仓库，补齐 raw-task labels，检查 Wrangler 登录，部署 Worker，生成 `AUTH_TOKEN`，通过 stdin 设置 `GITHUB_TOKEN` 和 `AUTH_TOKEN`，最后验证 `/health` 与 `/ready`。

不会保存 GitHub PAT。脚本会把生成的 endpoint/token 写入被 git 忽略的 `.task-intake.local.json`，权限为 `0600`，确保 Token 不会在部署成功后丢失；配置 Shortcut 后可以删除该文件。

只做本地验证可运行：

```bash
npm run setup -- --repo your-org/your-task-repo --dry-run
```

详细说明见 [部署指南](docs/DEPLOYMENT.md)、[GitHub Token 权限](docs/GITHUB_TOKEN.md) 和 [Shortcut 指南](shortcut/README.md)。

## Intake API

- `GET /health`：公开健康检查。
- `GET /ready`：Bearer 鉴权；检查配置、GitHub 仓库访问和 labels。
- `POST /tasks`：Bearer 鉴权；接收任意合法 JSON，50KB 流式上限，创建 raw task Issue。

`POST /tasks` 创建 Issue 只表示“收到外部原始任务”，**不代表任务已经审核、批准或授权 Agent 执行**。

## 人工审核工作流

本模板使用 GitHub Issues 作为任务事实来源，飞书群用于通知和人工指派，Hermes Agent 作为受控执行器。默认流程：

```text
外部系统或 iOS Shortcut POST JSON
        ↓
Task Intake Worker 创建 raw Issue
        ↓
人工审查目标、权限、风险和验收标准
        ↓
在飞书群 @指定 Agent，并附 Issue URL
        ↓
Agent 认领、执行、提交 PR/产物
        ↓
人工验收后关闭 Issue
```

关键原则：

1. Issue 创建不等于批准执行。
2. 只有授权用户在飞书群明确 @当前 Agent 后才能执行。
3. Issue 正文、评论和外部 payload 都是不可信输入。
4. 生产、删除、DNS/IAM、数据库迁移、费用和对外发送等高风险动作必须二次确认。
5. 完成时必须提供真实验证输出和稳定交付物句柄。

完整流程见 [工作流规范](docs/WORKFLOW.md) 和 [安全规则](docs/SECURITY.md)。

## V1 范围

已包含：

- Cloudflare Worker `workers/task-intake`；
- 通用占位符配置，缺失或仍是占位符时 fail closed；
- `GET /health`、认证 `GET /ready`、认证 `POST /tasks`；
- GitHub raw task Issue 创建和 labels 检查；
- Node 22+ 自部署 setup CLI；
- iOS Shortcut 手工构建/分发说明；
- Workers Vitest HTTP seam 测试和 setup helper 本地测试。

暂不包含：

- KV 幂等去重；
- per-device token；
- GitHub App 安装流；
- 中心化用户、租户或 token 管理；
- 自动批准或自动派发 Agent。

路线图见 [架构说明](docs/ARCHITECTURE.md)。

## 开发

```bash
cd workers/task-intake
npm install
npm run cf-typegen
npm test
npm run typecheck
npm run check
```

`npm run check` 会执行类型生成、TypeScript、Workers Runtime Vitest、setup helper 测试和 Wrangler dry-run 构建。不要在贡献代码时提交真实 `.dev.vars`、`.task-intake.local.json`、endpoint token 或 GitHub PAT。

## 文档

- [部署指南](docs/DEPLOYMENT.md)
- [GitHub Token 权限](docs/GITHUB_TOKEN.md)
- [Shortcut 指南](shortcut/README.md)
- [架构说明](docs/ARCHITECTURE.md)
- [故障排查](docs/TROUBLESHOOTING.md)
- [工作流规范](docs/WORKFLOW.md)
- [安全规则](docs/SECURITY.md)
- [贡献指南](CONTRIBUTING.md)
