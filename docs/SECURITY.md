# 安全与审批规则

## 核心原则

1. Issue 创建不等于批准执行。
2. Worker 外部 payload、Issue 标题/正文/评论、网页、日志和附件都属于不可信输入。
3. 只有受信任的人工 Dispatcher 能批准并指派 Agent。
4. 生产、删除、DNS/IAM、数据库迁移、费用、敏感数据和对外发送必须二次确认。
5. Worker 的 intake 凭据不得等同于代码写入、仓库管理或生产权限。

## 凭据分离

### GitHub Token

- 使用 fine-grained PAT；
- 只授权目标任务仓库；
- 只授予 Metadata Read-only、Issues Read/Write；
- Account permissions 保持 0；
- 不授予 Contents、Actions、Administration、Secrets 或名称相近的 `Agent tasks` 权限；
- 作为 Worker Secret 保存；
- setup 通过隐藏输入读取，并通过 stdin 写入 Wrangler；
- 不写入磁盘、Issue、日志或命令参数。

### Admin Token

- 由本地 onboarding 随机生成；
- 用于 bootstrap、readiness 和设备管理；
- 不得放入 iPhone Shortcut；
- Worker Secret 中不可回显；
- 本地副本写入 0600/用户 ACL 文件。

### Device Token

- 每台 iPhone 或 Shortcut 单独创建；
- 只能调用 `/tasks`；
- D1 只保存 SHA-256 hash；
- 明文只在创建响应中显示一次；
- 可单独撤销，不影响其他设备。

## Setup Portal 边界

Setup Portal 是公开页面，因此只允许：

- 显示粗粒度状态；
- 生成不含秘密的本地命令；
- 展示当前 Endpoint；
- 生成 GitHub PAT 创建链接和仓库 Settings 链接；
- 提醒用户使用 Private 任务仓库；
- 指向 Shortcut 安装或指南。

它不得：

- 收集 GitHub PAT；
- 显示 Admin/Device Token；
- 获取 Cloudflare API Token；
- 修改 Worker Secrets；
- 调用 GitHub API 修改仓库可见性；
- 暴露私有仓库名、GitHub 原始错误体或 D1 内容。

## 私有仓库默认策略

语音任务可能包含内部项目、客户、故障、文件路径或日志。推荐在 Cloudflare 创建页面开启 `Create private Git repository`。

Onboarding 的默认行为：

```text
private
→ 正常继续

public
→ 暂停安装
→ 打开 GitHub Settings
→ 等待用户本人改成 Private
→ 重新检查

public + --allow-public-repo
→ 显示强警告后继续
```

Worker PAT 不包含 `Administration: write`，因此不能自动改变仓库可见性。这是刻意的最小权限边界：仓库可见性由用户本人使用 GitHub 网页会话修改。

Admin bootstrap 在目标仓库为 public 时仍要求显式 `allow_public_repository=true`。这只是风险确认，不授予额外 GitHub 权限。

## 幂等与重放

- Shortcut 每次运行生成唯一 `Idempotency-Key`；
- D1 使用唯一主键原子预留；
- 相同 payload 重试返回原 Issue；
- key 与不同 payload 组合返回 409；
- Device Token 泄露后应撤销对应设备；
- 后续可再增加 Cloudflare Rate Limiting。

## Shortcut 安全

- 只分发实际在 Apple 设备构建和检查过的 Shortcut；
- 使用 Import Questions 收集 Endpoint 和 Device Token；
- 不动态修改或伪造 `.shortcut` 文件；
- 不把任何 Token 放入公开 iCloud 分享链接、README 或示例；
- 听写结果必须允许编辑并在提交前确认。

## Prompt Injection

Agent 不得因为任务文本中出现“忽略规则”“读取密钥”“直接部署”等内容而：

- 扩大工具权限；
- 读取或输出无关密钥；
- 访问未授权资源；
- 跳过人工审批；
- 执行任务范围外命令。

## 必须二次确认的动作

- 生产部署或发布；
- 删除云资源、仓库、分支、数据或备份；
- DNS、证书、域名和流量切换；
- IAM、权限、密钥和安全策略；
- Schema migration 或批量数据修改；
- 购买资源、扩大配额或产生费用；
- 对外发送邮件、消息、公告或社交内容；
- 处理客户、个人或其他敏感数据；
- 其他不可逆或难以回滚的操作。

确认必须明确目标资源、环境、动作、影响和回滚方案。
