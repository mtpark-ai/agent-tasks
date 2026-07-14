# 架构说明

## 组件

- 源码仓库：保存 Worker、setup CLI、文档和测试。
- 目标任务仓库：每个部署者自己的 GitHub 仓库，用 Issues 接收任务。
- Cloudflare Worker：公开 HTTPS intake endpoint。
- GitHub Issues：任务事实来源。
- 飞书群：人工通知、审查和指派。
- Hermes Agent：只有被人工明确 @ 后才执行。

## 数据流

```text
iOS Shortcut / 外部系统
        ↓ POST /tasks + Bearer
Cloudflare Worker
        ↓ GitHub REST API
目标任务仓库 Issue
        ↓ 人工审查和飞书 @ 指派
Hermes Agent 执行
```

## 配置与密钥

非敏感配置通过 Wrangler vars 注入：

- `GITHUB_OWNER`
- `GITHUB_REPO`
- `ISSUE_LABELS`
- `MAX_BODY_BYTES`

敏感值通过 Worker Secrets 注入：

- `GITHUB_TOKEN`
- `AUTH_TOKEN`

tracked `wrangler.jsonc` 只保留安全占位符。Worker 发现配置缺失或仍是占位符时 fail closed。

## V1 安全边界

- `/health` 公开；
- `/ready` 和 `/tasks` 必须 Bearer 鉴权；
- `/tasks` 只创建 raw task Issue，不批准执行；
- GitHub 错误返回安全摘要，不回显 token、header 或 GitHub 响应体；
- 请求体硬上限 50,000 字节；
- 原始 JSON 在 Issue 中标记为不可信输入。

## 路线图

未来可以添加：

- KV 幂等：按 request id 或 payload hash 去重；
- per-device token：为不同设备或 Shortcut 单独吊销；
- GitHub App：替代 PAT，提高安装和权限管理体验；
- 更细粒度审计事件；
- 可选队列或告警集成。

V1 不做中心化账号、租户、token 管理，也不做自动派发或自动执行。
