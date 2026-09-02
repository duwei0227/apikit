# 更新日志

所有重要的项目变更都会记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [0.2.19] - 2026-09-01

### 新增
- Workflow 日志支持树形执行路径、循环与迭代层级、请求及条件诊断详情，以及实时展开当前执行路径和自动跟踪最新记录。

### 变更
- Workflow、循环、迭代和请求日志改为单节点生命周期更新，减少重复记录，并集中展示执行进度、耗时、请求统计与断言摘要。
- 精简 Workflow 日志列表列项；用户查看历史、手动展开或打开详情时暂停自动跟踪，并可通过 `Jump to latest` 恢复。

### 修复
- 修复旧版状态码断言使用 `value` 字段时，HTTP 200 被误判为测试失败的问题；保存时会自然规范化为 `expectedValue`。
- 修复非法状态码期望值及非 JSON 响应上的 JSON 断言缺少明确失败原因的问题。
- 修复请求执行前没有运行中日志，以及请求异常、停止或断言失败时日志信息不完整的问题。

## [0.2.18] - 2026-08-14

- 优化 cURL 导入与请求解析，正确处理 URL 编码参数及更多 cURL 配置。

## [0.2.17] - 2026-08-04

### 新增
- HTTP 请求体新增 XML 支持，涵盖编辑与格式化、默认 Content-Type、cURL 识别、请求执行及 Postman 导入导出。
- GET 请求支持发送 JSON、XML、x-www-form-urlencoded 和 form-data body 参数。

### 变更
- 更新 Console 请求信息与发送状态展示：记录隐式及 multipart 实际 Content-Type，并优化 Console 展开时的请求遮罩和取消操作。

## [0.2.16] - 2026-07-24


### 修复
- 修复原生窗口显示后、Vue 首屏挂载前出现较长时间空白的问题。

## [0.2.15] - 2026-07-24

### 新增
- 工作流支持自定义引用请求和内联请求配置，并提供明确的应用流程；请求草稿与覆盖配置现在能够独立保存和恢复。
- Console 请求日志支持持久化保存 15 天，应用重启后仍可查看近期记录。

### 变更
- History 记录调整为保留 15 天并按日期分组，双击历史项时使用与新建请求一致的临时请求打开逻辑。
- 优化工作流执行日志的表格和请求/响应详情展示。
- 根据请求方法和请求体类型自动选择合适的请求配置页签。

### 修复
- 修复工作流请求设置布局不一致的问题。
- 修复在工作流中使用 `Ctrl+S` 时显示错误保存提示的问题。

## [0.2.14] - 2026-07-06

### 变更
- Environments 管理弹窗宽度缩小 20%，从 `90vw` 调整为 `72vw`。

## [0.2.13] - 2026-07-02

### 修复
- 修复发送 DELETE 请求时请求体未发送的问题：JSON、x-www-form-urlencoded、form-data 等非 query 参数现在会在普通发送、下载发送、工作流执行与 cURL 生成中保持一致。
- 修复 Console 面板展开后 Response 状态栏的 Status/Time/Size 覆盖在 Console 上方的问题。

## [0.2.12] - 2026-06-30

### 新增
- Collections 侧栏搜索支持按请求 URL 模糊匹配：搜索请求地址片段时会保留命中的请求及其父级 Collection/Folder，同时继续支持原有的名称匹配。

## [0.2.11] - 2026-06-26

### 修复
- 修复从 Postman 格式导入多层级 Collection 时同层级顺序错乱的问题：此前同一层级内单独的请求总是排在文件夹前面，丢失了 Postman 文件中文件夹与请求交错的原始顺序。现为文件夹与请求引用引入 `order` 排序信息，导入按 Postman item 原始顺序赋值，拖拽与导出均按该顺序保留，实现往返一致。

### 变更
- 集合树中未携带顺序信息的历史集合统一改为「文件夹在前、请求在后」展示（此前为「请求在前」）。

## [0.2.10] - 2026-06-26

### 新增
- 环境（Environment）支持导入与导出 Postman 环境文件：单环境导出时可选择 ApiKit JSON 或 Postman 格式，导入时自动识别 Postman 环境文件（`_postman_variable_scope` 或 `name` + `values`）并转换为内部结构。

