# Sending Requests

Click **New Request** (or press `Ctrl+N`) to create a request. Each open request is edited in its own tab; unsaved changes show a dot on the tab. Click **Save** (or press `Ctrl+S`) to save.

![Request editor](/screenshots/request.png)

## Method and URL

Choose GET, POST, PUT, DELETE, PATCH, HEAD or OPTIONS from the method dropdown and enter the URL next to it. Query parameters in the URL and the **Params** tab stay in sync: change a parameter in the URL and Params updates; change it in Params and the URL updates.

The URL, parameters, headers, body and authentication can use `{{variables}}`; see [Variables](./variables).

## Headers

One header per row; the checkbox controls whether it is sent. The body type sets `Content-Type` automatically; a `Content-Type` you enter in Headers wins.
Select **Bulk Edit** on the right side of the table to edit headers as text, one `key: value` pair per line. Select **Key-Value Edit** to return to the table. Params, form-data and x-www-form-urlencoded support the same mode. File fields in form-data are omitted from the text and retained when you return to the table.

## Body

| Type | Description |
|------|-------------|
| none | No body |
| form-data | `multipart/form-data`; each row is Text or File, and files are streamed |
| x-www-form-urlencoded | Form key-value pairs |
| json | JSON editor; **Beautify** formats it |
| xml | XML editor that closes tags automatically |
| text | Plain text |
| binary | A file as the body |

The body editor is based on Ace:

- Typing `{{` completes variables; defined and undefined variables have different colours, and hovering shows the value.
- JSON braces and brackets and XML tags are coloured by nesting level: each pair shares a colour, three colours repeat, and extra ones without a pair are shown in red.
- `Ctrl+F` searches, with match case (**Aa**) and regular expressions (**.\***).
- Brackets and quotes close automatically, and Ace's common shortcuts work, such as `Ctrl+/` to toggle a comment and `Alt+↑/↓` to move lines; see [Reference](./reference#keyboard-shortcuts).
- Large integers keep their exact value instead of being rounded by JavaScript.

## Authorization

| Type | Description |
|------|-------------|
| No Auth | No authentication |
| Bearer Token | Sends `Authorization: Bearer <token>`; the token can be `{{token}}` |
| Basic Auth | Username and password, sent as `Authorization: Basic …` |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Automatically follow redirects | On | Follow 3xx redirects |
| Max redirects | 10 | The most redirects to follow (1–50) |
| Enable SSL certificate verification | On | When off, self-signed and invalid certificates are accepted |
| Encode URL automatically | On | Encode special characters in the URL when sending |
| Accept-Encoding: gzip, deflate, br | On | Send the compression header; responses are decompressed automatically |

## Code

The **Code** tab shows the cURL command for the current request (with variables replaced; `$sequence` is previewed without advancing). Click **Copy** to copy it. Paste a cURL command into **Paste cURL Command** and click **Import** to fill the current request with it.

## Send

Click **Send**; click **Stop** to cancel while it runs. The dropdown next to **Send** has **Send And Download**, which saves the response as a file, with the file name and type taken from the response headers.

See [Responses](./responses) for viewing the response, and [Tests and Assertions](./tests) for assertions and variable extraction.
