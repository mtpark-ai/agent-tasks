# iOS Shortcut 分发说明

本目录提供通用 Shortcut 构建规范。当前仓库不伪造或提交未经实际构建审核的 `.shortcut` 二进制文件或 iCloud 链接；维护者可以在 Apple 设备上完成并检查通用模板后，将真实 iCloud 分享链接发布到项目官网。任何分发物都不得内嵌生产 endpoint 或共享 bearer token。

## 目标

导入者安装 Shortcut 时填写：

- Task Intake Endpoint URL，例如 `https://<worker>.workers.dev`
- Intake Bearer Token，也就是部署者自己的 `AUTH_TOKEN`

Apple Shortcuts 的 Setup/Import Question **不是运行时 Magic Variable**。它会在导入时替换某个动作里的指定参数。因此必须先建立两个保存占位值的 `Text` 动作，再把 Setup Questions 分别绑定到这两个动作的文本字段。

## 动作流程

按以下顺序构建：

1. `Text`：`https://example.your-subdomain.workers.dev`
   - 将该动作重命名或备注为 `Endpoint`。
   - 后续把它作为 Magic Variable `Endpoint` 使用。
2. `Text`：`paste-token-here`
   - 重命名或备注为 `Token`。
   - 后续把它作为 Magic Variable `Token` 使用。
3. `Text`：输入静态文本 `Bearer `，然后插入第 2 步的 `Token` Magic Variable
   - 结果变量记为 `Authorization`。
4. `Dictate Text` 或 `Ask for Input`
   - 提示：记录任务内容。
5. `Get Current Location`
   - 可选；不希望发送位置时应删除。
6. `Current Date`
7. `URL`
   - 插入第 1 步的 `Endpoint` Magic Variable，再输入静态文本 `/tasks`。
8. `Get Contents of URL`
   - URL：第 7 步结果。
   - Method：`POST`。
   - Headers：
     - `Authorization`：第 3 步的 `Authorization` Magic Variable。
     - `Content-Type`：`application/json`。
   - Request Body：选择 `JSON`，逐项添加：
     - `source`：文本 `ios-shortcut`
     - `text`：第 4 步结果
     - `location`：第 5 步结果，或删除该字段
     - `captured_at`：第 6 步结果
9. `Show Result`
   - 显示 API 返回 JSON 或成功提示。

## 正确添加 Setup Questions

在 Shortcut 详情页打开 `Setup` / `Import Questions`：

1. 新建问题 `Task Intake Endpoint URL`。
2. 将它绑定到第 1 个 `Text` 动作的文本参数。
3. 提示写为：`输入你的 Task Intake Worker URL，不要包含 /tasks`。
4. 新建问题 `Intake Bearer Token`。
5. 将它绑定到第 2 个 `Text` 动作的文本参数。
6. 提示写为：`输入 setup 生成的 AUTH_TOKEN，不要添加 Bearer 前缀`。

不要尝试在 URL/Header 中直接引用“Import Question”；实际运行时引用的是被问题替换后的 `Text` 动作 Magic Variable。

## 发布前验证

不能只在创建者自己的 Shortcut 库里运行。必须：

1. 检查两个占位 `Text` 动作中没有真实 endpoint/token。
2. 创建 iCloud 分享链接或导出测试副本。
3. 在另一台设备或删除本地副本后重新导入。
4. 确认导入流程确实连续询问 Endpoint 和 Token。
5. 用测试仓库发送一条任务，确认请求 URL、Authorization Header 和 JSON Body 正确。
6. 删除测试 Issue，并再次检查分享副本中没有真实凭据。

## 分发方式

可以使用 Apple Shortcuts 的 iCloud sharing link 分享通用模板，也可以在 macOS/iOS 上导出并签名 `.shortcut` 文件后发布。

本 Linux 仓库不会生成或伪造 iCloud link，也不会提交未经审核的二进制 `.shortcut`。项目官网只应发布已经按上述重新导入流程验证过的链接。

## 隐私与安全

- Bearer Token 等同于创建 raw task Issue 的权限，不代表批准 Agent 执行。
- 不要把同一个 Token 发给不可信用户。
- 位置属于敏感信息，应默认说明用途，并允许用户删除位置动作/字段。
- iOS 可能请求语音识别、麦克风、位置和网络权限。
- 页面应明确任务最终写入部署者自己的 GitHub 仓库。

Token 泄露时重新运行 setup 会轮换 Token并使旧 Shortcut 失效：

```bash
cd workers/task-intake
npm run setup
```

普通代码更新只运行 `npm run deploy`，不会轮换 Token。
