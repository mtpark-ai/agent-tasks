# 贡献指南

欢迎改进这个自部署模板。请保持变更小而可验证。

## 本地检查

```bash
cd workers/task-intake
cp .dev.vars.local.example .dev.vars
npm install
npm run check
```

`npm run check` 包含 typegen、TypeScript、Workers Vitest、setup helper Node 测试和 Wrangler dry-run。

## 安全要求

- 不提交 `.dev.vars`、`.task-intake.local.json`、PAT、Bearer token 或真实生产 URL；
- 不添加 permissive CORS；
- 不把 Issue 创建描述成执行授权；
- `/bootstrap` 只能创建或规范化硬编码协议 labels，不能接受任意 label 创建参数；
- 不让 setup 测试触发真实 GitHub/Cloudflare 副作用；
- 高风险操作和远端变更必须由维护者人工确认。

## 配置约定

Tracked `workers/task-intake/wrangler.jsonc` 保留占位符，用于 Deploy Button/Workers Builds、fail-closed 初始部署、类型生成和 dry-run。

- `npm run deploy`：标准 `wrangler deploy`；
- `npm run deploy:managed`：只使用 setup 生成且被忽略的 `.task-intake.deploy.jsonc`；
- `npm run setup`：首次部署或重新配置，会轮换 Intake Token。

`.dev.vars.example` 只声明 Deploy Button 需要发现的 runtime secrets；完整本地开发模板使用 `.dev.vars.local.example`。

修改 Wrangler config 或 secret example 后请运行：

```bash
cd workers/task-intake
npm run cf-typegen
```

## 独立模板目录

`workers/task-intake` 会被 Cloudflare Deploy Button 当作复制后仓库根目录。新增依赖、文档、许可证或 CI 时，不得依赖该目录之外的文件。

## 文档语言

用户面文档优先使用简洁中文。命令、环境变量、API 字段保持英文原文。
