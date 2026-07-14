# 飞书通知与人工指派

## 当前定位

飞书群用于：

- 接收新 Issue 通知；
- 人工讨论和审查；
- @指定 Hermes Agent；
- 接收 Blocked、In Review 和完成通知。

GitHub Issue 始终是任务事实来源。任何只存在于飞书、未回写 GitHub 的任务状态都不算持久状态。

## 新 Issue 通知格式

```text
🆕 新任务待审查

#123 <Issue title>
优先级: <priority>
风险: <risk>
来源: <source>

<Issue URL>

请人工审查后 @具体 Agent 执行。
```

Repo Webhook 推荐监听：

- `issues.opened`
- `issues.reopened`
- `issues.closed`
- `issues.assigned`
- `issue_comment.created`
- `pull_request.opened`
- `pull_request.closed`

## 指派格式

```text
@<agent> 执行 <Issue URL>
权限范围: ...
禁止操作: ...
预期交付: ...
```

## Agent 消息处理规则

每个 Agent：

- 只处理明确 @自己的消息；
- 只接受授权用户发出的指派；
- 按飞书 `event_id` 去重；
- 必须要求有效 Issue URL；
- 第一时间将认领状态回写 GitHub；
- 不因重复消息重复启动；
- 不监听或抢占 @其他 Agent 的消息。

## 待配置项

部署飞书机器人或 Webhook Receiver 时，需要显式配置：

- 飞书群 `chat_id`；
- 授权 Dispatcher 的 `open_id` 白名单；
- 每个 Agent 的稳定 Agent ID/Profile 名；
- GitHub Webhook Secret；
- 飞书事件签名/加密配置；
- `event_id` 去重存储；
- GitHub 到飞书的消息模板。

任何凭据不得写入本仓库。
