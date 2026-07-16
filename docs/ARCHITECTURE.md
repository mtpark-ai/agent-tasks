# 架构说明

## 设计目标

- 每个部署者拥有自己的 Cloudflare、Git 仓库、D1 和 GitHub 凭据；
- Worker 首次部署后立即提供友好 Setup Portal，但业务 API fail closed；
- 网页负责引导和状态展示，本地 CLI 负责高权限初始化；
- GitHub Issues 是任务事实来源；
- 创建任务与批准执行严格分离；
- iPhone 使用可单独撤销的低权限 Device Token；
- 网络重试不会重复创建 Issue。

## 组件

```text
Deploy to Cloudflare
  ├─ 复制 Worker 模板到用户 Git 账号
  ├─ 创建 Worker
  ├─ 创建 D1
  └─ 部署 Static Assets Setup Portal

Setup Portal
  ├─ 公开粗粒度状态
  ├─ 命令生成器
  ├─ Shortcut 安装入口
  └─ Action Button 指南

本地 onboard CLI
  ├─ Wrangler 账号确认
  ├─ GitHub PAT 隐藏输入
  ├─ D1 migrations
  ├─ Worker Secrets
  ├─ GitHub labels bootstrap
  └─ 首个 Device Token

Worker Runtime
  ├─ Admin API
  ├─ Device-authenticated /tasks
  ├─ GitHub API client
  ├─ Static Assets
  └─ D1 state
```

## D1 数据

### `settings`

保存非敏感、可变的运行配置：

- `github_owner`
- `github_repo`
- `repository_visibility`
- `bootstrap_completed_at`
- `github_verified_at`
- `shortcut_url`

### `devices`

保存：

- Device ID 和名称；
- SHA-256 Token hash；
- 创建、最后使用和撤销时间。

Device Token 明文只在创建响应中出现一次。

### `idempotency_keys`

按客户端 `Idempotency-Key` 保存：

- payload hash；
- `pending` / `complete` 状态；
- Issue number 和 URL。

相同 key + 相同 payload 返回原 Issue；相同 key + 不同 payload 返回冲突。

### `audit_events`

记录 bootstrap、设备创建/撤销、任务创建等控制面事件。不得记录 Token 明文或完整敏感 payload。

## 配置分层

### Wrangler vars

只保存公开默认值和协议参数：

- `APP_VERSION`
- placeholder `GITHUB_OWNER/GITHUB_REPO`，仅兼容旧部署；
- `ISSUE_LABELS`
- `MAX_BODY_BYTES`
- 可选 `SHORTCUT_URL`

### Worker Secrets

- `GITHUB_TOKEN`
- `ADMIN_TOKEN`
- 可选旧版 `AUTH_TOKEN`

### Device credentials

D1 只存 hash；客户端保存明文。

## 未配置状态

首次 Deploy Button 部署后：

- `/`、`/health`、`/api/public/status`、静态指南可用；
- `/tasks` 因无 Device Token 和仓库配置而拒绝；
- Admin API 因无 `ADMIN_TOKEN` 而拒绝；
- placeholder owner/repo 不会被识别为真实配置。

## GitHub bootstrap

`POST /api/admin/bootstrap`：

- 只接受 owner/repo、公开仓库确认和可选 Shortcut URL；
- 只创建或规范化代码内固定的四个协议 labels；
- PATCH labels 同时验证 PAT 具有 Issues 写权限；
- 不创建普通任务；
- 不批准或派发 Agent；
- 不修改仓库代码、Actions、成员或设置。

## Shortcut 分发

Worker 的 `/shortcut` 是稳定入口：

- 已配置时跳转到审核过的 HTTPS/iCloud URL；
- 未配置时跳转到本地手工构建指南。

Worker 不动态修改 `.shortcut` 二进制，也不把 Device/Admin Token 放入下载 URL。

## Agent 执行面

本仓库只提供 intake 与人工审核控制面。Agent Runner 应继续使用：

- 明确的可信 Dispatcher 授权；
- 独立 worktree 或容器；
- 原子 run lease；
- Draft PR；
- 禁止自动部署、自动合并和生产密钥访问；
- Issue 中的 Run ID、权限范围和验证证据。
