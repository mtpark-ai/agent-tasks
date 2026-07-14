# 贡献指南

欢迎改进这个自部署模板。请保持变更小而可验证。

## 本地检查

```bash
cd workers/task-intake
npm install
npm run check
```

`npm run check` 包含 typegen、TypeScript、Workers Vitest、setup helper Node 测试和 Wrangler dry-run。

## 安全要求

- 不提交 `.dev.vars`、`.task-intake.local.json`、PAT、Bearer token 或真实生产 URL；
- 不添加 permissive CORS；
- 不把 Issue 创建描述成执行授权；
- 不让 setup 测试触发真实 GitHub/Cloudflare 副作用；
- 高风险操作和远端变更必须由维护者人工确认。

## 配置约定

tracked `workers/task-intake/wrangler.jsonc` 保留占位符，用于 fail-closed 初始部署、类型生成和 dry-run。setup 生成被 git 忽略的 `.task-intake.deploy.jsonc` 保存真实非敏感配置，`npm run deploy` 只能使用该文件。

修改 Wrangler config 后请运行：

```bash
cd workers/task-intake
npm run cf-typegen
```

## 文档语言

用户面文档优先使用简洁中文。命令、环境变量、API 字段保持英文原文。
