# iOS Shortcut 分发说明

本目录提供通用 Shortcut 构建规范。当前仓库不伪造或提交未经实际构建审核的 `.shortcut` 二进制文件或 iCloud 链接；维护者可以在 Apple 设备上完成并检查通用模板后，将真实 iCloud 分享链接发布到项目官网。任何分发物都不得内嵌生产 endpoint 或共享 bearer token。

配置 Shortcut 前，部署者必须已经：

1. 部署 Task Intake Worker；
2. 调用一次 `POST /bootstrap`；
3. 确认 `GET /ready` 返回 `ok: true`；
4. 保存 Worker endpoint 与自己的 `AUTH_TOKEN`。

## 目标

导入者安装 Shortcut 时填写：

- Task Intake Endpoint URL，例如 `https://<worker>.workers.dev`；
- Intake Bearer Token，也就是部署者自己的 `AUTH_TOKEN`。

Apple Shortcuts 的 Setup/Import Question **不是运行时 Magic Variable**。它会在导入时替换某个动作里的指定参数。因此必须先建立两个保存占位值的 `Text` 动作，再把 Setup Questions 分别绑定到这两个动作的文本字段。

## 推荐动作流程

按以下顺序构建：

1. `Text`：`https://example.your-subdomain.workers.dev`
   - 将该动作重命名或备注为 `Endpoint`；
   - 后续把它作为 Magic Variable `Endpoint` 使用。
2. `Text`：`paste-token-here`
   - 重命名或备注为 `Token`；
   - 后续把它作为 Magic Variable `Token` 使用。
3. `Text`：输入静态文本 `Bearer `，然后插入第 2 步的 `Token` Magic Variable
   - 结果变量记为 `Authorization`。
4. `Dictate Text`
   - 提示：`请描述 Agent 任务`；
   - 建议语言设置为中文普通话，暂停后停止。
5. `Ask for Input`
   - 提示：`检查或修改任务内容`；
   - 输入类型：文本；
   - 默认答案：第 4 步听写结果；
   - 允许多行。
6. `Show Alert`
   - 标题：`确认创建 Agent 任务？`；
   - 正文：插入第 5 步编辑后的文本；
   - 开启取消按钮。
   - 点击取消会停止 Shortcut；确认后才继续发送。
7. `Current Date`
8. `URL`
   - 插入第 1 步的 `Endpoint` Magic Variable，再输入静态文本 `/tasks`。
9. `Get Contents of URL`
   - URL：第 8 步结果；
   - Method：`POST`；
   - Headers：
     - `Authorization`：第 3 步的 `Authorization` Magic Variable；
     - `Content-Type`：`application/json`；
   - Request Body：选择 `JSON`，逐项添加：
     - `source`：文本 `ios-shortcut`；
     - `text`：第 5 步编辑后的结果；
     - `captured_at`：第 7 步结果。
10. `Show Result`
    - 显示返回的 `issue_number` 与 `issue_url`，或完整 API JSON。

默认不要发送位置。编码任务通常不需要地理位置；如确有业务需求，部署者应明确说明用途，再自行添加 `Get Current Location` 和请求字段。

## 正确添加 Setup Questions

在 Shortcut 详情页打开 `Setup` / `Import Questions`：

1. 新建问题 `Task Intake Endpoint URL`；
2. 将它绑定到第 1 个 `Text` 动作的文本参数；
3. 提示写为：`输入你的 Task Intake Worker URL，不要包含 /tasks`；
4. 新建问题 `Intake Bearer Token`；
5. 将它绑定到第 2 个 `Text` 动作的文本参数；
6. 提示写为：`输入部署时保存的 AUTH_TOKEN，不要添加 Bearer 前缀`。

不要尝试在 URL/Header 中直接引用“Import Question”；实际运行时引用的是被问题替换后的 `Text` 动作 Magic Variable。

## 发布前验证

不能只在创建者自己的 Shortcut 库里运行。必须：

1. 检查两个占位 `Text` 动作中没有真实 endpoint/token；
2. 创建 iCloud 分享链接或导出测试副本；
3. 在另一台设备或删除本地副本后重新导入；
4. 确认导入流程确实连续询问 Endpoint 和 Token；
5. 确认听写后可以编辑，取消提醒不会发送请求；
6. 用测试仓库发送一条任务，确认请求 URL、Authorization Header 和 JSON Body 正确；
7. 删除测试 Issue，并再次检查分享副本中没有真实凭据。

## 分发方式

可以使用 Apple Shortcuts 的 iCloud sharing link 分享通用模板，也可以在 macOS/iOS 上导出并签名 `.shortcut` 文件后发布。

本 Linux 仓库不会生成或伪造 iCloud link，也不会提交未经审核的二进制 `.shortcut`。项目官网只应发布已经按上述重新导入流程验证过的链接。

## 隐私与安全

- Bearer Token 等同于调用 Worker 管理面并创建 raw task Issue 的权限，不代表批准 Agent 执行；
- 不要把同一个 Token 发给不可信用户；
- 默认不收集位置；
- iOS 可能请求语音识别、麦克风和网络权限；
- 页面应明确任务最终写入部署者自己的 GitHub 仓库。

Token 泄露时：

- CLI setup 用户可重新运行 setup 轮换 Token；
- Deploy Button 用户生成新 Token，更新 Cloudflare Worker Secret，并同步更新 Shortcut。

CLI setup：

```bash
cd workers/task-intake
npm run setup
```

普通代码更新只运行 `npm run deploy:managed`，不会轮换 Token。
