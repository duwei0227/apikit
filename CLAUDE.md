# CLAUDE.md

## 协作原则

1. 以我的身份提交：所有代码提交、tag 和发布动作都必须使用我的 Git 身份：`duwei0227 <duwei0227@gmail.com>`。提交前确认 `git config user.name` / `git config user.email` 为该值，且 `git log` / `git show` 中的 Author 和 Committer 均为该身份。
2. 直接修改 `main`：所有改动直接在 `main` 分支完成，不建立功能分支，不提交 PR，不绕过主分支流程。
3. 明确需求确认：需要我确认或选择时，使用问题卡片/AskUserQuestion 提问，不在正文中罗列待确认项。
4. 方案先确认再实施：新功能、UI 改动、较大范围重构必须先给出方案，并附上界面稿/交互说明；得到确认后再改代码，不要“先写后问”。
5. 代码与发布必须保持一致：任何可感知的功能改动、修复、文档更新，都应同步反映到对应代码、README、文档和版本日志中。
6. 不要在仓库里留下 AI 相关署名：不得在提交信息、tag、文件内容、注释、文档里写入 AI 名称、会话信息���Co-authored-by、自动生成说明等内容；所有自动化提交/打 tag 必须使用我的凭据而不是默认 GitHub Actions 用户。

## 项目概览

这是一个 Tauri 2 桌面应用：前端使用 Vue 3 + `<script setup>` + PrimeVue 4 + Pinia + Vite；后端使用 Rust（`src-tauri/`），负责 HTTP 请求、MCP 服务和更新逻辑。

- `src/components`：界面组件
- `src/composables`：组合函数
- `src/stores`：Pinia store
- `src/services`：与 UI 无关的核心逻辑（HTTP、workflow、MCP、import-export、variables、storage、api 等）
- `src/utils`：纯函数工具集
- `src/types/models.ts`：共享数据结构
- `src/editor/ace.ts`：Ace 编辑器模式与主题
- `test/`：单元测试
- `e2e/`：浏览器测试
- `docs/`：VitePress 文档站；中文文档在根目录，英文文档在 `docs/en/`

## 代码规范

1. TypeScript 规范
   - 组件统一使用 `<script setup lang="ts">`。
   - Props / Emits 明确声明类型，不使用 `any`。
   - 对外部数据（导入文件、MCP 参数、流式事件）使用 `unknown`，在读取前进行收窄。
   - 复杂逻辑必须抽离到 `src/services`、`src/utils`、`src/composables` 中，不要塞进组件。
2. 优先复用
   - 优先复用现有工具：`templateVariables`（变量补全）、`textSearch`（搜索）、`valueComparison`（断言/条件比较）、`collectionTree`（集合树）、`popupPosition`（弹层定位）等。
   - 不要重复造轮子，除非已有实现不满足场景需求。
3. 多实例与状态管理
   - 每个打开的请求都应有独立组件实例，元素使用模板 ref，不直接使用 `document.querySelector`。
   - 跨组件共享状态放入组合函数 / Pinia store，而不是散落在组件中。
4. 浮层与编辑器
   - 浮层使用 Teleport 到 body，固定 `position: fixed`，`z-index: var(--ak-floating-z)`。
   - Esc 仅关闭当前浮层，并阻止事件继续冒泡。
   - 编辑器统一使用 Ace。
5. 代码风格
   - 保持命名清晰、可读性优先，避免过度抽象。
   - 复杂条件要提前抽出变量或函数，避免深层嵌套。
   - 业务逻辑与 UI 逻辑分离，避免组件中堆砌副作用代码。

## 测试要求

- 类型检查：`npm run typecheck`
- 单元测试：`npm test`（Vitest，`test/**/*.test.ts`）
- 浏览器测试：`npm run test:e2e`（Playwright，`e2e/**/*.e2e.ts`）

必须遵守：

- 纯函数放在 `src/utils`，并编写单元测试。
- 改动界面交互时（编辑器、`{{` 变量补全、集合树、页签、对话框等），必须运行浏览器测试。
- 测试应等待具体状态变化（焦点、元素出现、防抖后的数据），不要依赖固定 delay。
- 修复 bug 时，必须补充回归测试，并确认修复前失败、修复后通过。
- 在提交前执行：`npm run typecheck && npm test`；若涉及界面变更，再执行 `npm run test:e2e`。

## 提交与版本控制

- 提交说明必须为中文，且使用历史一致的前缀：`feat` / `fix` / `refactor` / `perf` / `test` / `docs` / `chore`。
- bug 修复必须单独提交，不与重构或功能改造混在一起。
- 提交前检查：
  - `git diff --cached --stat`：确认仅包含本次变更。
  - `git config user.name` / `git config user.email`：确认为 my identity。
  - `git show --pretty=fuller -1`：确认 Author 和 Committer 为该身份。
