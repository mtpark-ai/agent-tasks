# GitHub Issue Webhook 转发（MVP）

这个 Worker 可以接收 GitHub 的 Issue / Issue comment Webhook，验签后转换为稳定的事件格式，再异步转发给一个 IM Webhook 或 Bot 服务。

```text
GitHub Issue / Comment
→ POST /webhooks/github
→ HMAC-SHA256 验签
→ D1 去重和投递状态
→ ctx.waitUntil() 异步转发
→ 通用 Bot Webhook 或飞书自定义机器人
```

## MVP 能力

- 接收 `issues` 与 `issue_comment` 事件；
- 使用 `X-Hub-Signature-256` 验证 GitHub Webhook Secret；
- 使用 `X-GitHub-Delivery` 在 D1 中去重；
- 将 GitHub payload 转换为 `schema_version: 1` 的稳定 JSON；
- 支持通用 JSON Webhook和飞书文本机器人两种输出；
- 使用 `ctx.waitUntil()` 在返回 `202` 后发送；
- 对网络错误、`429` 和 `5xx` 最多尝试 3 次；
- 忽略 PR comment、Bot 账号评论和带 `<!-- agent-tasks:bot -->` 标记的评论，避免通知循环；
- 通过 Admin API 查看投递记录和失败原因。

MVP 暂时不使用 Cloudflare Queue 或 DLQ，因此属于“尽力投递”。需要更强可靠性时，可把发送阶段替换为 Queue Consumer。

## 1. 配置 Worker Secrets

生成 GitHub Webhook Secret：

```bash
openssl rand -hex 32
```

保存该值，然后在 Worker 仓库中执行：

```bash
npx wrangler secret put GITHUB_WEBHOOK_SECRET
npx wrangler secret put OUTBOUND_WEBHOOK_URL
```

- `GITHUB_WEBHOOK_SECRET`：稍后在 GitHub Webhook 设置中填写同一个值；
- `OUTBOUND_WEBHOOK_URL`：接收转换后消息的 Bot / IM Webhook 地址。

通用 Bot 需要 Authorization Header 时，可再设置：

```bash
npx wrangler secret put OUTBOUND_WEBHOOK_AUTHORIZATION
```

例如保存：

```text
Bearer your-bot-token
```

Webhook URL 和 Token 都应使用 Worker Secret，不要放进 Git、D1 或普通 `vars`。

## 2. 选择输出格式

`wrangler.jsonc` 默认是：

```json
{
  "vars": {
    "OUTBOUND_WEBHOOK_KIND": "generic"
  }
}
```

支持：

```text
generic  转发标准化 JSON，适合自建 Bot、另一个 Worker 或自动化服务
feishu   转换成飞书自定义机器人 text 消息格式
```

使用飞书时改为：

```json
"OUTBOUND_WEBHOOK_KIND": "feishu"
```

然后把飞书自定义机器人的 Webhook URL 写入 `OUTBOUND_WEBHOOK_URL`。MVP 不包含飞书“签名校验”模式；如启用飞书签名，需要后续增加签名适配器。

## 3. 部署 Migration 和 Worker

```bash
npm run deploy
```

该命令会先应用：

```text
migrations/0003_github_webhook_forwarding.sql
```

再部署 Worker。

## 4. 在 GitHub 添加 Webhook

进入任务仓库：

```text
Settings
→ Webhooks
→ Add webhook
```

填写：

```text
Payload URL:
https://你的-worker.workers.dev/webhooks/github

Content type:
application/json

Secret:
与 GITHUB_WEBHOOK_SECRET 相同的值
```

选择：

```text
Let me select individual events
✓ Issues
✓ Issue comments
```

保存后，GitHub 会发送 `ping`。Worker 验签成功后返回 `200`，但不会把 ping 转发到 IM。

## 支持的事件

```text
issues:
- opened
- reopened
- closed
- labeled
- unlabeled
- assigned

issue_comment:
- created
```

其他事件会记录为 `ignored`，不发送到目标 Webhook。

## 标准化 JSON

`generic` 模式发送示例：

```json
{
  "schema_version": 1,
  "event_id": "X-GitHub-Delivery",
  "source": "github",
  "event": "issue.opened",
  "action": "opened",
  "occurred_at": "2026-07-17T12:00:00Z",
  "repository": {
    "full_name": "blue-bear/agent-tasks",
    "private": true,
    "url": "https://github.com/blue-bear/agent-tasks"
  },
  "actor": {
    "login": "blue-bear",
    "type": "User",
    "url": "https://github.com/blue-bear"
  },
  "issue": {
    "number": 18,
    "title": "修复登录失败问题",
    "state": "open",
    "url": "https://github.com/blue-bear/agent-tasks/issues/18",
    "labels": ["status:needs-triage"]
  }
}
```

评论正文最多保留 1,200 个字符，减少把长日志或敏感内容推送到群聊的风险。

通用模式还会发送：

```http
X-Agent-Tasks-Delivery: <GitHub delivery ID>
X-Agent-Tasks-Event: issue.opened
```

## D1 投递记录

`github_webhook_deliveries` 保存：

- GitHub delivery ID；
- event、action、仓库、Issue 编号和 sender；
- 标准化 JSON；
- `ignored`、`queued`、`delivered` 或 `failed` 状态；
- 目标 HTTP 状态码、错误码和尝试次数；
- 接收与完成时间。

不保存：

- `GITHUB_WEBHOOK_SECRET`；
- `OUTBOUND_WEBHOOK_URL`；
- Authorization Header；
- GitHub PAT、Admin Token 或 Device Token；
- GitHub 原始完整 payload。

## Admin API

需要：

```http
Authorization: Bearer <ADMIN_TOKEN>
```

列出投递：

```http
GET /api/admin/github-webhooks?limit=25
```

可选过滤：

```text
status=ignored|queued|delivered|failed
event_type=issues|issue_comment
limit=1..100
```

读取单条：

```http
GET /api/admin/github-webhooks/<delivery-id>
```

## 循环防护

Worker 会忽略：

- `sender.type == Bot`；
- 用户名以 `[bot]` 结尾的账号；
- PR 上的 `issue_comment`；
- 含有下面标记的评论：

```html
<!-- agent-tasks:bot -->
```

Bot 回写 GitHub 评论时应添加该标记，作为额外防循环措施。

## MVP 局限

- `ctx.waitUntil()` 不是持久消息队列；
- Worker 更新或运行时间耗尽时，少量通知仍可能丢失；
- GitHub 事件可能乱序；
- 一个实例当前只配置一个目标 Webhook；
- 没有管理页面、手工重放、Queue 或 DLQ；
- 飞书只支持不带签名的自定义机器人 Webhook。

下一阶段建议加入 Cloudflare Queue、DLQ、多目的地规则和失败投递重放。
