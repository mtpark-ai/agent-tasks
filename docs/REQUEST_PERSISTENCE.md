# D1 请求持久化

每个通过 Device Token 或旧版 `AUTH_TOKEN` 认证的 `POST /tasks` 请求，都会在调用 GitHub 之前先写入部署者自己的 D1 数据库。

## 保存内容

`task_requests` 表按“每次 HTTP 请求一次记录”的方式保存：

- 内部记录 ID；
- 逻辑 `request_id`；
- 客户端提供的 `Idempotency-Key`；
- Device ID、名称和凭据类型；
- Content-Type；
- 从 payload 提取的任务摘要；
- 原始请求正文；
- 正文字节数和 SHA-256；
- 请求结果：`received`、`completed`、`rejected` 或 `failed`；
- HTTP 状态码和错误码；
- 是否属于幂等重试；
- 对应的 GitHub Issue 编号和 URL；
- 接收、完成和更新时间。

同一个 `Idempotency-Key` 的网络重试会产生多条 D1 请求记录，便于审计；原有的 `idempotency_keys` 表仍保证 GitHub 只创建一张 Issue。

## 不保存内容

以下信息不会写入请求历史：

- `Authorization` Header；
- Device Token 明文；
- `ADMIN_TOKEN`；
- GitHub PAT；
- Cloudflare 凭据。

只有通过认证的 `/tasks` 请求会被持久化。未认证流量不会进入 `task_requests`。

当请求正文超过 `MAX_BODY_BYTES` 时，系统仍可保存请求元数据和最终错误，但不会把超限正文写入 D1。

## 写入顺序

```text
认证 Device Token
→ 在 D1 插入 status=received
→ 执行原有 GitHub Issue 创建流程
→ 将 D1 记录更新为 completed / rejected / failed
```

如果第一步 D1 写入失败，Worker 会返回：

```json
{"ok":false,"error":"request_persistence_failed"}
```

并且不会继续创建 GitHub Issue。GitHub 已经产生外部副作用后，如果最终状态更新偶发失败，原始 `received` 记录仍会保留，Worker 日志会记录 `task_request_finalize_failed`。

## Admin API

以下接口需要：

```http
Authorization: Bearer <ADMIN_TOKEN>
```

### 列出请求

```http
GET /api/admin/task-requests?limit=25
```

可选过滤器：

```text
request_id=<Idempotency-Key 或 request ID>
status=received|completed|rejected|failed
limit=1..100
```

列表不返回完整原始正文。

### 查看单条请求

```http
GET /api/admin/task-requests/<record-id>
```

详情会返回解析后的 `payload` 以及请求结果元数据。

## Migration

新部署会自动应用：

```text
migrations/0002_task_requests.sql
```

已有实例更新时运行：

```bash
cd workers/task-intake
npm install
npm run deploy
```

`npm run deploy` 会先执行远端 D1 migrations，再部署 Worker。

## 数据保留

当前版本不会自动删除请求历史。部署者应根据自己的隐私和合规要求制定保留期。

例如删除 90 天以前的记录：

```bash
npx wrangler d1 execute DB --remote --command \
  "DELETE FROM task_requests WHERE received_at < datetime('now', '-90 days')"
```

执行删除前应确认目标 Cloudflare 账号和 D1 数据库正确，并按需要先备份。