### 变更
- 应用默认主题改为亮色（无保存偏好时默认亮色，原为暗色），已手动切换的主题偏好仍保留。
- 环境变量编辑弹窗加宽（`90vw`）并优化输入框间距与高度，便于编辑较多变量。

## [0.2.9] - 2026-06-24

### 修复
- 修复 JSON 请求体编辑器中未加引号的 `{{变量}}`（如 `"id": {{$randomInt}}`）引发的两个问题：回车换行后缩进丢失，以及该变量之后的所有键名被错误地按字符串值着色（紫色键名变蓝色）。新增容错 JSON 编辑模式，将 `{{变量}}` 视为一个完整取值处理。
- 修复点击 Beautify 格式化时，未加引号的 `{{变量}}` 的花括号被 jsonc-parser 当作对象结构而展开错乱的问题；现在格式化会原样保留这类变量。

## [0.2.8] - 2026-06-24

### 新增
- Console 区域展开某条请求记录时，Request Body 与 Response Body 标签旁新增一键复制图标，点击即可将对应内容复制到剪贴板并弹出成功提示。

### 变更
- Console 区域 Request Body 与 Response Body 的显示区高度翻倍（`max-h-32` → `max-h-64`），一次可查看更多内容。

### 修复
- 修复 Console 响应/请求体过长时被截断到 1000 字符的问题，现在完整保留全部内容（同时影响普通请求与工作流执行两条记录路径）。

## [0.2.7] - 2026-06-17

### 新增
- 请求体 Beautify 改用 VS Code 同款 jsonc-parser 引擎，支持对不完整/不合法 JSON 的容错格式化：自动补全缺失的尾部括号、闭合未结束的字符串、去除尾随逗号，并转义字符串内的裸控制字符（真实换行/制表符）；对 `{"as":}`、`{"aa"}` 等结构也按 VS Code 规则重排。大整数（超过 2^53）按原文保留，不丢精度。

### 变更
- 移除新建请求 JSON 请求体中的占位示例 `{"key": "value"}`。

### 修复
- 修复 JSON 请求体编辑器失去焦点后（如点击 Beautify / 搜索 / 复制等工具栏按钮）`Ctrl+Z`、`Ctrl+Shift+Z`、`Ctrl+Y` 撤回/恢复失效的问题：在 Body 面板捕获快捷键并转发到编辑器。
- 修复 Beautify 等外部就地修改会清空撤回历史、导致无法撤回的问题（CodeMirror 5 改用 `replaceRange` 替代会重置历史的 `setValue`）。

## [0.2.6] - 2026-06-13

### 新增
- 内置 Header 自动补全下拉支持 上/下 方向键导航、回车选中、Esc 关闭。

### 变更
- 重构：将 HttpRequest 巨石组件拆分为 RequestBodyEditor / RequestTestsEditor / ResponseViewer / SaveRequestDialog 等子组件，并抽离 composables、常量与 API 工具方法（对外行为保持不变）。
- 增大 JSON Body `{{` 变量自动补全弹窗的可见高度，一次可查看更多候选项。
- 统一所有 `{{` 变量选择器（JSON 编辑器、输入框、内置 Header 下拉）的选中项为蓝色高对比强调色，并随明/暗主题自动协调。

### 修复
- 修复未保存编辑在应用重启后被错误持久化/丢失的问题。
- 修复 Linux（WebKitGTK）下 JSON `{{` 变量自动补全弹窗在首帧后落到 Response 区域下层、被遮挡的问题（改为将浮层渲染到 `document.body`）。
- 修复暗色主题下多处样式不生效的问题：内置 Header 下拉、form-data 文件选择器与类型下拉、复选框/单选框选中态、响应搜索开关按钮等。根因是 `:deep(.p-dark ...)` 写法使暗色规则编译为 `[data-v] .p-dark ...`、因 `.p-dark` 位于 `<html>` 祖先而永不匹配。
- 修复暗色主题下顶部编辑器页签边框过亮、与标题分割线颜色不一致的问题。

## [0.2.5] - 2026-06-12

### 新增
- 编辑器按 `Ctrl+F` 搜索时，自动以当前选中文本预填充并选中搜索框内容（CodeEditor / JsonEditor、响应区及 Body 搜索框）。

### 变更
- 切换 CodeMirror 编辑器主题：暗色模式采用 Dracula，亮色模式采用 GitHub Light。
- 调整编辑器与请求面板的默认字体大小。
- 移除无用依赖。

