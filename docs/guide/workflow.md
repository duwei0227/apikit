# 工作流（Workflow）

工作流把多个请求串成一个自动化流程：按顺序执行请求，根据响应选择分支、循环轮询，并在请求之间传递数据。

## 创建和编辑

1. 在侧边栏 **Workflows** 中点击 **New Workflow**，工作流在新标签页中打开。
2. 用工具栏按钮添加步骤，循环和条件内部也有同样的按钮，用来添加嵌套的步骤。
3. 点击 **Save**（或按 `Ctrl+S`）保存。

每个步骤卡片左侧可以拖拽排序、折叠，勾选框用来启用或停用步骤（停用的步骤运行时跳过）；右侧可以上移、下移和删除。

![工作流编辑器](/screenshots/workflow.png)

## 用文件夹整理

工作流较多时，可以在侧边栏 **Workflows** 中用文件夹分组，文件夹可以多级嵌套。

- 点击 **New Workflow** 右侧的文件夹按钮（**New Folder**）在根目录新建文件夹；右键文件夹选择 **New Folder** 新建子文件夹。新文件夹排在同层其他文件夹之后、工作流之前。
- 在文件夹中新建工作流：点击文件夹行上的 **+**（**New Workflow in Folder**），或右键文件夹选择 **New Workflow**。
- 点击文件夹展开或折叠。右键文件夹或工作流可以 **Rename** 和 **Delete**；删除文件夹会同时删除其中（含子文件夹）的全部工作流。
- 右键工作流或文件夹选择 **Move Up** / **Move Down** 在同一层中上移、下移；右键工作流选择 **Move to...** 移到其他文件夹或根目录（**Workflows**），放在末尾。搜索时不显示这些选项。
- 拖动工作流或文件夹可以调整顺序：拖到文件夹中间放进文件夹，拖到行的上下边缘放在它的前面或后面。搜索时不能拖动。
- 页签右键 **Duplicate Tab** 复制的工作流放在原工作流后面（同一文件夹中）。
- 同一位置的文件夹不能重名；工作流名称在全部工作流中不能重复。
- 搜索时显示名称匹配的工作流和文件夹，以及它们所在的文件夹。

![用文件夹整理工作流](/screenshots/workflow-folders.png)

## 步骤类型

| 步骤 | 作用 |
|------|------|
| **Existing Request** | 运行集合中已保存的请求。选择请求后，步骤名称默认改为请求名称 |
| **Inline Request** | 只属于这个工作流的请求，点击 **Edit Inline Request** 用完整的请求编辑器编辑 |
| **If** | 条件满足时执行 Then 中的步骤，否则执行 Else 中的步骤 |
| **For** | 重复固定次数 |
| **While** | 每次循环**之前**检查条件，满足时继续 |
| **Do While** | 先执行一次，每次循环**之后**检查条件，满足时继续 |
| **Until** | 先执行一次，每次循环**之后**检查条件，满足时停止 |
| **Set Variables** | 设置全局变量 |

### 引用已保存的请求

Existing Request 步骤默认使用请求的全部设置；请求有未保存的修改时，运行时使用修改后的内容。点击 **Customize Request** 可以只在这个步骤中改动部分设置（例如 URL、请求头、请求体或测试），未改动的部分继续沿用原请求；步骤上会显示 **Customized (n)**，在对话框中可以 **Reset All**。

请求从集合中删除后，步骤会提示 "Referenced request was removed from Collections."，需要重新选择。

## 条件

If、While、Do While、Until 步骤都有条件。每个条件由取值来源、字段、运算符和期望值组成：

| 来源 | 字段 | 说明 |
|------|------|------|
| **Last response** | Status / JSON path / Header / Body | 最近一个请求步骤的响应 |
| **Step response** | Status / JSON path / Header / Body | 指定请求步骤的响应（本次运行中最近一次执行的结果） |
| **Global variable** | Value | 全局变量的值，从已有的全局变量中选择 |
| **Loop iteration** | Value | 循环序号，只有循环内部的步骤可以选 |

可用的运算符：

- Status、Loop iteration：Equals、Not equals、Greater than、Less than、Greater/equal、Less/equal（按数字比较）。
- JSON path、Header、Body：Equals、Not equals、Contains、Not contains、Exists、Not exists。
- Global variable：以上全部。

Exists / Not exists 不需要期望值；值为 `null` 视为不存在。期望值可以使用 `{{变量}}`，例如 `{{orderId}}`。

**Loop iteration 的值**是"下一次要执行的循环序号"：While 在第一次循环前检查时为 1；Do While 和 Until 在每次循环后检查，第一次循环后为 2。

