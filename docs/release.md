# 自动发布正式版

[开发指南](development.md) · [制品验收](release-acceptance.md) · [验证范围](verification.md)

Ownloom 的 [Release 工作流](../.github/workflows/release.yml)由版本标签推送或网页手动操作触发，构建 Apple Silicon macOS 安装包。发布标题统一为 `Ownloom vX.Y.Z`，使用正式 GitHub Release（`prerelease=false`）；制品验收、附件上传及摘要核对全部通过后，才公开并设为 **Latest**。

当前安装包使用 ad-hoc 签名，未经过 Developer ID 签名或 Apple 公证；安装时可能需要在系统「隐私与安全性」中手动允许。不要全局关闭 Gatekeeper。正式 Release 标记不改变签名性质或已验证范围，证据统一维护在[验证范围](verification.md)。

## 首次启用

1. 将工作流、脚本和文档审查后合并到 `main`，确认仓库已启用 GitHub Actions。
2. 工作流使用 GitHub 托管的 `macos-15` ARM 构建机，不依赖个人电脑、模型目录或额外 Apple 凭据。
3. 手动标签准备任务和发布任务使用 GitHub 自动提供的 `GITHUB_TOKEN`，仅这两个任务有 `contents: write`。仓库或组织策略必须允许这个权限；不需要另建 PAT。
4. 首次运行须在 Actions 中确认依赖安装、完整 Sidecar 打包和包内启动实际通过。工作流文件存在不代表云端已验收通过。

## 发布一个版本

标签格式为 `vMAJOR.MINOR.PATCH`，例如 `v0.1.0`。发布流程不接受带后缀或前导零的标签。以下四个版本号必须相同：

- 根目录 `package.json` 的 `version`。
- `apps/desktop/package.json` 的 `version`。
- `apps/desktop/src-tauri/tauri.conf.json` 的 `version`。
- `apps/desktop/src-tauri/Cargo.toml` 中 `[package].version`。

修改 Cargo 版本后由 Cargo 同步 `Cargo.lock`，一并提交；构建过程中产生的锁文件或源码差异会阻止发布。先提交版本改动并合并到 `main`，再在网页操作：

1. 打开仓库 **Actions → Release → Run workflow**。
2. 分支选择 **main**，填入版本标签，例如 `v0.1.1`。
3. 点击 **Run workflow**。新标签须与主分支中的应用版本一致；标签准备通过后，本次运行继续执行验证、构建和发布。

[标签准备脚本](../scripts/release/prepare_release.py)只为已经校验的主分支提交创建缺失标签，不移动已有标签。已有标签使用原提交重试，并重新核对版本、干净源码及主分支归属。手动操作其他分支会失败。GitHub 自动令牌创建标签不会递归触发另一轮发布，本次手动工作流直接继续后续任务；普通主分支推送不发布。

也可以从已更新的本地 `main` 显式推送标签。以四处均已更新为 `0.1.1`、且该标签尚不存在为例：

```bash
git tag -a v0.1.1 -m "Ownloom v0.1.1"
git push origin v0.1.1
```

标签必须指向已包含在远程 `main` 中的提交。两种入口使用同一套后续验证和发布任务。

构建和发布任务检出标签对应的源码，因此新标签必须包含本工作流及对应发布脚本。重试适用于具备这套文件的标签；不将新工作流用于缺少这些文件的历史标签，也不移动已经发布的标签。

## 编写发布说明

每个版本的完整中英文正文放在 `docs/releases/<tag>.md`，例如 [v0.1.0](releases/v0.1.0.md) 和 [v0.1.1](releases/v0.1.1.md)。制品收集读取与标签完全对应的文件，原样生成 `RELEASE_NOTES.md`；文件缺失、空白或为符号链接时收集失败，不使用其他版本或通用文案代替。

正文先回答用户关心的问题：

- **更新内容：** 写清这一版新增、改进或修复了什么，以及用户能观察到的变化。首版写首次提供的能力；没有实际修复时不写“Bug Fixes”。以相邻版本的代码变化为依据，不根据提交标题编造功能、性能或模型兼容性结论。
- **安装：** 给出本版本真实存在的安装包链接，以及适用的打开、更新和开始使用步骤。仅在支持安装脚本的版本中提供终端入口；使用 Latest 地址时明确它安装的是最新版。
- **使用前提：** 保留 Apple Silicon、模型另行下载和未经过 Apple 公证等直接影响安装、使用的信息。
- **构建详情：** 源码、制品元数据、验证范围及可选校验命令放在末尾的 `<details>` 折叠区。

Release 标题由 GitHub 单独显示，正文不再重复 `Ownloom vX.Y.Z`。版本说明随代码评审；后续版本需编写自己的文件，不能沿用上一版的更新列表。

提交说明文件不会自动修改已有 Release。更新历史页面时，在对应 Release 页选择 **Edit**，用该版本文件替换正文后保存；历史文件名、标签和已发布附件仍以该版本实际产物为准。已经开始的构建继续使用其标签中原有的发布脚本，后续源码调整不会改变那次构建的说明。

