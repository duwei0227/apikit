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
| json | JSON editor; **Beautify** fixes and formats it; comments are allowed and removed when sending; validated before sending |
| xml | XML editor that closes tags automatically; **Beautify** fixes and formats it; validated before sending |
| text | Plain text |
| binary | A file as the body |

The body editor is based on Ace:

- Typing `{{` completes variables; defined and undefined variables have different colours, and hovering shows the value.
- JSON braces and brackets and XML tags are coloured by nesting level: each pair shares a colour, three colours repeat (the same colours as VS Code), and extra ones without a pair are shown in red.
- `Ctrl+F` searches, with match case (**Aa**) and regular expressions (**.\***).
- Brackets and quotes close automatically, and Ace's common shortcuts work, such as `Ctrl+/` to toggle a comment and `Alt+↑/↓` to move lines; see [Reference](./reference#keyboard-shortcuts).
- Large integers keep their exact value instead of being rounded by JavaScript.

### Comments in JSON

A json body can contain `//` line comments and `/* */` block comments, for example to switch off a field for a while or to add a note. When the request is sent, comments are removed first, then variables are replaced:

- Only comments outside strings are removed; the `//` in a string such as `"http://example.com"` is kept.
- Lines that are empty once their comment is removed are deleted, and when the last item is commented out, the comma left before `}` or `]` is removed too.
- The saved request keeps its comments. Requests sent by Workflows and AI (MCP), copied cURL commands and the request body recorded in the Console all have the comments removed.

```jsonc
{
  "name": "apikit", // name
  // "debug": true,
  "url": "http://example.com"
}
```

Sent as:

```json
{
  "name": "apikit",
  "url": "http://example.com"
}
```

### Beautify

json and xml bodies have **Beautify** on the toolbar. It first fixes common mistakes, then formats the body. Press `Ctrl+Z` to undo.

For json, it:

- Completes truncated content: adds missing `}`, `]` and closing quotes.
- Fixes commas: adds missing commas between members, for example `"a": {} "b": "xx"` becomes `"a": {}, "b": "xx"`, and removes duplicate, leading and trailing commas.
- Fixes quotes: changes single-quoted strings to double-quoted ones and quotes bare keys, for example `{'a': 'x', b: 1}` becomes `{"a": "x", "b": 1}`.
- Fills missing values with `null`: `{"a":}`, `{"a"}` and a truncated `{"a":` all become `{"a": null}`.
- Escapes newlines, tabs and other control characters in strings as `\n`, `\t`.

For xml, it:

- Closes unclosed tags in nesting order, for example `<a><b>x` becomes `<a><b>x</b></a>`; when a closing tag is out of place, the tags left open inside it are closed first.
- Completes a truncated tag with the attribute's quote and `>`, for example `<a id="1` becomes `<a id="1"></a>`, and closes an unterminated comment or CDATA section.
- Escapes a bare `&` in text and attribute values as `&amp;`, and a bare `<` in text as `&lt;`. Content in CDATA sections and comments is not changed.

`{{variables}}` are left as they are, including an unquoted `{{id}}` in json. If the json still has errors afterwards, it is formatted and the error position is shown; if the xml still has errors, the body is not changed and the line and column of the error are shown.

### Validation before sending

When you click **Send** or **Send And Download**, json and xml bodies are validated first. The check uses the content that is actually sent: for json, comments are removed first, then variables are replaced. If the body is invalid, the request is not sent: **Invalid JSON Body** or **Invalid XML Body** is shown with the line and column of the error, the Body tab opens and the cursor moves to the error.

- When the error comes from a variable's value (for example, in `{"id": {{id}}}` the value of `id` is not a number, or the variable is not defined), the message names the variable.
- A bare `&` or `<` in xml is also blocked; click **Beautify** to escape it.
- Only json and xml bodies are validated, and requests sent by Workflows and AI (MCP) are not.

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
