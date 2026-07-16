# 贡献指南

欢迎改进这个自部署模板。请保持变更小、可审计并可重复验证。

## 本地检查

```bash
cd workers/task-intake
cp .dev.vars.local.example .dev.vars
npm install
npx wrangler d1 migrations apply DB --local
npm run check
```

`npm run check` 包含：

- Wrangler Env 类型生成；
- 严格 TypeScript 检查；
- Workers Runtime + D1 Vitest；
- onboarding helper Node 测试；
- Static Assets 与 Worker bundle dry-run。

## 安全要求

- 不提交 `.dev.vars`、`.task-intake.local.json`、PAT、Admin/Device Token 或真实生产 URL；
- 不添加 permissive CORS；
- 不把 Issue 创建描述成执行授权；
- Admin Token 与 Device Token 必须分离；
- D1 只能保存 Device Token hash，不保存明文；
- `/api/admin/bootstrap` 只能管理硬编码协议 labels，不能接受任意 label 参数；
- 公开任务仓库必须显式二次确认；
- Setup Portal 不得收集或回显 secrets；
- 不伪造、动态修改或提交未经 Apple 设备验证的 `.shortcut`；
- 测试不得触发真实 GitHub/Cloudflare 副作用；
- 高风险远端动作必须由维护者明确确认。

## 配置约定

Tracked `workers/task-intake/wrangler.jsonc` 是 Deploy Button 模板：

- D1 使用可被 Cloudflare 自动替换的占位 `database_id`；
- GitHub owner/repo 保留 fail-closed 占位符；
- 不在 `.dev.vars.example` 中声明生产 secrets，以免首次 Deploy Button 页面收集高权限凭据；
- 本地开发 secrets 使用 `.dev.vars.local.example`。

命令：

- `npm run deploy`：先执行远端 D1 migrations，再部署 Worker；
- `npm run deploy:worker`：只部署 Worker，不运行 migrations；
- `npm run onboard`：在 Deploy Button 后完成 secrets、GitHub bootstrap 和 Device Token 配置；
- `npm run setup`：`onboard` 的兼容别名。

## 独立模板目录

Cloudflare Deploy Button 指向 `workers/task-intake` 子目录。复制后的用户仓库根目录就是这个目录，因此它必须自包含：

- `package.json` / lockfile；
- `wrangler.jsonc`；
- `src/`、`public/`、`migrations/`、`scripts/`、`test/`；
- README、LICENSE 和独立 CI。

不得让 Worker 模板运行时或构建流程依赖父目录文件。

## 文档语言

用户面文档优先使用清晰中文；命令、环境变量、API 路径和 JSON 字段保留英文原文。
