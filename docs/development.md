# 开发环境与命令

[文档入口](./README.md) · [贡献指南](./contributors.md) · [代码规范](./code-standards.md)

本文是开发环境、启动与命令的维护入口。根目录 [package.json](../package.json) 只保留八个动作入口，按 `pnpm <动作> <模块> [参数]` 选择范围；目标与默认组合维护在[任务目录](../scripts/tasks/index.mjs)，由[统一入口](../scripts/run.mjs)执行。功能说明见[使用手册](./reference.md)，发布包验收见[发布验收](./release-acceptance.md)。所有命令均从仓库根目录执行。

## 常用入口

| 动作     | 常用命令                                       | 作用                                     |
| -------- | ---------------------------------------------- | ---------------------------------------- |
| 准备环境 | `pnpm bootstrap`                               | 安装锁定依赖和 Apple Silicon 推理 extras |
| 开发     | `pnpm dev`、`pnpm dev web`                     | 启动桌面或浏览器前端                     |
| 静态检查 | `pnpm check`、`pnpm check runtime`             | 执行完整门禁或指定模块                   |
| 自动测试 | `pnpm test`、`pnpm test coding`                | 执行完整回归或指定模块                   |
| 构建     | `pnpm build web`、`pnpm build app`             | 构建指定产物                             |
| 生成     | `pnpm generate api`、`pnpm generate rpc`       | 更新指定契约或设计 token                 |
| 格式化   | `pnpm format`、`pnpm format docs`              | 格式化源码或文档                         |
| 实际验证 | `pnpm verify chat --model-path /path/to/model` | 显式运行模型或制品验证                   |

`check` 和 `test` 默认运行各自的非 Rust 全量集合；`dev` 默认桌面模式。`build`、`generate` 和 `verify` 必须指定目标，防止省略参数时意外打包或运行真实模型。使用对应动作的 `--help` 查看可选目标，例如 `pnpm verify --help`。

## 工具链

| 工具       | 项目约定                                             | 事实来源                                                                              |
| ---------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Node.js    | 22（至少 22.19.0）；发行包要求 macOS arm64 原生 Node | [.nvmrc](../.nvmrc)、[Coding 打包脚本](../scripts/build/build-coding-host.sh)         |
| pnpm       | `11.11.0`                                            | [package.json](../package.json) 的 `packageManager`                                   |
| Python     | 3.12，由 uv 管理                                     | [Runtime 配置](../services/runtime/pyproject.toml)、根脚本                            |
| Rust       | stable，包含 rustfmt/clippy                          | [CI](../.github/workflows/ci.yml)、[Cargo.toml](../apps/desktop/src-tauri/Cargo.toml) |
| macOS 工具 | Command Line Tools；真实模型与打包使用 Apple Silicon | [Runtime 打包脚本](../scripts/build/build-runtime.sh)                                 |

先确保 `node`、`pnpm`、`uv`、`cargo` 和 macOS `xcrun` 可用。使用已有 nvm 时可运行 `nvm use`。依赖使用仓库锁文件，不为运行文档示例顺手升级整套依赖。

## Apple Silicon 桌面开发

```bash
UV_PYTHON=3.12 pnpm bootstrap
UV_NO_SYNC=1 pnpm dev
```

`UV_PYTHON=3.12` 固定准备环境的 Python 版本；`bootstrap` 执行冻结安装，并同步 Runtime 的 `mlx-vlm`、`mflux`、`audio` extras。`dev` 先构建 Coding Host，再通过 Tauri 启动 Vite 与源码 Runtime，使用开发配置排除发布资源引用。

