# Agent Tasks Task Intake Worker

一个可自部署的 Cloudflare Worker：提供 Setup Portal，把 iPhone Shortcut 或外部系统提交的任务持久化到部署者自己的 GitHub Issues，并保持“创建任务不等于批准 Agent 执行”的安全边界。

## 快速安装

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/mtpark-ai/agent-tasks/tree/main/workers/task-intake)

> 在 Cloudflare 创建页面开启 **Create private Git repository**。上游模板保持公开，但你自己的任务仓库建议从创建开始就是 Private。

Deploy Button 会：

- 把这个 Worker 模板复制到你的 GitHub/GitLab 账号；
- 在你的 Cloudflare 账号创建 Worker 和 D1 数据库；
- 应用 D1 migrations；
- 部署 Setup Portal、Task API 和静态资源。

首次部署不要求在网页中粘贴 GitHub PAT 或生成长期 Token。部署完成后打开 Worker URL，页面会根据当前服务地址和你粘贴的 GitHub 仓库 URL 生成一条本地命令：

```bash
git clone 'https://github.com/you/your-agent-tasks.git'
cd 'your-agent-tasks'
npm install
npm run onboard -- --endpoint 'https://your-worker.workers.dev'
```

`onboard` 会：

1. 显示并确认当前 Cloudflare 账号；
2. 从 `git remote origin` 推导目标 GitHub 仓库；
3. 打开预填最小权限的 fine-grained PAT 创建页面并隐藏输入 PAT；
4. 检查仓库可见性；公开仓库默认暂停并引导用户改为 Private；
5. 应用 D1 migrations；
6. 通过 stdin 写入 `GITHUB_TOKEN` 和随机生成的 `ADMIN_TOKEN` Worker Secrets；
7. 初始化固定的 GitHub 协议 labels；
8. 创建首个低权限 iPhone Device Token；
9. 把 Endpoint、Admin Token 和 Device Token 写入被 Git 忽略的 `.task-intake.local.json`；
10. 在创建测试 Issue 前再次检查仓库没有意外变回 Public。

GitHub PAT 不会保存到磁盘，也不会出现在命令参数中。它不包含 `Administration` 权限，因此 Worker 不会也不能自行修改仓库可见性。

只有明确使用高级参数时才允许公开仓库：

```bash
npm run onboard -- \
  --endpoint 'https://your-worker.workers.dev' \
  --allow-public-repo
```

## Shortcut 安装

Worker 首页提供：

- 当前 Worker Endpoint；
- Device Token 的本地文件位置；
- `/shortcut` 安装入口；
- 手工构建和 Action Button 绑定指南。

模板默认使用已经在真实 iPhone 上构建并通过 iCloud 分享的通用 Shortcut：

[安装 Agent Tasks Shortcut](https://www.icloud.com/shortcuts/4788308f799c4e8abee863ab3ddb3334)

`GET /shortcut` 会跳转到该链接。导入时填写自己的 Endpoint 与 Device Token；公开 Shortcut 本身不包含生产凭据。部署者可以通过 `SHORTCUT_URL` 或 Admin bootstrap 替换为自己审核过的版本。

首次 onboarding 时覆盖 Shortcut URL：

```bash
npm run onboard -- --endpoint 'https://your-worker.workers.dev' \
  --shortcut-url 'https://www.icloud.com/shortcuts/...'
```

## 权限模型

| 凭据 | 用途 | 存储 |
|---|---|---|
| `GITHUB_TOKEN` | 仅在目标任务仓库读写 Issues/labels | Worker Secret |
| `ADMIN_TOKEN` | 初始化仓库、管理设备和读取详细 readiness | Worker Secret；本机 0600 文件保留副本 |
| Device Token | iPhone Shortcut 调用 `POST /tasks` | D1 仅保存 SHA-256；明文只显示一次 |

新安装不要把 `ADMIN_TOKEN` 放进 iPhone。

## API

### 公开接口

- `GET /`：Setup Portal；
- `GET /health`：进程健康和版本；
- `GET /api/public/status`：只返回粗粒度安装状态；
- `GET /shortcut`：跳转到配置的 Shortcut，配置为空时进入手工指南；
- `POST /tasks`：使用 Device Token 创建 raw task Issue。

### Admin 接口

以下接口需要：

```http
Authorization: Bearer <ADMIN_TOKEN>
```

- `GET /ready`、`GET /api/admin/status`；
- `POST /bootstrap`、`POST /api/admin/bootstrap`；
- `GET|POST /api/admin/devices`；
- `DELETE /api/admin/devices/:id`；
- `POST /api/admin/test-task`。

### 创建任务

```http
POST /tasks
Authorization: Bearer <DEVICE_TOKEN>
Content-Type: application/json
Idempotency-Key: <8-128 字符唯一值>
```

```json
{
  "source": "ios-shortcut",
  "task": {
    "text": "检查最新 CI 失败，修复能确认的问题并创建 Draft PR"
  },
  "captured_at": "2026-07-16T18:00:00+08:00"
}
```

相同 `Idempotency-Key` 和相同 payload 重试时返回原 Issue；同一个 key 配不同 payload 返回 `409 idempotency_conflict`。

## GitHub Token 权限

使用 fine-grained PAT，只选择目标任务仓库：

- Metadata: Read-only
- Issues: Read and write
- Account permissions: 0

不要选择名称相近的 `Agent tasks`，也不要添加 Contents、Actions、Administration、Secrets 或其他权限。

## 本地开发

```bash
cp .dev.vars.local.example .dev.vars
npm install
npx wrangler d1 migrations apply DB --local
npm run dev
```

完整检查：

```bash
npm run check
```

它会执行类型生成、严格 TypeScript 检查、Worker/D1 测试、onboarding helper 测试、浏览器/CLI 语法检查和 Wrangler bundle dry-run。

## 安全边界

- 未配置时 Worker fail closed，只有 Portal、health 和粗粒度状态可用；
- raw Issue、评论、网页、日志和附件都是不可信输入；
- Issue 创建不等于批准或派发 Agent；
- Worker 不持有 Cloudflare 管理 API Token，也不能修改自己的 Secrets；
- Worker 的 GitHub Token 没有 `Administration` 权限，不能修改仓库可见性；
- `/bootstrap` 只管理代码内固定的协议 labels；
- 公开任务仓库默认被 onboarding 拒绝，除非显式传入 `--allow-public-repo`；
- 生产、删除、DNS/IAM、数据库迁移、费用和对外发送等高风险动作仍需独立人工确认。
