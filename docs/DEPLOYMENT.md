# 自部署指南

本项目是源码模板，不提供中心服务。每个部署者必须使用自己的：

- Cloudflare 账号；
- GitHub 目标任务仓库；
- GitHub fine-grained PAT；
- 随机生成的 Intake Bearer Token。

## 前置条件

- Node.js 22+
- `npm install`
- 已登录 Wrangler：`npx wrangler login`
- 一个用于接收任务的 GitHub 仓库
- 一个 fine-grained PAT，权限见 [GITHUB_TOKEN.md](GITHUB_TOKEN.md)

## 一键 setup

```bash
cd workers/task-intake
npm run setup
```

脚本会提示目标仓库和 GitHub PAT；PAT 输入会被隐藏。PAT 只用于本次 setup，不会写入磁盘；随后会通过 `wrangler secret put GITHUB_TOKEN` 的 stdin 写入 Worker Secret。

setup 使用 `wrangler deploy --var ...` 注入非敏感部署配置，不改写 tracked `wrangler.jsonc`。这样模板仓库保留安全占位符，真实部署保留在 Cloudflare Worker 版本配置中。

## dry-run

```bash
npm run setup -- --repo your-org/your-task-repo --dry-run
```

dry-run 只验证输入并展示将使用的 labels 和 Wrangler vars，不访问 GitHub/Cloudflare，不部署，不写 secrets。

## 手工部署

不使用 setup 时：

```bash
cd workers/task-intake
npm install
npm run cf-typegen
npx wrangler deploy \
  --var GITHUB_OWNER:your-org \
  --var GITHUB_REPO:your-task-repo \
  --var ISSUE_LABELS:status:needs-triage,agent:unassigned,type:raw,source:external \
  --var MAX_BODY_BYTES:50000
```

然后通过 stdin 写入 secrets，避免 token 出现在命令参数中：

```bash
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put AUTH_TOKEN
```

## 验证

```bash
curl -fsS https://<worker>.workers.dev/health

curl -fsS https://<worker>.workers.dev/ready \
  -H "Authorization: Bearer $AUTH_TOKEN"
```

发送测试任务：

```bash
curl -fsS https://<worker>.workers.dev/tasks \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"message":"请将此原始请求分类"}'
```

## 本地安装文件

setup 会写入 `workers/task-intake/.task-intake.local.json`，避免部署后无法恢复生成的 `AUTH_TOKEN`：

```json
{
  "endpoint_url": "https://<worker>.workers.dev",
  "auth_token": "<generated-token>",
  "github_repository": "your-org/your-task-repo"
}
```

该文件已被 git 忽略并设置为 `0600`。不要分享、提交或复制到公开文档；将 Token 填入 Shortcut 后可以删除，后续如需轮换可重新运行 setup。
