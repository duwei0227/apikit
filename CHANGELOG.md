# 更新日志

所有重要的项目变更都会记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

每个版本先写英文分组（`### Added` / `### Changed` / `### Fixed`），再写中文分组（`### 新增` / `### 变更` / `### 修复`）。
英文分组会写入自动更新的 `latest.json`，在应用内的更新弹窗中显示。

## [Unreleased]

### Added
- Folders in a collection can be moved with **Move Up** and **Move Down** in their right-click menu, as with requests.
- Workflows in the sidebar can be organized in folders, which can be nested. Create folders with **New Folder**, create a workflow in a folder from the folder row or its right-click menu, and drag workflows and folders to reorder them or move them into folders. Right-click a workflow or folder and choose **Move Up** or **Move Down** to reorder it, or a workflow and choose **Move to...** to move it to another folder, as with requests. Deleting a folder also deletes the workflows in it.
- The **Save Request** dialog has a **New Collection** button, so a new request can be saved even before any collection exists.
- ApiKit JSON export keeps the folder of each workflow, and import puts it back into a folder with the same name. The AI (MCP) `list_workflows` tool returns workflows in sidebar order with their `folderPath`.

### Changed
- The README and Getting Started guide note that `.deb`, `.rpm` and the portable Linux build use the system WebKitGTK (2.50 or later recommended), while the AppImage includes its own.
- ApiKit now requires macOS 11 Big Sur or later, with Safari 16.4 or later (before: macOS 10.13). The interface styles were updated to a newer toolkit that the older system WebKit cannot display.
- Buttons in the toolbar, title bar, status bar and elsewhere, the right-click menu of text fields (Cut, Copy, Paste, Select All), and tabs such as **Find** / **Console**, **Pretty** / **Raw**, the import and export lists and the mock service views now use the standard component style; the response text view switches between **Rendered** and **Source** with a segmented button. The Mocks and MCP status in the status bar is shown as a badge, the dot on the title-bar ✦ icon appears only while the MCP server is running (green) or failed to start (red), and the file picker for form-data and binary bodies is a **Select File** button next to the file name.
- Dialogs use consistent widths by content: simple name dialogs (such as **Rename**) are a little wider, **Move Request** is as wide as **Save Request**, and **Manage Environments** and **AI Integration (MCP)** no longer stretch across large screens. Dialogs also stay inside small windows.
- Status, method and highlight colors (for example the unsaved tab title and **Status: 200 OK**) use the updated default color palette and look slightly more vivid, mainly in the dark theme.
- The **Save Request** dialog now starts at the location you last saved to (or the only collection when there is just one), expands to it, and marks a collection's top level as **(collection root)**.
- A new workflow is now added at the end of the sidebar list (or of its folder) instead of at the top; the order you set by dragging is kept.
- Params, Headers, form-data and x-www-form-urlencoded now support Postman-style Bulk Edit with one `key: value` pair per line.
- Windows uninstaller now explains that deleting the app cache also removes theme and MCP settings, while user data is controlled by a separate option.

### Fixed
- **Move Up** / **Move Down** on a request now swaps it with the item right next to it in the collection tree, instead of jumping over folders in between.
- Pressing the MCP status dot on the title-bar ✦ icon no longer starts dragging the window.
- Variable suggestions and function parameter hints (for example after typing `{{$sequence(`) no longer extend past the window when there is not enough room above or below the field; they shrink to the space available and scroll.
- Bulk Edit buttons no longer shift the Value column heading out of alignment with the table rows.
- Updated bundled dependencies (Vue, DOMPurify, nanoid and others) to patched versions that fix known security vulnerabilities.

### 新增
- 集合中的文件夹可以在右键菜单中用 **Move Up** / **Move Down** 上移、下移，与请求一致。
- 侧边栏 Workflows 支持用文件夹分组，文件夹可以多级嵌套。用 **New Folder** 新建文件夹，在文件夹行或右键菜单中在文件夹内新建工作流，拖动工作流和文件夹可以调整顺序或移入文件夹。右键工作流或文件夹选择 **Move Up** / **Move Down** 调整顺序，右键工作流选择 **Move to...** 移到其他文件夹，与请求一致。删除文件夹会同时删除其中的工作流。
- **Save Request** 对话框新增 **New Collection** 按钮，还没有任何集合时也能直接保存新请求。
- ApiKit JSON 导出会记录工作流所在的文件夹，导入时放回同名文件夹。AI（MCP）的 `list_workflows` 按侧边栏顺序返回工作流及其 `folderPath`。

### 变更
- README 和快速开始文档说明 Linux 的 `.deb`、`.rpm` 和便携版使用系统的 WebKitGTK（建议 2.50 或更高），AppImage 自带 WebKitGTK。
- ApiKit 现在需要 macOS 11 Big Sur 或更高版本，且 Safari 为 16.4 或更高（之前为 macOS 10.13）。界面样式改用了新版工具，旧版系统 WebKit 无法正确显示。
- 工具栏、标题栏、状态栏等处的按钮，输入框的右键菜单（Cut、Copy、Paste、Select All），以及 **Find** / **Console**、**Pretty** / **Raw**、导入导出列表和 Mock 服务视图等选项卡改用标准组件样式；流式响应文本视图用分段按钮切换 **Rendered** 和 **Source**。状态栏中 Mocks 和 MCP 的状态以徽标显示；标题栏 ✦ 图标上的圆点只在 MCP 服务运行中（绿色）或启动失败（红色）时显示；form-data 和 binary 请求体的文件选择改为 **Select File** 按钮加文件名。
- 弹窗按内容统一宽度：只有名称输入的弹窗（如 **Rename**）略为加宽，**Move Request** 与 **Save Request** 同宽，**Manage Environments** 和 **AI Integration (MCP)** 在大屏上不再过宽；窗口较小时弹窗不会超出窗口。
- 状态、请求方法和强调色（例如未保存页签的标题和 **Status: 200 OK**）改用新版默认调色板，颜色略为鲜艳，主要体现在暗色主题。
- **Save Request** 对话框默认选中上次保存的位置（只有一个集合时选中它）并展开到该位置，保存在集合根目录时标注 **(collection root)**。
- 新建的工作流现在放在侧边栏列表（或所在文件夹）的末尾，而不是最前面；拖动调整的顺序会保留。
- Params、Headers、form-data 和 x-www-form-urlencoded 现支持 Postman 风格的 Bulk Edit，每行使用 `key: value` 编辑；form-data 文件字段在批量编辑时保留。
- Windows 卸载程序现在说明删除应用缓存也会移除主题和 MCP 设置，用户数据则由单独选项控制。

### 修复
- 请求的 **Move Up** / **Move Down** 现在与集合树中紧挨着的一项交换位置，不再越过中间的文件夹。
- 按下标题栏 ✦ 图标上的 MCP 状态点时不再拖动窗口。
- 输入框上下空间都不够时，变量补全和函数参数提示（例如输入 `{{$sequence(` 后）不再超出窗口，而是缩小到可用的空间并可滚动。
- Bulk Edit 按钮不再导致 Value 列标题与表格数据行错位。
- 升级内置依赖（Vue、DOMPurify、nanoid 等）到已修复已知安全漏洞的版本。

## [0.4.3] - 2026-10-15