## 自动执行的步骤

1. 校验标签指向的提交、`main` 归属、四个版本号及干净源码。
2. 校验通过后，`quality`、`rust` 和 `build` 三个 macOS 任务并行运行，分别检出校验输出的同一个提交。`quality` 使用 Node 22、pnpm 11.11.0、Python 3.12 和锁定依赖，执行 API 生成一致性、`pnpm check` 与 `pnpm test`；`rust` 保留格式检查、Clippy 与 Rust 测试。两个检查任务结束时分别确认没有跟踪文件差异。
3. `build` 构建 Coding Host 与内置 Node，恢复符合下文条件的 Runtime，或从源码构建 `release` profile Runtime，再由 Tauri 构建 Web、应用与 DMG。Web 只由 Tauri hook 构建一次；模型权重不进入安装包。
4. 以只读方式挂载最终 DMG，运行其中应用的隔离 `smoke` 两轮检查。检查没有完成、有警告或签名完整性失败均阻止发布。
5. 只收集安装包、安装脚本、公开元数据、摘要和双语发布说明。原始诊断、临时数据库、系统路径和模型不进入发布附件。
6. 使用待发布的 `install.sh` 和真实 DMG，在临时目录验证首次安装、完整替换、损坏下载保护旧版、签名完整性及清理。下载由本地附件 fixture 提供，挂载、复制和签名检查使用真实 macOS 工具；报告单独上传到 Actions artifact。
7. `validate`、`quality`、`rust` 和 `build` 全部成功且运行未取消，独立的 Ubuntu 发布任务才会开始。该任务复核标签与本地摘要，创建正式版草稿，上传附件并核对 GitHub 返回的文件大小与 SHA-256。全部核对成功后公开，设置 `prerelease=false`、`make_latest=true`。核对失败时保留草稿，不修改 Latest。

候选发布目录为 `.build/release`，DMG 内应用的 smoke 报告位于 `.build/release-acceptance`。版本校验和制品收集由 [scripts.release.release](../scripts/release/release.py)负责，上传、摘要核对及公开由 [scripts.release.publish_release](../scripts/release/publish_release.py)负责。

发布附件为 `ownloom-darwin-arm64.dmg`、`install.sh`、`release-metadata.json` 和 `SHA256SUMS`。制品收集时将 Tauri 生成的 `Ownloom_<版本>_aarch64.dmg` 原样复制为该公开文件名；版本由 Release 标签、应用版本和元数据标识。安装脚本从 [scripts/release/install.sh](../scripts/release/install.sh) 原样收集，与 DMG 和元数据一起纳入摘要及上传复核。下载四个文件到同一目录后运行：

```bash
shasum -a 256 -c SHA256SUMS
```

## 缓存与 Runtime 制品复用

Rust 使用固定提交版本的 `Swatinem/rust-cache` 缓存依赖与编译产物，工作区为 `apps/desktop/src-tauri -> target`。CI 的 `macos-14-check`、Release 的 `macos-15-check` 与 `macos-15-release` 分别使用独立缓存键，保留 action 对 Rust 工具链、Cargo 配置与锁文件的哈希。检查和正式构建不再共用一个临时任务，也不删除检查产物来腾出发布空间。Release 的 `CARGO_BUILD_JOBS=2` 和检查时的 debug 信息设置保持不变。

缓存仍受 [GitHub 的分支与标签作用域](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching)约束：可以读取默认分支中的兼容缓存，但不同标签之间不能直接共享各自保存的缓存。日常 CI 的 `macos-14-check` 不预热 Release 的两个 `macos-15` 缓存；手动从 `main` 发起 Release 才能为它们建立可从默认分支复用的缓存。新工具链、依赖变化或首次发布仍可能冷构建。缓存不替代任何检查。

Runtime 复用的是完成打包与包内验收的 Sidecar，不缓存或搬运 Python 虚拟环境。生产和消费入口分别为 [runtime_artifact](../scripts/build/runtime_artifact.py) 和 [restore_runtime](../scripts/release/restore_runtime.py)：

- CI 在导入与资源、包内协议和退出清理检查通过后，记录二进制大小与 SHA-256、源码输入摘要、构建 profile、Python/PyInstaller/hooks 版本、macOS 架构与 runner 镜像，以及仓库、完整提交 SHA、运行 ID 和 attempt。生成与恢复都要求当前 Git HEAD 与指定 SHA 一致且跟踪源码干净。
- 仅 `main` 的 push CI 上传 `runtime-release-<sha>-<attempt>`，保留 7 天、压缩级别为 0。Release 只接受同仓库、同一完整 SHA、指定 CI 工作流、`push main` 且整次工作流成功的制品，不使用 PR 制品或只通过 Runtime 单项的运行。
- 恢复前核对运行与制品来源、GitHub 提供的整个 ZIP 摘要、清单与二进制的大小及摘要，再与当前源码、锁文件、Python、平台和 runner 镜像匹配。归档只允许预期的普通文件，拒绝路径穿越、链接和额外内容；验证通过后才原子替换 Sidecar 并恢复可执行权限。
- 没有符合条件的制品、CI 尚未完成、制品过期、下载失败或校验不匹配时，日志记录回退原因，本次 Release 重新从源码构建完整 Runtime。不会为等待 CI 或缓存无限阻塞，也不会用未经校验的二进制继续打包。

