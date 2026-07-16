# Agent Tasks Task Intake Worker

一个可自部署的 Cloudflare Worker：提供 Setup Portal，把 iPhone Shortcut 或外部系统提交的任务持久化到部署者自己的 GitHub Issues，并保持“创建任务不等于批准 Agent 执行”的安全边界。

## 快速安装

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/mtpark-ai/agent-tasks/tree/main/workers/task-intake)

Deploy Button 会：

- 把这个 Worker 模板复制到你的 GitHub/GitLab 账号；
- 在你的 Cloudflare 账号创建 Worker 和 D1 数据库；
- 应用 D1 migrations；
- 部署 Setup Portal、Task API 和静态资源。

首次部署不要求在网页中粘贴 GitHub PAT 或生成长期 Token。部署完成后打开 Worker URL，页面会根据当前 Endpoint 和你粘贴的 GitHub clone URL 生成一条本地命令：

```bash
git clone 'https://github.com/you/your-agent-tasks.git'
cd 'your-agent-tasks'
npm install
npm run onboard -- --endpoint 'https://your-worker.workers.dev'
```

`onboard` 会：

1. 显示并确认当前 Cloudflare 账号；
2. 从 `git remote origin` 推导目标 GitHub 仓库；
3. 隐藏输入 fine-grained PAT；
4. 检查仓库可见性，公开仓库必须再次确认；
5. 应用 D1 migrations；
6. 通过 stdin 写入 `GITHUB_TOKEN` 和随机生成的 `ADMIN_TOKEN` Worker Secrets；
7. 初始化固定的 GitHub 协议 labels；
8. 创建首个低权限 iPhone Device Token；
9. 把 Endpoint、Admin Token 和 Device Token 写入被 Git 忽略的 `.task-intake.local.json`。

GitHub PAT 不会保存到磁盘，也不会出现在命令参数中。

## Shortcut 安装

Worker 首页提供：

- 当前 Worker Endpoint；
- Device Token 的本地文件位置；
- `/shortcut` 安装入口；
- 手工构建和 Action Button 绑定指南。

只有维护者配置了一个实际在 Apple 设备上构建并验证过的 iCloud Shortcut 链接或 `.shortcut` HTTPS 地址时，`/shortcut` 才会直接跳转下载。未配置时，它会打开手工构建指南。项目不会伪造或动态修改 Shortcut 二进制，也不会把 Token 嵌入公开分发物。

配置已审核的 Shortcut：

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
- `GET /shortcut`：跳转到已配置 Shortcut，或进入手工指南；
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

- Metadata: Read
- Issues: Read and write

不要使用 classic PAT、管理员 Token 或 `gh auth token` 作为 Worker Secret。

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

它会执行类型生成、严格 TypeScript 检查、8 个 Worker/D1 测试、10 个 onboarding helper 测试和 Wrangler bundle dry-run。

## 安全边界

- 未配置时 Worker fail closed，只有 Portal、health 和粗粒度状态可用；
- raw Issue、评论、网页、日志和附件都是不可信输入；
- Issue 创建不等于批准或派发 Agent；
- Worker 不持有 Cloudflare 管理 API Token，也不能修改自己的 Secrets；
- `/bootstrap` 只管理代码内固定的协议 labels；
- 公开任务仓库必须显式二次确认；
- 生产、删除、DNS/IAM、数据库迁移、费用和对外发送等高风险动作仍需独立人工确认。