### Changed
- MCP tool descriptions and schemas now clarify direct tool arguments versus request URL query parameters, document request/workflow input alternatives, and match supported workflow override fields.
- MCP `get_request_log` returns request and response bodies in pages, so AI clients can retrieve complete large bodies without exceeding one tool response.
- MCP `get_workflow_logs` now paginates request and response bodies in log details, and `send_request` returns a `logId` for retrieving its complete response.

### Fixed
- MCP `search_requests` now explicitly documents `query` as the text-search argument and directs AI clients to pass filters directly, not inside `params` or as `keyword`.

### 变更
- MCP 工具说明和 schema 现在明确区分直接传入的工具参数与请求 URL 查询参数，说明请求和工作流输入的二选一规则，并与工作流实际支持的覆盖字段保持一致。
- MCP `get_request_log` 现在分段返回请求体和响应体，AI 客户端可以逐页读取完整的大报文，避免单次工具响应过大。
- MCP `get_workflow_logs` 现在分段返回日志详情中的请求体和响应体；`send_request` 返回 `logId`，可用于读取完整响应。

### 修复
- MCP 的 `search_requests` 现在明确说明文本搜索参数为 `query`，并提示 AI 客户端直接传入筛选参数，不要放进 `params` 对象或改用 `keyword`。

## [0.4.2] - 2026-10-15

### Added
- Mock routes: a copy button in the address box copies the full URL, with path parameters set to `1`. **Open as Request** opens the route in a new request with the `x-mock-response-name` header, so it returns the response you are editing.
- MCP: `open_request`, `close_request`, `open_workflow` and `close_workflow` open and close workspace tabs. Closing a tab with unsaved edits first returns the complete draft for review; the user can then confirm saving or discarding it in the AI tool.

### Changed
- Mock routes: **Duplicate Route** and **Delete Route** move into the **⋯** menu. The duplicated route is disabled and its path ends with `-copy`, so it no longer answers the same calls as the original; the path box is focused so you can change it.
- Mock responses: the **Name** field is now labelled **Response Name**.
- Windows uninstaller: the single "Delete the application data" option is split into two. **Delete the app cache and interface settings** only deletes the cache, theme and MCP settings. **Also delete my collections, workflows, environments, mocks and history (cannot be undone)** deletes your data and is unchecked by default. When a new version is installed with "Uninstall before installing", your data is always kept and the second option is not shown.
- Mock responses: picking a `{{` completion that ends with `.`, such as `$request.headers.`, now leaves the cursor after the `.` so you can type the name right away, in both the body and the header fields.

### Fixed
- Updating ApiKit now stops the MCP server and the mock services before restarting or starting the installer, so the new version can listen on the same ports again.
- Mock: in a route path written as `/users/{{id}}`, `{{$request.params.id}}` and path rules now read the parameter `id`; before, they got nothing.
- Mock template preview: a full URL such as `http://127.0.0.1:3001/orders/1` in **Preview with** now fills the path parameters; before, `{{$request.params.id}}` was empty.

### 新增
- Mock 路由：地址框中的复制按钮复制完整地址，路径参数换成 `1`；**Open as Request** 在新请求中打开路由，并带上请求头 `x-mock-response-name`，返回正在编辑的响应。
- MCP：新增 `open_request`、`close_request`、`open_workflow` 和 `close_workflow`，用于打开和关闭工作区页签。关闭有未保存修改的页签时，会先返回完整草稿供用户审阅，再由用户在 AI 工具中确认保存或丢弃。

### 变更
- Mock 路由：**Duplicate Route** 和 **Delete Route** 移到 **⋯** 菜单中。复制出的路由默认停用，路径末尾加 `-copy`，不再和原路由应答同样的请求；复制后聚焦路径输入框，方便修改。
- Mock 响应：**Name** 字段改名为 **Response Name**。
- Windows 卸载程序：原来的一个“删除应用程序数据”选项拆成两个。**删除应用缓存和界面设置**只删除缓存、主题和 MCP 设置；**同时删除我的集合、工作流、环境、Mock 和历史记录（无法恢复）**删除用户数据，默认不勾选。安装新版本时选择“安装前卸载”，用户数据始终保留，也不显示第二个选项。
- Mock 响应：在 `{{` 补全中选中以 `.` 结尾的项（例如 `$request.headers.`）后，光标停在 `.` 之后，可以直接输入名称，响应体和响应头中都是如此。

### 修复
- 更新 ApiKit 时，在重启或启动安装程序之前先停止 MCP 服务和 Mock 服务，新版本启动后可以继续使用原来的端口。
- Mock：路由路径写作 `/users/{{id}}` 时，`{{$request.params.id}}` 和路径规则现在能读到参数 `id`，之前取不到值。
- Mock 模板预览：**Preview with** 中填写完整地址（如 `http://127.0.0.1:3001/orders/1`）时也能读到路径参数，之前 `{{$request.params.id}}` 为空。

## [0.4.1] - 2026-10-15

### Changed
- Streamed answers in a custom format: the text of events such as `event: token` is shown as the answer as it arrives. When other events with content follow it, such as `event: result` and `event: fill`, the text received so far moves into Thinking and those events are shown as results, each as its own block in the Text view: text as Markdown and `data` as formatted JSON; text arriving after them is also Thinking, and Thinking stays expanded while it keeps arriving. Events without content, such as `done`, only end the stream, and a stream without such events keeps the text as the answer. Tests and extracted variables can read these events from `results`, for example `results.result.data.suggestAction` or `results.fill.content`.
- The Console tab in the bottom panel no longer shows a count badge.

### Fixed
- Streamed responses: expanding or collapsing Thinking by hand no longer carries over to the next response of the same request.

### 变更
- 自定义格式的流式回答：`event: token` 之类事件的文本在接收时作为回答逐段显示。之后有带内容的其它事件（例如 `event: result`、`event: fill`）时，已收到的文本移入 Thinking，这些事件作为结果，在 Text 视图中各显示为一块：文本按 Markdown 显示，`data` 显示为格式化的 JSON；之后再收到的文本也算 Thinking，文本仍在输出时 Thinking 保持展开。不带内容的事件（例如 `done`）只表示流结束，没有这类事件的流，文本仍是回答。断言和变量提取可以从 `results` 读取这些事件，例如 `results.result.data.suggestAction`、`results.fill.content`。
- 底部面板的 Console 页签不再显示数量角标。

### 修复
- 流式响应：手动展开或折叠 Thinking 后，同一请求的下一次响应不再沿用这个状态。

## [0.4.0] - 2026-10-15