### 多个条件

点击条件下方的 **Add condition** 添加更多条件。有两个及以上条件时，可以选择组合方式：

| 组合方式 | 含义 | 可用于 |
|---------|------|-------|
| All conditions are true at once | 同一次检查中所有条件都满足 | 所有条件步骤 |
| Any condition is true | 同一次检查中任一条件满足 | 所有条件步骤 |
| Each condition has been met (any order) | 每个条件在某次检查中满足过即可，不限顺序；满足过的条件保持满足 | Until |

例如订单状态依次变为 `paid`、`payment_captured`、`packing`、`shipped`，要等"已扣款"和"已发货"都出现过才停止，就用 Until 加第三种组合方式。同一次检查中所有条件都满足时也立即停止。每次进入 Until 步骤时重新计数。

## 循环

| 设置 | 说明 |
|------|------|
| **Iterations**（For） | 循环次数 |
| **Max iterations**（While / Do While / Until） | 最多循环次数，默认 30，最多 1000。达到后结束循环，工作流继续执行后面的步骤 |
| **Wait between iterations** | 每次循环之间等待的毫秒数，第一次之前不等待，最长 1 小时。轮询耗时任务时使用，点击 Stop 会立即结束等待 |

循环中的请求可以用 `{{$loopIndex}}` 取当前是第几次循环（从 1 开始，嵌套循环取最内层），例如 `{{baseUrl}}/orders?page={{$loopIndex}}`。

## Set Variables

每行设置一个全局变量，值可以使用 `{{变量}}` 和 `{{$loopIndex}}`。运行到这个步骤时按顺序设置，日志中显示设置后的值。常用于：

- 运行开始时重置上次留下的变量，例如 `page` = `1`。
- 保存一个本次运行共用的值，例如 `runId` = `{{$guid}}`，后续请求都用 `{{runId}}`。

## 运行

点击 **Run** 运行当前编辑器中的工作流（包括还没保存的修改），运行中可以点击 **Stop** 停止。同一时间只能运行一个工作流。

- 请求的测试失败或请求出错时，工作流停止。
- If 条件不满足且没有 Else 步骤时，工作流停止。
- 循环达到 Max iterations 时结束循环，不算失败。
- 请求测试中提取的变量写入全局变量，后续步骤立即可用。
- 运行中切换环境，后续步骤使用新环境的变量。

## 运行日志

![运行日志](/screenshots/workflow-log.png)

点击 **Log** 打开运行日志。日志按层级显示工作流、步骤、循环和每次循环，包括时间、状态、类型、耗时和请求通过数；运行中可以 **Jump to latest** 跟随最新的步骤。点击一行查看详情：

- 条件：目标、运算符、期望值（替换变量后）和实际值；多个条件时逐个列出每个条件的结果，先后满足模式下显示在第几次循环满足。
- 请求步骤：请求、响应和测试结果。
- Set Variables：设置的变量和值。

![运行日志中的条件详情](/screenshots/workflow-log-detail.png)

## 示例

### 登录后带 token 调用

| 步骤 | 设置 |
|------|------|
| Existing Request · Login | Tests 中把 `$.data.token` 提取为 `token` |
| Existing Request · Get profile | Authorization 选 Bearer Token，Token 填 `{{token}}` |

### 轮询异步任务

| 步骤 | 设置 |
|------|------|
| Set Variables | `orderId` = 空，清除上次运行留下的值 |
| Existing Request · Create order | Tests 中把 `$.id` 提取为 `orderId` |
| Until · Wait for order | Stop when：Each condition has been met (any order)；条件 1：Last response · JSON path `$.status` equals `payment_captured`；条件 2：Last response · JSON path `$.status` equals `shipped`；Max iterations `60`，Wait between iterations `2000` ms |
| └ Existing Request · Get order | URL `{{baseUrl}}/orders/{{orderId}}`，测试 `$.id` equals `{{orderId}}` |

### 按页码分页

| 步骤 | 设置 |
|------|------|
| For · Pages | Iterations `5` |
| └ Inline Request · List orders | URL `{{baseUrl}}/orders?page={{$loopIndex}}` |

### 按"下一页"字段分页

接口返回 `{"items": [...], "nextPage": 2}`，最后一页 `nextPage` 为 `null`：

| 步骤 | 设置 |
|------|------|
| Set Variables | `page` = `1` |
| Until · All pages | 条件：Last response · JSON path `$.nextPage` Not exists |
| └ Existing Request · List orders | URL `{{baseUrl}}/orders?page={{page}}`，Tests 中把 `$.nextPage` 提取为 `page` |
