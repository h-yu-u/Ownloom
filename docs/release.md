# 自动发布正式版

[开发指南](development.md) · [制品验收](release-acceptance.md) · [验证范围](verification.md)

Ownloom 的 [Release 工作流](../.github/workflows/release.yml)由版本标签触发，构建 Apple Silicon macOS 安装包。发布标题统一为 `Ownloom vX.Y.Z`，使用正式 GitHub Release（`prerelease=false`）；制品验收、附件上传及摘要核对全部通过后，才公开并设为 **Latest**。

当前安装包使用 ad-hoc 签名，未经过 Developer ID 签名或 Apple 公证；安装时可能需要在系统「隐私与安全性」中手动允许。不要全局关闭 Gatekeeper。正式 Release 标记不改变签名性质或已验证范围，证据统一维护在[验证范围](verification.md)。

## 首次启用

1. 将工作流、脚本和文档审查后合并到 `main`，确认仓库已启用 GitHub Actions。
2. 工作流使用 GitHub 托管的 `macos-15` ARM 构建机，不依赖个人电脑、模型目录或额外 Apple 凭据。
3. 发布任务使用 GitHub 自动提供的 `GITHUB_TOKEN`，仅该任务有 `contents: write`。仓库或组织策略必须允许这个权限；不需要另建 PAT。
4. 首次运行须在 Actions 中确认依赖安装、完整 Sidecar 打包和包内启动实际通过。工作流文件存在不代表云端已验收通过。

## 发布一个版本

标签格式为 `vMAJOR.MINOR.PATCH`，例如 `v0.1.0`。发布流程不接受带后缀或前导零的标签。以下四个版本号必须相同：

- 根目录 `package.json` 的 `version`。
- `apps/desktop/package.json` 的 `version`。
- `apps/desktop/src-tauri/tauri.conf.json` 的 `version`。
- `apps/desktop/src-tauri/Cargo.toml` 中 `[package].version`。

修改 Cargo 版本后由 Cargo 同步 `Cargo.lock`，一并提交；构建过程中产生的锁文件或源码差异会阻止发布。先提交版本改动并合并到 `main`，更新本地 `main`，再显式发布标签。以四处均已更新为 `0.1.1`、且该标签尚不存在为例：

```bash
git tag -a v0.1.1 -m "Ownloom v0.1.1"
git push origin v0.1.1
```

标签必须指向已包含在远程 `main` 中的提交。工作流只在标签推送或手动触发时发布，普通代码推送不发布。维护者也可在 Actions → Release → Run workflow 中填入已有标签进行重试。

构建和发布任务检出标签对应的源码，因此新标签必须包含本工作流及对应发布脚本。重试适用于具备这套文件的标签；不将新工作流用于缺少这些文件的历史标签，也不移动已经发布的标签。

## 自动执行的步骤

1. 校验标签指向的提交、`main` 归属、四个版本号及干净源码。
2. 固定 Node 22、pnpm 11.11.0、Python 3.12 和锁定依赖，执行 API 生成一致性、`pnpm check`、`pnpm test`、Rust 检查与测试。
3. 使用 `release` profile 打包完整 Runtime、Coding Host、Node、应用与 DMG；不会打包模型权重。
4. 以只读方式挂载最终 DMG，运行其中应用的隔离 `smoke` 两轮检查。检查没有完成、有警告或签名完整性失败均阻止发布。
5. 只收集安装包、公开元数据、摘要和双语发布说明。原始诊断、临时数据库、系统路径和模型不进入发布附件。
6. 在独立的 Ubuntu 发布任务中复核标签与本地摘要，创建正式版草稿，上传附件并核对 GitHub 返回的文件大小与 SHA-256。全部核对成功后公开，设置 `prerelease=false`、`make_latest=true`。核对失败时保留草稿，不修改 Latest。

候选发布目录为 `.build/release`，DMG 内应用的 smoke 报告位于 `.build/release-acceptance`。版本校验和制品收集由 [scripts.release.release](../scripts/release/release.py)负责，上传、摘要核对及公开由 [scripts.release.publish_release](../scripts/release/publish_release.py)负责。

发布附件为 `ownloom-darwin-arm64.dmg`、`release-metadata.json` 和 `SHA256SUMS`。制品收集时将 Tauri 生成的 `Ownloom_<版本>_aarch64.dmg` 原样复制为该公开文件名；版本由 Release 标签、应用版本和元数据标识。下载三个文件到同一目录后运行：

```bash
shasum -a 256 -c SHA256SUMS
```

## 失败和重试

检查或构建失败时不会公开 Release；上传或摘要验证失败时保留草稿。同标签使用并发组，新任务不会取消正在运行的发布。相同提交的正式版草稿可以重试；已公开版本、不同提交的草稿和含额外附件的草稿会被拒绝，避免覆盖已分发的内容。需要更新已发布版本时提升版本号并使用新标签。

创建草稿后直接使用创建接口返回的对象，不通过列表回读来判断是否创建成功，避免列表可见性延迟导致误判。

流程和发布脚本的回归在 [test_release.py](../tests/test_release.py)，随 `pnpm test` 执行。修改后还应运行 `pnpm check`、工作流语法检查和真实云端候选制品验证。

## 验证边界

发布工作流检查源码、签名完整性、包内 Runtime/Node、认证、重启、持久化及进程退出。`smoke` 不执行真实模型推理，也不提供原生 GUI、Gatekeeper、独立干净机器或长期稳定性结论。公开元数据和说明保留这些限制。

真实模型资格验收继续使用 [Release artifact acceptance](../.github/workflows/release-acceptance.yml)自托管流程；Developer ID 签名、公证和独立机器验收步骤见制品验收手册。应用内自动更新需单独实现。