### Added
- Documentation site in English and Chinese at https://duwei0227.github.io/apikit/, covering variables, workflows, mock services and the AI integration in detail. Open it from **Help > Documentation**, or from the link in **About ApiKit**, which now also opens the GitHub page instead of only copying its link.
- ? icons next to workflow conditions, loop settings, Set Variables, variable extraction in Tests, the mock response body and the AI Integration (MCP) dialog open the matching section of the documentation.
- AI Integration (MCP): a new `import_curl` tool saves a cURL command as a request in a collection or folder, the same way as **Import cURL** in ApiKit, and reports cURL options that were ignored.
- AI Integration (MCP): new tools to delete requests, folders, collections and workflows, and to move a request to another collection or folder. You confirm every deletion in ApiKit or in the AI tool, even after choosing Allow All This Session; the confirmation shows what will be deleted, how many requests it contains and which workflows use them. Tabs of deleted items are closed.
- New **Set Variables** Workflow step: sets global variables when it runs, for example to reset a page counter before a loop or to save `{{$guid}}` for later requests. Values can use `{{variables}}` and `{{$loopIndex}}`, and the run log shows the values that were set. The AI (MCP) can create it with the step type `setVariables`.
- Variables can now be extracted from response headers: in **Tests > Global Variable Settings**, choose the type **Response Header** and enter the header name, for example `x-session` (case-insensitive).
- Requests inside a Workflow loop can use `{{$loopIndex}}`, the number of the current iteration starting at 1 (in nested loops, of the innermost loop), for example `?page={{$loopIndex}}`. Outside a loop it is sent as written.
- Workflow loops (For, While, Do While and Until) can now wait between iterations: set **Wait between iterations** in milliseconds, up to one hour. Use it to poll a job that takes time instead of using up the iterations at once. Stop also ends the wait. Max iterations can now be up to 1000 (before: 100), the same as for the AI (MCP).
- Mock services: serve example responses on a local port, so a frontend or another program can call an API before it is ready. Open **Mocks** in the sidebar and create a service from scratch, from a collection (using the latest responses in the Console) or from an OpenAPI file. Each service has its own port, and several can run at once. Routes match by method and path, with path parameters such as `:id`. A route can have several responses: the first whose rules match (query, header, path parameter, body JSONPath or cookie) is returned, otherwise the default one, and callers can pick one with the `x-mock-response-name` or `x-mock-response-code` header. Bodies can read the request (`{{$request.params.id}}`), repeat a block to build lists (`{{#repeat 10}}…{{/repeat}}`) and use environment and dynamic variables; a Template body shows a preview of what it generates. Each response has its own status, headers and delay, and browser pages can call the mock (CORS). Logs keep the full request and response of the latest 100 calls per service, saved on this computer. **Save to Mock** in the response area adds a real response to a mock service. Mock services only accept connections from this computer.
- In the Console, JSON and XML request and response bodies now have a Format button next to Copy. It switches the body between formatted and as sent or received; Copy copies what is shown. Large integers keep their exact value.
- AI Integration (MCP): a new `list_builtin_variables` tool lists the built-in dynamic variables such as `{{$timestamp}}`, `{{$guid}}`, `{{$randomInt(1, 100)}}` and `{{$sequence}}`, with their usage, parameters and an example value, so the AI can use them in requests. Listing does not advance sequences.
- AI Integration (MCP): a new `search_requests` tool finds saved requests whose name or URL contains a text, optionally only with a given method or in one collection, and returns each with its collection and folder path, so the AI no longer has to read every collection.
- Workflow If, While, Do While and Until steps can now have several conditions: click **Add condition** under the condition. With two or more, choose how they combine: all conditions are true at once, or any condition is true. Until loops can also stop when each condition has been met, in any order: a condition that was met in an earlier iteration stays met, and the loop stops once all of them have been met. The run log shows the result of each condition and, for Until, the iteration in which it was met. The AI (MCP) can create and read such steps too.

### Changed
- When you choose a saved request for a Workflow step, the step is now named after the request, so the run log shows which request each step sent. A name you changed yourself is kept. Steps the AI (MCP) creates without a name are named the same way.
- Expected values of request tests and Workflow conditions, and custom values of extracted variables, can now use `{{variables}}`, for example `id equals {{orderId}}` to check a value extracted by an earlier request. An undefined variable is still compared as written. Test results show the value after replacement, and failure messages now read `Status code: expected 201, got 422` instead of `Status code 422 equals 201`.
- Streamed answers in a simple custom format are now joined into the Text view. When an event is named or typed `token`, `delta`, `chunk`, `text`, `content`, `message` or `answer`, or has neither a name nor a type, its `content`, `text`, `delta` or `token` text is added to the answer, for example `event: token` with `{"type":"token","content":"..."}`. Other events, such as status or result events, stay in the Events view.
- History and the Console now keep the requests of the last 2 weeks, up to the latest 100 each (before: 90 days and 500 requests). Each request's bodies are saved in their own file, and only a summary of each entry stays in memory; the bodies are read when you expand a Console entry, open a History entry or the AI reads a request log. Sending a request now writes only that request instead of rewriting all logs, so memory no longer jumps by tens to hundreds of MB on each send as the logs grow. Existing logs are converted and trimmed the first time ApiKit starts.
- The AI Integration (MCP) dialog is now 70% of the window width, so the URL, header and JSON config fit without wrapping.
- Requests, workflow runs and environment switches from the AI are now confirmed in the AI tool by default when it supports MCP elicitation; ApiKit still asks when the AI tool cannot. A choice you already made in the MCP settings is kept.
- When the AI changes an existing request or workflow, the change is now kept as unsaved edits instead of being saved: the open tab shows it as unsaved, and you click Save to keep it or Discard to undo it. If you already have unsaved edits, the AI's change is applied on top of them. New requests and workflows the AI creates are still saved directly. To save the AI's changes directly as before, choose "Save directly" in the MCP settings. When the AI reads, sends or runs a request or workflow, it uses the unsaved edits.
- In the request body editor, Ace's own shortcuts now take precedence, so ApiKit's conflicting shortcuts have moved: show the keyboard shortcuts with F1 (before: Ctrl+/, which now toggles a line comment in the editor) and switch dark/light mode with Ctrl+Alt+D, or Control+Option+D on macOS (before: Ctrl+Shift+D, which now duplicates the line in the editor). The Keyboard Shortcuts list now also covers the editor, input fields and the response, and shows Cmd and Option keys on macOS.
- Removed **AI Integration (MCP)...** from the **Help** menu. Open the AI integration settings from the ✦ icon in the title bar or **MCP** in the status bar.

### Fixed
- Moving a request to a collection or folder that no longer exists now leaves the request where it was. Before, the request was removed from its collection and no longer shown.
- Deleting a folder or collection now also deletes the requests inside it. Before, their files and unsaved edits stayed on disk.
- On macOS, Cmd+D now duplicates the selected item in the collection tree, like Ctrl+D on other systems.
- Keyboard shortcuts such as Ctrl+S, Ctrl+N and Ctrl+D now also work when Caps Lock is on or a non-Latin keyboard layout is active.

