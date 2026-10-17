# Variables

Use `{{name}}` in the URL, Params, Headers, Body and authentication; it is replaced with the variable's value when the request is sent. Typing `{{` lists the available variables. In the request body editor, defined and undefined variables have different colours, and hovering shows the value.

## Kinds of variables and precedence

| Kind | Where to set it | Scope |
|------|-----------------|-------|
| Built-in dynamic variables | Nothing to set; names start with `$` | All requests |
| Environment variables | The gear icon next to the environment selector, **Manage Environments** | While that environment is active |
| Global variables | **Global Variable Settings** in Tests, the **Set Variables** workflow step, or the AI | All environments |

With the same name: built-in dynamic variables > variables of the active environment > global variables.

Click the eye icon next to the environment selector (**View Variables**) to see the environment and global variables the current request uses, and to edit or delete global variables.

An undefined variable is sent as written, for example the URL still contains `{{token}}`; the Console shows the request that was actually sent. When the AI sends a request through MCP, the result lists these unresolved variables.

## Built-in dynamic variables

Each occurrence gets its own value; for example, two `{{$guid}}` in one request are two different values.

| Variable | Description | Example |
|----------|-------------|---------|
| `$timestamp` | Current timestamp in milliseconds | `{{$timestamp}}` |
| `$isoTimestamp` | Current time (ISO 8601) | `{{$isoTimestamp}}` |
| `$guid` | Random UUID | `{{$guid}}` |
| `$randomInt` | Random integer, both ends included, 0–1000 by default | `{{$randomInt(1, 100)}}`, `{{$randomInt(min=1, max=100)}}` |
| `$date` | Current date, format `yyyyMMdd` by default | `{{$date("yyyy-MM-dd")}}`, `{{$date(format="dd/MM/yyyy")}}` |
| `$time` | Current time, format `HHmmss` by default | `{{$time("HH:mm")}}` |
| `$datetime` | Current date and time, format `yyyyMMddHHmmss` by default | `{{$datetime("yyyy-MM-dd HH:mm:ss")}}` |
| `$randomAlpha` | Random letters (mixed case), 10 by default | `{{$randomAlpha(8)}}` |
| `$randomNumeric` | Random digits, 10 by default | `{{$randomNumeric(6)}}` |
| `$randomUppercase` | Random uppercase letters, 10 by default | `{{$randomUppercase(length=4)}}` |
| `$randomLowercase` | Random lowercase letters, 10 by default | `{{$randomLowercase(len=4)}}` |
| `$randomAlphanumeric` | Random letters and digits, 10 by default | `{{$randomAlphanumeric(16)}}` |
| `$randomChinese` | Random Chinese text made of common words, 10 characters by default | `{{$randomChinese(20)}}` |
| `$sequence` | Auto-increment sequence, see below | `{{$sequence(name=order, start=1000)}}` |
| `$loopIndex` | The current iteration of a workflow loop (from 1); only inside workflow loops | `?page={{$loopIndex}}` |

In date formats, `yyyy`, `MM`, `dd`, `HH`, `mm` and `ss` are the year, month, day, hours, minutes and seconds. Parameters can be positional or written as `name=value`: length as `length` or `len`, the date format as `format` or `fmt`, and the range of `$randomInt` as `start`/`end` or `min`/`max`. The completion list shows how to use each variable, and parameter help appears while you type the arguments.

### Sequences: `$sequence`

Each occurrence takes the next value and advances by the step (two occurrences in one request take two consecutive values). Values are stored on this computer and continue after a restart.

| Syntax | Description |
|--------|-------------|
| `{{$sequence}}` | The sequence named `default`, starting at 1, adding 1 each time |
| `{{$sequence(100)}}` | Start at 100 |
| `{{$sequence(order, 5, 1000, 10)}}` | Sequence `order`, zero-padded to 5 digits, starting at 1000, adding 10 each time |
| `{{$sequence(name=order, padding=5, start=1000, step=10)}}` | The same with named parameters |

The start value and step only apply the first time a sequence is used; after that the sequence keeps its own settings. Click **Manage Sequences** next to the environment selector to see and change the current value, step and padding of each sequence. Generated code (the Code view) only previews the next value and does not advance the sequence.

## Extract variables from responses

Add a row in **Tests → Global Variable Settings** of a request:

| Type | Value | Example |
|------|-------|---------|
| **JSON Path** | A path in the response JSON | `$.data.token` |
| **Response Header** | A response header name, case-insensitive | `x-session` |
| **Custom Value** | A fixed value, may use variables | `order-{{orderId}}` |

The value is saved as a global variable only when all assertions of the request pass; otherwise it is skipped and the test results say so. Later requests use it as `{{variableName}}`.

## Variables in assertions and conditions

Expected values of assertions and of workflow conditions can use variables, for example JSON path `$.id` equals `{{orderId}}` to check data returned by an earlier request. An undefined variable is compared as written. Test results and logs show the value after replacement.