## [0.2.4] - 2026-06-11

### 修复
- 修复 Windows 系统下 Tab 页签无法拖拽的问题（禁用 WebView `dragDropEnabled`）。

## [0.2.3] - 2026-06-11

### 新增
- 支持 Tab 页签拖拽排序。

### 变更
- 更新 README，补充 Workflow 工作流编排、内置鉴权（Bearer/Basic）、Postman 集合导入/导出等已有能力的说明。
- 修正 README 中过时的内容：移除并不存在的 `Ctrl+Enter` 发送快捷键，将"暂不支持 Postman 导入"更正为已支持。

### 修复
- 修复 Long 类型数值的展示问题。

## [0.2.2] - 2026-06-02

### 变更
- Workflow 日志表格支持固定表头，查看较长执行日志时保留列标题。
- Workflow 执行时切换环境可实时生效，后续步骤使用最新环境变量。

### 修复
- 修复存在多个 Workflow 时，删除其中一个 Workflow 后右侧 tab 页签选中状态错位的问题。

## [0.2.1] - 2026-05-27

### 新增
- Tab 右键菜单及工具栏菜单新增 **Close All Saved Tabs**，一键关闭所有已保存的标签页，保留有未保存变更的标签页。

### 变更
- Workflow 新增 `do-while` 循环节点，执行日志展示优化。

### 修复
- 修复 JsonEditor 失去焦点后 `Ctrl+Z` / `Ctrl+Shift+Z` 撤销/重做失效的问题（改用 CodeMirror Compartment 动态更新扩展，不再销毁并重建编辑器实例，undo history 不再被清空）。
- 修复 CodeEditor 切换主题或语言时 undo history 被清空的同类问题。
- 修复 multipart 文件上传的流式传输问题。
- 修复 Workflow 执行稳定性问题。
- 修复 URL 中全局变量未被正确匹配替换的问题。
- 修复内置 Header 自动补全提示的样式异常。
- 修复 JSON 格式化时数字精度丢失的问题。

## [0.2.0] - 2026-05-18

### 新增
- 新增 Workflow 编排能力，支持组合已有 HTTP Request 和 Inline Request。
- Workflow 支持 `if`、`for`、`while` 控制节点，可按条件分支或循环执行步骤。
- Inline Request 复用完整 HttpRequest 编辑器能力，支持 Params、Auth、Headers、Body、Tests、变量提取和 Code 视图。
- 新增 Workflow 独立标签页、左侧 Workflows 列表、新建/重命名/删除、右键菜单和打开状态恢复。
- 新增每个 Workflow 独立执行日志，按执行顺序以表格展示时间、层级、类型、条件、实际值、结果、响应、断言和耗时。
- Workflow 日志支持点击 Request 行查看请求与响应详情，并用特殊背景区分 Workflow start/completed 记录。

### 变更
- Workflow 保存、暂存、恢复和关闭确认逻辑与 HttpRequest 保持一致。
- Workflow 顶部工具栏调整为标题独立行，添加步骤按钮靠左，Save/Run/Stop/Log 操作靠右。
- Workflow 列表选中态增强，提高当前选中项的背景、边框和文字区分度。
- Workflow 支持 `Ctrl+S` / `Cmd+S` 保存当前流程。
- Workflow 运行中只遮罩当前流程，切换到其他流程不受影响，切回仍可看到运行状态。

### 修复
- 修复新建 Workflow 后内容为空、重新打开应用后暂存内容未立即展示的问题。
- 修复 Workflow 删除后右侧内容未关闭、顶部新建 Workflow 只能创建一次的问题。
- 修复 Collections 请求变化后 Workflow 获取到旧请求数据的问题。
- 修复 if/for/while 内部无法继续追加子步骤的问题。
- 修复 Workflow completed 日志被显示为 Request 的问题。

## [0.1.0] - 2026-05-12

ApiKit 首个公开发布版本！一个现代化的跨平台 API 测试工具。

### 核心功能

#### HTTP 请求测试
- 支持所有常用 HTTP 方法（GET、POST、PUT、DELETE、PATCH、HEAD、OPTIONS）
- 灵活配置请求参数、Headers 和 Body
- 支持多种 Body 格式（JSON、Form Data、x-www-form-urlencoded、Raw、Binary）
- 清晰展示响应数据、Headers 和状态码，显示请求响应时间
- 支持文件上传（multipart/form-data）
- 支持请求取消（Cancel）

