# Import and Export

## Import

Click **Import** in the top toolbar, or right-click a collection and choose **Import**. There are two import types:

### File

Choose a file; ApiKit detects the format and shows a preview. Check what to import and click **Import**:

| Format | Description |
|--------|-------------|
| ApiKit JSON | Collections and workflows exported from ApiKit |
| Postman Collection v2.1 | Collections exported from Postman (JSON) |
| OpenAPI 3.x / Swagger 2.0 | JSON or YAML documents |

- When a name is already used by a collection or workflow, the imported one is renamed; the preview shows the name it will get.
- The preview lists any import warnings.

How **OpenAPI / Swagger documents** are imported:

- Each document becomes one collection, with one folder per tag.
- Request URLs use the `{{baseUrl}}` variable; you can also create an environment whose `baseUrl` comes from the document's server URL (empty when the document has none, so fill it in yourself).
- Parameters, headers, bodies and examples are restored as far as possible; only `$ref` references inside the document are resolved.
- These are not imported, and the preview points them out: `$ref` references to external files, OAuth2 / OpenID Connect auth, cookie parameters and cookie API keys, the TRACE method, and unsupported body types.

### cURL

Paste a cURL command to import it as a new request, opened in a new tab. The method, URL and query parameters, headers, body (`-d`, `--data-*`, `-F`, …), Basic and Bearer auth, and settings such as `-k`, `-L` and `--compressed` are recognized; unsupported options are ignored and reported.

You can also paste a cURL command in the **Code** tab of a request to fill the current request with it.

## Export

Click **Export** in the top toolbar, or right-click a collection and choose **Export**. Check the collections and workflows to export and choose a format:

| Format | Description |
|--------|-------------|
| ApiKit JSON | Collections and workflows, ready to import completely in ApiKit on another computer |
| Postman | Postman Collection v2.1, collections only |

When an exported workflow uses a request that is not in the exported collections, that step becomes an inline request (keeping the step's customizations), so the workflow still runs after import.

## Environments

In **Manage Environments**:

- **Import**: import an ApiKit JSON or Postman environment file.
- **Export**: choose environments and export them as ApiKit JSON or Postman. Several environments in ApiKit JSON go into one file; in Postman format, each environment is saved as its own `.postman_environment.json` file in a folder you choose.

Global variables are not exported with environments.
