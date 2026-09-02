# Workflow Test Coverage Matrix

Target service: `https://httpbin.org`

| Feature | Component | Property / Scenario | Test File | Test Case | Status |
| --- | --- | --- | --- | --- | --- |
| Workflow CRUD | Store | create/save/load/delete workflow | `test/workflow/workflow-store.test.ts` | `WF-STORE-001` | Covered |
| Workflow Draft | Store | save/restore/clear draft | `test/workflow/workflow-store.test.ts` | `WF-STORE-001` | Covered |
| Workflow Logs | Store | started/completed lifecycle | `test/workflow/workflow-store.test.ts` | `WF-STORE-002` | Covered |
| Workflow Logs | Store | clear scoped logs | `test/workflow/workflow-store.test.ts` | `WF-STORE-003` | Covered |
| Request | Inline Request | GET, params, headers, status test | `test/workflow/request-step.test.ts` | `WF-REQ-001` | Covered |
| Request | Existing Request | reference request loaded from storage | `test/workflow/request-step.test.ts` | `WF-REQ-002` | Covered |
| Request | Existing Request | missing request failure | `test/workflow/request-step.test.ts` | `WF-REQ-003` | Covered |
| Request | Tests | failed tests stop workflow | `test/workflow/request-step.test.ts` | `WF-REQ-004` | Covered |
| Request | Tests | JSON field and global variable extraction | `test/workflow/request-step.test.ts` | `WF-REQ-005` | Covered |
| Condition | Last Response | status/body/header/jsonPath | `test/workflow/conditions.test.ts` | `WF-COND-001` | Covered |
| Condition | Step Response | source step response status | `test/workflow/conditions.test.ts` | `WF-COND-002` | Covered |
| Condition | Global Variable | source global variable value | `test/workflow/conditions.test.ts` | `WF-COND-002` | Covered |
| Condition | Loop Index | source loop iteration value | `test/workflow/conditions.test.ts` | `WF-COND-002` | Covered |
| Condition | Operators | equals/notEquals/contains/notContains/exists/notExists/greaterThan/lessThan/greaterThanOrEquals/lessThanOrEquals | `test/workflow/conditions.test.ts` | `WF-COND-003` | Covered |
| Control | If | then and else branches | `test/workflow/control-steps.test.ts` | `WF-CTRL-001` | Covered |
| Control | If | false condition without else fails workflow | `test/workflow/control-steps.test.ts` | `WF-CTRL-002` | Covered |
| Control | For | iterations, max cap, loopIndex | `test/workflow/control-steps.test.ts` | `WF-CTRL-003` | Covered |
| Control | While | pre-check skips body | `test/workflow/control-steps.test.ts` | `WF-CTRL-004` | Covered |
| Control | While | max iteration guard stops without failing | `test/workflow/control-steps.test.ts` | `WF-CTRL-005` | Covered |
| Control | Do While | executes at least once | `test/workflow/control-steps.test.ts` | `WF-CTRL-006` | Covered |
| Control | Until | executes until condition satisfied | `test/workflow/control-steps.test.ts` | `WF-CTRL-007` | Covered |
| Logs | Hierarchy | workflow -> loop -> iteration -> request parent IDs | `test/workflow/logs.test.ts` | `WF-LOG-001` | Covered |
| Logs | Status | no final log uses running | `test/workflow/logs.test.ts` | `WF-LOG-002` | Covered |
| Logs | Max Iterations | guard logs stopped/warn instead of failed | `test/workflow/logs.test.ts` | `WF-LOG-003` | Covered |
