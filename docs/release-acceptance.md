# 临时签名版本的安装与稳定性验收

[文档入口](./README.md) · [当前证据](./status.md)

本流程支持当前 ad-hoc 签名的 Apple Silicon 发布包，不要求 Developer ID 或公证。签名完整、应用能启动、干净机器可用、长期稳定是分别记录的验收项。手动允许应用打开不能证明安装包功能和稳定性已经通过。

## 自动化覆盖与边界

`scripts/run-bundle-acceptance.sh` 使用指定应用内置的 Node 执行无第三方依赖的验收工具，不需要在测试机器安装 Python、uv、pnpm 或 Node。它冻结一份完整应用副本，检查所有文件和符号链接的摘要及签名完整性，再在独立 HOME、缓存、临时目录、数据库和工作目录运行真正的包内 Runtime/Node。

Runtime 的环境使用系统 PATH，清空 Python 导入路径并关闭用户 site，启用 Hugging Face/Transformers 离线模式。Coding 验证只使用内置工具及固定的 `/usr/bin/grep` 检查命令，不依赖开发机的命令行包。没有修改已安装应用、用户数据、模型权重或系统安全设置。

这是同一主机和用户下的环境隔离，不是 macOS 沙箱。工具没有关闭系统网络，也无法证明宿主系统没有其他依赖；独立干净机器、原生 GUI 安装、系统断网与睡眠唤醒仍需人工记录。

`smoke` 验证新模型库为空、认证拒绝、包内 Node Host 的项目/会话创建、正常退出、父进程强制终止后的清理及重启持久化。该模式不生成 Fake 模型，不代表真实引擎验收。

`real` 额外要求四个本地模型目录，循环执行：

1. 文本 SSE、运行中取消、取消后再次生成、流式结果与历史一致。
2. 图片运行进度、取消后无作品、再次生成、PNG 校验和及解压后的完整扫描行。
3. 预设语音、生成样本参考音色、克隆、运行中取消、取消后恢复、WAV 容器和实际帧数。
4. 真实 Pi → MLX 工具协议、受管文件修改与固定命令验证。
5. 卸载后的 Worker 内存为零、无活跃任务、进程数、RSS、文件句柄和目录占用。

循环期间不重启 Supervisor/Node，以免掩盖持续累积。结束时重新加载文本 Worker，强制终止其父进程并关闭 stdin，检查观察到的子孙进程全部退出；再次启动后校验首批和最后一批媒体摘要、聊天、音色及 Coding 会话，最后正常退出。进程清理按 PID 和出生时间核对，不终止用户已有进程。

## 本机或独立测试机器执行

先把最终 DMG、固定模型目录和验收工具包放到测试机器。四个模型必须匹配当前被验证的引擎：MLX-VLM 文本、MFLUX 图片、Qwen3-TTS CustomVoice 预设、Qwen3-TTS Base 克隆。工具不自动下载模型。

首次短测，输出目录必须尚不存在：

```bash
sh scripts/run-bundle-acceptance.sh '/Applications/Ownloom.app' \
  --profile smoke --duration-seconds 0 --cycles 2 \
  --output "$HOME/Desktop/mlx-smoke-001"
```

工具包内的脚本直接放在根目录，使用 `sh run-bundle-acceptance.sh`。仓库内使用上面的 `scripts/` 路径。

真实模型先做两轮资格测试：

```bash
sh scripts/run-bundle-acceptance.sh '/Applications/Ownloom.app' \
  --duration-seconds 0 --cycles 2 \
  --text-model "$TEXT_MODEL" --image-model "$IMAGE_MODEL" \
  --preset-model "$PRESET_MODEL" --clone-model "$CLONE_MODEL" \
  --output "$HOME/Desktop/mlx-real-qualification-001"
```

资格测试通过后，执行八小时循环。`caffeinate` 只在该命令运行期间阻止空闲睡眠，不修改长期电源设置；测试机器应接通电源。模型推理会持续占用 CPU/GPU 和内存。

```bash
/usr/bin/caffeinate -i sh scripts/run-bundle-acceptance.sh '/Applications/Ownloom.app' \
  --duration-seconds 28800 --cycles 8 \
  --text-model "$TEXT_MODEL" --image-model "$IMAGE_MODEL" \
  --preset-model "$PRESET_MODEL" --clone-model "$CLONE_MODEL" \
  --output "$HOME/Desktop/mlx-soak-8h-001"
```

时长与最少轮数同时满足才结束，最后一轮不会被八小时边界强行截断。24/72 小时使用 `86400`/`259200`。Ctrl-C 或 SIGTERM 会记录中断并清理本次测试进程；中断不算通过。不要在测试期间覆盖冻结目录内的应用资源。

## 判定与证据

每一步失败立即停止，保留已经执行的结果。每个 API 请求、任务轮询、握手和退出都有期限。`report.json` 原子更新；`resources.ndjson` 每两秒记录真正进程 RSS 与 Runtime 指标；完整包清单在 `artifact-manifest.json`；本地 stderr 保存在权限受限的日志中。输出目录包含测试数据库和生成样本，不应提交到 Git。

资源门槛是本项目提出的初始标准：丢弃前两轮预热，至少六个后续卸载检查点，对比最早三点和最后三点的中位数。RSS 增长不得超过 256 MiB，数字文件句柄增长不得超过 16，存活进程数不得增加。它是异常增长门禁，不是内存无泄漏的数学证明；目录增长需要结合保留的作品、历史、探针报告判断。

