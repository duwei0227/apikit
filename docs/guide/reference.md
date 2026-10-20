# 参考

## 快捷键

macOS 上把 `Ctrl` 换成 `Cmd`，`Alt` 即 `Option`。按 `F1` 可以在应用中查看完整列表。

**全局**

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+N` | 新建请求 / 集合 / 环境（取决于当前所在的位置） |
| `Ctrl+S` | 保存当前请求或工作流 |
| `Ctrl+Alt+D` | 切换深色 / 浅色主题（macOS 上为 `Control+Option+D`） |
| `F1` | 显示快捷键列表 |
| `Esc` | 关闭浮层或补全列表 |

**集合树（选中项）**

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+D` | 复制 |
| `Delete` | 删除 |

**请求体编辑器**

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+F` | 搜索 |
| `Ctrl+Z` / `Ctrl+Shift+Z`、`Ctrl+Y` | 撤销 / 重做 |
| `Ctrl+/` | 切换行注释 |
| `Ctrl+D` | 删除行 |
| `Ctrl+Shift+D` | 复制行或选中内容 |
| `Alt+↑` / `Alt+↓` | 上移 / 下移行 |
| `Alt+Shift+↑` / `Alt+Shift+↓` | 向上 / 向下复制行（macOS 上为 `Cmd+Option+↑/↓`） |
| `Tab` / `Shift+Tab` | 缩进 / 取消缩进 |
| `Ctrl+Alt+↑` / `Ctrl+Alt+↓` | 在上方 / 下方添加光标 |
| `Alt+L` / `Alt+Shift+L` | 折叠 / 展开（macOS 上为 `Cmd+Option+L` / `Cmd+Option+Shift+L`） |
| `Ctrl+U` / `Ctrl+Shift+U` | 转为大写 / 小写 |

**输入框**：`Ctrl+Z` / `Ctrl+Shift+Z`、`Ctrl+Y` 撤销 / 重做。

**响应**：`Ctrl+F` 搜索，`Ctrl+A` 全选。

大写锁定或非英文键盘布局下，快捷键同样有效。

## 数据存储

所有数据保存在本机，不会上传：

| 系统 | 位置 |
|------|------|
| Windows | `%APPDATA%\cn.probiecoder.apikit` |
| macOS | `~/Library/Application Support/cn.probiecoder.apikit` |
| Linux | `~/.local/share/cn.probiecoder.apikit` |

目录中 `collections`、`requests`、`workflows`、`environments`、`history`、`mocks` 分别保存集合、请求、工作流、环境、历史和 Mock 服务。

### 备份和迁移

- 导出集合和工作流（ApiKit JSON），以及导出环境，见[导入导出](./import-export)。
- 或者在关闭 ApiKit 后直接复制上面的数据目录。

### 卸载时的数据（Windows）

卸载时总是删除 `%LOCALAPPDATA%\cn.probiecoder.apikit`，其中是界面缓存和主题、MCP 设置。上面的数据目录默认保留；卸载确认页有一个选项，默认不勾选：

- **同时删除我的集合、工作流、环境、Mock 和历史记录（无法恢复）**：删除上面的数据目录。

安装新版本时选择“安装前卸载”，不显示这个选项，缓存、设置和数据目录都会保留。

卸载时运行的是已安装版本的卸载程序，所以以上行为只适用于从 0.5.1 之后的版本卸载或升级。0.4.2 到 0.5.1 的卸载程序还有一个“删除应用缓存和界面设置”选项；更早版本的卸载程序只有一个“删除应用程序数据”选项，勾选后会删除数据目录。

## 更新

点击 **Help → Check For Update** 检查新版本。有新版本时标题栏会提示，可以查看更新内容并一键下载安装，完成后重启 ApiKit。

## 常见问题

### macOS 提示无法打开

首次打开时，在"系统设置 → 隐私与安全性"中允许运行 ApiKit。

### 请求中的变量没有被替换

确认变量已定义且拼写一致：环境变量只在选中该环境时生效；鼠标悬停在请求体中的变量上可以看到它的值，点击环境选择器旁的 **View Variables** 可以查看当前可用的变量。见[变量](./variables)。

### 访问使用自签名证书的接口

在请求的 **Settings** 中关闭 **Enable SSL certificate verification**。

### AI 工具连接不上 MCP 服务

确认 ApiKit 已打开，MCP 对话框中服务状态为 Running，AI 工具中的 URL、端口和 token 与对话框中一致。重新生成 token 后需要更新 AI 工具的配置。见 [AI 集成](./ai)。

### 前端页面调用 Mock 服务时报跨域错误

在 Mock 服务的设置中打开 **Allow calls from browser pages (CORS)**。见 [Mock 服务](./mock)。
