# Mock Services

A mock service returns the responses you define on a local port. When an API isn't ready yet, the frontend or other programs can call the mock first; you can also use it to simulate errors, slow responses and other hard-to-reproduce cases.

Mock services only accept connections from this computer, and ApiKit must stay open.

## Create

Click **New Mock Service** under **Mocks** in the sidebar, enter a name and port, and choose where to start from:

| Start from | Description |
|------------|-------------|
| **Blank** | An empty service; add routes by hand |
| **Collection** | One route per request in a collection, using the latest real response in the Console |
| **OpenAPI file** | One response per documented status, from the examples or generated from the schemas |

Each service uses its own port, and several can run at once. When creating a mock from a collection, you can also create an environment that points to the mock, so you can switch between the real API and the mock by switching environments.

Click **Save to Mock** in the response area of a request to add the response you just received to a mock service.

## Service settings

| Setting | Description |
|---------|-------------|
| Name / Port | Name and port |
| Default delay | Default delay in milliseconds; a response's own delay wins |
| Start when ApiKit opens | Start the service when ApiKit starts |
| Allow calls from browser pages (CORS) | Answers preflight requests and adds `Access-Control-Allow-*` headers, so pages on a dev server such as `localhost:5173` can call the mock |

## Routes

Routes match by method and path:

- Path parameters are written as `:id`, `{id}` or `{{id}}`, for example `/orders/:id`.
- `*` matches any one segment.
- When several routes match, the one with the most fixed segments wins, for example `/orders/latest` before `/orders/:id`.
- Disabled routes are not matched.

When no route matches, the mock returns 404 with the reason as JSON, for example `{"error": "No route matches GET /users"}`.

Actions in the route editor:

| Action | Description |
|--------|-------------|
| Copy button at the right of the address | Copies the full URL with path parameters set to the example value `1`, for example `http://127.0.0.1:3001/orders/1` |
| **Open as Request** | Opens a temporary request to this URL with the `x-mock-response-name` header, so sending it returns the response you are editing |
| **⋯** → **Duplicate Route** | Copies the route and all its responses. The copy is disabled and its path ends with `-copy`; change the path, then check **Enabled** |
| **⋯** → **Delete Route** | Deletes the route and all its responses |

## Responses

A route can have several responses, each with a name, status, headers, delay and body.

### Which response is returned

In this order:

1. The response named in the `x-mock-response-name` request header, or with the status in the `x-mock-response-code` header.
2. The first response whose **rules** match.
3. The default response: the one marked as default, otherwise the first response without rules.

### Rules

Each rule reads a value from the request and compares it:

| Source | Key | Example |
|--------|-----|---------|
| query | Query parameter name | `status` |
| header | Header name (case-insensitive) | `x-tenant` |
| path | Path parameter name | `id` |
| body | JSON path in the request body; `$` is the whole body | `$.items[0].sku` |
| cookie | Cookie name | `sid` |

Operators: equals, notEquals, contains, regex (regular expression), exists, notExists. A response with several rules can require all of them (all) or any of them (any).

### Body

| Mode | Description |
|------|-------------|
| JSON | JSON editor |
| Template | Template syntax such as `{{#repeat}}`, with a preview of the result (enter an example request in **Preview with**, as a path or a full URL, and click **Regenerate** to generate again) |
| Text | Plain text |

All three modes replace `{{variables}}`: environment variables, global variables and [built-in dynamic variables](./variables#built-in-dynamic-variables). Each occurrence gets its own value.

## Template syntax

![Mock response template and preview](/screenshots/mock.png)

Typing `{{` in the response body or headers lists the syntax below. After you pick an item that ends with `.`, such as `$request.headers.`, the cursor stays after the `.` so you can type the name right away.

| Syntax | Description |
|--------|-------------|
| `{{$request.query.page}}` | Query parameter |
| `{{$request.params.id}}` | Path parameter |
| `{{$request.headers.x-trace}}` | Request header |
| `{{$request.cookies.sid}}` | Cookie |
| `{{$request.body.items[0].sku}}` | A value in the request body JSON |
| `{{$request.method}}`, `{{$request.path}}` | Method and path |
| `{{$request.query.page ?? 1}}` | The value after `??` is used when there is no value |
| `{{#repeat 10}} … {{/repeat}}` | Repeats the content 10 times, with commas between the copies; at most 1000 times |
| `{{#repeat $request.query.pageSize ?? 10}}` | The count comes from the request |
| `{{$index}}` | Inside repeat, the number of the current copy (from 1) |
| `{{$pick(paid, pending, shipped)}}` | Picks one value at random |

Example: return a list of orders for the requested page and page size.

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

If building the response fails, the mock returns 500 with the reason in the body.

## Call log

**Logs** records the full request and response of each call, with the matched route and response. The latest 100 calls per service are kept on this computer. For a call that matched no route, you can click **Add Route** directly.
