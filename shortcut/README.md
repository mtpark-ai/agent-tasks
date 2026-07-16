# iOS Shortcut 构建与分发

## 分发原则

仓库不提交伪造或未经真实 Apple 设备检查的 `.shortcut` 文件，也不发布未经重新导入验证的 iCloud 链接。

通用 Shortcut 只能包含占位值，并使用 Import Questions 让每个部署者填写：

1. Task Intake Endpoint
2. Device Token

公开文件和链接不得包含生产 Endpoint、Admin Token、Device Token 或 GitHub Token。

## 推荐运行流程

```text
听写文本
→ 要求输入：默认值为听写结果，可编辑
→ 显示提醒：展示最终文本，可取消
→ 生成 UUID
→ POST [Endpoint]/tasks
→ 显示 Issue URL
```

## 动作配置

### 1. Endpoint 占位文本

添加 `Text` 动作：

```text
https://example.your-subdomain.workers.dev
```

把 Import Question “Task Intake Endpoint” 绑定到这个文本字段。后续使用该动作的 Magic Variable。

### 2. Device Token 占位文本

添加第二个 `Text` 动作：

```text
paste-device-token-here
```

把 Import Question “Device Token” 绑定到该文本字段。

### 3. 听写和编辑

- `Dictate Text`：语言按用户需要设置；
- `Ask for Input`：默认值为听写文本，允许多行；
- `Show Alert`：标题“确认提交任务？”，正文为编辑后的文本，显示取消按钮。

“取消”会停止 Shortcut；“好”才继续提交。

### 4. Idempotency-Key

每次 Shortcut 运行生成一个 UUID，并在整个网络重试过程中复用。不要用当前时间秒数或任务文本 hash 代替随机 UUID。

### 5. POST 请求

URL：

```text
[Endpoint]/tasks
```

Method：`POST`

Headers：

```text
Authorization: Bearer [Device Token]
Content-Type: application/json
Idempotency-Key: [UUID]
```

JSON Body：

```json
{
  "source": "ios-shortcut",
  "task": {
    "text": "[编辑后的文本]"
  },
  "captured_at": "[当前日期]"
}
```

### 6. 结果

解析响应中的：

- `issue_number`
- `issue_url`
- `duplicate`

显示通知，并提供打开 Issue 的按钮。

## 发布前验证

1. 检查两个占位 Text 中没有真实 endpoint/token；
2. 导出或创建 iCloud 分享链接；
3. 在另一台设备或删除本地副本后重新导入；
4. 确认 Import Questions 连续询问 Endpoint 与 Device Token；
5. 使用测试仓库发送任务；
6. 模拟网络重试，确认只创建一个 Issue；
7. 删除测试 Issue；
8. 再次检查分享副本中没有真实凭据。

## 接入 Worker 下载入口

发布验证后的 URL 后，通过 onboarding：

```bash
npm run onboard -- --endpoint 'https://worker.example' \
  --shortcut-url 'https://www.icloud.com/shortcuts/...'
```

或者调用 Admin bootstrap 更新 `shortcut_url`。完成后 Worker 的：

```text
GET /shortcut
```

会跳转到已审核下载地址。未配置时会打开 Worker 自带的 `/shortcut-guide.html`。

## Action Button

在 iPhone：

```text
设置 → 操作按钮 → 快捷指令 → 选择 Agent Tasks
```

第一次运行时允许麦克风、听写和网络访问。位置不是本方案默认字段，不需要请求定位权限。
