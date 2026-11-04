// 工具定义：名称、说明和参数结构，交给 Rust 端的 tools/list

import { requestFieldProperties, workflowStepDefs, workflowStepsSchema } from '../schemas';
import {
  DEFAULT_BODY_PREVIEW_CHARS,
  DEFAULT_LOG_BODY_PAGE_CHARS,
  DEFAULT_RUN_CONCURRENCY,
  DEFAULT_REQUEST_LOG_LIMIT,
  DEFAULT_SEARCH_LIMIT,
  MAX_BATCH_REQUESTS,
  MAX_BODY_CHARS,
  MAX_BODY_PREVIEW_CHARS,
  MAX_RUN_CONCURRENCY,
  MAX_RUN_REQUESTS,
  MAX_REQUEST_LOG_LIMIT,
  MAX_SEARCH_LIMIT,
  type McpToolDefinition,
} from './types';

const objectSchema = (properties: Record<string, unknown>, required: string[] = [], extra: Record<string, unknown> = {}) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
  ...extra,
});

const environmentVariablesSchema = {
  type: 'array',
  description: 'Variables to add or update, matched by key. Variables you do not list stay as they are. For an existing variable, omit value or pass "<hidden>" to keep its current value; a new variable defaults to an empty value if omitted.',
  items: {
    type: 'object',
    properties: {
      key: { type: 'string' },
      value: { type: 'string' },
      enabled: { type: 'boolean', description: 'Defaults to true for a new variable' },
      description: { type: 'string' },
    },
    required: ['key'],
  },
};

const queryProperty = { type: 'string', description: 'Keywords separated by spaces, for example "bpp login". Every keyword must appear (case-insensitive, partial words are fine) in the name or the collection/folder path.' };
const viewProperty = (fallback: 'summary' | 'full') => ({
  type: 'string',
  enum: ['summary', 'full'],
  description: `Default ${fallback}. Use summary to choose an item, full for the details.`,
});
const workflowNameProperty = { type: 'string', description: 'Workflow name, used when workflowId is not given; partial names are fine' };

