# Mock 服务

Mock 服务在本机端口上返回你设定的响应。接口还没完成时，前端或其他程序可以先调用 Mock；也可以用它模拟错误、慢响应等难以复现的情况。

Mock 服务只接受本机的连接，ApiKit 需要保持打开。

## 创建

在侧边栏 **Mocks** 中点击 **New Mock Service**，填写名称和端口，选择来源：

| 来源 | 说明 |
|------|------|
| **Blank** | 空白服务，手动添加路由 |
| **Collection** | 集合中每个请求生成一条路由，响应使用 Console 中最近一次的真实响应 |
| **OpenAPI file** | 文档中每个状态码生成一个响应，内容取自示例或按 schema 生成 |

每个服务使用自己的端口，可以同时运行多个。从集合创建时可以同时创建一个指向 Mock 的环境，切换环境就能在真实接口和 Mock 之间切换。

在请求的响应区点击 **Save to Mock**，可以把刚收到的真实响应添加到 Mock 服务。

## 服务设置

| 设置 | 说明 |
|------|------|
| Name / Port | 名称和端口 |
| Default delay | 默认延迟（毫秒）；响应自己设置的延迟优先 |
| Start when ApiKit opens | ApiKit 启动时自动启动服务 |
| Allow calls from browser pages (CORS) | 应答预检请求并添加 `Access-Control-Allow-*` 响应头，让 `localhost:5173` 等开发服务器中的页面可以调用 |

## 路由

路由按"方法 + 路径"匹配：

- 路径参数写作 `:id`、`{id}` 或 `{{id}}`，例如 `/orders/:id`。
- `*` 匹配任意一段。
- 多条路由都能匹配时，取固定段最多的一条，例如 `/orders/latest` 优先于 `/orders/:id`。
- 停用的路由不参与匹配。

没有路由匹配时返回 404，响应体是说明原因的 JSON，例如 `{"error": "No route matches GET /users"}`。

路由编辑区的操作：

| 操作 | 说明 |
|------|------|
| 地址框右侧的复制按钮 | 复制完整地址，路径参数换成示例值 `1`，例如 `http://127.0.0.1:3001/orders/1` |
| **Open as Request** | 用这个地址新建一个临时请求，并带上请求头 `x-mock-response-name`，发送后返回正在编辑的响应 |
| **⋯** → **Duplicate Route** | 复制路由和它的全部响应；副本默认停用，路径末尾加 `-copy`，改好路径后勾选 **Enabled** 启用 |
| **⋯** → **Delete Route** | 删除路由和它的全部响应 |

## 响应

一条路由可以有多个响应，每个响应有名称、状态码、响应头、延迟和响应体。

### 选择哪个响应

按以下顺序：

1. 请求头 `x-mock-response-name` 指定了响应名称，或 `x-mock-response-code` 指定了状态码时，返回对应的响应。
2. 第一个**规则**满足的响应。
3. 默认响应：标为默认的响应，没有时取第一个没有规则的响应。

### 规则

每条规则从请求中取一个值再比较：

| 来源 | 键 | 示例 |
|------|----|------|
| query | 查询参数名 | `status` |
| header | 请求头名称（不区分大小写） | `x-tenant` |
| path | 路径参数名 | `id` |
| body | 请求体 JSON 路径，`$` 表示整个请求体 | `$.items[0].sku` |
| cookie | Cookie 名称 | `sid` |

运算符：equals、notEquals、contains、regex（正则表达式）、exists、notExists。一个响应有多条规则时，可选择全部满足（all）或任一满足（any）。

### 响应体

| 模式 | 说明 |
|------|------|
| JSON | JSON 编辑器 |
| Template | 可以使用 `{{#repeat}}` 等模板语法，并显示生成结果的预览（**Preview with** 中可填写一个示例请求，路径或完整地址都可以，**Regenerate** 重新生成） |
| Text | 纯文本 |

三种模式都会替换 `{{变量}}`：环境变量、全局变量和[内置动态变量](./variables#内置动态变量)，每次出现单独生成。

## 模板语法

![Mock 响应模板和预览](/screenshots/mock.png)

在响应体和响应头中输入 `{{` 会列出下面的写法。选中 `$request.headers.` 这类以 `.` 结尾的项后，光标停在 `.` 之后，接着输入名称即可。

| 写法 | 说明 |
|------|------|
| `{{$request.query.page}}` | 查询参数 |
| `{{$request.params.id}}` | 路径参数 |
| `{{$request.headers.x-trace}}` | 请求头 |
| `{{$request.cookies.sid}}` | Cookie |
| `{{$request.body.items[0].sku}}` | 请求体 JSON 中的值 |
| `{{$request.method}}`、`{{$request.path}}` | 方法和路径 |
| `{{$request.query.page ?? 1}}` | 取不到值时使用 `??` 后的默认值 |
| `{{#repeat 10}} … {{/repeat}}` | 把中间的内容重复 10 次，副本之间自动加逗号；次数最多 1000 |
| `{{#repeat $request.query.pageSize ?? 10}}` | 次数取自请求 |
| `{{$index}}` | 在 repeat 中，当前是第几份（从 1 开始） |
| `{{$pick(paid, pending, shipped)}}` | 随机取一个值 |

示例：按请求的页码和每页数量返回订单列表。

```
{
  "page": {{$request.query.page ?? 1}},
  "items": [
    {{#repeat $request.query.pageSize ?? 10}}
    { "id": {{$index}}, "orderNo": "SO{{$randomInt(10000, 99999)}}", "status": "{{$pick(paid, pending)}}" }
    {{/repeat}}
  ]
}
```

生成响应出错时返回 500，响应体说明原因。

## 调用日志

**Logs** 中记录每次调用的完整请求和响应，以及命中的路由和响应，每个服务保留最近 100 条，保存在本机。没有匹配到路由的调用可以直接 **Add Route**。
