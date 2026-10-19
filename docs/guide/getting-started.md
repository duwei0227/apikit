# 快速开始

## 安装

在 [Releases](https://github.com/duwei0227/apikit/releases/latest) 页面下载对应系统的安装包：

| 系统 | 推荐 | 其他 |
|------|------|------|
| Windows | `.msi` 安装程序 | `.exe`（NSIS 安装程序）、`.zip`（便携版） |
| macOS | `.dmg` | |
| Linux | `.AppImage`（`chmod +x` 后直接运行） | `.deb`、`.rpm`、`.tar.gz`（便携版） |

macOS 首次打开时，可能需要在"系统设置 → 隐私与安全性"中允许运行。安装后可以在 **Help → Check For Update** 中检查并安装新版本。

## 发送第一个请求

1. 点击 **New Request**（或按 `Ctrl+N`）。
2. 选择方法，例如 `GET`，输入 URL，例如 `https://api.github.com/users/github`。
3. 点击 **Send**，在下方查看响应体、响应头、状态码、耗时和大小。

URL 中的查询参数会同步到 **Params**，在 **Headers**、**Body**、**Authorization** 中可以设置请求头、请求体和鉴权。

![请求编辑器和响应](/screenshots/request.png)

## 保存到集合

1. 点击 **Save**。
2. 选择集合和文件夹，或点击 **New Collection** 新建集合，填写请求名称后保存。下次保存新请求时默认选中上次的位置。

保存后的请求出现在侧边栏 **Collections** 中，可以拖拽排序、复制（`Ctrl+D`）和移动。

## 使用环境和变量

1. 点击右上角环境选择器旁的齿轮图标（**Manage Environments**），新建环境，例如"开发"。
2. 添加变量 `baseUrl` = `https://api.example.com`。
3. 在请求中写 `{{baseUrl}}/users`，切换环境即可切换接口地址。

变量的更多用法（全局变量、内置动态变量、从响应中提取变量）见[变量](./variables)。

## 测试响应

在请求的 **Tests** 标签页中添加断言：

- **Status Code Assertions**：例如状态码 equals `200`。
- **JSON Field Assertions**：例如 JSON 路径 `$.data.id` exists。
- **Global Variable Settings**：把响应中的值保存为全局变量，例如把 `$.data.token` 保存为 `token`，后续请求用 `{{token}}` 引用。

发送后在响应区的 **Test Results** 中查看结果；失败时显示期望值和实际值，例如 `Status code: expected 201, got 422`。

## 下一步

- 请求的全部设置：[发送请求](./requests)、[测试与断言](./tests)、[响应](./responses)
- 整理请求，从 Postman、OpenAPI 或 cURL 导入：[集合](./collections)、[导入导出](./import-export)
- 把多个请求串成自动化流程：[工作流](./workflow)
- 接口还没完成时让前端先调用：[Mock 服务](./mock)
- 让 AI 帮你建请求、写工作流、排查失败：[AI 集成（MCP）](./ai)
