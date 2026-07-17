# Agent Tasks

开源的 Hermes/Codex Agent 人工审核任务队列模板。它把 iPhone Shortcut 或外部系统提交的任务写入部署者自己的 GitHub Issues，同时坚持一个关键边界：**创建 Issue 只代表收到任务，不代表批准 Agent 执行。**

## 快速部署

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/mtpark-ai/agent-tasks/tree/main/workers/task-intake)

Cloudflare 会把 `workers/task-intake` 模板复制到部署者自己的 GitHub/GitLab 账号，创建其自己的 Worker 和 D1 数据库，并部署一个自托管 Setup Portal。

部署后：

1. 打开 Worker URL；
2. 在页面粘贴 Cloudflare 创建的新 GitHub 仓库 clone URL；
3. 复制页面生成的一条 onboarding 命令，在本机运行；
4. CLI 隐藏输入 fine-grained PAT、设置 Worker Secrets、初始化 D1/GitHub，并创建首个 iPhone Device Token；
5. 回到 Worker 页面安装 Shortcut，再绑定 iPhone Action Button。

典型命令：

```bash
git clone 'https://github.com/you/your-agent-tasks.git'
cd 'your-agent-tasks'
npm install
npm run onboard -- --endpoint 'https://your-worker.workers.dev'
```

完整步骤见 [部署指南](docs/DEPLOYMENT.md)。

## 架构

```text
iPhone Action Button
        ↓
iOS Shortcut：听写 → 编辑 → 确认
        ↓ Device Token + Idempotency-Key
用户自己的 Cloudflare Worker
  ├─ Setup Portal / Shortcut 安装入口
  ├─ Admin 与 Device Token 分离
  ├─ D1：设置、设备、幂等和审计
  └─ GitHub REST API
        ↓
用户自己的 GitHub task Issue
  status:needs-triage
        ↓
人工 Dispatcher 审核并明确指派
        ↓
Hermes/Codex Agent 执行
        ↓
Draft PR / 产物 / 验证证据
        ↓
人工验收并关闭 Issue
```

## Setup Portal

Worker 根路径 `/` 是安装向导，不是裸 API 页面。它会：

- 显示 Worker、D1、Secrets、GitHub、设备和 Shortcut 的粗粒度状态；
- 根据当前 Worker URL 和用户仓库 URL 生成本地 onboarding 命令；
- 展示 Shortcut Import Questions 需要的 Endpoint；
- 指向本机 Device Token 文件；
- 提供 `/shortcut` 安装入口和手工构建指南；
- 指导绑定 iPhone Action Button。

Worker 不会在网页中收集 GitHub PAT，也不持有 Cloudflare 管理 API Token。高权限初始化由本地 CLI 通过 Wrangler 完成。

## 凭据边界

| 凭据 | 权限 | 存储位置 |
|---|---|---|
| GitHub fine-grained PAT | 仅目标任务仓库的 Metadata Read、Issues Read/Write | Worker Secret；setup 过程不落盘 |
| `ADMIN_TOKEN` | 初始化仓库、管理设备、详细 readiness | Worker Secret + 本机 0600 文件 |
| Device Token | 只能向 `/tasks` 创建 raw Issue | D1 只存 SHA-256，明文只显示一次 |

公开任务仓库必须二次确认。推荐使用私有仓库，避免语音任务中的内部项目名、客户信息或错误日志被公开。

## Shortcut

通用 Shortcut 已在真实 iPhone 上构建并通过 iCloud 分享。安装时使用 Import Questions 填写每个部署者自己的 Endpoint 和 Device Token：

[安装 Agent Tasks Shortcut](https://www.icloud.com/shortcuts/5005bf386b2447ca855aec7ecb67fd15)

新 Deploy Button 实例的 `/shortcut` 会默认跳转到这个链接。部署者也可以通过 `SHORTCUT_URL` 或 Admin bootstrap 替换为自己审核过的版本。

仓库不会：

- 动态修改 `.shortcut` 二进制；
- 把生产 Endpoint 或 Token 内嵌到公开文件；
- 为每个部署者生成不可审计的 Shortcut 副本。

构建、Import Questions 和发布前验证见 [Shortcut 指南](shortcut/README.md)。

## API 摘要

公开：

- `GET /`：Setup Portal
- `GET /health`
- `GET /api/public/status`
- `GET /shortcut`
- `POST /tasks`：Device Token

Admin：

- `GET /ready`
- `GET /api/admin/status`
- `POST /api/admin/bootstrap`
- `GET|POST /api/admin/devices`
- `DELETE /api/admin/devices/:id`
- `POST /api/admin/test-task`

`POST /tasks` 支持 `Idempotency-Key`，避免 Shortcut 因网络超时重复创建 Issue。

## 人工审核工作流

1. 外部请求创建 `status:needs-triage`、`agent:unassigned`、`type:raw`、`source:external` Issue；
2. Dispatcher 检查目标、重复项、权限、风险和验收标准；
3. 人工批准后设置 `status:ready`，并明确指派 Agent；
4. Agent 认领、执行、提交 PR 或稳定产物；
5. Agent 标记 `status:in-review` 并提供真实验证证据；
6. 人工验收后标记 `status:done` 并关闭 Issue。

完整规范见 [工作流](docs/WORKFLOW.md) 与 [安全规则](docs/SECURITY.md)。

## 当前范围

已包含：

- Cloudflare Deploy Button；
- Worker Static Assets Setup Portal；
- 自动配置的 D1 数据库和 migrations；
- 本地 `npm run onboard`；
- Admin / Device Token 分离；
- per-device Token 创建与撤销；
- D1 幂等键；
- GitHub labels bootstrap 和 readiness；
- 已发布的通用 iCloud Shortcut 与 `/shortcut` 安装入口；
- Workers Runtime + D1 测试和 onboarding helper 测试。

暂不包含：

- 中心账号或多租户服务；
- GitHub App 安装流；
- 自动批准、自动派发或生产部署；
- 动态注入凭据或按用户生成 `.shortcut` 二进制。

## 开发

```bash
cd workers/task-intake
cp .dev.vars.local.example .dev.vars
npm install
npx wrangler d1 migrations apply DB --local
npm run check
```

## 文档

- [部署指南](docs/DEPLOYMENT.md)
- [架构说明](docs/ARCHITECTURE.md)
- [安全规则](docs/SECURITY.md)
- [GitHub Token 权限](docs/GITHUB_TOKEN.md)
- [故障排查](docs/TROUBLESHOOTING.md)
- [Shortcut 指南](shortcut/README.md)
- [工作流规范](docs/WORKFLOW.md)