只有 Release 的 `build` job 额外拥有 `actions: read`，该 job 仅向恢复 step 显式注入 `GH_TOKEN`；其他 action 仍可使用各自支持的自动令牌机制。复用成功后仍重新构建最终应用和 DMG，并完成最终 DMG 内 smoke 与真实 DMG 安装器验收；CI 的 Sidecar 验收不能替代这些发布条件。

并行检查缩短串行等待，Runtime 命中时省去一次 PyInstaller 构建。实际收益取决于排队时间、缓存命中与构建输入是否变化；并行也会占用更多同时运行的 runner。应比较 Actions 各 job/step 耗时与任务入口的命令摘要，分别记录冷构建和命中制品的运行，不将首次执行或静态配置检查当作提速实测。

## 终端安装与隔离验收

用户安装入口为：

```sh
curl -fsSL https://github.com/h-yu-u/Ownloom/releases/latest/download/install.sh | sh
```

安装器只支持 Apple Silicon macOS，并能识别 Rosetta 终端下的 ARM 硬件。它使用系统自带工具，不要求用户安装 Python、Node、Git 或开发工具链；模型权重仍由应用单独下载。先从 Latest 元数据确定一个严格的版本标签，再从该标签下载校验清单、元数据和 DMG；后续不会再次跟随 Latest。可在同一入口后使用 `sh -s -- --version vX.Y.Z` 选择具备这些附件的历史版本。

安装前校验下载摘要、元数据中的版本与架构、应用标识、可执行文件、ARM64 格式及签名完整性。摘要清单允许包含通过管道执行的 `install.sh`，仅对本次实际下载的 DMG 与元数据运行文件校验。所有网络下载和重定向使用 HTTPS；临时文件仅用于本次安装。

默认安装到可写的 `/Applications`，否则使用 `~/Applications`，不提权。`--install-dir /absolute/directory` 可选择已存在、可写且非符号链接的目录。更新前必须退出 Ownloom；安装器在目标文件系统暂存完整新应用，保留旧版后再替换，失败时恢复旧版或明确保留其位置，不合并两份应用目录。模型和资料库不属于替换范围。安装结束清理挂载、临时目录和安装锁，不自动打开应用，也不改变 Gatekeeper 或隔离属性。

安装器的行为回归见 [test_installer.py](../tests/test_installer.py)，随 `pnpm test` 执行。[CI](../.github/workflows/ci.yml) 的 `installer` job 构建微型签名应用和真实 DMG，检查系统工具调用；完整 Release 在收集制品后使用同一个[验收入口](../scripts/acceptance/verify_installer.py)：

```bash
python -m scripts.acceptance.verify_installer \
  --assets .build/release --output .build/installer/report.json
```

省略 `--assets` 会生成隔离的微型制品，只能验证安装流程。完整制品报告绑定 DMG 和安装脚本摘要，保存为独立的 Actions artifact；不会成为公开 Release 附件。两种模式均使用本地下载 fixture，公开 GitHub 下载地址仍需在发布后单独核对。当前最低 macOS 版本尚无完整应用的兼容矩阵，不能从桌面壳默认版本推导整个 Runtime 的支持下限。

## 失败和重试

检查或构建失败时不会公开 Release；上传或摘要验证失败时保留草稿。同标签使用并发组，新任务不会取消正在运行的发布。相同提交的正式版草稿可以重试；已公开版本、不同提交的草稿和含额外附件的草稿会被拒绝，避免覆盖已分发的内容。需要更新已发布版本时提升版本号并使用新标签。

创建草稿后直接使用创建接口返回的对象，不通过列表回读来判断是否创建成功，避免列表可见性延迟导致误判。

发布脚本回归在 [test_release.py](../tests/test_release.py)，任务依赖、并行检查与发布汇合条件由 [test_release_workflow.py](../tests/test_release_workflow.py)覆盖，均随 `pnpm test` 执行。修改后还应运行 `pnpm check`、工作流语法检查和真实云端候选制品验证。

## 验证边界

发布工作流检查源码、签名完整性、包内 Runtime/Node、认证、重启、持久化、进程退出及安装器对实际 DMG 的隔离安装。`smoke` 和安装器验收不执行真实模型推理，也不提供原生 GUI、Gatekeeper、独立干净机器或长期稳定性结论。公开元数据和说明保留这些限制。

真实模型资格验收继续使用 [Release artifact acceptance](../.github/workflows/release-acceptance.yml)自托管流程；Developer ID 签名、公证和独立机器验收步骤见制品验收手册。应用内自动更新需单独实现。
