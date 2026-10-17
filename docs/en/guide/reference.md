# Reference

## Keyboard shortcuts

On macOS, use `Cmd` instead of `Ctrl`; `Alt` is `Option`. Press `F1` in the app for the full list.

**Everywhere**

| Shortcut | Action |
|----------|--------|
| `Ctrl+N` | New request / collection / environment (depending on where you are) |
| `Ctrl+S` | Save the current request or workflow |
| `Ctrl+Alt+D` | Switch dark / light theme (`Control+Option+D` on macOS) |
| `F1` | Show keyboard shortcuts |
| `Esc` | Close popups or the completion list |

**Collection tree (selected item)**

| Shortcut | Action |
|----------|--------|
| `Ctrl+D` | Duplicate |
| `Delete` | Delete |

**Request body editor**

| Shortcut | Action |
|----------|--------|
| `Ctrl+F` | Search |
| `Ctrl+Z` / `Ctrl+Shift+Z`, `Ctrl+Y` | Undo / redo |
| `Ctrl+/` | Toggle line comment |
| `Ctrl+D` | Delete line |
| `Ctrl+Shift+D` | Duplicate line or selection |
| `Alt+↑` / `Alt+↓` | Move line up / down |
| `Alt+Shift+↑` / `Alt+Shift+↓` | Copy line up / down (`Cmd+Option+↑/↓` on macOS) |
| `Tab` / `Shift+Tab` | Indent / outdent |
| `Ctrl+Alt+↑` / `Ctrl+Alt+↓` | Add cursor above / below |
| `Alt+L` / `Alt+Shift+L` | Fold / unfold (`Cmd+Option+L` / `Cmd+Option+Shift+L` on macOS) |
| `Ctrl+U` / `Ctrl+Shift+U` | Upper / lower case |

**Input fields**: `Ctrl+Z` / `Ctrl+Shift+Z`, `Ctrl+Y` to undo / redo.

**Response**: `Ctrl+F` to search, `Ctrl+A` to select all.

Shortcuts also work with Caps Lock on or a non-Latin keyboard layout.

## Data storage

All data stays on your computer:

| System | Location |
|--------|----------|
| Windows | `%APPDATA%\cn.probiecoder.apikit` |
| macOS | `~/Library/Application Support/cn.probiecoder.apikit` |
| Linux | `~/.local/share/cn.probiecoder.apikit` |

The `collections`, `requests`, `workflows`, `environments`, `history` and `mocks` folders hold the collections, requests, workflows, environments, history and mock services.

### Backup and migration

- Export collections and workflows (ApiKit JSON) and environments; see [Import and Export](./import-export).
- Or close ApiKit and copy the data folder above.

### Data when uninstalling (Windows)

The uninstall confirmation page has two options, both unchecked by default:

- **Delete the app cache and interface settings**: deletes `%LOCALAPPDATA%\cn.probiecoder.apikit`, which holds the interface cache and the theme and MCP settings.
- **Also delete my collections, workflows, environments, mocks and history (cannot be undone)**: deletes the data folder above.

When you install a new version and choose "Uninstall before installing", the second option is not shown and the data folder is always kept. This applies to versions after 0.4.1: the uninstaller that runs is the one of the installed version, so when upgrading from an earlier version, the old uninstaller still shows a single "Delete the application data" option, which deletes the data folder when checked.

## Updates

Click **Help → Check For Update** to check for a new version. When there is one, the title bar shows it; you can read what's new, download and install it with one click, and ApiKit restarts.

## FAQ

### macOS says the app cannot be opened

The first time, allow ApiKit in "System Settings → Privacy & Security".

### Variables in a request are not replaced

Check that the variable is defined and spelled the same: environment variables only apply while their environment is active. Hover over a variable in the request body to see its value, or click **View Variables** next to the environment selector to see the available variables. See [Variables](./variables).

### Calling an API with a self-signed certificate

Turn off **Enable SSL certificate verification** in the request's **Settings**.

### The AI tool cannot connect to the MCP server

Check that ApiKit is open, the MCP dialog shows Running, and the URL, port and token in the AI tool match the dialog. After regenerating the token, update the AI tool's configuration. See [AI Integration](./ai).

### A web page calling a mock service gets a CORS error

Turn on **Allow calls from browser pages (CORS)** in the mock service's settings. See [Mock Services](./mock).
