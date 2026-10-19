# Workflows

A workflow chains several requests into an automated flow: it runs requests in order, picks branches based on responses, polls in loops, and passes data between requests.

## Create and edit

1. Click **New Workflow** under **Workflows** in the sidebar; the workflow opens in a new tab.
2. Add steps with the toolbar buttons. Loops and conditions have the same buttons inside them for nested steps.
3. Click **Save** (or press `Ctrl+S`).

On the left of each step card you can drag to reorder and collapse the step; the checkbox enables or disables it (disabled steps are skipped). On the right you can move the step up or down and delete it.

![Workflow editor](/screenshots/workflow.png)

## Organize with folders

When you have many workflows, group them in folders under **Workflows** in the sidebar. Folders can be nested.

- Click the folder button next to **New Workflow** (**New Folder**) to create a folder at the top level; right-click a folder and choose **New Folder** to create a subfolder.
- To create a workflow in a folder, click **+** (**New Workflow in Folder**) on the folder row, or right-click the folder and choose **New Workflow**.
- Click a folder to expand or collapse it. Right-click a folder or workflow to **Rename** or **Delete** it; deleting a folder also deletes all workflows in it, including those in subfolders.
- Right-click a workflow and choose **Move Up** / **Move Down** to move it up or down within its folder, or **Move to...** to move it to another folder or the top level (**Workflows**), at the end. These options are hidden while searching.
- Drag workflows and folders to reorder them: drop on the middle of a folder to move into it, or on the top or bottom edge of a row to place before or after it. Dragging is off while searching.
- A workflow copied with **Duplicate Tab** (right-click its tab) is placed right after the original, in the same folder.
- Folders in the same place cannot share a name; workflow names must be unique across all workflows.
- Searching shows the workflows and folders whose names match, together with the folders that contain them.

![Organize workflows with folders](/screenshots/workflow-folders.png)

## Step types

| Step | What it does |
|------|--------------|
| **Existing Request** | Runs a request saved in a collection. After you choose the request, the step is named after it |
| **Inline Request** | A request that belongs only to this workflow; click **Edit Inline Request** to edit it in the full request editor |
| **If** | Runs the Then steps when the condition is true, otherwise the Else steps |
| **For** | Repeats a fixed number of times |
| **While** | Checks the condition **before** each iteration and continues while it is true |
| **Do While** | Runs once, checks the condition **after** each iteration and continues while it is true |
| **Until** | Runs once, checks the condition **after** each iteration and stops once it is true |
| **Set Variables** | Sets global variables |

### Use a saved request

An Existing Request step uses all settings of the request; when the request has unsaved edits, the run uses the edited version. Click **Customize Request** to change some settings for this step only (for example the URL, headers, body or tests); everything you don't change still comes from the request. The step then shows **Customized (n)**, and the dialog has **Reset All**.

When the request is deleted from its collection, the step shows "Referenced request was removed from Collections." and you need to choose another request.

## Conditions

If, While, Do While and Until steps have conditions. Each condition has a source, a field, an operator and an expected value:

| Source | Field | Description |
|--------|-------|-------------|
| **Last response** | Status / JSON path / Header / Body | The response of the most recent request step |
| **Step response** | Status / JSON path / Header / Body | The response of a chosen request step (its latest run in this workflow run) |
| **Global variable** | Value | The value of a global variable, chosen from the existing ones |
| **Loop iteration** | Value | The loop counter; only available for steps inside a loop |

Available operators:

- Status, Loop iteration: Equals, Not equals, Greater than, Less than, Greater/equal, Less/equal (compared as numbers).
- JSON path, Header, Body: Equals, Not equals, Contains, Not contains, Exists, Not exists.
- Global variable: all of the above.

Exists / Not exists need no expected value; `null` counts as not existing. Expected values can use `{{variables}}`, for example `{{orderId}}`.

**The Loop iteration value** is the number of the iteration that would run next: While checks it before the first iteration, when it is 1; Do While and Until check it after each iteration, so it is 2 after the first one.

### Several conditions

Click **Add condition** under the condition to add more. With two or more conditions, choose how they combine:

