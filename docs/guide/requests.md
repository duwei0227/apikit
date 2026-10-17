# 发送请求

点击 **New Request**（或按 `Ctrl+N`）新建请求。每个打开的请求在自己的标签页中编辑，未保存的修改在标签上显示圆点，点击 **Save**（或按 `Ctrl+S`）保存。

![请求编辑器](/screenshots/request.png)

## 方法和 URL

在方法下拉框中选择 GET、POST、PUT、DELETE、PATCH、HEAD 或 OPTIONS，在旁边输入 URL。URL 中的查询参数和 **Params** 标签页互相同步：在 URL 里改参数，Params 随之更新；在 Params 里改，URL 也会更新。

URL、参数、请求头、请求体和鉴权中都可以使用 `{{变量}}`，见[变量](./variables)。

## 请求头（Headers）

每行一个请求头，勾选框控制是否发送。请求体类型会自动设置 `Content-Type`，在 Headers 中手动填写的 `Content-Type` 优先。
点击表格右侧的 **Bulk Edit** 可切换到文本批量编辑，每行填写 `key: value`；点击 **Key-Value Edit** 返回表格。Params、form-data 和 x-www-form-urlencoded 也支持此模式。form-data 的 File 字段在批量文本中隐藏，并在切回表格时保留。

## 请求体（Body）

| 类型 | 说明 |
|------|------|
| none | 不发送请求体 |
| form-data | `multipart/form-data`，每行可选 Text 或 File；文件以流的方式上传 |
| x-www-form-urlencoded | 表单键值对 |
| json | JSON 编辑器，**Beautify** 格式化 |
| xml | XML 编辑器，自动闭合标签 |
| text | 纯文本 |
| binary | 选择一个文件作为请求体 |

请求体编辑器基于 Ace：

- 输入 `{{` 时补全变量；已定义和未定义的变量颜色不同，悬停显示值。
- `Ctrl+F` 搜索，可区分大小写（**Aa**）和使用正则表达式（**.\***）。
- 自动补全括号和引号，支持 Ace 的常用快捷键，例如 `Ctrl+/` 切换注释、`Alt+↑/↓` 移动行，见[参考](./reference#快捷键)。
- 大整数保持原值，不会因为 JavaScript 精度而改变。

## 鉴权（Authorization）

| 类型 | 说明 |
|------|------|
| No Auth | 不添加鉴权 |
| Bearer Token | 发送 `Authorization: Bearer <token>`，Token 可以写 `{{token}}` |
| Basic Auth | 用户名和密码，发送 `Authorization: Basic …` |

## 设置（Settings）

| 设置 | 默认 | 说明 |
|------|------|------|
| Automatically follow redirects | 开 | 自动跟随 3xx 重定向 |
| Max redirects | 10 | 最多跟随的重定向次数（1–50） |
| Enable SSL certificate verification | 开 | 关闭后接受自签名或无效的证书 |
| Encode URL automatically | 开 | 发送时自动编码 URL 中的特殊字符 |
| Accept-Encoding: gzip, deflate, br | 开 | 发送压缩编码请求头，响应自动解压 |

## 代码（Code）

**Code** 标签页显示当前请求对应的 cURL 命令（变量已替换，`$sequence` 只预览不推进），点击 **Copy** 复制。在 **Paste cURL Command** 中粘贴一条 cURL 命令并点击 **Import**，可以用它的内容填充当前请求。

## 发送

点击 **Send** 发送，发送中可以点击 **Stop** 取消。**Send** 旁的下拉菜单中有 **Send And Download**：把响应保存为文件，根据响应头识别文件名和类型。

响应的查看方式见[响应](./responses)，断言和变量提取见[测试与断言](./tests)。