### 新增
- 中英文文档站 https://duwei0227.github.io/apikit/ ，详细说明变量、工作流、Mock 服务和 AI 集成。可以从 **Help > Documentation** 或 **About ApiKit** 中的链接打开；About 中的 GitHub 地址现在也可以直接打开，不再只能复制。
- 工作流条件、循环设置、Set Variables、Tests 中的变量提取、Mock 响应体和 AI 集成（MCP）对话框旁新增 ? 图标，打开文档中对应的章节。
- AI 集成（MCP）：新增 `import_curl` 工具，把 cURL 命令保存为集合或文件夹中的请求，处理方式与 ApiKit 中的 **Import cURL** 相同，并列出被忽略的 cURL 选项。
- AI 集成（MCP）：新增删除请求、文件夹、集合和 Workflow 的工具，以及把请求移动到其他集合或文件夹的工具。每次删除都要你在 ApiKit 或 AI 工具中确认，即使之前选择了 Allow All This Session 也一样；确认时显示要删除的内容、其中的请求数量以及哪些 Workflow 用到了它们。被删除内容的页签会关闭。
- Workflow 新增 **Set Variables** 步骤：运行时设置全局变量，例如在循环前重置页码，或保存 `{{$guid}}` 供后续请求使用。值可以使用 `{{变量}}` 和 `{{$loopIndex}}`，运行日志显示设置的值。AI（MCP）可以用步骤类型 `setVariables` 创建。
- 可以从响应头提取变量：在 **Tests > Global Variable Settings** 中选择类型 **Response Header**，填写响应头名称，例如 `x-session`（不区分大小写）。
- Workflow 循环中的请求可以使用 `{{$loopIndex}}`：当前是第几次循环，从 1 开始（嵌套循环取最内层），例如 `?page={{$loopIndex}}`。在循环外按原样发送。
- Workflow 的循环（For、While、Do While、Until）可以设置每次循环之间的等待时间：**Wait between iterations**，单位毫秒，最长一小时。轮询耗时任务时不会一下子用完循环次数。点 Stop 也会结束等待。Max iterations 上限从 100 提高到 1000，与 AI（MCP）一致。
- Mock 服务：在本机端口上返回示例响应，接口还没完成时前端或其他程序也能调用。在侧边栏的 **Mocks** 中新建服务，可以从空白创建、从集合创建（使用 Console 中最近的响应）或从 OpenAPI 文件创建。每个服务有自己的端口，可同时运行多个。路由按方法和路径匹配，支持 `:id` 等路径参数。一条路由可以有多个响应：返回第一个规则满足的响应（查询参数、请求头、路径参数、请求体 JSONPath 或 Cookie），否则返回默认响应；调用方也可以用请求头 `x-mock-response-name` 或 `x-mock-response-code` 指定。响应体可以读取请求数据（`{{$request.params.id}}`）、重复一段内容生成列表（`{{#repeat 10}}…{{/repeat}}`），并可使用环境变量和动态变量；Template 模式会显示生成结果的预览。每个响应可以单独设置状态码、响应头和延迟，浏览器页面也可以直接调用（CORS）。Logs 保留每个服务最近 100 次调用的完整请求和响应，保存在本机。响应区的 **Save to Mock** 可以把真实响应添加到 Mock 服务。Mock 服务只接受本机的连接。
- Console 中 JSON 和 XML 格式的请求体和响应体，在复制按钮旁新增格式化按钮，可在格式化显示和原文之间切换；复制按钮复制当前显示的内容。大整数保持原值。
- AI 集成（MCP）：新增 `list_builtin_variables` 工具，列出 `{{$timestamp}}`、`{{$guid}}`、`{{$randomInt(1, 100)}}`、`{{$sequence}}` 等内置动态变量的用法、参数和示例值，AI 可以在请求中使用它们。列出时不推进序列。
- AI 集成（MCP）：新增 `search_requests` 工具，按名称或 URL 查找已保存的请求，可再按请求方法或集合过滤，返回每个请求所在的集合和文件夹路径，AI 不用再读取全部集合。
- Workflow 的 If、While、Do While 和 Until 步骤可以设置多个条件：点条件下方的 **Add condition** 添加。有两个及以上条件时可以选择组合方式：所有条件同时满足，或任一条件满足。Until 循环还可以选择各条件先后满足（不限顺序）：之前某次循环中满足过的条件保持满足，所有条件都满足过后停止循环。运行日志显示每个条件的结果，Until 还显示每个条件在第几次循环满足。AI（MCP）也可以创建和读取这类步骤。

### 变更
- 为 Workflow 步骤选择已保存的请求时，步骤名称改为该请求的名称，运行日志中能看出每一步发送的是哪个请求。自己改过的名称保持不变。AI（MCP）创建的未命名步骤也同样处理。
- 请求测试和 Workflow 条件的期望值、提取变量的自定义值可以使用 `{{变量}}`，例如 `id equals {{orderId}}` 校验前一个请求提取的值。未定义的变量仍按原样比较。测试结果显示替换后的值，失败提示由 `Status code 422 equals 201` 改为 `Status code: expected 201, got 422`。
- 采用简单自定义格式的流式回答，现在会拼接显示在 Text 视图中。事件名或 `type` 为 `token`、`delta`、`chunk`、`text`、`content`、`message`、`answer`，或者既没有事件名也没有 `type` 时，事件里的 `content`、`text`、`delta` 或 `token` 文本会拼进回答，例如 `event: token` 加 `{"type":"token","content":"..."}`。状态、结果之类的其它事件仍只在 Events 视图中显示。
- History 和 Console 改为保留最近 2 周的请求，各自最多 100 条（之前为 90 天、500 条）。每个请求的 body 单独保存为一个文件，内存中只保留每条记录的摘要；展开 Console 日志、打开 History 记录或 AI 读取请求日志时才读取 body。发送请求时只写入这一条，不再重写全部日志，内存不再随日志增多在每次发送时上涨几十到几百 MB。已有日志会在 ApiKit 首次启动时转换并清理。
- AI Integration (MCP) 弹窗宽度改为窗口宽度的 70%，URL、Header 和 JSON 配置不再挤在一起换行。
- AI 发送请求、运行工作流和切换环境时，默认改为在支持 MCP elicitation 的 AI 工具里确认；AI 工具不能确认时仍由 ApiKit 询问。已在 MCP 设置中做过的选择保持不变。
- AI 修改已有的请求和工作流时，改为存为未保存的修改，不再直接保存：打开的页签显示为未保存，点击保存才会保留，点击丢弃即可撤销。已有未保存的修改时，AI 的修改在其基础上进行。AI 新建的请求和工作流仍直接保存。想像之前一样直接保存，可在 MCP 设置中选择 "Save directly"。AI 查看、发送请求或运行工作流时，使用包含未保存修改的版本。
- 请求体编辑器中以 Ace 的快捷键为准，ApiKit 与之冲突的快捷键改为：显示快捷键列表改为 F1（之前为 Ctrl+/，现在在编辑器中切换行注释），切换深色 / 浅色主题改为 Ctrl+Alt+D，macOS 上为 Control+Option+D（之前为 Ctrl+Shift+D，现在在编辑器中复制行）。快捷键列表补充了编辑器、输入框和响应中的快捷键，macOS 上显示 Cmd 和 Option 键。
- **Help** 菜单中移除了 **AI Integration (MCP)...**，点击标题栏的 ✦ 图标或底部状态栏的 **MCP** 打开 AI 集成设置。

### 修复
- 把请求移动到已不存在的集合或文件夹时，请求保留在原位置。之前请求会从原集合中移除，不再显示。
- 删除文件夹或集合时，同时删除其中的请求。之前这些请求的文件和未保存的修改会留在磁盘上。
- macOS 上在集合树中按 Cmd+D 可复制选中项，与其他系统上的 Ctrl+D 一致。
- 打开大写锁定或使用非拉丁字母键盘布局时，Ctrl+S、Ctrl+N、Ctrl+D 等快捷键也能使用。

## [0.3.0] - 2026-10-14