- 不允许在提交信息中写入 AI 名称、会话信息、Co-authored-by 或类似自动生成附言。
- 发布前必须同步更新 `CHANGELOG.md` 的 `## [Unreleased]`，新增/变更/修复应记录在版本日志中；内部问题不应误写为用户可感知变更。

## README 与文档

- 中文 `README.md` 与英文 `README.en.md` 应保持一致：内容结构、功能列表、示例和说明一一对应。
- 用户可感知的功能改动，需要同步更新对应文档页；中英文文档需一起更新（如 `docs/guide/` 与 `docs/en/guide/`）。
- 界面按钮、选项名称必须照抄界面原文，不要自行命名。
- 文档中的 `{{变量}}` 必须放在行内代码或代码块中，不要直接写在正文里，否则会被 Vue 当作插值。
- 若存在界面变化，需生成文档截图（`npm run docs:screenshots`），并保存到 `docs/public/screenshots/`。
- 修改文档后执行 `npm run docs:build` 以确认构建通过。

## Tauri 配置校验

修改 `src-tauri/tauri.conf.json` 时，必须按照 `src-tauri/Cargo.lock` 中锁定的 `tauri-utils` 版本校验配置，不能只看 `@tauri-apps/cli` 的 schema。

步骤：

1. 查看锁定版本：
   ```bash
   grep -A1 'name = "tauri-utils"' src-tauri/Cargo.lock
   ```
2. 使用该版本的 schema 做校验：
   ```bash
   curl -sSL -o /tmp/tauri-schema.json "https://raw.githubusercontent.com/tauri-apps/tauri/tauri-utils-v<版本>/crates/tauri-schema-generator/schemas/config.schema.json"
   python3 -c "import json, jsonschema; jsonschema.validate(json.load(open('src-tauri/tauri.conf.json')), json.load(open('/tmp/tauri-schema.json'))); print('OK')"
   ```
3. 如果需要使用新版本才支持的配置项，先升级 Rust 端 tauri 依赖（`cargo update`），并确认构建通过，不要仅修改配置。

## 发布新版本

1. 修改版本号：以下 6 处必须同时更新，并保持与历史提交 `chore: 发布 vX.Y.Z` 一致：
   - `package.json` 的 `version`
   - `package-lock.json` 顶部两处 `version`
   - `src-tauri/tauri.conf.json` 的 `version`
   - `src-tauri/Cargo.toml` 的 `version`
   - `src-tauri/Cargo.lock` 中 `name = "apikit"` 下的 `version`
   - `CHANGELOG.md` 中 `## [Unreleased]` 改为 `## [X.Y.Z] - YYYY-MM-DD`
2. 统一换行符：仓库使用 `.gitattributes` 统一为 LF，不得提交 CRLF；修改后 `git diff --stat` 应仅有少量改动。
3. 校验配置：若本版本修改了 `tauri.conf.json`，先按“Tauri 配置校验”执行校验。
4. 本地检查：按“提交前检查”全部通过后再提交；发布流程的 `verify` 任务也会再次执行类型检查和单元测试。
5. 提交并推送：提交说明为 `chore: 发布 vX.Y.Z`，推送到 `main`。
6. 创建 tag 并发布：
   - 推荐在本地终端直接执行：
     ```bash
     git tag vX.Y.Z && git push origin vX.Y.Z
     ```
   - 不要混用多种发布方式，否则可能重复发布。
7. 保护身份与凭据：
   - 自动化提交/打 tag 必须使用我的 PAT 等个人凭据，而不是默认 `GITHUB_TOKEN`。
   - 所有提交、tag 和发布动作都必须通过我的 Git 配置和授权链完成，不能以默认 Actions 用户或其他账号身份执行。

## 安全与身份强制要求

为了保证“代码和 tag 的提交都由我的身份实现”，必须满足以下要求：

- 本地提交前确认：
  ```bash
  git config user.name
  git config user.email
  ```
  输出必须是：
  ```bash
  duwei0227
  duwei0227@gmail.com
  ```
- 建议启用签名：
  ```bash
  git commit -S -m "feat: ..."
  git tag -s vX.Y.Z -m "chore: 发布 vX.Y.Z"
  ```
  这样可以增强可验证性，并让 GitHub 能识别签名已验证状态。
- 自动化脚本不得使用默认 GitHub Actions 用户；必须用我的 PAT 作为远程 push 的凭据，并在脚本中设置：
  ```bash
  git config user.name "duwei0227"
  git config user.email "duwei0227@gmail.com"
  ```
- 禁止在任何提交说明、tag、文件内容、注释和文档中出现 AI 名称、会话 ID、Co-authored-by 或自动生成署名。

## 执行原则

1. 优先遵循当前 repo 的已有模式与命名习惯，不为了“新方案”而破坏现有结构。
2. 只做必要修改，不无故扩大范围。
3. 每次提交都应保证变更集中、测试通过、日志更新完整。
4. 一切修改都必须以我的身份完成，且不留下任何 AI 相关署名。

