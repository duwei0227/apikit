# AI Integration (MCP)

ApiKit has a built-in MCP (Model Context Protocol) server. Once an AI tool that supports MCP is connected, it can read and change your collections, requests, workflows and environments, send requests, run workflows and read the logs. For example:

- "Create a workflow for placing an order with the Orders endpoints and run it; if it fails, find out why"
- "Save this cURL command in the Orders folder of the Shop collection"
- "Find the requests whose URL contains /v1/ and change it to /v2/"

## Connect

1. Click the ✦ icon in the title bar or **MCP** in the status bar.
2. Turn on **Enable MCP server**; the status shows Running when the server is up. The default port is `27121`; change it and click **Apply** if needed.
3. Add the server in your AI tool's MCP settings, with the Streamable HTTP transport:

   - URL: `http://127.0.0.1:27121/mcp`
   - Header: `Authorization: Bearer <token>`, copy the token from the dialog

   Or copy the JSON configuration from the dialog:

   ```json
   {
     "mcpServers": {
       "apikit": {
         "type": "http",
         "url": "http://127.0.0.1:27121/mcp",
         "headers": { "Authorization": "Bearer <token>" }
       }
     }
   }
   ```

The MCP server is off by default, accepts only connections from this computer and requires the token. After you click **Regenerate** for a new token, update the token in your AI tools. ApiKit must stay open for the AI to connect.

![AI integration dialog](/screenshots/mcp.png)

## Settings

| Setting | Description |
|---------|-------------|
| **Show variable values and credentials to AI** | Off by default: environment variable values, auth tokens, passwords and secret headers are sent to the AI as `<hidden>`. Requests still use the real values when they run |
| **Confirm requests, workflow runs and environment switches** | **In ApiKit**: confirm in an ApiKit dialog; **In the AI tool, when it supports it**: confirm in the AI tool when it supports MCP elicitation, otherwise in ApiKit |
| **Changes the AI makes to requests and workflows** | **Keep as unsaved edits**: the AI's changes to existing requests and workflows show up as unsaved edits that you Save or Discard; **Save directly**: saved right away. New requests and workflows the AI creates are always saved directly |

**Available tools** at the bottom of the dialog lists all tools, and **Recent calls** shows the latest calls.

## Actions you confirm

| Action | Confirmation |
|--------|--------------|
| Sending requests, running workflows, switching the active environment (including creating an environment and making it active) | Every time; you can choose **Allow All This Session** to stop asking until ApiKit restarts |
| Deleting requests, folders, collections and workflows | **Every time**, even after Allow All This Session; the confirmation shows what will be deleted, how many requests it contains and which workflows use them |

## Tools

| Group | Tools |
|-------|-------|
| Read | `list_collections`, `search_requests` (use `query` to find a name or URL fragment), `get_request`, `list_workflows` (with the containing folders as `folderPath`), `get_workflow`, `list_environments`, `list_builtin_variables`, `get_workflow_logs`, `list_request_logs`, `get_request_log` |
| Open and close tabs | `open_request`, `close_request`, `open_workflow`, `close_workflow` |
| Create and edit | `create_collection`, `update_collection`, `create_folder`, `update_folder`, `create_request`, `import_curl` (create from a cURL command), `update_request`, `move_request`, `create_workflow`, `update_workflow`, `create_environment`, `update_environment`, `set_global_variables` |
| Run (asks you first) | `send_request`, `run_workflow`, `set_active_environment` |
| Delete (asks you every time) | `delete_request`, `delete_folder`, `delete_collection`, `delete_workflow` |

Pass tool arguments directly according to each tool's schema; do not wrap them in a `params` object. The `params` field in a request definition is the HTTP URL query-parameter list. `send_request` requires exactly one of `requestId` or `request`; a workflow request step likewise requires exactly one of `requestId` or `inlineRequest`.

`get_request_log` returns request and response bodies in pages, with the first 8,000 characters of each body by default. If `hasMore` is `true`, pass that body's `nextOffset` as `requestOffset` or `responseOffset` and call again until `hasMore` is `false`. Offsets count UTF-16 code units. Use `bodyPart` to retrieve only the request or response body and reduce the size of each result.

`get_workflow_logs` uses the same body-pagination arguments when `logId` is provided. `send_request` returns a `logId` that can be passed directly to `get_request_log` to retrieve the complete response in pages.

The AI can do the same things as you can in the interface, including:

- opening request and workflow tabs; before closing a tab with unsaved edits, it returns the full draft for your review so you can choose to save or discard it in the AI tool. If the draft changes before confirmation, it must be reviewed again;
- creating workflows with all step types, several conditions and how they combine, waits between iterations and Set Variables steps;
- using variables in assertions and conditions, and extracting variables from response headers;
- reading the full requests, responses and test results in request logs and workflow logs to investigate failures.

What the AI changes or runs shows up in the interface right away; tabs of deleted items are closed.
