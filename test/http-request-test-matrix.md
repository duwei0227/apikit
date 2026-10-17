# HttpRequest Test Coverage Matrix

Target service: `https://httpbin.org`

| Feature | Component | Property / Scenario | Test File | Test Case | Status |
| --- | --- | --- | --- | --- | --- |
| Execution | HttpExecutionService | GET request, params, headers, variable replacement, console log | `test/http-request/http-execution.test.ts` | `HTTP-REQ-001` | Covered |
| Body | HttpExecutionService | JSON body and content type | `test/http-request/http-execution.test.ts` | `HTTP-REQ-002` | Covered |
| Body | HttpExecutionService | x-www-form-urlencoded body and content type | `test/http-request/http-execution.test.ts` | `HTTP-REQ-002` | Covered |
| Body | HttpExecutionService | text form-data body serialized to JSON | `test/http-request/http-execution.test.ts` | `HTTP-REQ-002` | Covered |
| Auth | HttpExecutionService | Bearer token authorization | `test/http-request/http-execution.test.ts` | `HTTP-REQ-003` | Covered |
| Auth | HttpExecutionService | Basic authorization | `test/http-request/http-execution.test.ts` | `HTTP-REQ-003` | Covered |
| Settings | HttpExecutionService | followRedirects, verifySsl, acceptEncoding options | `test/http-request/http-execution.test.ts` | `HTTP-REQ-004` | Covered |
| Tests | HttpExecutionService | status code, JSON field, global variable extraction | `test/http-request/http-execution.test.ts` | `HTTP-REQ-005` | Covered |
| Tests | executeRequestTests | equals/notEquals/contains/notContains/exists/notExists/greaterThan/lessThan/greaterThanOrEquals/lessThanOrEquals | `test/http-request/http-execution.test.ts` | `HTTP-REQ-006` | Covered |
| Tests | Utility | JSON path extraction and failed test result | `test/http-request/http-execution.test.ts` | `HTTP-REQ-007` | Covered |
| Cancel | HttpExecutionService | cancel valid and empty runtime request id | `test/http-request/http-execution.test.ts` | `HTTP-REQ-008` | Covered |
| Body | HttpExecutionService | GET request with JSON, x-www-form-urlencoded, and text form-data bodies | `test/http-request/http-execution.test.ts` | `HTTP-REQ-009` | Covered |
| Body | HttpExecutionService | HEAD and OPTIONS requests do not send configured bodies | `test/http-request/http-execution.test.ts` | `HTTP-REQ-010` | Covered |
| Body | HttpExecutionService | POST and GET XML bodies, variable replacement, and default content type | `test/http-request/http-execution.test.ts` | `HTTP-REQ-011` | Covered |
| Body | HttpExecutionService | Explicit SOAP XML content type is preserved | `test/http-request/http-execution.test.ts` | `HTTP-REQ-012` | Covered |
| Body | XML utility / cURL parser | XML formatting, strict validation, whitespace preservation, and cURL recognition | `test/http-request/xml-body.test.ts` | `XML-BODY-001`–`004` | Covered |