const collectionNameProperty = { type: 'string', description: 'Collection name, used when collectionId is not given; partial names are fine' };
const folderPathProperty = {
  type: 'array',
  description: 'Folder names from the collection root down, one entry per level, for example ["Orders", "Refunds"]; partial names are fine. Pass either folderPath or folderId, not both; omit both for the collection root. An entry can also be { "id": "<folder id>" } for a known folder at that level, or { "name": "<name>", "create": true } to create a new folder there.',
  items: {
    anyOf: [
      { type: 'string' },
      { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
      { type: 'object', properties: { name: { type: 'string' }, create: { type: 'boolean' } }, required: ['name'], additionalProperties: false },
    ],
  },
};
// 批量工具中请求字段出现两次（单项和公共字段），较大的子结构放进 $defs 只写一次
const REFERENCED_FIELDS = ['params', 'headers', 'body', 'auth', 'tests', 'settings'] as const;
const requestFieldDefs = Object.fromEntries(REFERENCED_FIELDS.map(key => [key, requestFieldProperties[key]]));
const requestFieldRefs: Record<string, unknown> = Object.fromEntries(Object.entries(requestFieldProperties).map(([key, schema]) => [
  key,
  (REFERENCED_FIELDS as readonly string[]).includes(key) ? { $ref: `#/$defs/${key}` } : schema,
]));
const { name: _name, url: _url, ...sharedRequestFieldRefs } = requestFieldRefs;
const requestRefsProperty = { type: 'array', items: { type: 'string' }, description: 'Request ids or names (partial names are fine), for example ["Login", "kLXPLXFPwE-ainiuGTgGs"]. Use instead of collection/folderPath/query.' };

/** 按名称定位时的统一说明 */
export const NAME_NOTE = 'Name matching: an exact name (ignoring case) is used even if other names contain it; otherwise a single partial match is used and reported in resolved. If several match, ApiKit asks the user to choose, or the call fails with JSON error "ambiguous" listing candidates { id, name }: ask the user, then call again with the chosen id (collectionId, requestId, or a { "id" } entry in folderPath). If nothing matches, the error lists the closest or available items with their ids.';

/** 新建目录的工具中 folderPath 的规则不同：相近但不同名的目录要用户在使用和新建之间选择 */
const FOLDER_CREATE_NOTE = 'In folderPath, a level with an exactly matching folder uses it; a level with only similar folders asks the user whether to use one or create a new folder (or fails with "ambiguous" and canCreate: true); a level with no similar folder is created, together with the levels below it.';

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'list_collections',
    title: 'List collections',
    kind: 'read',
    description: 'Browse collections and folders. Returns { collections } in display order. Default view summary: each collection and folder as { id, name, requestCount (including subfolders), folders }, without requests; use search_requests to find requests. query keeps only matching collections, folders and requests plus their parents: a matching collection or folder keeps all its subfolders (in view full also its requests), and requests that match on name, URL or path are listed as requests: [{ id, name, method }]. depth limits the folder levels when there is no query; a folder at the limit shows folderCount instead of folders. view full returns items: every folder and request as { type, id, name, method, url }.',
    inputSchema: objectSchema({
      query: queryProperty,
      collectionId: { type: 'string', description: 'Only this collection' },
      depth: { type: 'integer', minimum: 1, description: 'Folder levels to list without query; deeper levels show folderCount' },
      view: viewProperty('summary'),
    }),
  },
  {
    name: 'search_requests',
    title: 'Search requests',
    kind: 'read',
    description: 'Find saved requests, for example to get a requestId. Pass at least one of query, method or collectionId. Do not wrap arguments in a params object. For text search use query, not keyword: keywords separated by spaces; every keyword must appear in the request name, URL or collection/folder path, so a URL fragment such as "/orders" works too. Best matches come first; without query the display order is kept. Returns { total (matches before limit), requests }: view summary (default) gives { requestId, name, method, path }, full also gives url, collectionId and folderId.',
    inputSchema: objectSchema({
      query: { type: 'string', description: 'Keywords to find in the request name, URL or path, for example "bpp login" or a URL fragment. This is the correct argument for text search; there is no keyword argument.' },
      method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'], description: 'Only requests with this HTTP method' },
      collectionId: { type: 'string', description: 'Only requests in this collection' },
      limit: { type: 'integer', minimum: 1, maximum: MAX_SEARCH_LIMIT, description: `Default ${DEFAULT_SEARCH_LIMIT}` },
      view: viewProperty('summary'),
    }),
  },
  {
    name: 'get_request',
    title: 'Get request',
    kind: 'read',
    mayConfirm: true,
    description: `Get one saved request. Pass requestId, or request (its name, optionally with words of its collection or folder). view full (default) returns the whole definition: id, name, method, url, params, headers, body, auth, tests, settings, collectionId, folderId. view summary returns id, name, method, url, the names of enabled params and headers, bodyType, authType, testCount, extractedVariables, collectionId and folderId. Both include hasUnsavedEdits; when it is true the result shows the unsaved edits. Secrets are "<hidden>" unless the user allows revealing them. ${NAME_NOTE}`,
    inputSchema: objectSchema({
      requestId: { type: 'string' },
      request: { type: 'string', description: 'Request name, optionally with words of its collection or folder' },
      view: viewProperty('full'),
    }),
  },
  {
    name: 'open_request',
    title: 'Open request',
    kind: 'write',
    localOnly: true,
    description: 'Open a saved request in ApiKit and select its tab.',
    inputSchema: objectSchema({ requestId: { type: 'string' } }, ['requestId']),
  },
  {
    name: 'close_request',
    title: 'Close request',
    kind: 'write',
    localOnly: true,
    description: 'Close an open request tab. If it has unsaved edits, the first call returns the complete current definition and a confirmationId without closing it. Show the edits to the user and ask whether to save or discard; then call again with that confirmationId and decision. Use the exact confirmationId from the review response. Saving is only available for requests assigned to a collection; check availableDecisions. If the edits change before confirmation, a new review is required.',
    inputSchema: objectSchema({
      requestId: { type: 'string', description: 'Id of an open saved request, for example from search_requests.' },
      decision: { type: 'string', enum: ['save', 'discard'], description: 'After the user reviews unsaved edits, choose save or discard. Requires confirmationId from the review response.' },
      confirmationId: { type: 'string', description: 'Exact token returned by the first close call; required together with decision.' },
    }, ['requestId']),
  },
  {
    name: 'list_workflows',
    title: 'List workflows',
    kind: 'read',
    description: 'List workflows in sidebar order. Returns { workflows }: view summary (default) gives { id, name, folderPath } where folderPath is the names of the sidebar folders that contain it (empty at the top level); view full also gives stepCount, updatedAt and hasUnsavedEdits. query keeps workflows whose name or folderPath contains every keyword, best matches first.',
    inputSchema: objectSchema({ query: queryProperty, view: viewProperty('summary') }),
  },
  {
    name: 'open_workflow',
    title: 'Open workflow',
    kind: 'write',
    localOnly: true,
    description: 'Open a workflow in ApiKit and select its tab.',
    inputSchema: objectSchema({ workflowId: { type: 'string' } }, ['workflowId']),
  },
  {
    name: 'close_workflow',
    title: 'Close workflow',
    kind: 'write',
    localOnly: true,
    description: 'Close an open workflow tab. If it has unsaved edits, the first call returns the complete current workflow and a confirmationId without closing it. Show the edits to the user and ask whether to save or discard; then call again with that confirmationId and decision. Use the exact confirmationId from the review response. If the edits change before confirmation, a new review is required.',
    inputSchema: objectSchema({
      workflowId: { type: 'string', description: 'Id of an open workflow, for example from list_workflows.' },
      decision: { type: 'string', enum: ['save', 'discard'], description: 'After the user reviews unsaved edits, choose save or discard. Requires confirmationId from the review response.' },
      confirmationId: { type: 'string', description: 'Exact token returned by the first close call; required together with decision.' },
    }, ['workflowId']),
  },
  {
    name: 'get_workflow',
    title: 'Get workflow',
    kind: 'read',
    mayConfirm: true,
    description: `Get one workflow. Pass workflowId, or workflow (its name). view full (default) returns { id, name, hasUnsavedEdits, stepCount, steps } with every step in the format create_workflow accepts; view summary returns only each step's id, type, name, requestId and nested thenSteps/elseSteps/childSteps. When hasUnsavedEdits is true the steps show the unsaved edits. ${NAME_NOTE}`,
    inputSchema: objectSchema({ workflowId: { type: 'string' }, workflow: workflowNameProperty, view: viewProperty('full') }),
  },
  {
    name: 'list_environments',
    title: 'List environments',
    kind: 'read',
    description: 'List environments and global variables. Values are shown as "<hidden>" unless the user allowed revealing them in ApiKit.',
    inputSchema: objectSchema({}),
  },
  {
    name: 'list_builtin_variables',
    title: 'List built-in variables',
    kind: 'read',
    description: 'List the built-in dynamic variables, such as {{$timestamp}}, {{$guid}}, {{$randomInt(1, 100)}} and {{$sequence}}, with usage, parameters and an example value. They can be used anywhere {{variable}} is accepted and take precedence over environment and global variables of the same name. Each occurrence is generated when the request is sent, and $sequence advances at each occurrence. The example value of $sequence is its next value; listing does not advance the sequence.',
    inputSchema: objectSchema({}),
  },
  {
    name: 'create_environment',
    title: 'Create environment',
    kind: 'write',
    mayConfirm: true,
    description: 'Create an environment, optionally with variables. Requests read its variables as {{key}} while it is the active environment. Pass activate to also make it the active environment; the user must approve that.',
    inputSchema: objectSchema({
      name: { type: 'string' },
      variables: environmentVariablesSchema,
      activate: { type: 'boolean' },
    }, ['name']),
  },
  {
    name: 'update_environment',
    title: 'Update environment',
    kind: 'write',
    description: 'Rename an environment and/or add, update or remove its variables.',
    inputSchema: objectSchema({
      environmentId: { type: 'string' },
      name: { type: 'string' },
      variables: environmentVariablesSchema,
      removeVariables: { type: 'array', items: { type: 'string' }, description: 'Keys of variables to remove' },
    }, ['environmentId']),
  },
  {
    name: 'set_global_variables',
    title: 'Set global variables',
    kind: 'write',
    description: 'Add, update or remove global variables. They are available in every environment; a variable of the active environment with the same key takes precedence.',
    inputSchema: objectSchema({
      variables: environmentVariablesSchema,
      removeVariables: { type: 'array', items: { type: 'string' }, description: 'Keys of variables to remove' },
    }),
  },
  {
    name: 'set_active_environment',
    title: 'Set active environment',
    kind: 'execute',
    localOnly: true,
    description: 'Switch the active environment, or pass null to use no environment. Requests sent by the user and by you then use its variables. The user must approve this.',
    inputSchema: objectSchema({
      environmentId: { type: ['string', 'null'], description: 'Id from list_environments, or null for no environment' },
    }, ['environmentId']),
  },
  {
    name: 'create_collection',
    title: 'Create collection',
    kind: 'write',
    description: 'Create an empty collection, optionally with a description.',
    inputSchema: objectSchema({
      name: { type: 'string', description: 'Collection name.' },
      description: { type: 'string', description: 'Optional collection description.' },
    }, ['name']),
  },
  {
    name: 'update_collection',
    title: 'Update collection',
    kind: 'write',
    description: 'Rename a collection and/or change its description.',
    inputSchema: objectSchema({
      collectionId: { type: 'string' },
      name: { type: 'string' },
      description: { type: 'string' },
    }, ['collectionId']),
  },
  {
    name: 'update_folder',
    title: 'Update folder',
    kind: 'write',
    description: 'Rename a folder in a collection.',
    inputSchema: objectSchema({
      collectionId: { type: 'string' },
      folderId: { type: 'string' },
      name: { type: 'string' },
    }, ['collectionId', 'folderId', 'name']),
  },
  {
    name: 'create_folder',
    title: 'Create folder',
    kind: 'write',
    description: 'Create a folder in a collection, optionally inside another folder.',
    inputSchema: objectSchema({
      collectionId: { type: 'string' },
      name: { type: 'string' },
      parentFolderId: { type: 'string' },
    }, ['collectionId', 'name']),
  },
  {
    name: 'create_request',
    title: 'Create request',
    kind: 'write',
    description: 'Create one request; to create several, use create_requests in one call. Pass collectionId, optional folderId, and request fields directly as tool arguments (not inside a params object); name and url are required. Defaults: method GET, no body, no auth, and a status code test expecting 200. Returns { id, name, method, url, collectionId, folderId }; use get_request for the details.',
    inputSchema: objectSchema({
      collectionId: { type: 'string' },
      folderId: { type: 'string' },
      ...requestFieldProperties,
    }, ['collectionId', 'name', 'url']),
  },
  {
    name: 'create_requests',
    title: 'Create requests',
    kind: 'write',
    mayConfirm: true,
    description: `Create up to ${MAX_BATCH_REQUESTS} requests in one call, creating folders as needed; prefer this over several create_request or import_curl calls. Target: collectionId or collection (name); then folderId, folderPath, or neither for the collection root. Each item in requests is one of: (1) request fields, name and url required; (2) { curl, name? } to import a cURL command, other given fields override what the command sets; (3) { copyFrom: <request id or name>, ...fields to change }, name defaults to "<original name> copy". defaults only apply to items of form (1): defaults.baseUrl is put in front of each relative url (urls starting with a scheme such as https:// or with {{ are kept); headers are merged by key ignoring case and params by key, the item winning; settings are merged; other default fields are used when the item omits them. onExists decides what happens when an item's name (exact, case-sensitive) already exists directly in the target folder: skip (default, the existing request is kept and reported), update (its whole content is replaced by the item; fields the item omits get their defaults; unsaved-edit rules as in update_request), error (the call fails and nothing is saved) or create (a second request with that name). Names must be unique within one call unless onExists is create. Every item is checked before anything is saved; an error names the item, for example requests[2]. Returns { collectionId, folderId, path, createdFolders?, created, skipped, updated, requests: [{ id, name, method, status }], warnings? }. ${FOLDER_CREATE_NOTE} ${NAME_NOTE}`,
    inputSchema: objectSchema({
      collectionId: { type: 'string' },
      collection: collectionNameProperty,
      folderId: { type: 'string' },
      folderPath: folderPathProperty,
      defaults: {
        type: 'object',
        description: 'Fields shared by the items given as request fields (not by curl or copyFrom items)',
        properties: { baseUrl: { type: 'string', description: 'For example {{baseUrl}}/api or https://api.example.com' }, ...sharedRequestFieldRefs },
        additionalProperties: false,
      },
      onExists: { type: 'string', enum: ['skip', 'error', 'update', 'create'], description: 'What to do when a request with the same name exists in the target folder. Default skip' },
      requests: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_BATCH_REQUESTS,
        items: {
          type: 'object',
          description: 'Request fields (name and url required), or { curl, name? }, or { copyFrom, ...fields to change }',
          properties: {
            ...requestFieldRefs,
            curl: { type: 'string', description: 'A cURL command to import instead of fields' },
            copyFrom: { type: 'string', description: 'Id or name of a saved request to copy into the target folder; the given fields change the copy, the original is unchanged' },
          },
          additionalProperties: false,
        },
      },
    }, ['requests'], { $defs: requestFieldDefs }),
  },
  {
    name: 'import_curl',
    title: 'Import cURL',
    kind: 'write',
    description: 'Save one cURL command as a new request in a collection or folder, the same way as importing cURL in ApiKit: method, URL with query parameters, headers, body, basic or bearer auth and settings such as -k and -L. For several commands, use create_requests with { curl } items. The name defaults to the method and path, for example "POST /orders". Returns { id, name, method, url, collectionId, folderId, warnings } where warnings lists cURL options that were ignored.',
    inputSchema: objectSchema({
      curl: { type: 'string', description: 'The full cURL command, for example curl -X POST https://api.example.com/orders -H "Content-Type: application/json" -d \'{"qty":1}\'' },
      collectionId: { type: 'string' },
      folderId: { type: 'string' },
      name: { type: 'string' },
    }, ['curl', 'collectionId']),
  },
  {
    name: 'import_spec',
    title: 'Import API document',
    kind: 'write',
    mayConfirm: true,
    description: `Import an OpenAPI 3 / Swagger 2 document, a Postman collection or an ApiKit export, in JSON or YAML. Pass exactly one source: filePath (absolute path of a local .json, .yaml or .yml file, read by ApiKit), url (downloaded by ApiKit after the user approves) or content (the document text; avoid it for large documents). Without collection/collectionId each collection in the file becomes a new collection (name renames it when there is only one). With collection/collectionId the folders and requests are added to that collection, or to folderPath/folderId inside it; a file with several collections gets one subfolder per collection, and name is not used. OpenAPI tags become folders. createEnvironment: true also creates the environment an OpenAPI document defines (for example baseUrl); otherwise the result lists it in availableEnvironments. Workflows in ApiKit exports are not imported. Returns { source, createdCollections or collectionId/folderId/path, importedRequests, createdFolders, createdEnvironments?, availableEnvironments?, warnings? }. ${FOLDER_CREATE_NOTE} ${NAME_NOTE}`,
    inputSchema: objectSchema({
      filePath: { type: 'string', description: 'Absolute path of a local .json, .yaml or .yml document' },
      url: { type: 'string', description: 'Address of the document' },
      content: { type: 'string', description: 'The whole document text, JSON or YAML' },
      collectionId: { type: 'string' },
      collection: collectionNameProperty,
      folderId: { type: 'string' },
      folderPath: folderPathProperty,
      name: { type: 'string', description: 'Name of the new collection; only used without collection/collectionId' },
      createEnvironment: { type: 'boolean', description: 'Also create the environment an OpenAPI document defines. Default false' },
    }),
  },
  {
    name: 'update_request',
    title: 'Update request',
    kind: 'write',
    description: 'Change fields of one saved request; to change several, use update_requests in one call. Pass requestId and the fields to change directly as tool arguments. Omitted fields stay unchanged; supplied list fields such as headers and params replace the whole list, while settings merge with the existing settings. For auth credentials and sensitive header values, "<hidden>" keeps the existing secret. Depending on the ApiKit settings, the change is either kept as unsaved edits that the user reviews and saves in ApiKit (the result then has unsavedEdits: true; tell the user), or saved directly, which fails if the user has unsaved edits to the request. Unsaved edits are changed on top of the existing ones. Returns { id, name, method, url, collectionId, folderId, unsavedEdits? }.',
    inputSchema: objectSchema({ requestId: { type: 'string' }, ...requestFieldProperties }, ['requestId']),
  },
  {
    name: 'update_requests',
    title: 'Update requests',
    kind: 'write',
    mayConfirm: true,
    description: `Change up to ${MAX_BATCH_REQUESTS} saved requests in one call; prefer this over several update_request calls. Use one of two forms. (1) Different changes per request: updates: [{ requestId or request (name), ...fields }]; do not pass the other arguments. (2) The same change for many requests: select them with requestIds, or with collection/collectionId plus optional folderPath/folderId (all requests inside, including subfolders) and query (keywords matched against name, URL and path); then pass set (request fields except name; lists such as headers replace the whole list), mergeHeaders (add headers, or replace those with the same key ignoring case) and/or removeHeaders (header names, ignoring case), applied in that order. Field rules, "<hidden>" and unsaved edits work as in update_request. A selection of more than ${MAX_BATCH_REQUESTS} requests fails; narrow it. Every request is checked before anything is saved; an error names the request, for example updates[1]. Returns { updated, requests: [{ id, name, method, unsavedEdits? }] }. ${NAME_NOTE}`,
    inputSchema: objectSchema({
      updates: {
        type: 'array',
        maxItems: MAX_BATCH_REQUESTS,
        items: {
          type: 'object',
          description: 'Form (1): requestId or request, plus the fields to change',
          properties: { requestId: { type: 'string' }, request: { type: 'string', description: 'Request name, used when requestId is not given; may include words of its collection or folder' }, ...requestFieldRefs },
          additionalProperties: false,
        },
      },
      requestIds: requestRefsProperty,
      collectionId: { type: 'string' },
      collection: collectionNameProperty,
      folderId: { type: 'string' },
      folderPath: folderPathProperty,
      query: { type: 'string', description: 'Form (2) with collection: only requests whose name, URL or path contains every keyword' },
      set: { type: 'object', description: 'Form (2): request fields to set on every selected request (not name)', properties: sharedRequestFieldRefs, additionalProperties: false },
      mergeHeaders: { type: 'array', description: 'Headers to add, or replace when a header with the same key exists', items: { type: 'object', properties: { key: { type: 'string' }, value: { type: 'string' }, enabled: { type: 'boolean' } }, required: ['key'] } },
      removeHeaders: { type: 'array', items: { type: 'string' }, description: 'Header names to remove (case-insensitive)' },
    }, [], { $defs: requestFieldDefs }),
  },
  {
    name: 'create_workflow',
    title: 'Create workflow',
    kind: 'write',
    description: 'Create a workflow. Steps run in order. A request step must specify exactly one of requestId or inlineRequest; requestOverrides can be used with requestId. A request step whose tests fail stops the workflow. An if step whose condition is false and has no else steps stops the workflow. while checks the condition before each iteration, doWhile after each iteration (repeats while true), until after each iteration (stops once true). A step can have several conditions (conditions) combined by conditionMatch: all, any, or for until also cumulative, where each condition counts once it was true at some check, in any order. A loop that reaches its iteration limit stops and the workflow continues. A setVariables step sets global variables, for example to reset a page counter before a loop.',
    inputSchema: objectSchema({
      name: { type: 'string' },
      steps: workflowStepsSchema,
    }, ['name', 'steps'], { $defs: workflowStepDefs }),
  },
  {
    name: 'update_workflow',
    title: 'Update workflow',
    kind: 'write',
    description: 'Rename a workflow and/or replace all of its steps. Pass workflowId and name and/or steps directly as tool arguments; steps use exactly the step format of create_workflow (see its input schema) and replace every existing step. Depending on the ApiKit settings, the change is either kept as unsaved edits that the user reviews and saves in ApiKit (the result then has unsavedEdits: true; tell the user), or saved directly, which fails if the user has unsaved edits to the workflow. Unsaved edits are changed on top of the existing ones.',
    inputSchema: objectSchema({
      workflowId: { type: 'string' },
      name: { type: 'string' },
      // 步骤结构与 create_workflow 相同；不重复整份 schema，减少每次 tools/list 的内容，由 ApiKit 校验
      steps: { type: 'array', description: 'Steps in the same format as create_workflow steps', items: { type: 'object' } },
    }, ['workflowId']),
  },
  {
    name: 'move_request',
    title: 'Move request',
    kind: 'write',
    description: 'Move a saved request to another collection, or to a folder (folderId) in a collection. It is placed at the end.',
    inputSchema: objectSchema({
      requestId: { type: 'string' },
      collectionId: { type: 'string', description: 'Target collection' },
      folderId: { type: 'string', description: 'Target folder in that collection; omit for the top level' },
    }, ['requestId', 'collectionId']),
  },
  {
    name: 'delete_request',
    title: 'Delete request',
    kind: 'write',
    destructive: true,
    description: 'Permanently delete a saved request, including unsaved edits. The user must approve every deletion. The result lists workflows that used the request; their steps then refer to a missing request.',
    inputSchema: objectSchema({ requestId: { type: 'string' } }, ['requestId']),
  },
  {
    name: 'delete_folder',
    title: 'Delete folder',
    kind: 'write',
    destructive: true,
    description: 'Permanently delete a folder with its subfolders and all requests in them. The user must approve every deletion. The result lists workflows that used those requests.',
    inputSchema: objectSchema({ collectionId: { type: 'string' }, folderId: { type: 'string' } }, ['collectionId', 'folderId']),
  },
  {
    name: 'delete_collection',
    title: 'Delete collection',
    kind: 'write',
    destructive: true,
    description: 'Permanently delete a collection with all its folders and requests. The user must approve every deletion. The result lists workflows that used those requests.',
    inputSchema: objectSchema({ collectionId: { type: 'string' } }, ['collectionId']),
  },
  {
    name: 'delete_workflow',
    title: 'Delete workflow',
    kind: 'write',
    destructive: true,
    description: 'Permanently delete a workflow, including unsaved edits. The saved requests it uses are kept. The user must approve every deletion.',
    inputSchema: objectSchema({ workflowId: { type: 'string' } }, ['workflowId']),
  },
  {
    name: 'send_request',
    title: 'Send request',
    kind: 'execute',
    description: 'Send one request: a saved request by passing requestId, or an unsaved request definition by passing request; pass exactly one as a direct tool argument. To send several saved requests, use run_requests (one approval, sent in parallel). A saved request uses its current unsaved edits in ApiKit, if any. The request object contains request fields such as url and HTTP query params; do not wrap tool arguments in a params object. The user must approve this. The result includes logId; use get_request_log with that id to retrieve a large request or response body in pages. Variables extracted by the request tests are saved as global variables. A {{variable}} that is not defined is sent as written; the result then lists its name in unresolvedVariables. For a streaming response (SSE or NDJSON, such as an LLM completion) the call returns when the stream ends: body is the raw stream and stream holds the merged answer text, finish reason, token usage and event count. In a custom format, the text of events such as token is thinking when other events with content (such as result) follow it, and those events are listed in stream.results; without such events the text is the answer. JSON field tests and extracted variables then read a merged object { text, thinking, finishReason, usage, eventCount, events, results }, where results maps each result event name to its last event.',
    inputSchema: objectSchema({
      requestId: { type: 'string', description: 'Id of a saved request; uses its current unsaved edits if it is open with a draft.' },
      request: {
        type: 'object',
        description: 'Request definition to send without saving it. Pass request fields inside this object; url is required.',
        properties: { ...requestFieldProperties },
        required: ['url'],
        additionalProperties: false,
      },
    }, [], { oneOf: [{ required: ['requestId'] }, { required: ['request'] }] }),
  },
  {
    name: 'run_requests',
    title: 'Run requests',
    kind: 'execute',
    description: `Send up to ${MAX_RUN_REQUESTS} saved requests in parallel after one approval from the user; prefer this over several send_request calls. Select them with requestIds, or with collection/collectionId plus optional folderPath/folderId (all requests inside, including subfolders) and query (keywords matched against name, URL and path). A selection of more than ${MAX_RUN_REQUESTS} requests fails; narrow it. Each request uses its unsaved edits, if any, and the active environment. Returns { total, passed, failed, totalMs, results } with one result per request in selection order: { requestId, name, method, passed, status, time, logId, failures? (failed tests), bodyPreview?, unresolvedVariables? }, or { requestId, name, method, passed: false, error } when no response came back. Use get_request_log with logId for the full request and response. Variables extracted by tests are saved as global variables as each request finishes, so requests in one call must not depend on each other; use run_workflow for dependent requests. ${NAME_NOTE}`,
    inputSchema: objectSchema({
      requestIds: requestRefsProperty,
      collectionId: { type: 'string' },
      collection: collectionNameProperty,
      folderId: { type: 'string' },
      folderPath: folderPathProperty,
      query: { type: 'string', description: 'Only requests whose name, URL or path matches these keywords' },
      maxConcurrency: { type: 'integer', minimum: 1, maximum: MAX_RUN_CONCURRENCY, description: `Requests sent at the same time; default ${DEFAULT_RUN_CONCURRENCY}` },
      bodyPreviewChars: { type: 'integer', minimum: 0, maximum: MAX_BODY_PREVIEW_CHARS, description: `Characters of each response body to include; default ${DEFAULT_BODY_PREVIEW_CHARS}, 0 for none` },
    }),
  },
  {
    name: 'run_workflow',
    title: 'Run workflow',
    kind: 'execute',
    description: `Run a workflow with the active environment and return a summary with the step log. Pass workflowId, or workflow (its name). Uses its current unsaved edits in ApiKit, if any. The user must approve this. Only one workflow can run at a time. ${NAME_NOTE}`,
    inputSchema: objectSchema({ workflowId: { type: 'string' }, workflow: workflowNameProperty }),
  },
  {
    name: 'get_workflow_logs',
    title: 'Get workflow logs',
    kind: 'read',
    description: `Get logs of the latest run of a workflow. Pass logId for one entry's request and response details. When logId is provided, bodies are returned in pages: by default the first ${DEFAULT_LOG_BODY_PAGE_CHARS} characters of both bodies. Check bodyLength and hasMore, then call again with bodyPart and the corresponding nextOffset (requestOffset or responseOffset) until hasMore is false. Offsets and lengths count UTF-16 code units. unresolvedVariables lists {{variable}} placeholders that were not defined and were sent as written.`,
    inputSchema: objectSchema({
      workflowId: { type: 'string' },
      logId: { type: 'string', description: 'Optional workflow log entry id; omit to list the latest run summary.' },
      bodyPart: { type: 'string', enum: ['request', 'response', 'both'], description: 'Which body to return when logId is provided. Defaults to both.' },
      requestOffset: { type: 'integer', minimum: 0, description: 'UTF-16 code-unit offset for the request body page; defaults to 0.' },
      responseOffset: { type: 'integer', minimum: 0, description: 'UTF-16 code-unit offset for the response body page; defaults to 0.' },
      limit: { type: 'integer', minimum: 1, maximum: MAX_BODY_CHARS, description: `Characters per selected body; defaults to ${DEFAULT_LOG_BODY_PAGE_CHARS}, maximum ${MAX_BODY_CHARS}.` },
    }, ['workflowId']),
  },
  {
    name: 'list_request_logs',
    title: 'List request logs',
    kind: 'read',
    description: `List executed HTTP requests from the ApiKit console, newest first. Includes requests sent from the editor, from workflows and through send_request. Use get_request_log for the full request and response. limit defaults to the most recent ${DEFAULT_REQUEST_LOG_LIMIT} and is capped at ${MAX_REQUEST_LOG_LIMIT}.`,
    inputSchema: objectSchema({
      urlContains: { type: 'string', description: 'Only logs whose URL contains this text (case-insensitive)' },
      method: { type: 'string', description: 'Only logs with this HTTP method' },
      status: { type: 'string', description: 'Exact status such as "404", or a class such as "4xx". "0" matches requests that got no response.' },
      limit: { type: 'integer', description: `Default ${DEFAULT_REQUEST_LOG_LIMIT}; values above ${MAX_REQUEST_LOG_LIMIT} are capped at ${MAX_REQUEST_LOG_LIMIT}` },
    }),
  },
  {
    name: 'get_request_log',
    title: 'Get request log',
    kind: 'read',
    description: `Get one executed request from list_request_logs. Bodies are returned in pages to avoid response truncation. By default, the first ${DEFAULT_LOG_BODY_PAGE_CHARS} characters of both bodies are returned. Check bodyLength and hasMore, then call again with bodyPart and the corresponding nextOffset (requestOffset or responseOffset) until hasMore is false. Offsets and lengths count UTF-16 code units. unresolvedVariables lists {{variable}} placeholders that were not defined and were sent as written.`,
    inputSchema: objectSchema({
      logId: { type: 'string' },
      bodyPart: { type: 'string', enum: ['request', 'response', 'both'], description: 'Which body to return. Defaults to both.' },
      requestOffset: { type: 'integer', minimum: 0, description: 'UTF-16 code-unit offset for the request body page; defaults to 0.' },
      responseOffset: { type: 'integer', minimum: 0, description: 'UTF-16 code-unit offset for the response body page; defaults to 0.' },
      limit: { type: 'integer', minimum: 1, maximum: MAX_BODY_CHARS, description: `Characters per selected body; defaults to ${DEFAULT_LOG_BODY_PAGE_CHARS}, maximum ${MAX_BODY_CHARS}.` },
    }, ['logId']),
  },
];
