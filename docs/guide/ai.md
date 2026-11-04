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
| 发送请求（包括 `run_requests` 一次发送的多个请求，整批确认一次）、运行工作流、切换当前环境（包括创建环境并设为当前）、`import_spec` 从网址下载文档 | 每次确认；可选择 **Allow All This Session**，ApiKit 重启前不再询问 |
| 删除请求、文件夹、集合、工作流 | **每次都确认**，即使选择过 Allow All This Session；确认框显示要删除的内容、其中的请求数量和用到这些请求的工作流 |

## 工具

| 分类 | 工具 |
|------|------|
| 读取 | `list_collections`、`search_requests`、`get_request`、`list_workflows`（含所在文件夹 `folderPath`）、`get_workflow`、`list_environments`、`list_builtin_variables`、`get_workflow_logs`、`list_request_logs`、`get_request_log` |
| 打开和关闭页签 | `open_request`、`close_request`、`open_workflow`、`close_workflow` |
| 创建和修改 | `create_collection`、`update_collection`、`create_folder`、`update_folder`、`create_request`、`import_curl`（从 cURL 命令创建）、`update_request`、`move_request`、`create_workflow`、`update_workflow`、`create_environment`、`update_environment`、`set_global_variables` |
| 批量 | `create_requests`（一次新建多个请求，自动创建目录）、`update_requests`（一次修改多个请求）、`run_requests`（并行发送多个请求，需确认）、`import_spec`（导入 OpenAPI / Swagger、Postman 或 ApiKit 导出文件） |
| 运行（需确认） | `send_request`、`run_workflow`、`set_active_environment` |
| 删除（每次确认） | `delete_request`、`delete_folder`、`delete_collection`、`delete_workflow` |

### 减少调用次数和返回内容

AI 每调用一次工具，都要重新读一遍上下文再生成参数，耗时主要花在调用次数和返回内容上。以下工具专门用来减少这两项：

- **按关键词查找**：`list_collections`、`search_requests`、`list_workflows` 接受 `query`，按空格分成多个关键词，全部出现在名称、URL 或所在路径中才算匹配，不区分大小写，可以只写一部分，例如 `bpp 优化` 能找到 “BPP / 服务优化”。结果按匹配程度排序。
- **精简视图**：这三个工具默认返回 `view: "summary"`：`list_collections` 只返回目录树和每个目录的请求数（可用 `depth` 限制层级），`search_requests` 只返回名称、方法和路径。需要完整内容时传 `view: "full"`。`get_request`、`get_workflow` 默认返回完整内容，传 `view: "summary"` 只返回请求的 header 名、参数名，或 Workflow 的步骤大纲。
- **用名称代替 id**：批量工具、`get_request`、`get_workflow`、`run_workflow` 可以用 `collection`、`folderPath`、`request`、`requestIds`、`workflow` 按名称定位（可只写一部分），其他工具仍需传 id。有完全同名（不区分大小写）的项时直接使用它；否则只有一项匹配时直接使用，按部分名称匹配到的会列在结果的 `resolved` 中；匹配到多项时，AI 工具支持 MCP elicitation 就在其中请你选择，否则返回 `ambiguous` 和候选列表，由 AI 问你后再调用。`folderPath` 中某一级没有同名目录但有相近的目录时，也会请你在使用已有目录和新建之间选择。
- **批量写入**：`create_requests` 一次最多新建 50 个请求，`folderPath` 中不存在的目录自动创建；每项可以是请求字段、`curl` 或 `copyFrom`（复制已有请求并修改部分字段），`defaults` 填写公共字段（`baseUrl` 拼在相对地址前，headers 和 params 按名称合并）；`onExists` 决定同名请求跳过（默认）、替换、报错还是重复新建。`update_requests` 可分别修改多个请求，也可对选中的请求统一 `set` 字段、`mergeHeaders` 或 `removeHeaders`。任何一项有误都不会写入；写操作只返回摘要。
- **批量运行**：`run_requests` 按 id、名称或目录选出最多 30 个请求，确认一次后并行发送（`maxConcurrency` 默认 4），每个请求返回是否通过、状态码、耗时、失败的断言和响应摘要。
- **导入文档**：`import_spec` 传 `filePath`（本机 `.json`、`.yaml`、`.yml` 文件的绝对路径）时由 ApiKit 读取文件，传 `url` 时由 ApiKit 下载文档，AI 都不必把整份文档写进参数；可导入为新集合，也可放进已有集合的目录。

调用工具时，按各工具 schema 将参数直接传入，不要再套一层 `params` 对象。请求定义中的 `params` 是 HTTP URL 查询参数列表；`send_request` 必须且只能传入 `requestId` 或 `request` 其中一个。工作流的 request 步骤也必须且只能传入 `requestId` 或 `inlineRequest` 其中一个。

`get_request_log` 的请求体和响应体按页返回，默认每个返回前 8,000 个字符。若 `hasMore` 为 `true`，使用对应 body 的 `nextOffset` 作为 `requestOffset` 或 `responseOffset` 继续调用，并重复直到 `hasMore` 为 `false`。偏移量按 UTF-16 代码单元计算；使用 `bodyPart` 只读取请求体或响应体可减少单次返回内容。

`get_workflow_logs` 传入 `logId` 获取单条详情时也使用相同的 body 分页参数。`send_request` 返回的 `logId` 可直接传给 `get_request_log`，以分页读取完整响应。

AI 能做的事情和在界面中一样，包括：

- 打开请求和工作流页签；关闭有未保存修改的页签时，先把完整草稿交给你审阅，再由你在 AI 工具中选择保存或丢弃。确认前草稿若有变化，会重新要求审阅；
- 创建工作流的全部步骤类型、多个条件和组合方式、循环等待和 Set Variables；
- 在断言和条件中使用变量、从响应头提取变量；
- 读取请求日志和工作流日志中的完整请求、响应和测试结果，用来排查失败。

AI 修改或运行的内容会实时显示在界面中；被删除的内容对应的页签会自动关闭。