### Added
- Streaming responses, such as LLM completions, now show as they arrive. When a response is Server-Sent Events (`text/event-stream`) or newline-delimited JSON, the Response area shows a Streaming status with the time to the first event, the event count and a Stop button. The Body has three views: Text joins the answer as it is generated and renders it: Markdown is formatted, an answer that is JSON is shown formatted and foldable, and an answer that is HTML or SVG is shown in an isolated preview. Code blocks inside Markdown have a Copy button, `json` blocks are formatted and `html` or `svg` blocks have a Preview button. Switch to Source to see the plain text. The model's thinking is shown while it arrives and folds into one line when the answer starts. Scripts in an HTML preview do not run; on Linux you can turn them on for one preview with Run scripts. Images in an answer are not loaded and show as links; Events lists every event with its time and expands to formatted JSON; Raw shows the stream as received. Answer text, finish reason and token usage are recognized for OpenAI-compatible, Anthropic, Gemini and Ollama APIs; other streams open in Events. After the stream ends, JSON field tests, extracted variables and workflow conditions read a merged object with `text`, `thinking`, `finishReason`, `usage`, `eventCount` and `events`. Stopping a stream keeps what was received. Workflows and the MCP server wait for the stream to end and then use the same merged result.
- Import now supports OpenAPI 3.x and Swagger 2.0 documents in JSON or YAML. Each document becomes a collection, with one folder per tag. Request URLs start with `{{baseUrl}}`, and you can also create an environment that holds `baseUrl`, the path variables and the auth variables (`token`, `apiKey` and so on). Query parameters, headers, request bodies (generated from the examples or the schema), Bearer, Basic and API key auth, and the expected status code are filled in from the document. The import preview lists anything that could not be imported, such as OAuth2 auth.
- Any AI tool that supports MCP (Model Context Protocol) can now work with ApiKit through a built-in MCP server. Open it from the sparkle icon in the title bar or the MCP status in the bottom bar, turn it on, and add the URL and Authorization header (or the JSON config) to your AI tool's MCP settings. The icon shows whether the server is running. While ApiKit is open, the AI can read and edit collections, requests and workflows, rename collections and folders, create and edit environments and global variables, switch the active environment, send requests, run workflows, and read the request logs in the console. Requests the AI sends are also added to History. ApiKit asks you before each request is sent, each workflow is run and each switch of the active environment; choose "Allow All This Session" to stop asking until ApiKit restarts. If your AI tool supports MCP elicitation, you can choose "In the AI tool" in the MCP settings to approve these in the AI tool instead of switching to ApiKit; ApiKit still asks when the AI tool cannot. The server is off by default, only accepts connections from this computer and requires a token. Environment variable values, auth tokens and passwords are hidden from the AI unless you allow them. If a request or workflow has unsaved edits in ApiKit, the AI cannot change it, so your edits are not lost.

### Changed
- History and the Console now keep at most the latest 500 requests each, in addition to the 90-day limit, and are saved together at most once every half second, so sending many requests (for example in a workflow loop) no longer slows down as the logs grow. Request and response bodies in the Console are saved up to 256 KB each, and History no longer saves response bodies, which nothing used. Existing logs are trimmed the first time ApiKit starts.
- Text responses are passed from the network layer to the window as text instead of base64, so they take less memory and time to show. Responses larger than 2 MB are shown as received instead of being formatted. Responses larger than 5 MB show only the first 1 MB, with buttons to copy the full body or save it to a file; tests, extracted variables, workflows and the MCP server still use the full response.
- The request editor now sends requests and runs tests the same way as workflows and the MCP server. JSON field tests on a response that is not JSON now fail with "response is not valid JSON" instead of being left out. A status code test whose expected value is not a number now says so. Test Results lists every variable to extract with its result: set, skipped because a test failed, or failed because the value could not be found; "Variables Set" counts only the variables that were set. A Custom Value variable is now set when all tests pass even if the response is not JSON. Requests that still contain an undefined `{{variable}}` list its name in the Console log.
- Requests with the same settings now reuse connections, so repeated requests to the same server skip the DNS lookup and TCP/TLS handshake. Idle connections are closed after 30 seconds. As in browsers and Postman, the Time of a request that reuses a connection no longer includes setting up the connection.
- Sequence numbers and global variables set by request tests are now saved together at most once every half second instead of after every request.
- Long workflows run faster: logging and request counting no longer slow down as the log grows. A loop of 600 requests spends about 70 ms on logging instead of about 2 seconds.
- ApiKit starts with less code to load: the MCP tools, the workflow runner and the cURL parser now load the first time they are used. The main startup file is about 85 KB smaller (528 KB to 442 KB).
- The request body editor and the code viewers for responses, the Console and streamed answers now use the Ace editor. Like before, it takes typing through a native text box, which keeps Chinese and other IME input reliable on Windows. The two editor libraries used before are replaced by one, so the app is about 270 KB smaller. After you choose a variable from the `{{` suggestions, the cursor now goes after the closing `}}`, and typing `{{` outside a string also shows the suggestions.

### Fixed
- Files in a form-data body that the AI adds through MCP are now uploaded with their file name. Before, the server received them as plain form fields instead of files.
- MCP now rejects a request test with an unknown operator. Before, the test was saved and then always failed.
- MCP now rejects an empty URL when the AI updates a request, adds a request to a workflow or sends an unsaved request. An unsaved request without a URL is rejected before ApiKit asks you to approve it.
- Requests that get no response, such as a connection error or too many redirects, are now added to the Console and History when they are sent from a workflow or by the AI. They show status 0 with the error message.
- When a request sent by the AI or by a workflow the AI runs still contains a `{{variable}}` that is not defined, the result and the request log now list its name. The request is still sent as written.
- The MCP `send_request` tool now rejects a call that passes both a saved request and an unsaved one. Before, the unsaved one was ignored.
- The MCP `update_request` tool now rejects a call that changes nothing.
- Closing the ApiKit window now saves everything that was still waiting to be written: edits to collections and requests from the last half second, the latest Console and History entries, sequence numbers and global variables set by tests. Before, these could be lost.
- When the AI sends a request through MCP, `{{$sequence}}` now advances once per request. Before, showing the request in the approval dialog also used up a number.
- Requests sent in the same millisecond, such as steps of a workflow, no longer share the same Console log ID.
- Requests the AI sends through MCP while the ApiKit window is still loading now resolve dynamic variables such as `{{$timestamp}}` and `{{$sequence}}`, and variables whose names contain characters such as `.` or `$`. Before, these were sent as written.
- Disabled request steps are no longer counted in the number of requests in the workflow log.
- The MCP tool descriptions now explain that a test's expected value is compared as written, and what the loop index is when a Do While or Until condition is checked.
- Duplicating a folder now places the copy next to the original folder and shows it in the sidebar right away. Before, the copy was placed inside the original folder and did not appear until ApiKit was restarted.
- When you rename a request in the sidebar, the Rename dialog now warns right away if another request in the same folder has that name. Before, the warning only appeared after you clicked Rename.
- After you choose a header name from the suggestions and click the Value field, the suggested values for that header now stay open. Before, they closed after a moment.
- Dropping a collection item where it cannot go, such as a folder into another collection, no longer undoes changes made to collections in the last half second, such as a rename.
- In the inline request editor of a workflow step, the `{{` variable suggestions and the parameter help for functions such as `$sequence(` now show on top of the dialog. Before, they opened behind it and could not be seen.
- The parameter help for functions such as `{{$sequence(` in the request body editor is no longer cut off by the editor area. Variable suggestions and parameter help near the bottom of the window now open above the field so they stay fully visible.
- Pressing Esc to close the `{{` variable suggestions or the parameter help in a dialog, such as the inline request editor of a workflow step, now only closes the suggestions. Before, it also tried to close the dialog and asked whether to discard your changes.
- The parameter help for `{{$date(`, `{{$time(` and `{{$datetime(` now shows the real default formats (`yyyyMMdd`, `HHmmss` and `yyyyMMddHHmmss`). Before, it showed formats with separators, such as `yyyy-MM-dd`, that are not used when no format is given.
- With several requests open, pressing Ctrl+F in a request body or a response now focuses the search box of the request you are working in. Before, it could focus the search box of another open request, so what you typed did not go into the search.
- Searching a request body or a response with a regular expression that can match empty text, such as `a*` or `^`, no longer freezes ApiKit. Empty matches are skipped.
- Opening a request from History now restores its body. XML and plain text bodies, and form bodies with a single field, were dropped before, and form values that contained `=` or `+` were cut off or changed. The body type now follows the request's `Content-Type`.
- When a request in a collapsed collection or folder is opened or its tab is selected, the sidebar now expands the collection and every parent folder to show and select it. Before, the collection and some nested folders stayed collapsed.
- Duplicating a folder or a collection now keeps the order of its requests and folders as you arranged them by dragging, and keeps folder descriptions. Before, the copy listed folders first and requests after them.
- The Sequences dialog now shows `{{$sequence}}` in its hint when no sequences exist yet. Before, the variable name was missing from the text.
- The Variables dialog now shows the value a sequence will start at when the request has not been sent yet, using the request's `start`, `step` and `padding`, such as 100 for `{{$sequence(start=100)}}`. Before, it always said the sequence would start at 1. It also finds the sequences in a request with the same rules used when the request is sent.
- After switching the theme with Ctrl+Shift+D, the theme button in the title bar now shows the right icon and switches back on the first click. Before, it kept showing the old theme and the first click did nothing.
- Extracting a JSON object or array into a variable now stores it as JSON text, such as `{"id":1}`. Before, the variable was set to `[object Object]`. JSON field tests and workflow conditions also compare objects and arrays as JSON text, and the test result shows the value. Variables can now also be extracted from a JSON body that is `0`, `false` or an empty string.
- Workflow conditions on a response header now match the header name in any case, such as `Content-Type`. Before, only the lowercase name matched, so the condition read no value.

