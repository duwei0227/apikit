# ApiKit

<div align="center">

A modern, lightweight API testing tool

![GitHub release](https://img.shields.io/github/v/release/duwei0227/apikit)
![GitHub License](https://img.shields.io/github/license/duwei0227/apikit)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)

[Download](#download) • [Features](#features) • [Docs](https://duwei0227.github.io/apikit/en/) • [Changelog](CHANGELOG.md)

English | [中文](README.md)

</div>


## Introduction

ApiKit is a cross-platform API testing tool built for developers, with a clean, intuitive interface and powerful features. Whether you are debugging an endpoint or automating tests, ApiKit has you covered.

### Why ApiKit?

- 🚀 **Fast startup** - Lightweight, starts in a second, low memory use
- 💻 **Cross-platform** - Windows, macOS and Linux
- 🎨 **Modern interface** - Clean design with dark and light themes
- 🔗 **Workflows** - Chain requests with conditions and loops
- 📦 **Portable builds** - No installation needed, just unzip and run
- 🔄 **Automatic updates** - Update in the app with one click, no need to download again
- 🆓 **Free** - Open source and free forever

## Features

![ApiKit request editor](docs/public/screenshots/request.png)

| Feature | Description | Docs |
|---------|-------------|------|
| 🌐 HTTP requests | Common methods and body types, Bearer / Basic auth, file upload and download, generate and import cURL | [Sending Requests](https://duwei0227.github.io/apikit/en/guide/requests) |
| 🧪 Tests | Status and JSON field assertions (expected values can use variables), extract variables from the response JSON or headers | [Tests and Assertions](https://duwei0227.github.io/apikit/en/guide/tests) |
| 📡 Streaming responses | SSE and newline-delimited JSON shown as they arrive, with LLM answers, thinking and token usage merged | [Responses](https://duwei0227.github.io/apikit/en/guide/responses) |
| 🌍 Variables | Environment and global variables, and built-in dynamic variables such as `$guid`, `$randomInt` and `$sequence`, completed as you type `{{` | [Variables](https://duwei0227.github.io/apikit/en/guide/variables) |
| 📁 Collections | Nested folders, drag to reorder; import Postman, OpenAPI / Swagger and cURL, export ApiKit JSON or Postman | [Collections](https://duwei0227.github.io/apikit/en/guide/collections), [Import and Export](https://duwei0227.github.io/apikit/en/guide/import-export) |
| 🔗 Workflows | Folders and drag to reorder; chain requests with branches and loops (several conditions, any order), waits between iterations, `$loopIndex`, Set Variables, and a step-by-step run log | [Workflows](https://duwei0227.github.io/apikit/en/guide/workflow) |
| 🧩 Mock services | Mock APIs on a local port, return different responses by rules, and generate lists from the request with response templates | [Mock Services](https://duwei0227.github.io/apikit/en/guide/mock) |
| 🤖 AI integration (MCP) | AI tools read and change collections, requests, workflows and environments through MCP; you confirm before requests are sent and before deletions | [AI Integration](https://duwei0227.github.io/apikit/en/guide/ai) |
| 📝 Console and history | See every request actually sent and its response, and reopen requests from the history | [Console and History](https://duwei0227.github.io/apikit/en/guide/console-history) |

See the [Reference](https://duwei0227.github.io/apikit/en/guide/reference) for keyboard shortcuts, where data is stored and the FAQ.

## Download

Download the latest version from the [Releases](https://github.com/duwei0227/apikit/releases/latest) page.

### Windows

| Package | Description | Recommended |
|---------|-------------|-------------|
| `.msi` | Windows installer | ⭐ Recommended |
| `.exe` | NSIS installer | |
| `.zip` | Portable (unzip and run) | Good for USB drives |

### macOS

| Package | Description | Recommended |
|---------|-------------|-------------|
| `.dmg` | macOS disk image | ⭐ Recommended |

**Requirements**: macOS 11 Big Sur or later, with Safari updated to 16.4 or later (the interface is shown with the system WebKit).

**Note**: The first time you open ApiKit on macOS, you may need to allow it in "System Settings → Privacy & Security".

### Linux

| Package | Description | Recommended |
|---------|-------------|-------------|
| `.AppImage` | Portable (no installation) | ⭐ Recommended |
| `.deb` | Debian/Ubuntu package | |
| `.rpm` | Fedora/RHEL/CentOS package | |
| `.tar.gz` | Portable (unpack and run) | |

**Requirements**: `.deb`, `.rpm` and the portable build show the interface with the system WebKitGTK; keep your system updated (WebKitGTK 2.50 or later). With older versions, bold text may be shown at regular weight. The AppImage includes its own WebKitGTK and does not depend on the system version.

**Using the AppImage**:
```bash
chmod +x ApiKit_*.AppImage
./ApiKit_*.AppImage
```

**Using the portable build**:
```bash
tar -xzf ApiKit_*.tar.gz
cd ApiKit
./install-desktop.sh  # optional: create a desktop shortcut
./apikit.sh
```

## Documentation

See the documentation site for the full guide: **https://duwei0227.github.io/apikit/en/**. In the app, open it from **Help → Documentation**.

- [Getting Started](https://duwei0227.github.io/apikit/en/guide/getting-started): send your first request, save it to a collection, use environment variables
- [Workflow examples](https://duwei0227.github.io/apikit/en/guide/workflow#examples): log in for a token, poll a job, read pages
- [Connect an AI tool](https://duwei0227.github.io/apikit/en/guide/ai#connect)

## Feedback and Support

### Report a problem

If you run into a problem or have an idea, visit:
- [GitHub Issues](https://github.com/duwei0227/apikit/issues) - report bugs
- [GitHub Discussions](https://github.com/duwei0227/apikit/discussions) - ideas and discussion

### Contributing

Pull requests are welcome! See the [contributing guide](CONTRIBUTING.md) (if available).

## License

ApiKit is released under the [MIT License](LICENSE).

## Links

- [GitHub repository](https://github.com/duwei0227/apikit)
- [Releases](https://github.com/duwei0227/apikit/releases)
- [Changelog](CHANGELOG.md)

## Acknowledgements

ApiKit is built on these excellent open source projects:

- [Tauri](https://tauri.app/) - Cross-platform desktop app framework
- [Vue.js](https://vuejs.org/) - The progressive JavaScript framework
- [PrimeVue](https://primevue.org/) - Vue UI component library
- [Ace](https://ace.c9.io/) - Code editor
- [Vite](https://vitejs.dev/) - Next generation frontend tooling

---

<div align="center">

**If you find ApiKit useful, please give it a ⭐ Star!**

Made with ❤️ by [@duwei0227](https://github.com/duwei0227)

</div>
