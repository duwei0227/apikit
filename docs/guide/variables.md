# 变量

在 URL、Params、Headers、Body 和鉴权中用 `{{name}}` 引用变量，发送时替换为变量的值。输入 `{{` 时会列出可用的变量；请求体编辑器中，已定义和未定义的变量用不同颜色显示，鼠标悬停可以看到值。

## 变量的种类和优先级

| 种类 | 在哪里设置 | 作用范围 |
|------|-----------|---------|
| 内置动态变量 | 无需设置，名称以 `$` 开头 | 所有请求 |
| 环境变量 | 环境选择器旁的齿轮图标 **Manage Environments** | 选中该环境时 |
| 全局变量 | 测试中的 **Global Variable Settings**、工作流的 **Set Variables** 步骤，或 AI | 所有环境 |

同名时的优先级：内置动态变量 > 当前环境的变量 > 全局变量。

点击环境选择器旁的眼睛图标 **View Variables**，可以查看当前请求用到的环境变量和全局变量，并修改或删除全局变量。

未定义的变量按原样发送，例如 URL 中仍是 `{{token}}`；可以在 Console 中查看实际发出的请求。AI 通过 MCP 发送请求时，结果中会列出这些未解析的变量。

## 内置动态变量

每次出现都单独生成，例如同一个请求中的两个 `{{$guid}}` 是两个不同的值。

| 变量 | 说明 | 示例 |
|------|------|------|
| `$timestamp` | 当前时间戳（毫秒） | `{{$timestamp}}` |
| `$isoTimestamp` | 当前时间（ISO 8601） | `{{$isoTimestamp}}` |
| `$guid` | 随机 UUID | `{{$guid}}` |
| `$randomInt` | 随机整数，包含两端，默认 0–1000 | `{{$randomInt(1, 100)}}`、`{{$randomInt(min=1, max=100)}}` |
| `$date` | 当前日期，默认格式 `yyyyMMdd` | `{{$date("yyyy-MM-dd")}}`、`{{$date(format="dd/MM/yyyy")}}` |
| `$time` | 当前时间，默认格式 `HHmmss` | `{{$time("HH:mm")}}` |
| `$datetime` | 当前日期时间，默认格式 `yyyyMMddHHmmss` | `{{$datetime("yyyy-MM-dd HH:mm:ss")}}` |
| `$randomAlpha` | 随机字母（大小写），默认 10 位 | `{{$randomAlpha(8)}}` |
| `$randomNumeric` | 随机数字，默认 10 位 | `{{$randomNumeric(6)}}` |
| `$randomUppercase` | 随机大写字母，默认 10 位 | `{{$randomUppercase(length=4)}}` |
| `$randomLowercase` | 随机小写字母，默认 10 位 | `{{$randomLowercase(len=4)}}` |
| `$randomAlphanumeric` | 随机字母和数字，默认 10 位 | `{{$randomAlphanumeric(16)}}` |
| `$randomChinese` | 由常用词组成的随机中文，默认 10 个字 | `{{$randomChinese(20)}}` |
| `$sequence` | 自增序列，见下文 | `{{$sequence(name=order, start=1000)}}` |
| `$loopIndex` | 工作流循环中当前是第几次（从 1 开始），只在工作流循环中有效 | `?page={{$loopIndex}}` |

日期格式中 `yyyy`、`MM`、`dd`、`HH`、`mm`、`ss` 分别表示年、月、日、时、分、秒。参数可以按位置写，也可以写成 `名称=值`；长度参数可写 `length` 或 `len`，日期格式可写 `format` 或 `fmt`，`$randomInt` 的范围可写 `start`/`end` 或 `min`/`max`。在补全列表中可以看到每个变量的用法，输入参数时会显示参数说明。

### 自增序列 `$sequence`

每次出现都取下一个值并按步长递增（同一个请求中出现两次会取两个连续的值），值保存在本机，重启后继续。

| 写法 | 说明 |
|------|------|
| `{{$sequence}}` | 名为 `default` 的序列，从 1 开始，每次加 1 |
| `{{$sequence(100)}}` | 从 100 开始 |
| `{{$sequence(order, 5, 1000, 10)}}` | 序列 `order`，补零到 5 位，从 1000 开始，每次加 10 |
| `{{$sequence(name=order, padding=5, start=1000, step=10)}}` | 同上，命名参数 |

起始值和步长只在序列第一次使用时生效；之后沿用序列自己的设置。点击环境选择器旁的 **Manage Sequences** 可以查看和修改每个序列的当前值、步长和补零位数。生成代码（Code 视图）只预览下一个值，不会推进序列。

## 从响应中提取变量

在请求的 **Tests → Global Variable Settings** 中添加一行：

| 类型 | 值 | 示例 |
|------|----|------|
| **JSON Path** | 响应 JSON 中的路径 | `$.data.token` |
| **Response Header** | 响应头名称，不区分大小写 | `x-session` |
| **Custom Value** | 固定值，可以使用变量 | `order-{{orderId}}` |

请求的所有断言都通过后才写入全局变量；有断言失败时跳过，测试结果中会说明。之后的请求用 `{{变量名}}` 引用。

## 在断言和条件中使用变量

断言的期望值、工作流条件的期望值都可以使用变量，例如 JSON 路径 `$.id` equals `{{orderId}}`，用来校验前一个请求返回的数据。未定义的变量按原样比较。测试结果和日志中显示替换后的值。
