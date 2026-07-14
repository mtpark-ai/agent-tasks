# iOS Shortcut 分发说明

本目录提供通用 Shortcut 构建规范。当前仓库不伪造或提交未经实际构建审核的 `.shortcut` 二进制文件或 iCloud 链接；维护者可以在 Apple 设备上完成并检查通用模板后，将真实 iCloud 分享链接发布到项目官网。任何分发物都不得内嵌生产 endpoint 或共享 bearer token。

## 目标

创建一个通用 iOS Shortcut，让导入者在安装/首次设置时填写：

- Task Intake Endpoint URL，例如 `https://<worker>.workers.dev`
- Intake Bearer Token，也就是部署者自己的 `AUTH_TOKEN`

使用 Apple Shortcuts 的 Import Questions / Setup Questions 保存这两个值。分发文件中只能包含占位问题，不能包含真实生产值。

## 动作流程

建议 Shortcut 动作顺序：

1. `Ask for Input` 或 `Dictate Text`
   - 类型：Text
   - 提示：记录任务内容
2. `Get Current Location`
   - 可选；如用户不希望发送位置，可删除此动作
3. `Current Date`
4. `Dictionary`
   - `source`: `ios-shortcut`
   - `text`: 第 1 步文本
   - `location`: 第 2 步位置，或仅保留经纬度/地址字段
   - `captured_at`: 第 3 步日期
   - `device_note`: 可选普通文本，不要放密钥
5. `Get Contents of URL`
   - URL：Import Question `Task Intake Endpoint URL` + `/tasks`
   - Method：`POST`
   - Headers：
     - `Authorization`: `Bearer ` + Import Question `Intake Bearer Token`
     - `Content-Type`: `application/json`
   - Request Body：JSON，使用第 4 步 Dictionary
6. `Show Result`
   - 显示 API 返回 JSON 或成功提示

## Import Questions

在 Shortcut 编辑器中为以下字段设置 Import Questions：

- `Task Intake Endpoint URL`
  - 示例提示：`输入你的 Task Intake Worker URL，不要包含 /tasks`
  - 示例占位：`https://example.your-subdomain.workers.dev`
- `Intake Bearer Token`
  - 示例提示：`输入 setup 生成的 AUTH_TOKEN`
  - 示例占位：`paste-token-here`

## 分发方式

可以使用 Apple Shortcuts 的 iCloud sharing link 分享通用 Shortcut。也可以在 macOS/iOS 上导出并签名 `.shortcut` 文件后发布。

本 Linux 仓库不会生成或伪造 iCloud link，也不会提交二进制 `.shortcut`。发布前请手工确认：

- Shortcut 中没有真实 endpoint；
- Shortcut 中没有真实 bearer token；
- Import Questions 会在导入时要求用户填写自己的值；
- 分享说明提醒用户不要发布共享 token。

## 安全提醒

Bearer token 等同于创建 raw task Issue 的权限。不要把同一个 token 发给不可信用户；如果泄露，运行：

```bash
cd workers/task-intake
npm run setup
```

或重新生成 token 并执行：

```bash
npx wrangler secret put AUTH_TOKEN
```