**语音开发注意：** 当前 [Rust debug 启动器](../apps/desktop/src-tauri/src/runtime/supervisor.rs) 的 `uv run` 显式选择 `mlx-vlm` 和 `mflux`，没有选择 `audio`。完成上述同步后，单次启动加 `UV_NO_SYNC=1` 保留已准备的环境；该选项[跳过环境更新](https://docs.astral.sh/uv/configuration/environment/#uv_no_sync)，不会安装缺失依赖。不要全局设置它；修改锁文件后重新执行 `UV_PYTHON=3.12 pnpm bootstrap`。

仅重新准备完整 Runtime 开发环境时：

```bash
uv sync --project services/runtime --python 3.12 --frozen \
  --extra mlx-vlm --extra mflux --extra audio
```

开发 `mlx-lm` 适配器时在该命令额外指定 `--extra mlx-lm`。引擎版本以 `services/runtime/uv.lock` 为准，模型不随依赖安装。

## 不安装 MLX 的开发检查

Linux 等环境可以参与类型、纯逻辑、FakeEngine 和协议测试：

```bash
pnpm install --frozen-lockfile
uv sync --project services/runtime --python 3.12 --frozen
pnpm check
pnpm test
pnpm build web
```

这与 [CI quality job](../.github/workflows/ci.yml) 的基本路径一致。测试 fixture 在隔离数据库中显式登记 FakeEngine，普通运行不会自动添加 Fake 模型。非 macOS 环境没有项目使用的 Keychain 后端，也不提供正式桌面包或 MLX 推理能力。不要在这些环境运行 `bootstrap` 并假设真实引擎 extras 可用。

## 浏览器调试

`pnpm dev web` 先构建 Coding Host，再启动 Vite；它不会启动 Runtime。连接由 [runtime-bridge.ts](../apps/desktop/src/platform/runtime-bridge.ts) 读取 `VITE_RUNTIME_URL` 与 `VITE_RUNTIME_TOKEN`。

终端 A 指定临时资料库和本次随机令牌，再启动已同步的 Runtime：

```bash
export MLX_STUDIO_DATA_DIR="$PWD/.build/browser-development"
export MLX_STUDIO_SESSION_TOKEN='<本次生成的随机令牌>'
PYTHONPATH=services/runtime/src uv run --project services/runtime \
  --python 3.12 --frozen --no-sync \
  python -m mlx_studio_runtime.entrypoints.http.main
```

替换占位令牌，不能使用本文字符串或提交真实令牌。Runtime 在 `127.0.0.1` 的随机端口监听，stdout `runtime.ready` 帧给出 `port`，不会打印令牌。终端 B 使用同一令牌和实际端口：

```bash
VITE_RUNTIME_URL='http://127.0.0.1:<实际端口>' \
VITE_RUNTIME_TOKEN='<同一会话令牌>' pnpm dev web
```

Vite 环境变量进入本地浏览器开发配置，不能将这种配置打包发布或绑定公网。浏览器模式不能调用原生 Runtime 重启、目录选择和保存对话框。无需真实模型的交互验证应复用测试 fixture，不在个人资料库中植入测试数据。

## 质量与测试命令

| 模块         | 静态检查                                                                | 自动测试                                                           |
| ------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 全部         | `pnpm check`：tokens、文档、格式、前端、Runtime、Coding、边界与源码质量 | `pnpm test`：frontend、runtime、coding、acceptance、tooling        |
| 前端         | `pnpm check frontend`：Vue/TypeScript 类型与 ESLint                     | `pnpm test frontend`：Vitest/Vue Test Utils                        |
| Runtime      | `pnpm check runtime`：Python Ruff 与 Pyright                            | `pnpm test runtime`：先构建 Coding Host，再执行 Python unittest    |
| Coding       | `pnpm check coding`：Host 类型检查                                      | `pnpm test coding`：Host 回归                                      |
| 文档         | `pnpm check docs`：检查器回归、必需入口、本地链接、锚点及 Markdown 格式 | 随文档检查执行                                                     |
| 依赖边界     | `pnpm check boundaries`：RPC 漂移、违规 fixture、依赖边界与源码质量     | 随边界检查执行                                                     |
| 格式与 token | `pnpm check format`、`pnpm check tokens`                                | 无独立测试目标                                                     |
| 验收工具     | 无独立静态检查目标                                                      | `pnpm test acceptance`：可携带工具的隔离回归，不启动真实应用或模型 |
| 命令入口     | 无独立静态检查目标                                                      | `pnpm test tooling`：任务选择、参数与失败处理回归                  |
| Rust         | `pnpm check rust`：fmt 与 clippy，警告作为失败                          | `pnpm test rust`：Rust 单元测试                                    |

全量 `check` 和 `test` 均不含 Rust，也不运行真实模型或制品验收。选择相关的最窄回归，再执行贡献指南要求的门禁；缺工具或平台不支持时记录未执行项，不写成通过。

没有发布资源、只做 Rust 静态检查时，使用 CI 同样的资源覆盖：

```bash
TAURI_CONFIG='{"bundle":{"externalBin":[],"resources":[]}}' pnpm check rust
TAURI_CONFIG='{"bundle":{"externalBin":[],"resources":[]}}' pnpm test rust
```

CI 中的 Sidecar 占位文件仅满足编译检查，不得进入发行包或用作启动证据。

`pnpm format` 与 `pnpm check format` 使用相同的源码范围。JavaScript 脚本递归覆盖子目录；Python 统一覆盖 `services/runtime/src`、`tests` 和整个 `scripts/`，新增脚本自动纳入 Ruff 检查与格式化。脚本的 Python 版本、格式和 lint 规则由 [scripts/ruff.toml](../scripts/ruff.toml)维护，命令范围见 [Runtime 任务](../scripts/tasks/runtime.mjs)。文档使用 `pnpm format docs`，随后运行 `pnpm check docs`。文档检查不验证远程网站可达性或产品事实，仍需人工核对源码和外部来源。

## 契约和设计 token 生成

| 命令                   | 唯一手写来源与生成目标                                                |
| ---------------------- | --------------------------------------------------------------------- |
| `pnpm generate api`    | FastAPI OpenAPI → `packages/api-client/src/generated-schema.d.ts`     |
| `pnpm generate rpc`    | `packages/coding-protocol/schema.json` → Python/TypeScript Coding RPC |
| `pnpm generate tokens` | `apps/desktop/src/shared/styles/theme.tokens.json` → CSS/TypeScript   |
| `pnpm check tokens`    | 检查设计 token 无漂移                                                 |

修改源后重新生成并审查 diff，不手改生成文件。API 类型一致性由 CI 重新生成检查；RPC 与 token 漂移也有门禁。HTTP、RPC 和 UI 主题分别归属不同所有者，不在文档维护第二份协议或色值表。

## 构建命令与产物

| 命令                       | 作用与环境                                          |
| -------------------------- | --------------------------------------------------- |
| `pnpm build web`           | Vue 类型检查和 Vite 构建                            |
| `pnpm build coding`        | 编译 Coding Host                                    |
| `pnpm build coding-bundle` | Apple Silicon 上收集 Host 生产依赖与内置 Node       |
| `pnpm build runtime`       | Apple Silicon 上构建 PyInstaller Runtime            |
| `pnpm build app`           | Coding bundle → Web → Sidecar → Tauri `.app`/`.dmg` |

默认 Sidecar `release` profile 使用独立 `.build/runtime/venv-release`，收集真实引擎。仅验证替身时可运行 `MLX_STUDIO_BUILD_PROFILE=fake pnpm build runtime`；fake profile 不含真实推理依赖，不能作为正式发布产物。

应用位于 `apps/desktop/src-tauri/target/release/bundle/macos/Ownloom.app`，DMG 位于同级 `dmg/`。当前配置使用 ad-hoc 签名；构建成功不代表完成 Developer ID、公证、真实模型或干净机器验收。标签触发的自动构建和上传见[预览版发布](./preview-release.md)，完整制品要求见[发布验收](./release-acceptance.md)。

## 按模块实际验证

`verify` 与自动测试分开：显式选择目标并提供模型、应用或输出路径。不会默认运行全部探针，也不会替用户下载模型。参数保留原脚本的含义；目标后可直接传参，也可先加 `--`。

| 关注范围            | `pnpm verify` 目标             | 所属脚本                                                                                    |
| ------------------- | ------------------------------ | ------------------------------------------------------------------------------------------- |
| 聊天与视觉输入      | `chat`、`vision`、`streaming`  | `scripts/verify/verify_local_chat.py`、`verify_local_vision.py`、`verify_chat_streaming.py` |
| 图片生成与编辑      | `image`、`edit`                | `scripts/verify/verify_local_image.py`、`verify_local_edit.py`                              |
| 语音                | `speech`、`speech-quality`     | `scripts/verify/verify_local_speech.py`、`verify_speech_quality.py`                         |
| Coding              | `coding`                       | `scripts/verify/verify_local_coding.py`                                                     |
| 系统能力            | `system`                       | `scripts/verify/system_probe.py`                                                            |
| 包内 Runtime 与退出 | `packaged-runtime`、`shutdown` | `scripts/acceptance/verify_packaged_runtime.py`、`verify_desktop_shutdown.py`               |
| 应用制品与数据      | `bundle`、`data`               | `scripts/acceptance/verify_release_bundle.py`、`verify-packaged-data.mjs`                   |
| 长测与工具打包      | `stability`、`kit`             | `scripts/acceptance/run-bundle-acceptance.sh`、`package-acceptance-kit.sh`                  |

例如，源码聊天验证和指定应用的 smoke 验证分别执行：

```bash
pnpm verify chat --model-path /path/to/model
pnpm verify stability '/path/to/Ownloom.app' \
  --profile smoke --duration-seconds 0 --cycles 2 \
  --output /path/to/new-report-directory
```

源码 Python 工具使用模块方式启动，例如 `uv run --project services/runtime --python 3.12 --frozen python -m scripts.verify.verify_local_chat --help`。这样可以解析跨模块导入；不要将子目录中的 Python 文件直接作为脚本启动。工具包解压后仍使用根部的 `sh run-bundle-acceptance.sh`，不需要 pnpm 或仓库目录。制品验收步骤、前置条件及证据要求统一见[发布验收](./release-acceptance.md)。

## 脚本职责与维护

| 目录                  | 所有权与范围                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------- |
| `scripts/tasks/`      | 按 desktop、runtime、coding、contracts、repository、acceptance 模块声明命令；统一入口负责目标选择与顺序执行 |
| `scripts/checks/`     | 文档、架构边界、Python 依赖和源码质量门禁及其回归                                                           |
| `scripts/generate/`   | OpenAPI、Coding RPC 和设计 token 生成                                                                       |
| `scripts/build/`      | Runtime Sidecar、Coding Host 打包与资源校验                                                                 |
| `scripts/verify/`     | 按聊天、图片、语音、Coding、系统模块组织的本地探针；模型选择等共用代码也归属本目录                          |
| `scripts/acceptance/` | 指定安装包的验收、隔离数据 fixture、长测与可携带工具打包                                                    |
| `scripts/release/`    | 版本校验、候选制品收集与 GitHub 预览发布                                                                    |

新增验证时先确定所有者：可重复的纯逻辑回归放对应源码测试；需要真实模型的探针放 `verify/`；依赖最终 `.app` 的检查放 `acceptance/`。仅对需要直接调用的操作在所属 `scripts/tasks/*.mjs` 中声明任务，并在 `scripts/tasks/index.mjs` 注册目标；共享实现留在所属模块，不增加一个根级 `package.json` 命令。调用者、工作流、文档和可携带工具的复制清单必须一起更新，生成器移动后重新生成并核对差异。

修改命令、环境变量、锁文件、构建 profile 或产物路径时同步本文及工作流。开发脚本不应悄悄访问用户项目、下载模型、覆盖个人资料库或更改全局环境。真实模型和发布结果统一维护在[验证范围](./verification.md)，本文件不累计测试数量或临时日志。
