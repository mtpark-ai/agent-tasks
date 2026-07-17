# Agent Tasks

> **按住 iPhone 操作按钮，说出一件事，它就会变成一张等待你确认的开发任务单。**

Agent Tasks 是一个放在你自己 Cloudflare 和 GitHub 账号里的语音任务入口。完成一次设置后，你可以对 iPhone 说：

> 检查登录失败的问题，修复后创建一个 Draft PR，不要部署。

这句话会被保存成你自己 GitHub 仓库中的一张任务单。你可以先查看、补充或取消，再决定是否交给 Codex、Hermes 或其他 Agent 处理。

**说出任务不等于授权执行。** Agent Tasks 不会仅因为收到一段语音就自动修改代码、合并 PR、删除资源或部署生产环境。

## 使用起来是什么样

```text
按住 iPhone 操作按钮
        ↓
说出任务，并检查识别结果
        ↓
确认提交
        ↓
你的私有 GitHub 仓库出现一张待审核任务单
        ↓
由你决定是否交给 Agent 执行
```

没有操作按钮的 iPhone，也可以直接从“快捷指令”App、主屏幕小组件或 Siri 运行同一个快捷指令。

## 它能帮你解决什么

- **想到就记下来**：离开电脑时也能快速记录开发任务、Bug 和改进想法；
- **减少听写误操作**：语音转成文字后可以编辑，并在提交前再次确认；
- **任务不会散落在聊天里**：每条任务都有独立链接、状态、评论和后续交付记录；
- **保留人工控制**：任务先进入待审核状态，不会自动执行高风险操作；
- **数据留在自己的账号中**：接收服务和请求历史保存在你的 Cloudflare，任务单保存在你的 GitHub 仓库。

## 你需要准备什么

- 一个 GitHub 账号；
- 一个 Cloudflare 账号；
- 一台 Mac、Windows 或 Linux 电脑，用于完成一次设置；
- 一台可以运行“快捷指令”的 iPhone。

第一次设置需要在电脑终端复制运行一段命令，电脑应已安装 Git 和 Node.js 22 或更高版本。安装完成后，日常使用不需要再打开终端。

## 快速开始

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/mtpark-ai/agent-tasks/tree/main/workers/task-intake)

> **在 Cloudflare 创建页面开启 `Create private Git repository`。** 模板源码可以保持公开，但你自己的任务仓库应尽量从创建开始就是 Private，避免语音中的项目名称、错误信息或内部说明被公开。

整个安装流程分为三步：

1. **点击上面的按钮**，让 Cloudflare 在你的账号中创建服务和仓库；
2. **打开部署完成后的安装页面**，粘贴新仓库地址，并把页面生成的一段命令复制到电脑终端运行；
3. **回到 iPhone 安装快捷指令**，填写页面和终端给出的“服务地址”与“iPhone 配置码”，再绑定操作按钮。

安装页面会告诉你当前该做什么，并引导你创建最小权限的 GitHub 授权码。它不会要求你把 GitHub 授权码、Cloudflare 密钥或管理员配置码粘贴到网页中。

完整的图文步骤、权限说明和故障排查见 [部署指南](docs/DEPLOYMENT.md)。

---

## 技术用户：手动初始化

部署完成后，也可以在本机直接运行：

```bash
git clone 'https://github.com/you/your-agent-tasks.git'
cd 'your-agent-tasks'
npm install
npm run onboard -- --endpoint 'https://your-worker.workers.dev'
```

`onboard` 检测到公开任务仓库时会默认暂停，打开 GitHub 仓库设置并等待用户改为 Private。只有明确使用高级参数 `--allow-public-repo` 才会继续使用公开仓库。

下面内容面向希望了解系统实现、权限和 API 的开发者与维护者。

## 架构

```text
iPhone Action Button
        ↓
iOS Shortcut：听写 → 编辑 → 确认
        ↓ Device Token + Idempotency-Key
用户自己的 Cloudflare Worker
  ├─ Setup Portal / Shortcut 安装入口
  ├─ Admin 与 Device Token 分离
  ├─ D1：设置、设备、请求历史、幂等和审计
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

- 根据当前安装状态只展示下一项需要完成的操作；
- 根据用户仓库 URL 生成本地 onboarding 命令；
- 提醒部署时创建 Private 仓库，并为已创建的仓库生成 GitHub Settings 入口；
- 生成只包含最小权限的 GitHub fine-grained PAT 创建链接；
- 展示 Shortcut Import Questions 需要的服务地址；
- 指向本机 Device Token 文件；
- 提供 `/shortcut` 安装入口和 Action Button 指南；
- 把 D1、Secrets、labels 等实现细节折叠在高级区域。

Worker 不会在网页中收集 GitHub PAT，也不持有 Cloudflare 管理 API Token。高权限初始化由本地 CLI 通过 Wrangler 完成。Worker 使用的 PAT 不包含 `Administration` 权限，因此不会也不能自行改变仓库可见性。

## 凭据边界

| 凭据 | 权限 | 存储位置 |
|---|---|---|
| GitHub fine-grained PAT | 仅目标任务仓库的 Metadata Read、Issues Read/Write | Worker Secret；setup 过程不落盘 |
| `ADMIN_TOKEN` | 初始化仓库、管理设备、详细 readiness | Worker Secret + 本机 0600 文件 |
| Device Token | 只能向 `/tasks` 创建 raw Issue | D1 只存 SHA-256，明文只显示一次 |

任务仓库推荐保持 Private。若用户主动使用 `--allow-public-repo`，CLI 会显示强警告；这是高级显式豁免，不是默认安装路径。

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
- `GET /api/admin/task-requests`
- `GET /api/admin/task-requests/:id`

`POST /tasks` 支持 `Idempotency-Key`，避免 Shortcut 因网络超时重复创建 Issue。每次通过认证的请求还会先持久化到 D1；详见 [D1 请求持久化](docs/REQUEST_PERSISTENCE.md)。

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
- Private 仓库引导与 CLI 可见性检查；
- 自动配置的 D1 数据库和 migrations；
- 本地 `npm run onboard`；
- Admin / Device Token 分离；
- per-device Token 创建与撤销；
- D1 请求历史和幂等键；
- GitHub labels bootstrap 和 readiness；
- 已发布的通用 iCloud Shortcut 与 `/shortcut` 安装入口；
- Workers Runtime + D1 测试和 onboarding helper 测试。

暂不包含：

- 中心账号或多租户服务；
- GitHub App 安装流；
- 自动修改 GitHub 仓库可见性；
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
- [D1 请求持久化](docs/REQUEST_PERSISTENCE.md)
- [安全规则](docs/SECURITY.md)
- [GitHub Token 权限](docs/GITHUB_TOKEN.md)
- [故障排查](docs/TROUBLESHOOTING.md)
- [Shortcut 指南](shortcut/README.md)
- [工作流规范](docs/WORKFLOW.md)