### 新增
- 流式响应（例如大模型的回答）现在边接收边显示。响应是 Server-Sent Events（`text/event-stream`）或逐行 JSON 时，Response 区域显示 Streaming 状态、首个事件到达的时间、事件数和 Stop 按钮。Body 有三个视图：Text 把回答按生成顺序拼接并渲染：Markdown 会排版显示，回答是 JSON 时显示为格式化、可折叠的 JSON，回答是 HTML 或 SVG 时显示在隔离的预览框里。Markdown 中的代码块带 Copy 按钮，`json` 代码块会自动格式化，`html` 和 `svg` 代码块带 Preview 按钮。切换到 Source 可以看原文。模型的思考内容在接收时展开显示，回答开始输出后折叠成一行。HTML 预览里的脚本默认不运行；在 Linux 上可以点 Run scripts 为当前预览开启。回答里的图片不会自动加载，显示为链接；Events 列出每个事件及其时间，点开可看格式化后的 JSON；Raw 显示收到的原始内容。可以识别 OpenAI 兼容接口、Anthropic、Gemini 和 Ollama 的回答文本、结束原因和 token 用量；其它流默认打开 Events。流结束后，JSON 字段断言、变量提取和 Workflow 条件对一个合并后的对象取值，其中包含 `text`、`thinking`、`finishReason`、`usage`、`eventCount` 和 `events`。停止接收时会保留已收到的内容。Workflow 和 MCP 服务会等流结束，再使用同样的合并结果。
- 导入支持 OpenAPI 3.x 和 Swagger 2.0 文档（JSON 或 YAML）。每个文档导入为一个 Collection，按 tag 分文件夹。请求 URL 以 `{{baseUrl}}` 开头，还可以同时创建一个环境，包含 `baseUrl`、路径变量和鉴权变量（`token`、`apiKey` 等）。Query 参数、Headers、请求体（按文档中的示例或 schema 生成）、Bearer / Basic / API Key 鉴权和预期状态码都会按文档填好。导入预览中会列出无法导入的内容，例如 OAuth2 鉴权。
- 新增内置 MCP 服务，任何支持 MCP（Model Context Protocol）的 AI 工具都可以操作 ApiKit。点击标题栏的 ✦ 图标或底部状态栏的 MCP 打开设置并开启服务，然后把 URL 和 Authorization 请求头（或 JSON 配置）添加到 AI 工具的 MCP 设置中。图标上的状态点显示服务是否在运行。ApiKit 打开期间，AI 可以读取和修改 Collections、请求和 Workflows，重命名 Collection 和文件夹，创建和修改环境与全局变量，切换当前环境，发送请求、运行 Workflow，以及读取 Console 中的请求执行日志。AI 发出的请求也会记录到 History。每次发送请求、运行 Workflow 或切换当前环境前 ApiKit 会先询问你；选择 "Allow All This Session" 后，在 ApiKit 重启前不再询问。如果你的 AI 工具支持 MCP elicitation，可以在 MCP 设置中选择 "In the AI tool"，直接在 AI 工具里确认，不用切换到 ApiKit；AI 工具无法询问时仍由 ApiKit 询问。服务默认关闭，只接受本机连接，并且需要 token。环境变量的值、鉴权 token 和密码默认对 AI 隐藏，可以在设置中允许。请求或 Workflow 在 ApiKit 中有未保存的修改时，AI 不能修改它，你的修改不会丢失。

### 变更
- History 和 Console 在保留 90 天的基础上，各自最多保留最近 500 条请求，并且至多每半秒合并保存一次，大量发送请求（例如 Workflow 循环）时不再随日志增多而变慢。Console 中的请求体和响应体各最多保存 256 KB，History 不再保存未被使用的响应体。已有日志会在 ApiKit 首次启动时清理。
- 文本响应从网络层以文本而不是 base64 传给界面，占用内存更少、显示更快。超过 2 MB 的响应不再格式化，按原样显示。超过 5 MB 的响应只显示前 1 MB，并提供复制完整内容和保存到文件的按钮；断言、变量提取、Workflow 和 MCP 服务仍使用完整响应。
- 请求编辑器现在与 Workflow、MCP 服务使用同一套方式发送请求和执行断言。响应不是 JSON 时，JSON 字段断言现在显示为失败（"response is not valid JSON"），不再被忽略。状态码断言的期望值不是数字时会给出提示。Test Results 会列出每个要提取的变量及结果：已设置、因断言失败而跳过，或因取不到值而失败；"Variables Set" 只统计设置成功的变量。使用 Custom Value 的变量在断言全部通过时，即使响应不是 JSON 也会设置。请求中仍有未定义的 `{{变量}}` 时，Console 日志会列出变量名。
- 设置相同的请求现在复用连接，连续请求同一服务器时不再重复进行 DNS 解析和 TCP/TLS 握手；空闲连接 30 秒后关闭。与浏览器和 Postman 一样，复用连接的请求，其 Time 不再包含建立连接的时间。
- 序列号和请求断言设置的全局变量改为至多每半秒合并保存一次，不再每个请求都写文件。
- 长时间运行的 Workflow 更快：写日志和统计请求数不再随日志增多而变慢。600 次请求的循环，日志处理时间从约 2 秒降到约 70 毫秒。
- ApiKit 启动时需要加载的代码更少：MCP 工具、Workflow 运行和 cURL 解析改为首次使用时再加载。启动主文件减小约 85 KB（528 KB 降到 442 KB）。
- 请求 Body 编辑器，以及响应、Console 和流式回答中的代码查看器，改用 Ace 编辑器。和之前一样通过原生文本框接收输入，在 Windows 上用中文等输入法输入依然可靠。原来使用的两个编辑器库合并为一个，应用减小约 270 KB。从 `{{` 补全中选择变量后，光标现在停在 `}}` 之后；在字符串外输入 `{{` 也会显示补全。