#### URL 与参数
- URL ↔ Params 表格双向实时同步
- 输入 URL 时自动添加 `http://` 前缀
- URL 自动编码选项

#### 文件下载
- 一键下载 API 响应文件，智能识别文件名和类型

#### 集合管理
- 创建和组织请求集合，使用文件夹分组管理
- 导入导出集合（JSON 格式）
- 拖拽排序、重命名、复制、删除请求和文件夹
- Move Up / Move Down 同目录排序

#### 环境变量
- 创建多个环境配置（开发、测试、生产等）
- 使用 `{{变量名}}` 语法在请求中引用变量，输入框实时高亮（已定义橙色、未定义红色）
- 快速切换环境；支持全局变量的查看、编辑和删除
- 环境列表支持复制和排序

#### 内置变量
- 日期时间变量：`$date`、`$time`、`$datetime`
- 随机字符串变量（中文、英文）
- 自定义 Sequence 序列变量

#### 请求历史
- 自动记录所有发送的请求，支持日期分组（Today 标签）
- 搜索、过滤历史记录；支持一键清空

#### 自动化测试
- 验证响应状态码、JSON 字段值、响应时间
- 断言全部通过后自动设置全局变量，可在其他请求中通过 `{{variableName}}` 引用
- Tests 配置随请求持久化保存

#### 导入功能
- 从 cURL 命令导入请求（支持单引号/双引号/无引号 JSON body，支持嵌套对象）
- 导出 cURL 命令时自动替换环境变量和全局变量

#### 应用内更新
- 自动检查新版本，查看更新内容，一键下载并安装更新

### 用户界面
- 现代化暗色主题，简洁直观的操作界面
- Response 区域：内容搜索、一键复制、`Ctrl+A` 全选
- Response 加载遮罩，Tab 页签未保存状态橙色圆点指示
- `Ctrl+S` 保存请求，`Ctrl+N` 新建请求，`Ctrl+Z` / `Ctrl+Shift+Z` 撤销/重做
- Collections 键盘快捷键；窗口启动时自动最大化
- JSON Body 编辑器：`{{变量名}}` 实时高亮，变量自动补全（输入 `{{` 触发），内置变量参数说明面板

### 数据存储（本地文件系统，无服务端）
- Linux：`~/.local/share/ApiKit`
- macOS：`~/Library/Application Support/ApiKit`
- Windows：`%APPDATA%\ApiKit`

### 跨平台支持
- Windows（安装包和便携版）
- macOS（DMG 安装包）
- Linux（DEB、RPM、AppImage 和便携版）

---

[Unreleased]: https://github.com/duwei0227/apikit/compare/v0.2.16...HEAD
[0.2.16]: https://github.com/duwei0227/apikit/compare/v0.2.15...v0.2.16
[0.2.15]: https://github.com/duwei0227/apikit/compare/v0.2.14...v0.2.15
[0.2.14]: https://github.com/duwei0227/apikit/compare/v0.2.13...v0.2.14
[0.2.13]: https://github.com/duwei0227/apikit/compare/v0.2.12...v0.2.13
[0.2.12]: https://github.com/duwei0227/apikit/compare/v0.2.11...v0.2.12
[0.2.11]: https://github.com/duwei0227/apikit/compare/v0.2.10...v0.2.11
[0.2.10]: https://github.com/duwei0227/apikit/compare/v0.2.9...v0.2.10
[0.2.9]: https://github.com/duwei0227/apikit/compare/v0.2.8...v0.2.9
[0.2.8]: https://github.com/duwei0227/apikit/compare/v0.2.7...v0.2.8
[0.2.7]: https://github.com/duwei0227/apikit/compare/v0.2.6...v0.2.7
[0.2.6]: https://github.com/duwei0227/apikit/compare/v0.2.5...v0.2.6
[0.2.5]: https://github.com/duwei0227/apikit/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/duwei0227/apikit/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/duwei0227/apikit/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/duwei0227/apikit/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/duwei0227/apikit/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/duwei0227/apikit/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/duwei0227/apikit/releases/tag/v0.1.0
