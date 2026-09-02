# ApiKit

<div align="center">

一个现代化、轻量级的 API 测试工具

![GitHub release](https://img.shields.io/github/v/release/duwei0227/apikit)
![GitHub License](https://img.shields.io/github/license/duwei0227/apikit)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)

[下载](#下载安装) • [功能特性](#功能特性) • [使用指南](#使用指南) • [更新日志](CHANGELOG.md)

</div>


## 简介

ApiKit 是一个跨平台的 API 测试工具，专为开发者设计，提供简洁直观的界面和强大的功能。无论是日常接口调试还是自动化测试，ApiKit 都能满足你的需求。

### 为什么选择 ApiKit？

- 🚀 **快速启动** - 轻量级设计，秒速启动，低内存占用
- 💻 **跨平台** - 支持 Windows、macOS 和 Linux
- 🎨 **现代界面** - 简洁美观，支持深色 / 浅色主题切换
- 🔗 **工作流编排** - 串联多个请求，支持条件分支与循环
- 📦 **便携版本** - 提供免安装版本，解压即用
- 🔄 **自动更新** - 应用内一键更新，无需重新下载
- 🆓 **完全免费** - 开源软件，永久免费使用

## 功能特性

### 核心功能

#### 🌐 HTTP 请求测试
- 支持所有常用 HTTP 方法（GET、POST、PUT、DELETE、PATCH、HEAD、OPTIONS）
- 灵活配置请求参数（Params）、Headers 和 Body
- 支持多种 Body 格式（JSON、Form Data、x-www-form-urlencoded、Raw、Binary）
- 内置鉴权配置（No Auth、Bearer Token、Basic Auth）
- 支持文件上传（multipart/form-data，流式传输）
- 清晰展示响应数据、Headers 和状态码
- 显示请求响应时间

#### 🔗 工作流编排（Workflow）
- 串联多个请求，将已保存的 HTTP Request 与 Inline Request 组合成自动化流程
- 支持 `if` 条件分支与 `for`、`while`、`do-while`、`until` 循环控制节点
- Inline Request 复用完整请求编辑器能力（Params、Auth、Headers、Body、Tests、变量提取、Code 视图）
- 每个 Workflow 拥有独立标签页与执行日志，按执行顺序展示时间、层级、类型、条件、结果、响应与耗时
- 执行中切换环境实时生效，后续步骤自动使用最新环境变量

#### 📥 文件下载
- 一键下载 API 响应文件
- 智能识别文件名和类型
- 支持 50+ 种常见文件格式

#### 📁 集合管理
- 创建和组织请求集合
- 使用文件夹分组管理请求
- 导入导出集合（ApiKit JSON 与 Postman Collection v2.1 格式）
- 拖拽排序请求

#### 🌍 环境变量
- 创建多个环境配置（开发、测试、生产等）
- 使用 `{{变量名}}` 语法在请求中引用变量
- 快速切换环境
- 支持全局变量

#### 📝 请求历史
- 自动记录所有发送的请求
- 搜索和过滤历史记录
- 从历史快速恢复请求
- 清理历史记录

#### 🧪 自动化测试
- 验证响应状态码
- 检查 JSON 字段值
- 测试响应时间
- 提取响应数据到变量
- 查看测试结果

#### 📋 导入功能
- 从 cURL 命令导入请求，自动解析 URL、Headers 和 Body
- 导入 Postman Collection（v2.1）集合

#### 🔄 应用内更新
- 自动检查新版本
- 查看更新内容
- 一键下载并安装更新

## 下载安装

访问 [Releases](https://github.com/duwei0227/apikit/releases/latest) 页面下载最新版本。

### Windows

| 安装包类型 | 说明 | 推荐 |
|----------|------|------|
| `.msi` | Windows 安装程序 | ⭐ 推荐 |
| `.exe` | NSIS 安装程序 | |
| `.zip` | 便携版（解压即用） | 适合 U 盘使用 |

### macOS

| 安装包类型 | 说明 | 推荐 |
|----------|------|------|
| `.dmg` | macOS 磁盘映像 | ⭐ 推荐 |

**注意**: macOS 用户首次打开可能需要在"系统偏好设置 → 安全性与隐私"中允许运行。

### Linux

| 安装包类型 | 说明 | 推荐 |
|----------|------|------|
| `.AppImage` | 便携版（无需安装） | ⭐ 推荐 |
| `.deb` | Debian/Ubuntu 安装包 | |
| `.rpm` | Fedora/RHEL/CentOS 安装包 | |
| `.tar.gz` | 便携版（解压即用） | |

**AppImage 使用方法**:
```bash
chmod +x ApiKit_*.AppImage
./ApiKit_*.AppImage
```

**便携版使用方法**:
```bash
tar -xzf ApiKit_*.tar.gz
cd ApiKit
./install-desktop.sh  # 可选：创建桌面快捷方式
./apikit.sh
```

## 使用指南

### 快速开始

#### 1. 发送第一个请求

1. 启动 ApiKit
2. 点击工具栏的 **New Request** 按钮（或按 `Ctrl+N`）
3. 选择 HTTP 方法（如 GET）
4. 输入 URL（如 `https://api.github.com/users/github`）
5. 点击 **Send** 按钮
6. 查看响应结果

#### 2. 保存请求到集合

1. 发送请求后，点击 **Save** 按钮
2. 选择或创建一个集合
3. 输入请求名称
4. 点击保存

#### 3. 使用环境变量

1. 点击右上角的环境选择器
2. 点击 **Manage Environments**
3. 创建新环境（如"开发环境"）
4. 添加变量：
   - 名称：`baseUrl`
   - 值：`https://api.example.com`
5. 在请求中使用：`{{baseUrl}}/users`
6. 切换环境即可切换不同的 API 地址

### 高级功能

#### 自动化测试

在请求的 **Tests** 标签页中配置测试规则：

**验证状态码**：选择运算符（equals / not equals / greater than 等），填入期望值（如 `200`）

**验证 JSON 字段**：填写 JSONPath（如 `$.data.name`），选择运算符，填入期望值

**提取数据到变量**：填写变量名与 JSONPath，请求成功后自动写入环境变量

#### 文件下载

1. 发送会返回文件的请求
2. 点击 **Send And Download** 按钮（下拉菜单）
3. 选择保存位置
4. 文件会自动下载并保存

#### 导入 cURL 命令

1. 复制 cURL 命令
2. 点击工具栏 **Import** 按钮
3. 选择 **cURL** 类型
4. 粘贴命令，点击 **Import**

### 快捷键

| 快捷键 | 功能 | 作用范围 |
|--------|------|---------|
| `Ctrl+N` | 新建请求 / 集合 / 环境 | 全局 |
| `Ctrl+S` | 保存当前请求 / 工作流 | 请求 / 工作流编辑器 |
| `Ctrl+D` | 复制选中项（文件夹 / 请求） | 集合面板 |
| `Ctrl+Z` | 撤销 | 输入框 / JSON 编辑器 |
| `Ctrl+Shift+Z` | 重做 | 输入框 / JSON 编辑器 |
| `Ctrl+Shift+D` | 切换深色 / 浅色主题 | 全局 |
| `Ctrl+/` | 显示快捷键列表 | 全局 |
| `Delete` | 删除选中项 | 集合面板 |

## 常见问题

### 如何更新应用？

点击菜单栏 **Help** → **Check for Updates**，如有新版本会自动提示下载安装。

### 数据存储在哪里？

所有数据（集合、环境、历史）都存储在本地文件系统：
- Windows: `%APPDATA%\ApiKit`
- macOS: `~/Library/Application Support/ApiKit`
- Linux: `~/.local/share/ApiKit`

### 如何备份数据？

1. 导出所有集合（**Collections** → **Export**）
2. 保存环境配置（**Environments** → **Export**）
3. 或直接备份上述数据目录

### 支持导入 Postman 集合吗？

支持。在 **Collections** 面板导入时可直接选择 Postman Collection（v2.1）文件，导出时也可选择 Postman 格式，方便与 Postman 互通。

## 反馈与支持

### 问题反馈

如果遇到问题或有功能建议，请访问：
- [GitHub Issues](https://github.com/duwei0227/apikit/issues) - 报告 Bug
- [GitHub Discussions](https://github.com/duwei0227/apikit/discussions) - 功能建议和讨论

### 贡献代码

欢迎提交 Pull Request！请查看 [贡献指南](CONTRIBUTING.md)（如有）。

## 许可证

本项目采用 [MIT 许可证](LICENSE)。

## 相关链接

- [GitHub 仓库](https://github.com/duwei0227/apikit)
- [发布页面](https://github.com/duwei0227/apikit/releases)
- [更新日志](CHANGELOG.md)

## 致谢

ApiKit 的开发离不开以下优秀的开源项目：

- [Tauri](https://tauri.app/) - 跨平台桌面应用框架
- [Vue.js](https://vuejs.org/) - 渐进式 JavaScript 框架
- [PrimeVue](https://primevue.org/) - Vue UI 组件库
- [CodeMirror](https://codemirror.net/) - 代码编辑器组件
- [Vite](https://vitejs.dev/) - 下一代前端构建工具

---

<div align="center">

**如果觉得 ApiKit 有用，请给个 ⭐ Star 支持一下！**

Made with ❤️ by [@duwei0227](https://github.com/duwei0227)

</div>
