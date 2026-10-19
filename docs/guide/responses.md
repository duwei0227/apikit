# 响应

发送后，响应区顶部显示状态码、耗时和大小，下方有 **Body**、**Headers** 和 **Test Results** 三个标签页。点击右上角的箭头可以折叠响应区。

## 响应体

| 视图 | 说明 |
|------|------|
| **Pretty** | JSON、XML 等格式化并高亮显示，可折叠；括号和 XML 标签按嵌套层级着色 |
| **Raw** | 收到的原文 |

- 点击搜索图标（或在响应中按 `Ctrl+F`）搜索，可区分大小写、使用正则表达式；`Ctrl+A` 全选响应内容。
- 复制按钮复制当前视图的内容。
- 大整数保持原值显示。
- 超过 5 MB 的响应只显示前 1 MB，可以点击 **Copy Full Body** 复制全部内容，或 **Save to File…** 保存到文件。

## 保存响应

- **Send And Download**（Send 按钮旁的下拉菜单）：把响应保存为文件，根据响应头识别文件名和类型。
- **Save to Mock**：把这次的响应添加到 [Mock 服务](./mock)，作为某条路由的一个响应。

## 流式响应

响应类型为 `text/event-stream`（SSE）或 `application/x-ndjson`、`application/ndjson`、`application/jsonl`（逐行 JSON）时，按流式响应处理：边接收边显示，可以随时点击 **Stop** 停止。

| 视图 | 说明 |
|------|------|
| **Text** | 合并后的回答文本，可在 Rendered 和 Source（原文）之间切换。Rendered 中：回答是 HTML 或 SVG 时显示隔离的网页预览（随输出实时更新，可打开更大的预览），是 JSON 或 XML 时格式化显示，其他按 Markdown 显示。有思考内容时单独显示为 Thinking |
| **Events** | 每个事件的时间、事件名和数据，可以筛选 |
| **Raw** | 收到的原文 |

**Follow output** 打开时自动滚动到最新的内容。

![流式响应的 Text 视图](/screenshots/streaming.png)

ApiKit 能识别以下接口的事件，并合并出回答文本、思考内容、结束原因和 token 用量：

- OpenAI Chat Completions 及兼容接口、OpenAI Responses
- Anthropic Messages
- Gemini
- Ollama
- 自定义格式：事件名或 `type` 为 `token`、`delta`、`chunk`、`text`、`content`、`message`、`answer`（或两者都没有）时，取其中的 `content`、`text`、`delta` 或 `token` 字段

自定义格式中，这些事件的文本在接收时作为回答逐段显示。之后如果有带内容的其它事件，例如 `event: token` 输出思考过程，`event: result` 和 `event: fill` 输出结果，收到第一个这样的事件时，已收到的文本移入 Thinking，之后再收到的文本也算 Thinking，文本仍在输出时 Thinking 保持展开并显示最新的内容，流结束后折叠；这些事件是结果，在 Text 中各显示为一块，以事件名为标题，`content` 或 `text` 按 Markdown 显示，`data` 显示为格式化的 JSON（两种字段都没有时显示整个事件）。不带内容的事件，例如 `{"type":"done","content":null,"data":null}`，只表示流结束。没有任何结果事件的流，例如只有 `token` 和 `done`，文本一直是回答。

流式响应的 JSON 字段断言和变量提取读取合并后的对象：

```json
{
  "text": "合并后的回答",
  "thinking": "思考内容",
  "finishReason": "stop",
  "usage": { "prompt_tokens": 5, "completion_tokens": 3 },
  "eventCount": 12,
  "events": [],
  "results": {}
}
```

`usage` 是接口返回的原始用量对象，字段名随接口不同。例如断言 `text` contains `你好`，或把 `usage.completion_tokens` 提取为变量。

自定义格式有结果事件时，`text` 是各结果事件文本的拼接，`results` 按事件名保存最后一个事件，例如 `results.result.data.suggestAction`、`results.fill.content`。
