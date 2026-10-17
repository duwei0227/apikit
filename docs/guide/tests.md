# 测试与断言

在请求的 **Tests** 标签页中设置断言和变量提取。每次发送后自动执行，结果显示在响应区的 **Test Results** 中；在工作流中，断言失败会让工作流停止。

新请求默认带一条断言：状态码 equals `200`。

![Tests 标签页](/screenshots/tests.png)

## 状态码断言（Status Code Assertions）

选择运算符并填写期望的状态码，例如 equals `201`、greater than `199`、less than `300`。期望值可以使用变量，例如 `{{expectedStatus}}`。

## JSON 字段断言（JSON Field Assertions）

填写 JSON 路径、运算符和期望值，例如 `$.data.id` exists、`$.status` equals `paid`。

**JSON 路径**写法：

| 写法 | 含义 |
|------|------|
| `$` | 整个响应 |
| `$.data.name` | 对象属性，`$.` 可以省略，写成 `data.name` 也可以 |
| `$.items[0].id` | 数组下标，从 0 开始 |

只支持以上简单写法，不支持通配符（`*`）、过滤表达式和负数下标。

## 运算符

| 运算符 | 说明 |
|--------|------|
| Equals / Not equals | 按文本比较；对象和数组按 JSON 文本比较，例如 `["a","b"]` |
| Contains / Not contains | 是否包含期望的文本 |
| Exists / Not exists | 字段是否存在；值为 `null` 视为不存在。不需要期望值 |
| Greater than / Less than / Greater/equal / Less/equal | 按数字比较 |

期望值中的 `{{变量}}` 会先替换再比较，例如 `$.id` equals `{{orderId}}`；未定义的变量按原样比较。

## 提取变量（Global Variable Settings）

把响应中的值保存为全局变量，供后续请求和工作流使用：

| 类型 | 值 | 示例 |
|------|----|------|
| **JSON Path** | 响应 JSON 中的路径 | `$.data.token` |
| **Response Header** | 响应头名称，不区分大小写 | `x-session` |
| **Custom Value** | 固定值，可以使用变量 | `order-{{orderId}}` |

- 所有断言都通过后才写入；有断言失败时跳过，结果中标为 Skipped。
- 取不到值时（例如路径不存在、没有该响应头），结果中标为 Failed，变量保持原值。
- 对象和数组保存为 JSON 文本。

## 查看结果

![测试结果](/screenshots/test-results.png)

**Test Results** 列出每条断言的类型、期望值、运算符、实际值和是否通过，以及每个变量的提取结果。失败的说明形如 `Status code: expected 201, got 422`、`$.status: expected paid, got pending`。

流式响应（SSE、逐行 JSON）的 JSON 字段断言和变量提取读取合并后的结果对象，见[响应](./responses#流式响应)。