| Mode | Meaning | Available for |
|------|---------|---------------|
| All conditions are true at once | All conditions are true at the same check | All condition steps |
| Any condition is true | At least one condition is true at the same check | All condition steps |
| Each condition has been met (any order) | Each condition was true at some check, in any order; a condition that was met stays met | Until |

For example, if an order's status goes through `paid`, `payment_captured`, `packing` and `shipped`, and you want to stop once both "payment captured" and "shipped" have been seen, use Until with the third mode. If all conditions are true at the same check, the loop also stops right away. The count starts over each time the Until step starts.

## Loops

| Setting | Description |
|---------|-------------|
| **Iterations** (For) | Number of iterations |
| **Max iterations** (While / Do While / Until) | The most iterations to run, 30 by default and at most 1000. When reached, the loop ends and the workflow continues with the next steps |
| **Wait between iterations** | Milliseconds to wait between iterations, not before the first, up to one hour. Use it to poll a job that takes time; Stop ends the wait immediately |

Requests inside a loop can use `{{$loopIndex}}` for the current iteration (from 1; in nested loops, of the innermost loop), for example `{{baseUrl}}/orders?page={{$loopIndex}}`.

## Set Variables

Each row sets one global variable; values can use `{{variables}}` and `{{$loopIndex}}`. The variables are set in order when the step runs, and the log shows the values that were set. Common uses:

- Reset variables left by the last run when the workflow starts, for example `page` = `1`.
- Save a value shared by this run, for example `runId` = `{{$guid}}`, and use `{{runId}}` in later requests.

## Run

Click **Run** to run the workflow as it is in the editor (including unsaved changes), and **Stop** to stop it. Only one workflow can run at a time.

- The workflow stops when the tests of a request fail or the request fails.
- The workflow stops when an If condition is false and there are no Else steps.
- A loop that reaches Max iterations ends; this is not a failure.
- Variables extracted by request tests are saved as global variables and are available to the next steps right away.
- If you switch the environment during a run, the next steps use the new environment's variables.

## Run log

![Run log](/screenshots/workflow-log.png)

Click **Log** to open the run log. It shows the workflow, steps, loops and each iteration as a tree, with time, status, type, duration and how many requests passed; during a run, **Jump to latest** follows the latest step. Click a row to see details:

- Conditions: target, operator, expected value (after replacing variables) and actual value. With several conditions, the result of each one, and in the any-order mode the iteration in which it was met.
- Request steps: the request, response and test results.
- Set Variables: the variables and values that were set.

![Condition details in the run log](/screenshots/workflow-log-detail.png)

## Examples

### Log in and call with the token

| Step | Settings |
|------|----------|
| Existing Request · Login | Extract `$.data.token` as `token` in Tests |
| Existing Request · Get profile | Authorization: Bearer Token, Token `{{token}}` |

### Poll a job

| Step | Settings |
|------|----------|
| Set Variables | `orderId` = empty, to clear the value left by the last run |
| Existing Request · Create order | Extract `$.id` as `orderId` in Tests |
| Until · Wait for order | Stop when: Each condition has been met (any order); condition 1: Last response · JSON path `$.status` equals `payment_captured`; condition 2: Last response · JSON path `$.status` equals `shipped`; Max iterations `60`, Wait between iterations `2000` ms |
| └ Existing Request · Get order | URL `{{baseUrl}}/orders/{{orderId}}`, test `$.id` equals `{{orderId}}` |

### Pages by number

| Step | Settings |
|------|----------|
| For · Pages | Iterations `5` |
| └ Inline Request · List orders | URL `{{baseUrl}}/orders?page={{$loopIndex}}` |

### Pages by a "next page" field

The API returns `{"items": [...], "nextPage": 2}`, and `nextPage` is `null` on the last page:

| Step | Settings |
|------|----------|
| Set Variables | `page` = `1` |
| Until · All pages | Condition: Last response · JSON path `$.nextPage` Not exists |
| └ Existing Request · List orders | URL `{{baseUrl}}/orders?page={{page}}`, extract `$.nextPage` as `page` in Tests |
