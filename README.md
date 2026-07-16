# Agent Tasks

开源的 Hermes/Codex Agent 人工审核任务队列模板。你可以把本仓库作为**源码仓库** fork/clone，再把 Cloudflare Worker 部署到自己的 Cloudflare 账号，并把外部任务写入你自己的 GitHub **目标任务仓库** Issues。

V1 没有中心账号服务：每个部署者使用自己的 Cloudflare 账号、GitHub 仓库、fine-grained PAT 和随机生成的 Intake Bearer Token。任何公开分发的文件都不得内嵌生产 endpoint 或 token。

## 快速部署：Cloudflare Deploy Button

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/mtpark-ai/agent-tasks/tree/main/workers/task-intake)

> Cloudflare 只支持从公开 GitHub/GitLab 源仓库分发 Deploy Button。维护者在对外发布按钮前必须确保本源码仓库为 public；目标任务仓库仍然可以是 private。

部署前准备：

1. 创建用于接收任务的 GitHub 仓库；
2. 创建仅授权该仓库的 fine-grained PAT，权限为 `Metadata: Read`、`Issues: Read and write`；
3. 生成并保存 Intake Token，例如 `openssl rand -base64 32`；
4. 点击按钮，在 Cloudflare 页面填写 `GITHUB_OWNER`、`GITHUB_REPO`、`GITHUB_TOKEN`、`AUTH_TOKEN`，其余变量保留默认值；
5. 部署完成后调用一次认证的 `POST /bootstrap`，再用 `GET /ready` 验证；
6. 把 Worker endpoint 和同一个 `AUTH_TOKEN` 填入 iOS Shortcut。

`POST /bootstrap` 只会创建或规范化程序内固定的 raw-task labels，并验证 GitHub Token 具有 Issues 写权限；它不会创建任务、批准任务或触发 Agent。

完整步骤见 [Deploy Button 与自部署指南](docs/DEPLOYMENT.md)。

## CLI 自部署

需要严格预检、自动生成 Intake Token 和可重复的本地部署配置时，使用 CLI：

```bash
cd workers/task-intake
npm install
npm run setup
```

setup 会提示输入目标任务仓库、Worker 名称和 GitHub fine-grained PAT，显示当前 Cloudflare 账号并要求确认。它会先部署安全占位符使 Worker fail closed，再写入 Secrets，最后通过被 git 忽略的持久化部署配置启用真实 owner/repo，并验证 `/health` 与 `/ready`。

不会保存 GitHub PAT。脚本会把生成的 endpoint/token 写入被 git 忽略的 `.task-intake.local.json`；POSIX 权限为 `0600`，Windows 使用当前用户目录继承 ACL。配置 Shortcut 后可以删除该文件。后续代码更新使用：

```bash
npm run deploy:managed
```

该命令不会轮换现有 Token。

只做本地验证可运行：

```bash
npm run setup -- --repo your-org/your-task-repo --dry-run
```

详细说明见 [部署指南](docs/DEPLOYMENT.md)、[GitHub Token 权限](docs/GITHUB_TOKEN.md) 和 [Shortcut 指南](shortcut/README.md)。

## Intake API

- `GET /health`：公开健康检查；
- `POST /bootstrap`：Bearer 鉴权；创建/规范化固定协议 labels，并验证 GitHub Issues 写权限；
- `GET /ready`：Bearer 鉴权；检查配置、GitHub 仓库访问和 labels；
- `POST /tasks`：Bearer 鉴权；接收任意合法 JSON，50KB 流式上限，创建 raw task Issue。

`POST /tasks` 创建 Issue 只表示“收到外部原始任务”，**不代表任务已经审核、批准或授权 Agent 执行**。

## 人工审核工作流

本模板使用 GitHub Issues 作为任务事实来源，由受信任的人工 Dispatcher 负责通知、审核和明确指派，Hermes/Codex Agent 作为受控执行器。飞书 `@Agent` 是本仓库采用的参考 Dispatcher 实现，不是 Worker 自部署的强制依赖。默认流程：

```text
外部系统或 iOS Shortcut POST JSON
        ↓
Task Intake Worker 创建 raw Issue
        ↓
人工审查目标、权限、风险和验收标准
        ↓
受信任的人工 Dispatcher 明确指派 Agent，并附 Issue URL
        ↓
Agent 认领、执行、提交 PR/产物
        ↓
人工验收后关闭 Issue
```

关键原则：

1. Issue 创建不等于批准执行；
2. 只有受信任的人工 Dispatcher 明确授权并指派当前 Agent 后才能执行；飞书 `@Agent` 是一种参考实现；
3. Issue 正文、评论和外部 payload 都是不可信输入；
4. 生产、删除、DNS/IAM、数据库迁移、费用和对外发送等高风险动作必须二次确认；
5. 完成时必须提供真实验证输出和稳定交付物句柄。

完整流程见 [工作流规范](docs/WORKFLOW.md) 和 [安全规则](docs/SECURITY.md)。

## V1 范围

已包含：

- Cloudflare Worker `workers/task-intake`；
- Cloudflare Deploy Button 兼容的独立 Worker 子目录；
- 通用占位符配置，缺失或仍是占位符时 fail closed；
- `GET /health`、认证 `POST /bootstrap`、认证 `GET /ready`、认证 `POST /tasks`；
- GitHub raw task Issue 创建和 labels 初始化/检查；
- Node 22+ 自部署 setup CLI；
- iOS Shortcut 手工构建/分发说明；
- Workers Vitest HTTP seam 测试和 setup helper 本地测试。

暂不包含：

- KV/Durable Object 幂等去重；
- per-device token；
- GitHub App 安装流；
- 中心化用户、租户或 token 管理；
- 自动批准或自动派发 Agent。

路线图见 [架构说明](docs/ARCHITECTURE.md)。

## 开发

```bash
cd workers/task-intake
cp .dev.vars.local.example .dev.vars
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
