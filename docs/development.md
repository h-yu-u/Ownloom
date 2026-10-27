# 开发环境与命令

[文档入口](./README.md) · [贡献指南](./contributors.md) · [代码规范](./code-standards.md)

本文是开发环境、启动与命令的维护入口。脚本定义以根目录 [package.json](../package.json) 为准；功能说明见[使用手册](./reference.md)，发布包验收见[发布验收](./release-acceptance.md)。所有命令均从仓库根目录执行。

## 工具链

| 工具       | 项目约定                                             | 事实来源                                                                              |
| ---------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Node.js    | 22（至少 22.19.0）；发行包要求 macOS arm64 原生 Node | [.nvmrc](../.nvmrc)、[Coding 打包脚本](../scripts/build-coding-host.sh)               |
| pnpm       | `11.11.0`                                            | [package.json](../package.json) 的 `packageManager`                                   |
| Python     | 3.12，由 uv 管理                                     | [Runtime 配置](../services/runtime/pyproject.toml)、根脚本                            |
| Rust       | stable，包含 rustfmt/clippy                          | [CI](../.github/workflows/ci.yml)、[Cargo.toml](../apps/desktop/src-tauri/Cargo.toml) |
| macOS 工具 | Command Line Tools；真实模型与打包使用 Apple Silicon | [Runtime 打包脚本](../scripts/build-runtime.sh)                                       |

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
pnpm build:web
```

这与 [CI quality job](../.github/workflows/ci.yml) 的基本路径一致。测试 fixture 在隔离数据库中显式登记 FakeEngine，普通运行不会自动添加 Fake 模型。非 macOS 环境没有项目使用的 Keychain 后端，也不提供正式桌面包或 MLX 推理能力。不要在这些环境运行 `bootstrap` 并假设真实引擎 extras 可用。

## 浏览器调试

`pnpm dev:web` 先构建 Coding Host，再启动 Vite；它不会启动 Runtime。连接由 [runtime-bridge.ts](../apps/desktop/src/platform/runtime-bridge.ts) 读取 `VITE_RUNTIME_URL` 与 `VITE_RUNTIME_TOKEN`。

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
VITE_RUNTIME_TOKEN='<同一会话令牌>' pnpm dev:web
```

Vite 环境变量进入本地浏览器开发配置，不能将这种配置打包发布或绑定公网。浏览器模式不能调用原生 Runtime 重启、目录选择和保存对话框。无需真实模型的交互验证应复用测试 fixture，不在个人资料库中植入测试数据。

## 质量与测试命令

| 命令                    | 执行范围                                                      |
| ----------------------- | ------------------------------------------------------------- |
| `pnpm check`            | tokens、文档、格式、前端、Runtime、Coding、依赖边界与源码质量 |
| `pnpm check:docs`       | 文档检查器回归、必需入口/本地链接/锚点检查及 Markdown 格式    |
| `pnpm check:format`     | Prettier 与 Ruff 格式检查                                     |
| `pnpm check:frontend`   | Vue/TypeScript 类型与 ESLint                                  |
| `pnpm check:runtime`    | Python Ruff 与 Pyright                                        |
| `pnpm check:coding`     | Coding Host 类型检查                                          |
| `pnpm check:boundaries` | RPC 漂移、违规 fixture、依赖边界与源码长度/样式检查           |
| `pnpm test`             | 顺序执行 frontend、runtime、coding、acceptance 四组           |
| `pnpm test:frontend`    | Vitest/Vue Test Utils                                         |
| `pnpm test:runtime`     | 先构建 Coding Host，再执行 Python unittest                    |
| `pnpm test:coding`      | Coding Host 回归测试                                          |
| `pnpm test:acceptance`  | 可携带验收工具的 Node 回归测试                                |
| `pnpm check:rust`       | Rust fmt 与 clippy，警告作为失败                              |
| `pnpm test:rust`        | Rust 单元测试                                                 |
| `pnpm format`           | 按配置范围格式化源码，会修改文件                              |

`check` 不含 Rust，`test` 也不含 Rust。选择相关的最窄回归，再执行贡献指南要求的门禁；缺工具或平台不支持时记录未执行项，不写成通过。

没有发布资源、只做 Rust 静态检查时，使用 CI 同样的资源覆盖：

```bash
TAURI_CONFIG='{"bundle":{"externalBin":[],"resources":[]}}' pnpm check:rust
TAURI_CONFIG='{"bundle":{"externalBin":[],"resources":[]}}' pnpm test:rust
```

CI 中的 Sidecar 占位文件仅满足编译检查，不得进入发行包或用作启动证据。

Markdown 不在源码 `pnpm format` 的写入范围中。修改文档后运行 `pnpm exec prettier --write "*.md" "docs/**/*.md"`，再执行 `pnpm check:docs`；该检查不验证远程网站可达性或产品事实，仍需人工核对源码和外部来源。

## 契约和设计 token 生成

| 命令                   | 唯一手写来源与生成目标                                                |
| ---------------------- | --------------------------------------------------------------------- |
| `pnpm api:generate`    | FastAPI OpenAPI → `packages/api-client/src/generated-schema.d.ts`     |
| `pnpm rpc:generate`    | `packages/coding-protocol/schema.json` → Python/TypeScript Coding RPC |
| `pnpm tokens:generate` | `apps/desktop/src/shared/styles/theme.tokens.json` → CSS/TypeScript   |
| `pnpm tokens:check`    | 检查设计 token 无漂移                                                 |

修改源后重新生成并审查 diff，不手改生成文件。API 类型一致性由 CI 重新生成检查；RPC 与 token 漂移也有门禁。HTTP、RPC 和 UI 主题分别归属不同所有者，不在文档维护第二份协议或色值表。

## 构建命令与产物

| 命令                       | 作用与环境                                                                  |
| -------------------------- | --------------------------------------------------------------------------- |
| `pnpm build:web`           | Vue 类型检查和 Vite 构建                                                    |
| `pnpm build:coding`        | 编译 Coding Host                                                            |
| `pnpm build:coding:bundle` | Apple Silicon 上收集 Host 生产依赖与内置 Node                               |
| `pnpm build:runtime:check` | 仅检查 Python 可编译；`build:runtime` 是别名                                |
| `pnpm build:sidecar`       | Apple Silicon 上构建 PyInstaller Runtime                                    |
| `pnpm build:app`           | Coding bundle → Web → Sidecar → Tauri `.app`/`.dmg`；`build:desktop` 是别名 |

默认 Sidecar `release` profile 使用独立 `.build/runtime/venv-release`，收集真实引擎。仅验证替身时可运行 `MLX_STUDIO_BUILD_PROFILE=fake pnpm build:sidecar`；fake profile 不含真实推理依赖，不能作为正式发布产物。

应用位于 `apps/desktop/src-tauri/target/release/bundle/macos/Ownloom.app`，DMG 位于同级 `dmg/`。当前配置使用 ad-hoc 签名；构建成功不代表完成 Developer ID、公证、真实模型或干净机器验收。发布步骤见[发布验收](./release-acceptance.md)。

## 维护入口

修改命令、环境变量、锁文件、构建 profile 或产物路径时同步本文及工作流。开发脚本不应悄悄访问用户项目、下载模型、覆盖个人资料库或更改全局环境。真实模型和发布结果统一维护在[验证范围](./verification.md)，本文件不累计测试数量或临时日志。
