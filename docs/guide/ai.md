# AI 集成（MCP）

ApiKit 内置 MCP（Model Context Protocol）服务。支持 MCP 的 AI 工具连接后，可以读取和修改你的集合、请求、工作流和环境，发送请求、运行工作流，并查看执行日志。例如：

- "按 Orders 接口建一个下单流程的工作流并运行，失败的话找出原因"
- "把这条 cURL 命令保存到 Shop 集合的 Orders 文件夹"
- "找出 URL 里包含 /v1/ 的请求，改成 /v2/"

## 连接

1. 点击标题栏的 ✦ 图标或底部状态栏的 **MCP**。
2. 打开 **Enable MCP server**，状态显示 Running 表示服务已运行。默认端口为 `27121`，可以修改后点 **Apply**。
3. 在 AI 工具的 MCP 设置中添加服务，传输方式为 Streamable HTTP：

   - URL：`http://127.0.0.1:27121/mcp`
   - 请求头：`Authorization: Bearer <token>`，token 在对话框中复制

   也可以直接复制对话框中的 JSON 配置：

   ```json
   {
     "mcpServers": {
       "apikit": {
         "type": "http",
         "url": "http://127.0.0.1:27121/mcp",
         "headers": { "Authorization": "Bearer <token>" }
       }
     }
   }
   ```

MCP 服务默认关闭，只接受本机连接，并且必须带 token。点击 **Regenerate** 生成新 token 后，已配置的 AI 工具需要更新 token。ApiKit 需要保持打开，AI 才能连接。

![AI 集成对话框](/screenshots/mcp.png)

## 设置

| 设置 | 说明 |
|------|------|
| **Show variable values and credentials to AI** | 默认关闭：环境变量的值、鉴权 token、密码和敏感请求头在发给 AI 时显示为 `<hidden>`。发送请求时仍使用真实值 |
| **Confirm requests, workflow runs and environment switches** | **In ApiKit**：在 ApiKit 中弹窗确认；**In the AI tool, when it supports it**：AI 工具支持 MCP elicitation 时在 AI 工具中确认，不支持时仍在 ApiKit 中确认 |
| **Changes the AI makes to requests and workflows** | **Keep as unsaved edits**：AI 对已有请求和工作流的修改显示为未保存的修改，由你 Save 或 Discard；**Save directly**：直接保存。AI 新建的请求和工作流总是直接保存 |

对话框底部的 **Available tools** 列出全部工具，**Recent calls** 显示最近的调用。

## 需要你确认的操作

| 操作 | 确认方式 |
|------|---------|
| 发送请求、运行工作流、切换当前环境（包括创建环境并设为当前） | 每次确认；可选择 **Allow All This Session**，ApiKit 重启前不再询问 |
| 删除请求、文件夹、集合、工作流 | **每次都确认**，即使选择过 Allow All This Session；确认框显示要删除的内容、其中的请求数量和用到这些请求的工作流 |

## 工具

| 分类 | 工具 |
|------|------|
| 读取 | `list_collections`、`search_requests`（用 `query` 按名称或 URL 片段查找）、`get_request`、`list_workflows`（含所在文件夹 `folderPath`）、`get_workflow`、`list_environments`、`list_builtin_variables`、`get_workflow_logs`、`list_request_logs`、`get_request_log` |
| 打开和关闭页签 | `open_request`、`close_request`、`open_workflow`、`close_workflow` |
| 创建和修改 | `create_collection`、`update_collection`、`create_folder`、`update_folder`、`create_request`、`import_curl`（从 cURL 命令创建）、`update_request`、`move_request`、`create_workflow`、`update_workflow`、`create_environment`、`update_environment`、`set_global_variables` |
| 运行（需确认） | `send_request`、`run_workflow`、`set_active_environment` |
| 删除（每次确认） | `delete_request`、`delete_folder`、`delete_collection`、`delete_workflow` |

调用工具时，按各工具 schema 将参数直接传入，不要再套一层 `params` 对象。请求定义中的 `params` 是 HTTP URL 查询参数列表；`send_request` 必须且只能传入 `requestId` 或 `request` 其中一个。工作流的 request 步骤也必须且只能传入 `requestId` 或 `inlineRequest` 其中一个。

`get_request_log` 的请求体和响应体按页返回，默认每个返回前 8,000 个字符。若 `hasMore` 为 `true`，使用对应 body 的 `nextOffset` 作为 `requestOffset` 或 `responseOffset` 继续调用，并重复直到 `hasMore` 为 `false`。偏移量按 UTF-16 代码单元计算；使用 `bodyPart` 只读取请求体或响应体可减少单次返回内容。

`get_workflow_logs` 传入 `logId` 获取单条详情时也使用相同的 body 分页参数。`send_request` 返回的 `logId` 可直接传给 `get_request_log`，以分页读取完整响应。

AI 能做的事情和在界面中一样，包括：

- 打开请求和工作流页签；关闭有未保存修改的页签时，先把完整草稿交给你审阅，再由你在 AI 工具中选择保存或丢弃。确认前草稿若有变化，会重新要求审阅；
- 创建工作流的全部步骤类型、多个条件和组合方式、循环等待和 Set Variables；
- 在断言和条件中使用变量、从响应头提取变量；
- 读取请求日志和工作流日志中的完整请求、响应和测试结果，用来排查失败。

AI 修改或运行的内容会实时显示在界面中；被删除的内容对应的页签会自动关闭。
