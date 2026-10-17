# Tests and Assertions

Set up assertions and variable extraction in the **Tests** tab of a request. They run after every send, and the results appear under **Test Results** in the response area. In a workflow, a failed assertion stops the workflow.

New requests start with one assertion: status equals `200`.

![Tests tab](/screenshots/tests.png)

## Status Code Assertions

Choose an operator and enter the expected status, for example equals `201`, greater than `199` or less than `300`. The expected value can use variables, for example `{{expectedStatus}}`.

## JSON Field Assertions

Enter a JSON path, an operator and the expected value, for example `$.data.id` exists or `$.status` equals `paid`.

**JSON path** syntax:

| Syntax | Meaning |
|--------|---------|
| `$` | The whole response |
| `$.data.name` | Object property; `$.` is optional, so `data.name` works too |
| `$.items[0].id` | Array index, from 0 |

Only this simple syntax is supported: no wildcards (`*`), filter expressions or negative indexes.

## Operators

| Operator | Description |
|----------|-------------|
| Equals / Not equals | Compared as text; objects and arrays are compared as JSON text, for example `["a","b"]` |
| Contains / Not contains | Whether the value contains the expected text |
| Exists / Not exists | Whether the field exists; `null` counts as not existing. No expected value needed |
| Greater than / Less than / Greater/equal / Less/equal | Compared as numbers |

`{{variables}}` in the expected value are replaced before comparing, for example `$.id` equals `{{orderId}}`; an undefined variable is compared as written.

## Extract variables (Global Variable Settings)

Save values from the response as global variables for later requests and workflows:

| Type | Value | Example |
|------|-------|---------|
| **JSON Path** | A path in the response JSON | `$.data.token` |
| **Response Header** | A response header name, case-insensitive | `x-session` |
| **Custom Value** | A fixed value, may use variables | `order-{{orderId}}` |

- Values are saved only when all assertions pass; otherwise they are skipped and marked Skipped in the results.
- When there is no value (for example the path does not exist or the header is missing), the result is marked Failed and the variable keeps its old value.
- Objects and arrays are saved as JSON text.

## Results

![Test results](/screenshots/test-results.png)

**Test Results** lists each assertion's type, expected value, operator, actual value and whether it passed, and the result of each extracted variable. Failures read like `Status code: expected 201, got 422` or `$.status: expected paid, got pending`.

For streaming responses (SSE, newline-delimited JSON), JSON field assertions and variable extraction read the merged result object; see [Responses](./responses#streaming-responses).
