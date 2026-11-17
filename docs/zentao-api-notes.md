# 禅道接口契约（从 zentao-cli 0.4.4 / zentao-api 0.8.5 反查得到）

这些结论不是猜的：`zentao-cli` 的 `dist` 依赖 `zentao-api` 的 `dist/modules/generated.js`（239 条路径的机器可读定义），
本地 npx 缓存里的 `generated.js` 就是权威来源。写下来是为了让 `lib/zentao.js` 与 `lib/writeback.js` 有出处。

## 「我的地盘」端点（v2）

| 命令 | 方法 | 路径 | 结果字段 | 最低版本 |
| --- | --- | --- | --- | --- |
| `my tasks` | GET | `/my/tasks` | `tasks` | 22.5 / biz13.5 / max8.5 / ipd5.5 |
| `my bugs` | GET | `/my/bugs` | `bugs` | 同上 |
| `my stories` | GET | `/my/stories` | `stories` | 同上 |
| `my todos` | GET | `/my/todos` | `todos` | 同上 |

分页参数为 `recPerPage` + `pageID`（`pager` 字段回传总数）。
`my` 是**服务端过滤**：不需要枚举产品/项目，也就没有「先拉全量再本地按处理人过滤」的代价。

## 写端点（v2）

| 动作 | 方法 | 路径 | 请求体字段 |
| --- | --- | --- | --- |
| 启动任务 | PUT | `/tasks/{taskID}/start` | `realStarted`(必填)、`assignedTo`、`consumed`、`left`、`comment` |
| 完成任务 | PUT | `/tasks/{taskID}/finish` | `currentConsumed`、`realStarted`、`finishedDate`(三者必填)、`consumed`、`assignedTo`、`comment` |
| 关闭任务 | PUT | `/tasks/{taskID}/close` | `comment`、`consumed`、`realStarted`、`finishedDate` |
| 解决 Bug | PUT | `/bugs/{bugID}/resolve` | `resolution`(必填)、`resolvedDate`、`resolvedBuild`、`assignedTo`、`comment` |
| 关闭 Bug | PUT | `/bugs/{bugID}/close` | `comment`、`assignedTo` |

## 一个必须承认的限制

239 条路径里**没有独立的「加备注」端点**。`comment` 只挂在状态流转上
（`start` / `finish` / `close` / `resolve` / `activate`）。
所以「派发后写一句话回禅道」必须**同时是一个状态流转**——对派发来说这正好是
`start`（未开始 → 进行中），语义上就是「我开始干了」。

## 附件

v2 文档与 SDK 都没有二进制下载端点（`file` 只有 create/update/delete）。
二进制仍然只能走 v1 的 `/files/{id}` 或 web 的 `file-read-*`。
因此 CLI 通道下如果没另配账号密码，附件/正文图片下载不可用——插件会明确提示，而不是静默丢附件。
