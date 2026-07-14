# 自部署指南

本项目是源码模板，不提供中心服务。每个部署者使用自己的 Cloudflare 账号、GitHub 目标任务仓库、fine-grained PAT 和随机 Intake Bearer Token。

## 前置条件

- Node.js 22+
- 已登录 Wrangler：`npx wrangler login`
- 一个用于接收任务的 GitHub 仓库
- 一个 fine-grained PAT，权限见 [GITHUB_TOKEN.md](GITHUB_TOKEN.md)

## 首次 setup

```bash
cd workers/task-intake
npm install
npm run setup
```

setup 会：

1. 询问目标仓库和 Worker 名称；
2. 隐藏输入 GitHub PAT，且不把 PAT 写入磁盘或命令参数；
3. 显示 `wrangler whoami --json` 的当前 Cloudflare 账号并要求确认；
4. 生成被 git 忽略的 `.task-intake.deploy.jsonc`，保存真实的非敏感 owner/repo/labels 配置；
5. 创建缺失的 raw-task labels；
6. 先部署 tracked 占位符配置，使 Worker 在初始化期间保持 fail closed；
7. 通过 stdin 写入 `GITHUB_TOKEN` 和新生成的 `AUTH_TOKEN`；
8. 最后部署真实配置，并验证 `/health` 与 `/ready`。

这种顺序避免重新配置时出现“旧 Token 已生效，但请求已写入新仓库”的中间状态。任一步失败时，Worker 会停留在占位符 fail-closed 状态，而不是带着部分新配置继续接收任务。

可指定 Worker 名称：

```bash
npm run setup -- --worker-name my-task-intake
```

自动化环境只有在已经核对 Cloudflare 账号后才能跳过确认：

```bash
npm run setup -- --repo your-org/tasks --worker-name my-task-intake --yes
```

重新运行 setup 会重新配置实例并轮换 `AUTH_TOKEN`，现有 Shortcut 中的旧 Token 随即失效。

## dry-run

```bash
npm run setup -- --repo your-org/your-task-repo \
  --worker-name my-task-intake \
  --dry-run
```

dry-run 只验证输入并展示计划，不访问 GitHub/Cloudflare、不创建文件、不部署、不写 Secrets。

## 后续代码更新

首次 setup 后，真实非敏感部署配置保存在：

```text
workers/task-intake/.task-intake.deploy.jsonc
```

该文件不包含 Token，已被 git 忽略。更新代码时运行：

```bash
cd workers/task-intake
npm install
npm run deploy
```

`npm run deploy` 只使用持久化配置更新代码，不轮换 `AUTH_TOKEN` 或 `GITHUB_TOKEN`。如果配置文件不存在，命令会 fail closed 并要求先运行 setup；不要直接运行裸 `wrangler deploy`，否则 tracked 占位符会覆盖线上 vars。

## 手工部署的安全顺序

如不使用 setup，必须保持同样的三阶段顺序：

```bash
# 1. 占位符配置：先让实例 fail closed
npx wrangler deploy --name my-task-intake

# 2. 写入 Secrets；值从 stdin 交互输入
npx wrangler secret put GITHUB_TOKEN --name my-task-intake
npx wrangler secret put AUTH_TOKEN --name my-task-intake

# 3. 创建包含真实非敏感 vars 的 ignored config，再部署它
npx wrangler deploy --config .task-intake.deploy.jsonc
```

不建议在 shell 历史里用 `--var` 重复维护生产配置；应以 ignored deploy config 作为后续更新的唯一配置来源。

## 验证

```bash
curl -fsS https://<worker>.workers.dev/health

curl -fsS https://<worker>.workers.dev/ready \
  -H "Authorization: Bearer ***"
```

发送测试任务：

```bash
curl -fsS https://<worker>.workers.dev/tasks \
  -H "Authorization: Bearer ***" \
  -H "Content-Type: application/json" \
  --data '{"message":"请将此原始请求分类"}'
```

## 本地安装文件

setup 会写入 `workers/task-intake/.task-intake.local.json`，避免部署后无法恢复生成的 `AUTH_TOKEN`：

```json
{
  "endpoint_url": "https://<worker>.workers.dev",
  "auth_token": "<generated-token>",
  "github_repository": "your-org/your-task-repo",
  "worker_name": "my-task-intake"
}
```

- POSIX 系统：脚本创建文件后执行 `chmod 0600`。
- Windows：POSIX mode 不等同于 Windows ACL，文件使用当前用户目录继承 ACL。请在仅本人可访问的工作目录运行 setup，并检查文件属性/ACL。

不要分享或提交该文件。把 Token 填入 Shortcut 后可以删除；以后代码更新使用 `npm run deploy`，只有明确需要轮换 Token 时才重新运行 setup。
