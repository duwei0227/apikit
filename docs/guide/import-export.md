# 导入导出

## 导入

点击顶部工具栏的 **Import**，或在集合上右键选择 **Import**。导入类型有两种：

### 文件

选择一个文件，ApiKit 自动识别格式并显示预览，勾选要导入的内容后点击 **Import**：

| 格式 | 说明 |
|------|------|
| ApiKit JSON | ApiKit 导出的集合和工作流 |
| Postman Collection v2.1 | Postman 导出的集合（JSON） |
| OpenAPI 3.x / Swagger 2.0 | JSON 或 YAML 文档 |

- 名称和已有的集合或工作流重复时，自动改名，预览中会显示导入后的名称。
- 预览中会列出导入时的警告。

**OpenAPI / Swagger 文档**的导入方式：

- 每个文档导入为一个集合，按 tag 分文件夹。
- 请求 URL 使用 `{{baseUrl}}` 变量；可以勾选同时创建一个环境，`baseUrl` 取自文档中的服务器地址（文档中没有时为空，需要自己填写）。
- 请求参数、请求头、请求体和示例会尽量还原；只解析文档内部的 `$ref`。
- 以下内容不会导入，并在预览中提示：外部文件中的 `$ref`、OAuth2 / OpenID Connect 鉴权、Cookie 参数和 Cookie 方式的 API Key、TRACE 方法、不支持的请求体类型。

### cURL

粘贴一条 cURL 命令，导入为一个新请求，在新标签页中打开。能识别方法、URL 和查询参数、请求头、请求体（`-d`、`--data-*`、`-F` 等）、Basic 和 Bearer 鉴权，以及 `-k`、`-L`、`--compressed` 等设置；不支持的选项会被忽略并提示。

在请求的 **Code** 标签页中也可以粘贴 cURL 命令，用它的内容填充当前请求。

## 导出

点击顶部工具栏的 **Export**，或在集合上右键选择 **Export**。勾选要导出的集合和工作流，选择格式：

| 格式 | 说明 |
|------|------|
| ApiKit JSON | 包含集合和工作流，可以在另一台电脑上的 ApiKit 中完整导入 |
| Postman | Postman Collection v2.1，只包含集合 |

导出工作流时，如果它引用的请求不在一起导出的集合中，该步骤会转成内联请求（保留步骤中的定制），导入后仍能运行。

ApiKit JSON 会记录工作流在侧边栏中所在的文件夹，导入时放回同名文件夹（没有时新建）。导入和导出列表中会显示工作流所在的文件夹。

## 环境

在 **Manage Environments** 中：

- **Import**：导入 ApiKit JSON 或 Postman 的环境文件。
- **Export**：选择要导出的环境，格式为 ApiKit JSON 或 Postman。多个环境导出为 ApiKit JSON 时保存为一个文件；导出为 Postman 时，每个环境保存为一个 `.postman_environment.json` 文件，需要选择保存的文件夹。

全局变量不随环境导出。
