# Getting Started

## Install

Download the package for your system from the [Releases](https://github.com/duwei0227/apikit/releases/latest) page:

| System | Recommended | Others |
|--------|-------------|--------|
| Windows | `.msi` installer | `.exe` (NSIS installer), `.zip` (portable) |
| macOS | `.dmg` | |
| Linux | `.AppImage` (run it after `chmod +x`) | `.deb`, `.rpm`, `.tar.gz` (portable) |

On macOS, ApiKit requires macOS 11 Big Sur or later with Safari updated to 16.4 or later. The first time you open ApiKit on macOS, you may need to allow it in "System Settings → Privacy & Security". After installing, use **Help → Check For Update** to check for and install new versions.

## Send your first request

1. Click **New Request** (or press `Ctrl+N`).
2. Choose a method, for example `GET`, and enter a URL, for example `https://api.github.com/users/github`.
3. Click **Send** and look at the response body, headers, status, time and size below.

Query parameters in the URL are synced to **Params**. Set headers, the body and authentication in **Headers**, **Body** and **Authorization**.

![Request editor and response](/screenshots/request.png)

## Save to a collection

1. Click **Save**.
2. Choose a collection and folder, or click **New Collection** to create one, enter a name and save. Next time, the dialog starts at the location you last saved to.

Saved requests appear under **Collections** in the sidebar, where you can reorder them by dragging, duplicate them (`Ctrl+D`) and move them.

## Use environments and variables

1. Click the gear icon next to the environment selector in the top right (**Manage Environments**) and create an environment, for example "Development".
2. Add the variable `baseUrl` = `https://api.example.com`.
3. Write `{{baseUrl}}/users` in a request; switch the environment to switch servers.

See [Variables](./variables) for more: global variables, built-in dynamic variables and extracting variables from responses.

## Test the response

Add assertions in the **Tests** tab of a request:

- **Status Code Assertions**: for example status equals `200`.
- **JSON Field Assertions**: for example JSON path `$.data.id` exists.
- **Global Variable Settings**: save a value from the response as a global variable, for example `$.data.token` as `token`, and use it in later requests as `{{token}}`.

After sending, see the results under **Test Results** in the response area. Failures show the expected and actual values, for example `Status code: expected 201, got 422`.

## Next steps

- Everything about requests: [Sending Requests](./requests), [Tests and Assertions](./tests), [Responses](./responses)
- Organize requests, and import from Postman, OpenAPI or cURL: [Collections](./collections), [Import and Export](./import-export)
- Chain requests into automated flows: [Workflows](./workflow)
- Let the frontend call an API before it is ready: [Mock Services](./mock)
- Let AI create requests, write workflows and investigate failures: [AI Integration (MCP)](./ai)