不足八小时、真实模型轮数不足八轮或样本不足时，`longRunning` 明确保留未验证。出现 `resource_tracker`/semaphore 清理警告时，即使后续功能恢复，也会标为 `passed_with_warnings_requiring_review`，需要检查重复取消后的进程和资源曲线，不能直接宣布稳定性完全通过。资源增长超限、任务未进入预期终态、产物损坏、历史丢失或退出残留均失败。

最终发布结论绑定应用清单摘要、模型登记身份/revision、硬件、系统版本、实际运行时长、轮数及完整结果。换应用包或模型版本后重新验收。

## 六项短时专项复验

2026-10-19 的实际结果与限制见 [六项专项验收](./status.md#六项专项验收2026-10-19) 和 [总报告](../.build/acceptance-six-20261019/report.json)。旧数据、故障恢复、图片编辑、隐私和长语音在已记录范围内通过；大量历史的 API 分页通过，但原生搜索仅覆盖已加载会话，全历史搜索仍需修复复验。八小时长测继续暂停。

以下工具从仓库根目录运行，与上面的无 Python 可携带工具分开。数据库造数需要已有 Python 3.12 开发环境；仅由该环境准备合成 fixture，实际 API/迁移/Host 使用指定应用包。输出目录必须是新目录。不要传入用户数据库或安装版数据目录。

```bash
APP='apps/desktop/src-tauri/target/release/bundle/macos/Ownloom.app'
"$APP/Contents/Resources/coding-agent/bin/node" scripts/verify-packaged-data.mjs \
  --app "$APP" --python services/runtime/.venv/bin/python3 \
  --output .build/acceptance-data-new
```

默认依次执行 `migration`、`privacy`、`faults`、`history`，可通过 `--only` 指定其中一项。每项使用独立 HOME/缓存/临时目录与数据；故障注入仅影响这些 fixture 和按出生时间识别的测试进程。数据/故障使用显式登记的 FakeEngine，不把结果当作真实模型压力结论。旧库覆盖受支持格式的合成迁移与二次启动、媒体/模型文件摘要、审批失效和不重放；不代表任意私人历史库。大数据集为 2 万会话、2 万运行、10.2 万事件及 120 个大文件变更。

真实编辑与语音需要现有本地完整模型及开发环境中的验收客户端，不自动下载。以下变量分别指向完整编辑模型、CustomVoice、Base 克隆模型，以及测试 PNG 的源图、参考图和蒙版：

```bash
HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 \
  uv run --project services/runtime --python 3.12 python scripts/verify_local_edit.py \
  --sidecar "$APP/Contents/MacOS/mlx-studio-runtime" \
  --model-path "$EDIT_MODEL" --source "$SOURCE_PNG" \
  --reference "$REFERENCE_PNG" --mask "$MASK_PNG" \
  --output .build/acceptance-edit-new

HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 \
  uv run --project services/runtime --python 3.12 python scripts/verify_speech_quality.py \
  --sidecar "$APP/Contents/MacOS/mlx-studio-runtime" \
  --preset-model "$PRESET_MODEL" --clone-model "$CLONE_MODEL" \
  --output .build/acceptance-speech-new
```

图片探针检查双参考图、取消后生成、蒙版作品及重启摘要；蒙版外像素对照、参数复用和原生文件保存还需按实际输出补验。语音探针生成参考音、364 字预设与克隆样本，只自动判定 WAV 格式、帧数、能量与削波等指标；人工试听之前报告保留 `subjective_review` 待确认。人工结论应另记实际试听者、原话和样本范围，不能把信号指标改称自然度或音色相似度评分。

原生复验应使用独立应用标识及新数据目录，将合成历史和已生成媒体副本放入该目录，记录 fixture 来源、应用与包内资源摘要，不覆盖安装版。核对旧会话加载/搜索、恶意 Markdown 惰性展示、图片输入顺序/蒙版复用、播放暂停、保存及取消保存；仅终止该应用的 Runtime，确认断连提示、点击重试、历史恢复与退出后无残留。独立标识应用的本机结果不能替代下载 DMG、原生安装和独立干净 Mac 检查单。

## 干净机器人工检查单

独立 Mac 首次测试前不要安装开发工具或拷贝开发目录/缓存。记录该机器与构建机不同、芯片、内存、macOS 版本及安装包 SHA-256。新建本机用户只算补充隔离测试，不算独立机器。

| 项目 | 结果与证据 |
|---|---|
| 浏览器下载最终 DMG，校验随包 SHA-256 | 待填 |
| 拖入应用程序；首次被拦截后，在隐私与安全性中手动允许该应用 | 待填 |
| 无开发工具环境下，原生 UI 与 Runtime 正常启动 | 待填 |
| 导入四个模型，运行真实模型资格测试 | 待填 |
| 原生文本/图片/语音/Coding 展示和交互 | 待填 |
| WAV 播放、暂停、切页恢复、连续两次原生文件导出 | 待填 |
| 退出、重新打开、历史与作品恢复，后台无残留 | 待填 |
| 导入完成后系统断网，再启动并生成 | 待填 |
| 空闲/运行中睡眠唤醒，取消或恢复能进入明确终态 | 待填 |
| 最低声明支持系统与当前系统分别完成 | 待填 |
| 八小时自动化结果及警告审查 | 待填 |

保留默认 Gatekeeper 设置，不通过全局关闭安全检查来完成验收。未公证应用的手动打开操作见 [Apple 官方说明](https://support.apple.com/zh-cn/102445)。没有独立机器时，该检查单保持未完成。

## 打包可携带工具

在仓库运行：

```bash
sh scripts/package-acceptance-kit.sh .build/acceptance-kit-001
```

生成包含入口脚本、五个无依赖模块、工具回归测试、本文和 SHA256SUMS 的目录及 ZIP。工具包不包含应用、模型或凭据；与对应的 DMG 一起传给测试机器。