### 修复
- AI 通过 MCP 添加的 form-data 文件现在带文件名上传。之前服务端收到的是普通表单字段，而不是文件。
- MCP 现在拒绝使用未知操作符的请求断言。之前这样的断言会被保存，执行时必然失败。
- AI 修改请求、在 Workflow 中添加请求或发送未保存的请求时，MCP 现在拒绝空 URL。未保存的请求没有 URL 时，会在 ApiKit 询问你之前被拒绝。
- 没有收到响应的请求（例如连接失败、重定向次数过多）从 Workflow 或由 AI 发出时，现在也会记录到 Console 和 History，状态为 0，并带有错误信息。
- AI 发出的请求，或 AI 运行的 Workflow 中的请求，仍然包含未定义的 `{{变量}}` 时，结果和请求日志中现在会列出变量名。请求仍按原样发出。
- MCP 的 `send_request` 工具现在拒绝同时传入已保存请求和未保存请求的调用。之前未保存的请求会被忽略。
- MCP 的 `update_request` 工具现在拒绝没有任何修改的调用。
- 关闭 ApiKit 窗口时，现在会先写完所有尚未保存的内容：最后半秒内对 Collection 和请求的修改、最新的 Console 和 History 记录、序列号，以及断言设置的全局变量。之前这些内容可能丢失。
- AI 通过 MCP 发送请求时，`{{$sequence}}` 现在每个请求只前进一次。之前在确认框中显示请求时也会多消耗一个序号。
- 同一毫秒内发出的请求（例如 Workflow 中的步骤）在 Console 中不再使用相同的日志 ID。
- ApiKit 窗口还在加载时，AI 通过 MCP 发出的请求现在也能解析 `{{$timestamp}}`、`{{$sequence}}` 等动态变量，以及名称中含 `.`、`$` 等字符的变量。之前这些变量会按原样发出。
- Workflow 日志中的请求数不再包含被禁用的请求步骤。
- MCP 工具说明中现在写明：断言的期望值按字面比较；并说明 Do While 和 Until 判断条件时循环序号的取值。
- 复制文件夹时，副本现在放在原文件夹旁边，并立即显示在侧边栏中。之前副本会放进原文件夹里面，而且要重启 ApiKit 后才会显示。
- 在侧边栏重命名请求时，如果同一文件夹中已有同名请求，重命名对话框现在会立即提示。之前要点了 Rename 之后才提示。
- 从建议中选好 Header 名称后点击 Value 输入框，该 Header 的建议值现在会保持显示。之前会在片刻后消失。
- 把集合中的项目拖放到不允许的位置（例如把文件夹拖到另一个集合）时，不会再撤销最近半秒内对集合的修改（例如重命名）。
- 在 Workflow 步骤的内联请求编辑窗口中，`{{` 变量补全和 `$sequence(` 等函数的参数提示现在显示在窗口上方。之前它们显示在窗口后面，看不到。
- 请求 Body 编辑器中 `{{$sequence(` 等函数的参数提示不再被编辑区域遮挡。靠近窗口底部的输入框中，变量补全和参数提示改为在上方显示，保持完整可见。
- 在对话框中（例如 Workflow 步骤的内联请求编辑窗口）按 Esc 关闭 `{{` 变量补全或参数提示时，现在只关闭提示。之前会同时尝试关闭对话框，并询问是否放弃修改。
- `{{$date(`、`{{$time(` 和 `{{$datetime(` 的参数提示现在显示实际的默认格式（`yyyyMMdd`、`HHmmss` 和 `yyyyMMddHHmmss`）。之前显示的是带分隔符的格式（例如 `yyyy-MM-dd`），不指定格式时并不使用这些格式。
- 打开多个请求时，在请求 Body 或响应中按 Ctrl+F 现在会聚焦当前请求的搜索框。之前可能聚焦到其他已打开请求的搜索框，输入的内容不会进入搜索。
- 在请求 Body 或响应中用可以匹配空字符串的正则表达式（例如 `a*` 或 `^`）搜索时，ApiKit 不再卡死。空匹配会被跳过。
- 从 History 打开请求时现在会还原请求体。之前 XML、纯文本请求体和只有一个字段的表单请求体会丢失，表单值中的 `=` 或 `+` 会被截断或改变。请求体类型现在按请求的 `Content-Type` 还原。
- 打开或切换到位于已折叠集合或文件夹中的请求时，侧边栏现在会展开集合和所有上级文件夹，显示并选中该请求。之前集合和部分嵌套文件夹保持折叠。
- 复制文件夹或集合时，现在会保留拖动排好的请求与文件夹顺序，以及文件夹的说明。之前副本中文件夹排在前面，请求排在后面。
- 还没有序列时，Sequences 对话框的提示中现在会显示 `{{$sequence}}`。之前提示文字中缺少这个变量名。
- 请求还没发送过时，Variables 对话框现在按请求中的 `start`、`step` 和 `padding` 显示序列的起始值，例如 `{{$sequence(start=100)}}` 显示 100。之前总是显示从 1 开始。识别请求中用到的序列时，也改为与发送时相同的规则。
- 用 Ctrl+Shift+D 切换主题后，标题栏的主题按钮现在显示正确的图标，点一次就能切回。之前按钮仍显示原来的主题，第一次点击没有效果。
- 把 JSON 对象或数组提取为变量时，现在保存为 JSON 文本，例如 `{"id":1}`。之前变量的值为 `[object Object]`。JSON 字段断言和 Workflow 条件也按 JSON 文本比较对象和数组，断言结果中显示该值。响应体为 `0`、`false` 或空字符串的 JSON 时，现在也能提取变量。
- Workflow 条件读取响应头时，名称不再区分大小写，例如可以写 `Content-Type`。之前只有小写的名称能匹配，否则条件取不到值。

## [0.2.26] - 2026-10-13

### Added
- Export and Import now support workflows. The Export dialog has Collections and Workflows tabs, and everything you select is saved to one file. Requests used by the selected workflows are exported with them by default; turn off "Include referenced requests" to store a copy of each request inside the workflow steps instead.
- Import now shows what the file contains before importing, so you can choose which collections and workflows to import. Collections or workflows whose names already exist get an "(Imported)" suffix. If you skip a collection that a workflow uses, those steps keep a copy of the request so the workflow still runs.
- You can now choose which environments to export. In Manage Environments, "Export All" is now "Export...", which opens a dialog where you pick the environments and the format. All environments are selected by default. Postman environment files hold one environment each, so exporting several as Postman asks for a folder and saves one file per environment.

### Fixed
- When checking for updates fails, the message now includes the actual error (for example a network error) instead of only "Unable to check for updates".
- The Windows setup program and uninstaller now use the ApiKit logo instead of the default installer icon.

