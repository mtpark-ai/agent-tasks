# 部署与 Onboarding

## 推荐路径：Deploy to Cloudflare

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/mtpark-ai/agent-tasks/tree/main/workers/task-intake)

Deploy Button 的职责是创建一个安全但尚未配置业务凭据的自托管实例：

```text
公开模板仓库
   ↓ Deploy Button
部署者自己的 Git 仓库
部署者自己的 Cloudflare Worker
部署者自己的 D1 数据库
   ↓
Setup Portal 可访问
/tasks 与 Admin 功能保持 fail closed
```

Cloudflare 会从 `wrangler.jsonc` 读取 D1 和 Static Assets bindings，创建资源并把新 ID 写入部署者的仓库配置。`npm run deploy` 会先应用 D1 migrations，再部署 Worker。

## 1. 部署 Worker

点击按钮后，在 Cloudflare 页面确认：

- 新 Git 仓库名称；
- Worker 名称；
- D1 数据库名称；
- Cloudflare 账号。

普通变量保留默认值即可。首次部署不需要在 Cloudflare 页面提供 GitHub PAT、Admin Token 或 Device Token。

部署成功后打开 Worker URL。根路径应显示 Agent Tasks Setup Portal；`GET /health` 应返回：

```json
{
  "ok": true,
  "version": "0.2.0"
}
```

## 2. 在 Setup Portal 生成命令

把 Cloudflare 创建的新 GitHub 仓库 clone URL 粘贴到页面。因为 Deploy Button 指向 `workers/task-intake` 子目录，新仓库根目录就是 Worker 项目：

```bash
git clone 'https://github.com/you/your-agent-tasks.git'
cd 'your-agent-tasks'
npm install
npm run onboard -- --endpoint 'https://your-worker.workers.dev'
```

生产 Endpoint 必须使用 HTTPS；只有 localhost 可以使用 HTTP。

## 3. 准备 GitHub fine-grained PAT

选择目标任务仓库，并只授予：

- Metadata: Read
- Issues: Read and write

推荐让 Deploy Button 创建的仓库同时作为任务 Issue 仓库，但如果它是公开仓库，CLI 会显示醒目警告并要求二次确认。更稳妥的做法是把任务仓库设为 private。

## 4. 运行 onboarding

CLI 会依次执行：

1. `wrangler whoami --json`，显示 Cloudflare 账号并要求确认；
2. 从 `git remote get-url origin` 推导 GitHub owner/repo；
3. 隐藏输入 PAT并验证仓库和可见性；
4. `wrangler d1 migrations apply DB --remote`；
5. 生成随机 `ADMIN_TOKEN`；
6. 通过 stdin 执行 `wrangler secret put GITHUB_TOKEN`；
7. 通过 stdin 执行 `wrangler secret put ADMIN_TOKEN`；
8. 调用认证的 `/api/admin/bootstrap`，创建或规范化四个固定 labels；
9. 创建首个 `personal-iphone` Device Token；
10. 调用 `/ready` 完成端到端验证。

PAT 不会写入文件，也不会作为命令参数传递。

输出文件：

```text
.task-intake.local.json
```

内容包括：

```json
{
  "endpoint_url": "https://your-worker.workers.dev",
  "admin_token": "ata_...",
  "device_token": "atd_...",
  "device_id": "...",
  "device_name": "personal-iphone",
  "github_repository": "you/your-agent-tasks",
  "worker_name": "your-worker"
}
```

POSIX 系统使用 `0600`；Windows 继承当前用户目录 ACL。该文件已被 Git 忽略，不要提交或分享。

### 参数

```text
--endpoint URL          Worker HTTPS URL
--repo owner/repo       覆盖 git remote 推导结果
--worker-name NAME      覆盖 wrangler.jsonc 中的 Worker 名称
--device-name NAME      首个设备名称
--shortcut-url URL      已审核的 iCloud 或 .shortcut HTTPS 地址
--allow-public-repo     明确接受公开任务仓库风险
--yes                   跳过普通确认，不会隐式批准公开仓库
--dry-run               只显示计划，不访问外部系统
```

示例：

```bash
npm run onboard -- \
  --endpoint 'https://my-agent-tasks.example.workers.dev' \
  --device-name 'blue-bear-iphone'
```

## 5. 安装 Shortcut

回到 Worker 首页：

- Endpoint 使用当前 Worker URL；
- Device Token 从 `.task-intake.local.json` 复制；
- 点击“安装 / 下载 Shortcut”。

若维护者已配置审核过的 Shortcut URL，`GET /shortcut` 会跳转过去；否则进入手工构建指南。

通用 Shortcut 必须使用 Import Questions：

1. Task Intake Endpoint
2. Device Token

不要把 Token 写进公开 iCloud 分享链接或 `.shortcut` 文件。

## 6. 绑定 Action Button

在 iPhone：

```text
设置 → 操作按钮 → 快捷指令 → Agent Tasks
```

推荐 Shortcut 运行时流程：

```text
听写文本
→ 要求输入，编辑结果
→ 显示提醒，确认或取消
→ 生成 UUID 作为 Idempotency-Key
→ POST /tasks
→ 显示 Issue URL
```

## 更新代码

在部署者自己的 Worker 仓库：

```bash
git pull
npm install
npm run deploy
```

`npm run deploy` 会先应用尚未执行的 D1 migrations，再部署 Worker。它不会轮换已有 Secrets 或 Device Token。

## 更新 Shortcut URL

首次 onboarding 可直接传：

```bash
npm run onboard -- --endpoint 'https://worker.example' \
  --shortcut-url 'https://www.icloud.com/shortcuts/...'
```

当前 CLI 会重新生成 Admin Token 并创建一个新设备，因此日常只更新 Shortcut 时更推荐使用 Admin API：

```bash
curl -fsS 'https://worker.example/api/admin/bootstrap' \
  -H 'Authorization: Bearer <ADMIN_TOKEN>' \
  -H 'Content-Type: application/json' \
  --data '{
    "github_owner": "you",
    "github_repo": "tasks",
    "shortcut_url": "https://www.icloud.com/shortcuts/..."
  }'
```

公开任务仓库还必须附加：

```json
{"allow_public_repository": true}
```

## 手工验证

```bash
curl -fsS 'https://worker.example/api/public/status'

curl -fsS 'https://worker.example/ready' \
  -H 'Authorization: Bearer <ADMIN_TOKEN>'
```

测试 Device Token：

```bash
curl -fsS 'https://worker.example/tasks' \
  -H 'Authorization: Bearer <DEVICE_TOKEN>' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: setup-test-0001' \
  --data '{"task":{"text":"安装测试，请勿执行"}}'
```
