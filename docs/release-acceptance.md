# Ownloom 发布准备与制品验收

本文是可重复执行的维护者操作手册，也会被复制为可携带验收工具包的 README。当前应用面向 Apple Silicon macOS，Tauri 默认使用 ad-hoc 签名。签名完整、包内功能正常、原生安装可用、长期稳定和正式分发分别记录，不能互相替代。

仓库中的开发命令见 `docs/development.md`，当前证据范围见 `docs/verification.md`。工具包不包含这两份仓库文档，执行工具不需要它们。

## 1. 准备候选制品

维护者在 Apple Silicon 构建机上，使用干净工作树或明确记录的提交和差异：

1. 按开发指南准备锁定工具链、依赖和完整本地模型。
2. 执行源码、类型、契约、Rust 和相关真实模型检查，记录实际结果。
3. 运行 `pnpm build app`；默认 `release` profile 包含真实引擎。不要将 fake profile、占位 Sidecar 或开发目录依赖混入发行包。
4. 核对 `Ownloom.app`、DMG、版本、内置 Node/Host 与 Runtime 资源，对最终包计算摘要。
5. 使用最终制品执行本手册。重建、更换签名或修改包内资源后重新绑定清单并复验。

仓库默认应用路径为 `apps/desktop/src-tauri/target/release/bundle/macos/Ownloom.app`，DMG 位于同级 `dmg/`。源码检查与 Apple Silicon 自托管的手动验收工作流不自动完成发布。标签触发的 Preview release 工作流会在完整打包与 DMG 内应用的 smoke 检查通过后自动公开预览版，维护步骤见仓库 `docs/preview-release.md`；该流程不替代本文的真实模型和正式分发验收。

正式 Developer ID、公证和下载分发需要独立准备。分发 ad-hoc 测试包应标注其性质和未验证项，不以 `codesign --verify` 成功宣称已公证。第三方模型和依赖许可证分别核对，不随应用许可证自动改变。

## 2. 可携带工具与隔离边界

仓库入口 `scripts/acceptance/run-bundle-acceptance.sh` 使用指定应用内置的 Node。测试机器不需额外安装 Python、uv、pnpm 或 Node。工具冻结应用副本，核对完整文件/符号链接清单和签名，再在独立 HOME、缓存、临时目录、数据库及工作目录运行包内 Runtime/Node。

Runtime 使用系统 PATH，清空开发 Python 导入路径、关闭用户 site 并设置模型离线标志。Coding 只使用内置工具和固定系统验证命令。进程检查按 PID 与出生时间区分本次拥有的进程，不能清理用户已有进程。

这是同一机器和用户下的环境隔离，不是 macOS 沙箱。工具没有关闭系统网络，也不能证明宿主机不存在其他依赖；独立机器、系统断网、原生 GUI、Gatekeeper 与休眠唤醒需另行验证。

| profile | 自动化范围                                                                                          |
| ------- | --------------------------------------------------------------------------------------------------- |
| `smoke` | 空模型库、认证拒绝、包内 Host 项目/会话、退出清理、重启持久化；不创建 Fake 模型，不执行真实推理     |
| `real`  | 在 smoke 基础上循环文本、图片、预设/克隆语音、Pi 工具、各模态取消恢复、媒体校验、资源采样与最终恢复 |

`real` 必须提供四个现有模型目录：MLX-VLM 文本、MFLUX 图片、Qwen3-TTS CustomVoice、Qwen3-TTS Base。工具不下载模型，需记录每个模型的 revision、静态身份和实际目录。

## 3. 先执行短测

以下命令从仓库根目录运行，输出目录必须不存在。将应用及模型变量替换为本次实际路径，不能指向个人资料库：

```bash
sh scripts/acceptance/run-bundle-acceptance.sh '/Applications/Ownloom.app' \
  --profile smoke --duration-seconds 0 --cycles 2 \
  --output "$HOME/Desktop/ownloom-smoke-001"
```

真实模型资格测试：

```bash
sh scripts/acceptance/run-bundle-acceptance.sh '/Applications/Ownloom.app' \
  --profile real --duration-seconds 0 --cycles 2 \
  --text-model "$TEXT_MODEL" --image-model "$IMAGE_MODEL" \
  --preset-model "$PRESET_MODEL" --clone-model "$CLONE_MODEL" \
  --output "$HOME/Desktop/ownloom-real-001"
```

解压后的工具包中，脚本位于根部，使用 `sh run-bundle-acceptance.sh`，其余参数相同。`smoke` 不接受模型参数，`real` 必须四项齐全。

## 4. 长期运行

资格测试通过并审查警告后，接通电源，再执行八小时/至少八轮测试：

```bash
/usr/bin/caffeinate -i sh scripts/acceptance/run-bundle-acceptance.sh '/Applications/Ownloom.app' \
  --profile real --duration-seconds 28800 --cycles 8 \
  --text-model "$TEXT_MODEL" --image-model "$IMAGE_MODEL" \
  --preset-model "$PRESET_MODEL" --clone-model "$CLONE_MODEL" \
  --output "$HOME/Desktop/ownloom-soak-8h-001"
```

时长与最少轮数均满足才结束，最后一轮不会在时长边界强行截断。24/72 小时分别使用 `86400`/`259200`。循环不重启 Supervisor/Node，以观察累积；结束后检查强制父进程退出、重启持久化及正常退出。

`caffeinate` 只在命令期间阻止空闲睡眠，不保证低电量等系统休眠不会发生。运行中断、休眠跨越超时窗口或 Ctrl-C/SIGTERM 均保留实际结果，不计完整通过；重试使用新输出目录，不覆盖失败证据。