### 新增
- 导入导出支持 Workflows。导出对话框分为 Collections 和 Workflows 两个页签，选中的内容保存到同一个文件。默认把选中 Workflow 用到的请求一起导出；关闭 "Include referenced requests" 后，改为在 Workflow 步骤里保存请求副本。
- 导入时先显示文件中的内容，可以选择要导入的 Collections 和 Workflows。与已有名称重复的项会加上 "(Imported)" 后缀。如果没有导入某个 Workflow 用到的 Collection，相关步骤会保存请求副本，Workflow 仍可运行。
- 可以选择要导出的环境。环境管理中的 "Export All" 改为 "Export..."，打开对话框选择环境和格式，默认全选。Postman 的环境文件一次只能放一个环境，因此以 Postman 格式导出多个环境时会让你选择文件夹，每个环境保存为一个文件。

### 修复
- 检查更新失败时，提示中会附上具体错误（如网络错误），不再只显示 "Unable to check for updates"。
- Windows 安装程序和卸载程序改用 ApiKit 的图标，不再显示默认的安装程序图标。

## [0.2.24] - 2026-10-10

### Changed
- The "New" badge next to the title is now a purple-blue gradient with a pulsing dot and shows the new version number (e.g. New v0.2.24), so it no longer looks like a regular button.
- On Windows, updates now run the setup wizard so you can choose the install folder. It defaults to the folder ApiKit currently runs from (including the portable version) and offers to uninstall the previous version first.
- When updating from inside the app, the Windows installer skips the Welcome and License pages.
- The Windows installer is shown in Simplified Chinese on Chinese systems and in English otherwise.

### Fixed
- The app no longer closes to install an update before the download progress reaches 100%.

### 变更
- 标题旁的 New 标记改为紫蓝渐变配色，带呼吸圆点，并显示新版本号（如 New v0.2.24），不再和普通按钮同色。
- Windows 更新改为运行安装向导，可以选择安装目录：默认是 ApiKit 当前所在目录（便携版也一样），并提供安装前卸载旧版本。
- 从应用内更新时，Windows 安装程序跳过欢迎页和许可协议页。
- Windows 安装程序在中文系统上显示简体中文，其他系统显示英文。

### 修复
- 修复下载进度还没到 100% 就关闭应用开始安装的问题。

## [0.2.23] - 2026-10-09

### Changed
- Dark mode now uses the VS Code 2026 Dark color scheme throughout. Sidebar, toolbar, tab bar and footer share one grey, and the code editors use the same background as the rest of the window instead of the purple Dracula theme. JSON and XML syntax colors match VS Code.
- In dark mode, primary buttons (Send, New Request, etc.) and the active tab's top bar use VS Code blue instead of white.

### 变更
- 暗色模式整体改用 VS Code 2026 Dark 配色：侧边栏、工具栏、标签栏、底栏统一灰阶，代码编辑器背景与窗口其他区域一致，不再使用偏紫的 Dracula 主题；JSON、XML 语法着色与 VS Code 一致。
- 暗色模式下，主按钮（Send、New Request 等）和当前标签的顶部色条改为 VS Code 蓝，不再是白色。

## [0.2.22] - 2026-10-09

### Added
- Request tabs and Workflow tabs can be reordered together by dragging, and the order is kept after a restart. A duplicated tab opens right next to the original.
- Middle-click closes a content tab. When the tab bar overflows, the mouse wheel scrolls it sideways.

### Changed
- Dragging a tab now works like Chrome: the dragged tab follows the pointer, neighbouring tabs move aside in real time, it drops into place on release, and the dragged tab becomes the current tab.
- Tab width adapts between 110 and 220px depending on how many tabs are open. While you close tabs one after another with the mouse, the width stays fixed so the next tab's close button lands under the pointer; it adapts again once the pointer leaves the tab bar.
- The tab close button is now an 18px round target with a grey hover background (it used to turn red on hover).
- Input undo history now keeps 200 steps instead of 50, the same as the JSON editor.

### Fixed
- Closing a background tab no longer switches away from the current tab. Closing the current tab activates the tab to its right (or to its left if there is none).
- Undo/redo history is no longer lost when switching request sub-tabs (Params, Headers, Body, Tests, etc.), changing the Body type, switching Workflow tabs, or collapsing Workflow steps. The same fix applies to the Workflow request editor.
- Deleting a table row (Params, Headers, Body form, Tests, environment variables) no longer shifts the undo history of the rows below it onto other rows.
- Typing in the URL no longer rebuilds the whole parameter table about 0.3 seconds later and wipes the parameter inputs' undo history.
- Pressing `Ctrl+Shift+Z` after undoing and typing new text no longer overwrites what you just typed. Inputs no longer fall back to the browser's native undo when their own history is empty, which could restore a wrong value.
- With several requests open, clicking the Body type label of a background request no longer changes the Body type of the first request.

### 新增
- 请求页签与 Workflow 页签可以混合拖动排序，顺序在重启后保留；复制页签时新页签紧挨在原页签右侧。
- 内容页签支持鼠标中键关闭；页签栏放不下时可用鼠标滚轮横向滚动。

### 变更
- 页签拖动改为 Chrome 式跟随：被拖动的页签随指针移动，相邻页签实时让位，松开即落位，拖动过的页签成为当前页签。
- 页签宽度随打开数量在 110–220px 之间自适应；用鼠标连续关闭页签时宽度暂时保持不变，使下一个页签的关闭按钮停在指针下，指针离开页签栏后恢复自适应。
- 页签关闭按钮改为 18px 圆形点击区域，悬停时显示灰色底色（原为悬停变红）。
- 输入框撤销历史上限由 50 步提升到 200 步，与 JSON 编辑器一致。

### 修复
- 修复关闭后台页签时当前页签被切走的问题；关闭当前页签时激活右侧相邻页签（右侧没有则激活左侧）。
- 修复撤销/重做历史在切换请求子页签（Params、Headers、Body、Tests 等）、切换 Body 类型、切换 Workflow 页签、折叠 Workflow 步骤时丢失的问题；Workflow 请求配置编辑器同样修复。
- 修复删除表格行（Params、Headers、Body 表单、Tests、环境变量）后，后面各行的撤销历史错位到其他行的问题。
- 修复在 URL 中输入约 0.3 秒后参数表被整体重建、参数输入框撤销历史丢失的问题。
- 修复撤销后输入新内容再按 `Ctrl+Shift+Z` 会覆盖刚输入内容的问题；输入框不再在自身历史为空时落到浏览器原生撤销，避免恢复出错误的值。
- 修复同时打开多个请求时，点击后台请求的 Body 类型文字会改到第一个请求的 Body 类型的问题。

## [0.2.21] - 2026-09-29

### 变更
- For 循环不再有最大迭代次数限制，执行次数完全由 `Iterations` 决定；步骤面板移除多余的 `Max` 输入框，历史工作流中残留的 `maxIterations` 字段会在加载时清理。
- While、Do While、Until 循环的最大迭代次数默认值由 10 调整为 30，输入上限仍为 100。
- History 与 Console 的请求记录保留时间由 15 天延长到 90 天（3 个月），过期记录在加载时自动清理。

### 修复
- 修复 Workflow 循环条件日志一律显示 `Condition failed` 并标红的问题：Until 条件未满足只表示需要继续迭代，While/Do While 条件不再成立属于正常退出，两者都不再判定为失败；诊断文案改为按步骤类型区分（`Condition not met`、`Condition met`、`Condition holds`、`Condition ended`，达到迭代上限时为 `Condition still holds · max iterations` 或 `Condition not met · max iterations`），红色只保留给真正执行失败的步骤。
