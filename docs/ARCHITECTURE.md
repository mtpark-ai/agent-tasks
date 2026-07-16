# 架构说明

## 组件

- 源码仓库：保存 Worker、setup CLI、文档和测试；
- 独立 Worker 模板目录：`workers/task-intake`，可作为 Deploy Button 子目录根；
- 目标任务仓库：每个部署者自己的 GitHub 仓库，用 Issues 接收任务；
- Cloudflare Worker：公开 HTTPS intake endpoint；
- GitHub Issues：任务事实来源；
- 人工 Dispatcher：负责通知、审核和明确指派；飞书群 `@Agent` 是参考实现；
- Hermes/Codex Agent：只有被受信任的人工 Dispatcher 明确授权后才执行。

## 数据流

```text
iOS Shortcut / 外部系统
        ↓ POST /tasks + Bearer
Cloudflare Worker
        ↓ GitHub REST API
目标任务仓库 raw Issue
        ↓ 受信任的人工 Dispatcher 审查并明确指派
Hermes/Codex Agent 执行
```

部署初始化是独立控制流：

```text
Cloudflare Deploy Button / CLI setup
        ↓
Worker runtime 配置与 Secrets
        ↓ POST /bootstrap + Bearer
创建或规范化固定协议 labels
        ↓ GET /ready
确认仓库访问、写权限与 labels
```

`POST /bootstrap` 不创建任务、不批准任务、不派发 Agent。它只管理程序内硬编码的固定 raw-task labels，并通过 label mutation 验证 GitHub Token 具有 Issues 写权限。

## 配置与密钥

非敏感配置通过 Wrangler vars 注入：

- `GITHUB_OWNER`
- `GITHUB_REPO`
- `ISSUE_LABELS`
- `MAX_BODY_BYTES`

敏感值通过 Worker Secrets 注入：

- `GITHUB_TOKEN`
- `AUTH_TOKEN`

Tracked `wrangler.jsonc` 保留安全占位符，并兼容 Deploy Button/Workers Builds。

CLI setup 生成被 git 忽略的 `.task-intake.deploy.jsonc` 保存真实非敏感配置；后续 `npm run deploy:managed` 始终使用该文件并保留现有 Secrets。初始化或重新配置时先部署占位符版本，再写 Secrets，最后部署真实配置，避免旧 Token 与新目标配置短暂共存。

Deploy Button 使用标准 `npm run deploy`（即 `wrangler deploy`），并从 `.dev.vars.example` 发现 `AUTH_TOKEN`、`GITHUB_TOKEN` 两个 runtime secrets。部署者必须在部署前自行生成并保存 `AUTH_TOKEN`。

Worker 发现配置缺失或仍是占位符时 fail closed。

## Deploy Button 模板边界

Cloudflare 将 `workers/task-intake` 子目录视为复制后仓库的根目录。因此该目录必须自包含：

- `package.json` / lockfile；
- Wrangler 配置；
- Worker 源码与测试；
- setup/deploy helper；
- `.dev.vars.example`；
- README、LICENSE；
- 复制后可运行的 `.github/workflows/ci.yml`。

源仓库必须为 public；目标任务仓库可以为 private。模板副本不会自动同步上游更新。

## V1 安全边界

- `/health` 公开；
- `/bootstrap`、`/ready` 和 `/tasks` 必须 Bearer 鉴权；
- `/bootstrap` 只管理固定协议 labels，不接受客户端自定义 label；
- `/tasks` 只创建 raw task Issue，不批准执行；
- GitHub 错误返回安全摘要，不回显 token、header 或 GitHub 响应体；
- 请求体硬上限 50,000 字节；
- 原始 JSON 在 Issue 中标记为不可信输入。

## 路线图

未来可以添加：

- Durable Object/D1 幂等：按 request id 或 payload hash 去重；
- per-device token：为不同设备或 Shortcut 单独吊销；
- GitHub App：替代 PAT，提高安装和权限管理体验；
- 更细粒度审计事件；
- 可选队列或告警集成；
- 上游模板版本检查与升级指引。

V1 不做中心化账号、租户、token 管理，也不做自动派发或自动执行。