## 5. 判定和报告

每个 API、任务、握手及退出都有期限。失败立即停止，保留已完成步骤；输出目录含测试数据库和生成样本，不应提交 Git。

| 产物                     | 用途                                       |
| ------------------------ | ------------------------------------------ |
| `report.json`            | 原子更新的阶段、终态、时长、轮数和检查结果 |
| `artifact-manifest.json` | 冻结应用的完整清单与摘要                   |
| `resources.ndjson`       | 每两秒记录的进程 RSS 和 Runtime 资源       |
| 受限日志和样本           | 诊断、媒体校验与人工复核                   |

资源门槛丢弃前两轮预热，至少需要六个后续卸载检查点，比较最早三点和最后三点中位数。RSS 增长上限 256 MiB、数字文件句柄增长上限 16、存活进程数不得增加。这是异常增长检查，不是无泄漏证明；目录增长需解释作品和历史的正常占用。

不足八小时、八轮或样本不足时，`longRunning` 保持未验证。`resource_tracker`/semaphore 警告使结果进入 `passed_with_warnings_requiring_review`，需要审查重复取消与资源曲线。终态不符、产物损坏、历史丢失、资源超限或退出残留均需处理，不能宣布完全通过。

对外结果绑定提交、应用清单摘要、模型身份/revision、硬件、macOS、实际时长和轮数。分享前脱敏；发布附件可放报告和摘要，不上传私人数据库、凭据或完整模型。

## 6. 专项与原生复验

可携带循环不覆盖全部数据和 GUI 场景。下列工具从仓库根目录执行，Python 客户端需要开发环境，但目标仍是指定应用内的 Runtime/Node：

```bash
APP='apps/desktop/src-tauri/target/release/bundle/macos/Ownloom.app'
"$APP/Contents/Resources/coding-agent/bin/node" scripts/acceptance/verify-packaged-data.mjs \
  --app "$APP" --python services/runtime/.venv/bin/python3 \
  --output .build/acceptance-data-001
```

该探针默认执行合成库迁移、隐私、故障和大量历史检查，可通过 `--only` 选择项目。不访问个人库；数据故障使用显式 FakeEngine，不能据此推定真实模型压力稳定。

图片编辑和语音质量使用完整本地模型及测试素材：

```bash
HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 \
  uv run --project services/runtime --python 3.12 --frozen \
  python -m scripts.verify.verify_local_edit \
  --sidecar "$APP/Contents/MacOS/mlx-studio-runtime" \
  --model-path "$EDIT_MODEL" --source "$SOURCE_PNG" \
  --reference "$REFERENCE_PNG" --mask "$MASK_PNG" \
  --output .build/acceptance-edit-001

HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 \
  uv run --project services/runtime --python 3.12 --frozen \
  python -m scripts.verify.verify_speech_quality \
  --sidecar "$APP/Contents/MacOS/mlx-studio-runtime" \
  --preset-model "$PRESET_MODEL" --clone-model "$CLONE_MODEL" \
  --output .build/acceptance-speech-001
```

原生 UI 另查原图/参考顺序、蒙版复用、保存与取消、播放/暂停、切页恢复、输入法、剪贴板和系统外链。信号指标不能代替试听，应记录试听者、样本、语言和实际判断，不写成未经测量的 MOS 或相似度。大量历史需验证未加载记录的搜索，API 分页通过不等于全历史 UI 搜索通过。

## 7. 独立干净机器清单

测试机器应与构建机不同，不预装开发工具、不拷贝开发缓存。记录芯片、内存、系统版本和 DMG SHA-256；同机新用户只算补充隔离。

| 项目                                             | 本次结果/证据 |
| ------------------------------------------------ | ------------- |
| 下载最终 DMG 并核对摘要                          | 待执行        |
| 原生安装与 Gatekeeper 行为符合实际签名方式       | 待执行        |
| 无开发工具环境下 UI、Runtime、内置 Node 正常启动 | 待执行        |
| 四个模型真实资格测试                             | 待执行        |
| 原生聊天、图片、语音、Coding 和审批              | 待执行        |
| 播放、保存、取消保存和连续操作保持响应           | 待执行        |
| 退出、重启后历史恢复，后台无残留                 | 待执行        |
| 模型齐全后系统断网启动并生成                     | 待执行        |
| 空闲/生成中休眠唤醒后可恢复或进入明确终态        | 待执行        |
| 声明支持的最低系统、内存规格实际覆盖             | 待执行        |
| 八小时结果及资源警告审查                         | 待执行        |

保留默认系统安全策略；ad-hoc 包的手动打开方法参考 [Apple 官方说明](https://support.apple.com/zh-cn/102445)。不能通过全局关闭 Gatekeeper 代替安装验收，未执行项保留未完成。

## 8. 打包和维护验收工具

在 macOS 仓库中执行：

```bash
sh scripts/acceptance/package-acceptance-kit.sh .build/acceptance-kit-001
```

输出目录和同名 ZIP 必须不存在。工具包含入口、无第三方依赖的 Node 模块、回归测试、本文和 `SHA256SUMS`；不含应用、模型或凭据。与对应 DMG 一起提供，解压后核对摘要。

`scripts/acceptance/package-acceptance-kit.sh` 按固定路径复制本文件。修改依赖时同步打包清单，执行 `pnpm test acceptance`，并实际从新工具包运行 smoke。本文不得依赖工具包中不存在的相对链接或本机报告；示例应同时区分仓库与工具包路径。
