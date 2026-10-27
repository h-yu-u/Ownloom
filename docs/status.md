# 验收状态与后续工作

[文档入口](./README.md) · [使用说明](./getting-started.md) · [架构](./architecture.md)

本文根据当前实现与 2026-10-15 至 2026-10-28 的本地验收结果整理。功能实现、FakeEngine 自动化和真实模型验证分别看待，不将单机结果扩展为全模型或正式发布结论。

## Ownloom 品牌升级（2026-10-28）

应用名、窗口与网页标题、导航、消息署名、输入提示、导出文件、API 标题及当前发布说明统一为 Ownloom。新增 O 字标的 SVG、PNG 与 macOS ICNS，应用包名为 `Ownloom.app`，主程序名为 `ownloom`。旧应用标识、数据位置、Keychain 命名空间与内部协议标识保留，兼容约定见[数据位置](./getting-started.md#数据位置)。历史验收中的旧制品名称按当时事实保留。

`pnpm check`、`pnpm test`（前端 276、Runtime 224、Coding 67、验收工具 8，共 575 项）、`pnpm check:rust`、`pnpm test:rust`（7 项）、`pnpm api:generate` 与 `pnpm build:app` 通过。已构建 `apps/desktop/src-tauri/target/release/bundle/macos/Ownloom.app` 和 `bundle/dmg/Ownloom_0.1.0_aarch64.dmg`；应用元数据、可执行文件名、图标及 65 个 Coding JavaScript 模块与源码构建摘要逐项核对通过，`codesign --verify --deep --strict` 通过。

应用包内 Sidecar 在清空开发 `PYTHONPATH` 的子进程中通过 FakeEngine 对话、取消、Worker 重启、Runtime 重启持久化、系统/Worker 内存与退出验证。另以隔离旧数据目录和模拟 Keychain 验证历史读取、凭据引用及不创建新凭据。界面预览使用实际导航、聊天侧栏、消息和输入组件，消息为测试数据。证据位于 `.build/ownloom-brand-20261028/`。未新增依赖；Web 构建仍有原有大分包提示。本机构建使用临时签名，正式签名、公证、干净机器及真实 MLX 模型回归未在本次复测。

## 已有实现

| 模块 | 当前范围 |
|---|---|
| 桌面与 Runtime | 启停/重启、认证握手、连接代际与失效清理、状态和诊断接口 |
| 任务与持久化 | 唯一终态、幂等取消、重启中断标记、SQLite 事务与文件补偿清理 |
| 聊天 | 模型选择、HTTP/SSE、停止生成、多轮上下文、会话持久化、重命名/删除/置顶及取消置顶、失败保留草稿/附件 |
| Coding | 独立 Pi 工作区、项目与会话、三种模式、工具时间线、命令/测试修改审批、停止与补充、下一任务排队、按需文件/Diff、冲突撤销与验证证据、重启恢复 |
| 模型库 | 静态扫描/导入、能力识别、加载/卸载、登记与文件删除分离、HF MLX 下拉搜索/下载/自动登记 |
| 图片创作 | 文生图/图片编辑/局部重绘、参考图上传/排序、区域画笔与橡皮擦/撤销、原图对比、继续编辑、排队/进度/取消、PNG/参数/参考附件保存和历史复用 |
| 语音创作 | 预设合成/参考克隆、音色库与授权记录、音频校验、任务取消/恢复、作品历史/试听/波形/WAV 导出 |
| 引擎 | Fake Text/Image 开发路径、mlx-lm / mlx-vlm Worker、可选 MFLUX 适配器 |
| 工具链 | 前端/Runtime/边界检查、测试、API 类型生成、Web 与 Sidecar/桌面构建脚本、CI 配置 |

侧栏资源卡片显示实时系统内存（已用/总量）、使用率进度条、推理 Worker 当前占用和可用磁盘；设置页同步展示。每 2.5 秒后台采样，文档隐藏时暂停、重新可见时立即更新，后台采样不触发设置页加载遮罩。macOS 读取原生 VM/进程计数，不安装额外依赖：系统已用包含匿名页、不可分页页和实际压缩存储，排除文件缓存及可回收页；Worker 使用 physical footprint（含压缩内存），不称为专属显存或整个 App 占用。Linux 开发路径使用 MemAvailable 和 Worker RSS；采集不可用显示 `—`，未启动 Worker 显示“未启动”。旧峰值 RSS 字段仅为协议兼容保留。

实时指标更新已通过 `pnpm check`、前端 62 项和 Runtime 81 项测试、API 类型重复生成一致性与实际 App 构建。发布 Sidecar 验证系统总量/已用/可用一致、Worker 加载后占用大于零、卸载后归零；本机 64 MiB 映射申请/释放实验证明进程计数随当前占用升降。UI 已检查实时卡片、真实进度条、设置页同步及短窗口布局。证据位于忽略的 `.build/memory-validation/evidence.json`，App 内 Sidecar 与测试二进制哈希一致；没有新增依赖。

本次架构重构的阶段 0–8 实施、数据兼容策略及完整本机证据见[重构验收记录](./refactor-2026-10-15.md)。用户已确认正式签名、公证和干净机器验收另行执行。

## 产品与架构优化验收（2026-10-22）

按《MlxDesktop 产品与架构优化技术方案》的 PR 0–9 完成代码落点，保留既有进程边界与数据所有权，未自动提交或推送。实现机制见[架构](./architecture.md#产品与架构优化2026-10-22)。

| 批次 | 已实现与本轮验证 |
|---|---|
| PR 0 | NumPy 加入类型检查开发环境；Rust 静态 CI 禁用发行资源引用。开发资源配置下 fmt、clippy、Rust 测试通过。 |
| PR 1 | 推理结果及成功状态共同提交；故障注入覆盖 result→EOF/failed、重复终态、落盘失败、取消竞争及大段中文/转义结果分片。 |
| PR 2 | 统一预算和实际 usage、小窗口输出预留、Pi 压缩配置、可识别 overflow；长历史摘要保留早期约束与最近完整轮次，失败不替换原文，摘要可复用。 |
| PR 3 | 加载中归属、epoch 隔离、取消回收、中断重启、降级接纳门禁。覆盖加载取消、旧实例清理和真实 Fake Worker 启停重启。 |
| PR 4 | Pi 描述符在首轮 prompt 前保存；成功前校验已落盘叶节点，恢复校验身份、完整 JSONL 和父链；真实 Node 子进程首轮生成后 SIGKILL，恢复同一 Pi ID/文件，未完成 run 标记 interrupted。 |
| PR 5 | Agent 游标增量观察、SQL 稳定分页与不可变消息引用。10001 条同秒消息遍历无重复；重新生成后旧正文仍能供排队上下文与消息转换读取。 |
| PR 6 | 2001 文件可浏览，超大/不完整证据为 partial；外部编辑使证据过期。逐轮冻结 AGENTS；验证计划绑定配置摘要，配置变化或审批拒绝不误报 passed。 |
| PR 7 | 统一 readiness、应用级任务中心、聊天页内工具助手入口、消息转换预览、生成中浏览其他会话、按错误类型恢复；工具助手不单列主菜单，任务中心保留会话直达；无扩展的普通消息可走空能力快照。 |
| PR 8 | 实际增量文本、有限队列背压、失败不发成功 finish；真实 Pi SDK 接收部分文本后失败仍判断 error。图片按可见区域读取缩略图，原图独立缓存；浏览器验证 24→48→70 张及末页预览，缓存淘汰重取有自动化覆盖。 |
| PR 9 | 固定 revision 下载、实际停止后暂停、重启对账、独立 I/O 队列；存储占用、显式清理、跨所有者保护、图片回收与恢复；各所有者一致快照、Pi 正文与文件 hash、独立 profile 恢复及幂等切换/回滚；普通任务可选择验证并有限修复。 |

本轮质量检查包含 `pnpm check`、`pnpm test`（前端 236、Runtime 194、Coding Host 53、验收工具 8）、`pnpm build:web`、OpenAPI 重复生成与内部 RPC 漂移检查。Rust 使用 `TAURI_CONFIG='{"bundle":{"externalBin":[],"resources":[]}}'` 运行 fmt、clippy 和测试。Web 构建保留现有大 chunk 提示。

任务中心入口位于主导航末尾，随导航参与页面布局；进行中和待批准任务通过角标及名称提示显示。桌面浏览器已验证状态栏无遮挡、点击可打开全局任务面板，小屏导航同步使用紧凑尺寸。

任务聚合直接查询 SQL 摘要，不再重建历史聊天资料，兼容缺少 `turnId` 的旧任务且不读取提示词或回答正文。界面区分首次加载、读取失败和成功空列表；错误提供中文提示与重试，保留上次成功结果并说明状态可能过期。手动刷新复用当前请求并替换轮询计时器，旧观察者的迟到结果不覆盖新状态；模型目录刷新失败也不丢失任务列表。隔离浏览器已验证故障提示与重试恢复，本机开发 Runtime 需重新启动以加载后端修改。

2026-10-23 任务中心按会话标识归并为卡片，用实际会话标题、所属工作区、最近记录时间和主任务状态描述任务，每张卡片仅保留一个打开入口。SQLite 通过持久化 dispatch 关联 Coding/Agent 父任务，内部推理步骤归入同一卡片并默认折叠；未关联的已结束历史推理不作为独立用户任务展示，活跃孤立任务仍可见。同名的不同会话不合并，旧失败步骤不覆盖主任务成功状态，角标与筛选按归并后的任务计数；列表初始展示 10 个任务，支持继续展开。隔离浏览器验证了 14 条记录归并为 3 张卡片、折叠展开与进行中筛选；源码后端及 Coding Host 变更需重启开发应用生效。本次未新增依赖。

联网配置测试修复了代理 DNS 将有效摘要全部过滤的问题：正文读取保持公网 DNS 校验，搜索摘要单独校验引用地址，读取受限时明确标记仅摘要可用。本机已保存 Tavily 配置只读实测取得 3 条摘要来源、0 条正文，隔离界面显示连接成功及正文受限提示；未改动用户密钥或配置。实现与验收边界见[聊天附件与联网搜索](./chat-attachments-web.md)。

只新增 NumPy 开发依赖，未升级 Pi SDK 或增加生产依赖。桌面备份走固定认证 Runtime 地址到原生保存对话框的流式写入，避免普通媒体 64 MiB IPC 上限；浏览器调试路径使用下载。备份当前上限为压缩 4 GiB、展开 20 GiB，模型权重与 Keychain 凭据不纳入备份。恢复前校验，重启后使用新资料库，原资料库保留；外部模型路径与凭据可能需重新配置。跨所有者消息附件采用保守保护，未确认释放前不清理。

主要文件落点：

- Runtime：`application/inference_service.py`、`context_compaction.py`、`model_runtime.py`、`runtime_control.py`；`adapters/worker_host.py`、`text_engines/structured_input.py`、`persistence/context_revisions.py`、`download_transfer.py`、`backup_bundle.py`、`data_profiles.py`；对应的 `entrypoints/http` 和 Worker 协议。
- Coding Host：`adapters/pi-session.ts`、`transcript.ts`、`workspace-version.ts`、`data-export.ts`、`data-restore.ts`；`application/runs.ts`、`run-verification.ts`、`run-instructions.ts`、`verification-plan.ts` 与 Agent 事件查询。
- 桌面：`capabilities/tasks`、`capabilities/data`、`capabilities/models/task-readiness.ts`、媒体缓存及可见性适配；聊天、Coding、工具助手、图片和隐私设置界面；原生保存边界 `src-tauri/src/commands/backup.rs`。
- 契约与环境：`packages/coding-protocol/schema.json`、OpenAPI/RPC 生成文件、`scripts/generate_coding_rpc.py`、`.github/workflows/ci.yml`、`services/runtime/pyproject.toml` 及 uv 锁文件。
- 回归：`tests/test_inference_reliability.py`、`test_context_compaction.py`、`test_history_revisions.py`、`test_load_cancellation.py`、`test_download_lifecycle.py`、`test_data_recovery.py`，Node `tests/reliability.test.mjs` 及前端 readiness/媒体缓存测试。

隔离数据和界面证据位于忽略目录 `.build/optimization-validation/`，未操作正式会话数据库。下列内容仍未由本轮验证：真实 MLX 模型的新预算/压缩/工具解析和流式故障路径、实际 HF 网络断点恢复、大容量备份压力测试、原生备份保存对话框端到端、强化 Sidecar 打包、签名公证、干净机器及长期内存稳定性。下文的真实模型记录是此前的具体环境结果，不能视为本次变更已复验。

2026-10-23 对话操作收敛为回答下方的复制、重新生成、继续回答（仅截断时）与更多菜单。普通输入框移除工具/技能选择，普通请求不读取默认扩展绑定；工具助手在明确选择转交后才加载。联网重新生成默认重新检索，复用相同资料放在更多菜单中。来源显示发布/更新与检索日期；时效性检索带日期条件，并在 Runtime 复核，旧/无日期/未来日期来源不会充作今日信息。模型上下文接收本地当前时间及来源日期。真实已保存配置只读检索取得 3 条符合本地当日日期的摘要，正文仍未验证；隔离浏览器验证了回答操作、按需工具界面和仅有旧资料时的拦截提示。没有新增依赖；Python 后端修改需重启开发应用生效。 本轮 `pnpm check`、`pnpm test`（前端 241、Runtime 200、Coding Host 53、验收工具 8，共 502 项）和 `pnpm build:web` 通过，构建保留已有大 chunk 提示。界面证据位于忽略目录 `.build/optimization-validation/evidence/chat-answer-toolbar.png` 与 `chat-freshness-guard.png`。

2026-10-23 参考来源点击修复：新增受限外链桥接，网页来源与正文网页链接在系统浏览器打开；引用编号在消息内部滚动、聚焦来源，阻止锚点改写 Hash 路由。打开错误可见且支持重试，没有新增依赖或放开通用 Shell 权限。`pnpm check`、`pnpm test`（前端 261、Runtime 200、Coding Host 53、验收工具 8，共 522 项）、`pnpm build:web`、Rust fmt/clippy 和 7 项 Rust 测试通过。浏览器和独立数据的 macOS 桌面应用均完成点击验证，桌面端实际唤起系统 Chrome 显示来源页；证据位于忽略目录 `.build/optimization-validation/evidence/source-native-citation.png` 与 `source-native-browser-opened.png`。该变更需重新编译桌面壳，不能仅刷新页面。

## 真实模型验证

已记录的设备为 Apple M5 Pro / 64 GB，MLX 0.32.1，JIT 关闭。

| 模型 | 环境与已通过范围 | 尚不能推定 |
|---|---|---|
| `orcarouter/Qwen3.8-27B-Uncensored-MLX`，`4-bit` 子目录 | mlx-vlm 0.6.14；源码与实际 release Sidecar 的文本流式回复、多轮上下文、SQLite 持久化、取消、Worker 重启；测试 PNG 图片理解及保留附件/参数的重新生成 | 多图、长上下文、长期稳定性、其他模型 |
| Qwen Image 2.1 原生 MFLUX BF16 导出 | MFLUX 0.22.0，缓存上限 4 GiB；源码与实际 release Sidecar 的 512×512、12 steps、Seed 42；文生图、进度、取消后再生成、PNG/参数保存、Runtime 重启后历史、聊天→生图→继续原对话 | 图片编辑、LoRA、高分辨率、其他导出/模型或设备 |
| `OsaurusAI/Qwen-Image-2.1-mflux-8bit` 完整编辑导出 | MFLUX 0.22.0；模型级改色、中文换背景、双参考图、蒙版、提示词改写；源码真实 Runtime 的编辑取消/再生成、PNG 和参考顺序/蒙版保存、重启读取；浏览器实操双图编辑与画笔重绘，1440/1024/768 窗口布局与刷新恢复 | 十参考图、高分辨率、人物一致性、LoRA/ControlNet、长期运行、此次新增编辑功能的发布 Sidecar/原生打包交互 |

当前 Worker 显式关闭思考输出和 MLX JIT，作为已验证环境的配置；不将此结论推广到其他版本。

Qwen2.5-0.5B（mlx-lm）、Qwen2-VL-2B、Z-Image-Turbo 仍为候选未验证模型。FLUX/Qwen Image 其他适配分支的存在也不代表真机验收通过。

## 复验命令

图片编辑 UI 与真实接口的本机证据保存在忽略目录 `.build/validation/image-edit-integration/`。没有新增依赖；完整模型根据静态视觉组件识别能力，接口只接受已登记附件 ID，Worker 限制输入到受管附件目录并检查图像像素上限。

以下命令在仓库根目录、具有完整本地模型的 Apple Silicon Mac 上执行。脚本使用临时数据库并在结束时关闭测试 Runtime，不操作正式会话数据。

真实聊天：

```bash
uv run --frozen --project services/runtime --extra mlx-vlm --python 3.12 \
  python scripts/verify_local_chat.py --model-path /path/to/Qwen3.8-27B-Uncensored-MLX/4-bit
```

真实图片及聊天/生图切换：

```bash
uv run --frozen --project services/runtime --extra mlx-vlm --extra mflux --python 3.12 \
  python scripts/verify_local_image.py --model-path /path/to/qwen-image-2.1-mlx-bf16 \
  --output /tmp/mlx-studio-qwen-image.png \
  --chat-model-path /path/to/Qwen3.8-27B-Uncensored-MLX/4-bit
```

只验证图片时可省略 `--chat-model-path`。输出路径会保存验收 PNG。

真实图片编辑（红茶壶基线原图、蓝色参考图与对应黑白蒙版；白色修改、黑色保留）：

```bash
uv run --frozen --project services/runtime --extra mlx-vlm --extra mflux --python 3.12 \
  python scripts/verify_local_edit.py --model-path /path/to/qwen-image-2.1-edit-mlx-8bit \
  --source /path/to/source.png --reference /path/to/reference.png \
  --mask /path/to/mask.png --output /tmp/mlx-edit-check
```

脚本用 512×512、40 步、Seed 42 测试编辑、双参考顺序、取消后重新生成、区域修改和重启后的图片/附件读取。该脚本专用于红茶壶与蓝色参考图的基线复验；自有素材应按修改需求调整脚本中的测试指令。参考图与蒙版必须对应原图。

真实图片理解和重新生成：

```bash
uv run --frozen --project services/runtime --extra mlx-vlm --python 3.12 \
  python scripts/verify_local_vision.py --model-path /path/to/Qwen3.8-27B-Uncensored-MLX/4-bit \
  --image /path/to/verification.png
```

上述三个脚本均接受 `--sidecar /path/to/mlx-studio-runtime`，此时从实际二进制启动，并清除开发源码 PYTHONPATH。`scripts/verify_packaged_runtime.py --sidecar ...` 验证同一包的 FakeEngine、诊断、取消与重启持久化；不能单独代替真实引擎验证。

`scripts/verify_desktop_shutdown.py --sidecar ...` 模拟桌面壳强制停止 onefile bootloader，并关闭它持有的 stdin 管道；已验证内部 Runtime 和已加载 Worker 全部退出。冻结入口同时处理 multiprocessing 辅助进程，避免误启动额外 Runtime。最终 `.app` 已本机构建，签名、公证、原生 GUI 的正式安装与干净机器验收另行执行。

系统与早期独立探针保留为辅助工具，脚本能执行不代表对应模型已经通过：

```bash
python3 scripts/system_probe.py
uv run --project spikes/mlx-lm-text --python 3.12 python spikes/mlx-lm-text/run_text_generation.py
uv run --project spikes/mlx-vlm-image --python 3.12 python spikes/mlx-vlm-image/run_vlm.py --image /path/to/image.png
uv run --project spikes/mflux-image --python 3.12 python spikes/mflux-image/run_image_generation.py
```

文本探针默认固定小模型 revision，输出增量文本与耗时/吞吐/内存摘要。VLM 探针输入图片上限 50 MB。MFLUX 探针默认检查 PNG 后清理临时文件，指定 `--output` 才保留；其候选模型与当前已验证 Qwen Image 不同。独立 Spike 的依赖和上游 API 需单独复验，不能代替产品 Runtime 测试。

系统探针只读硬件、系统、Python 和磁盘，不安装依赖或访问网络。输出仅表示采集时环境，不是最低配置承诺。

## 聊天流式输出专项复验（2026-10-15）

已确认本机最近一条提前结束的回答恰好生成 512 token，达到旧默认上限。默认输出上限已提高到 4096，设置允许 8192；Worker 的 `finish_reason` 与生成 token 数传递到任务完成事件和会话参数，页面区分长度截断并提供「继续回答」。

对于 MLX-VLM 的 ByteLevel BPE 解码器，已改为按完整 UTF-8 字符输出，避免中文等待空格；其他解码器保留原行为。前端合并密集增量、限制 Markdown 解析频率、缓存未变化消息，并在实际 DOM 更新后按帧跟随滚动，向上阅读时暂停跟随。

本机 Apple M5 Pro / 64 GB、同一本地 Qwen 4-bit 模型、同一确定性测试输入：两次均生成 942 token 并自然结束；分片中位间隔从 339.06 ms 降至 56.60 ms，最大间隔从 411.77 ms 降至 61.13 ms，生成总耗时基本相同（53.33 / 53.36 秒）。这是显示分片粒度改善，不代表推理吞吐增加。中文、英文空格、Markdown 代码、表情及特殊 token 的最终解码与原解码器和分词器一致。

真实 HTTP/SSE 验证覆盖旧上限之外的长回答、16-token 截断原因、持久化一致性、主动断流后的游标重放、取消和正常退出。

独立浏览器使用 FakeEngine 的密集长文本验证页面渲染：跟随滚动和向上阅读保持通过，最终文本尾部完整，无页面异常及横向溢出；该次采样未记录超过 50 ms 的主线程任务。该浏览器验证使用临时数据，真实模型的输出与恢复另由上述 API 验证覆盖。

复验命令：

```bash
uv run --frozen --project services/runtime --extra mlx-vlm --python 3.12 \
  python scripts/verify_chat_streaming.py \
  --model-path /path/to/Qwen3.8-27B-Uncensored-MLX/4-bit \
  --output /tmp/mlx-chat-streaming.json
```

本次未重新打包 Sidecar，也未做长时间压力测试；开发应用需重启 Runtime 后使用新的解码器和完成原因。

## Coding 接入验收（2026-10-16）

已接入 Pi / pi-ai 1.2.0、TypeBox 1.3.27、内置 Node 22.23.1。Node Host 单独管理 Coding 元数据与 Pi 会话；新增内部结构化推理 API，按单次请求取得现有 MLX 推理租约。模型工具能力需经过实际闭环验证，关联引擎、模板/配置与权重版本信息；失败保持未验证。完整使用、协议范围和权限边界见 [Coding](./coding.md)。

本次通过的验证：

| 验证 | 结果与证据范围 |
|---|---|
| `pnpm check` | Prettier、Vue/TypeScript、ESLint、Ruff/Pyright、前后端与新增 Host 依赖边界、源码长度均通过 |
| `pnpm test` + 新增 Host 回归 | 前端 108 项、Runtime 101 项、Host 8 项；含结构化消息/ID、JSON/XML/Unicode/截断、权限凭据、路径和 symlink、已有 staged/unstaged/untracked 变更保留、大文件按需读取、审批拒绝/失效、取消与队列、人工编辑冲突、验证过期及 Host 崩溃后的进程组清理 |
| Rust | `pnpm check:rust` 与 `pnpm test:rust` 通过，3 项 Rust 单元测试通过 |
| Web / Sidecar / 应用 | Web、release Sidecar、`.app` 和 `.dmg` 均构建成功；DMG 使用 CI 模式跳过 Finder 外观脚本，正式签名/公证未进行 |
| 分发资源 | Host/Node/SDK 为实际文件布局，避免 Tauri 漏复制 pnpm 链接；包内 19 个 Host 模块与当前构建摘要一致，不依赖全局 Node 或 Pi |
| 最终应用包的脚本化闭环 | 直接调用 `.app` 内 Runtime、Node 和 Pi，完成 read → write → 检查失败（退出码 1）→ 修复 → 通过（退出码 0）；证据 `.build/coding-packaged-fake.json` |
| 最终应用包普通聊天回归 | 发布 Sidecar 的 Fake 文本生成、取消、Worker 重启、Runtime 重启后的历史、资源指标及退出均通过 |
| 最终应用包 API 回归 | 2 项端到端场景通过：幂等提交、审批、失败修复、版本撤销与普通聊天回归；拒绝/取消、排队及审批时不持推理锁 |
| 最终应用包的真实 MLX 闭环 | 同机 Qwen3.8-27B-Uncensored-MLX 4-bit / mlx-vlm 0.6.14，真实 read / write / run_command 共 3 次工具调用，模型发起检查及宿主收尾检查退出码均为 0；证据 `.build/coding-packaged-real.json` |
| 浏览器 | 验证了发送与两次独立审批、失败后的修复、验证退出码与旧记录过期显示；Runtime 重启后的会话恢复、按需读取修改内容；界面证据 `.build/coding-ui-final.png` |

安装制品位于忽略目录 `apps/desktop/src-tauri/target/release/bundle/`，没有提交模型、私有诊断或构建产物。本次新增依赖仅用于 Pi Host，不新增 Python 推理系统或 SQLite 原生模块。

上述真实模型验证只覆盖固定隔离项目的工具闭环，不能推定任意真实项目都能自动修复，也不能扩展为所有模板、长上下文、多模态 Coding 或长期稳定性结论。推理响应目前在完整结构化解析后发送，正文逐 Token 展示仍未实现。Worktree、PTY、外部 Skills/MCP、多 Agent 和周期任务按原设计属于后续阶段；正式签名、公证、干净机器及长期压力验收仍未进行。

### 首轮多工具调用回归（2026-10-16）

用户的“完成一个简单的web图书馆系统”任务暴露了固定单调用探针遗漏的问题：原解析器将同一响应中的多个 `<tool_call>` 当作格式错误，Host 又将具体错误归并为 `MODEL_INFERENCE_FAILED`。`mlx-tools-v2` 先校验完整调用批次，再通过已声明顺序执行的 Pi 工具逐个执行；每次命令仍独立审批。截断、缺失结束标记、未知工具及超过 48 个调用的批次整体拒绝。模型错误保留稳定 Runtime 错误码，界面显示中文说明与详情；不存储任意 Provider 错误正文。工具验证探针现在明确要求首轮同时发起目录列表和文件读取。

源码运行的同机真实 Qwen 模型已在隔离空目录完成原文任务：首轮 list / git_status、第二轮两个独立 write 均正常顺序执行，最终生成 HTML、CSS、JS 和使用说明，7 次工具调用，审批后的 `node --check app.js && ls -la` 退出码 0，任务终态 completed / passed。非 Git 空目录的 git_status 返回工具错误，模型正常继续；没有改动用户原项目。证据 `.build/coding-multicall-real-task.json` 及相邻 `.project/`。

Chrome 手工回归通过初始书目、添加、实时搜索、借出后库存减少、刷新后借阅保存、归还后库存恢复、删除及关联记录清理；页面无 console error。内置浏览器不支持原生 prompt，借阅弹窗由 Chrome 原生界面完成。证据 `.build/coding-library-browser.json`、`.build/coding-library-regression.png`。

最终 `.app` 内真实 MLX 再验收通过：新的批量调用探针共 4 次工具调用，模型检查与宿主收尾检查退出码均为 0；脚本化探针共 7 次工具调用，退出码序列 `[1, 0, 0]`。证据 `.build/coding-multicall-packaged-real.json`、`.build/coding-multicall-packaged-fake.json`。包内 19 个 Host 模块与源码构建摘要一致。重新构建 Host 后验证工作区仍同时保留运行依赖与开发工具；构建失败路径也执行依赖恢复。最终本机临时签名包及 `/Applications/MLX Studio.app` 通过 `codesign --verify --deep --strict`；保持 hardened runtime，声明 Python/MLX 动态库加载所需权限。签名后的独立 Runtime 真实模型 4 次工具调用、两个退出码 0，Fake 失败修复 `[1, 0, 0]` 均通过，证据 `coding-multicall-signed-real.json` / `coding-multicall-signed-fake.json`。正式 Developer ID 签名与公证未进行。

最终安装版桌面启动、Runtime 就绪、当前两条开发会话及 Qwen 工具验证状态恢复均已实际确认。用户授权关闭运行中的源码开发版后，在 `/Applications/MLX Studio.app` 创建独立“安装版回归验收（只读）”会话：真实 Qwen 在单一模型响应中发起 list / git_status，按序完成，任务 completed；只读任务无命令检查，正确保留 not_run。原项目目录仍为空。证据 `.build/coding-installed-real.json`、`.build/coding-installed-regression.png`。界面已恢复开发模式，保留安装版窗口。连接中断与超时也已映射为独立稳定错误码和中文提示。

## 后续工作与发布条件

| 方向 | 剩余工作及验收要求 |
|---|---|
| 模型与下载 | 扩展真实架构/量化矩阵；完善下载进度、跨重启恢复及磁盘压力处理 |
| 多模态 | 扩展连续图片追问、多图/像素解码限制；实时语音与视频能力后续评估 |
| 图片创作 | 扩展编辑素材、蒙版边界质量、十参考图、高分辨率和其他模型/导出；批量、LoRA 等扩展单独确定范围 |
| 稳定性 | 真模型故障注入、自动退避恢复、长时间运行、连续切换/取消与 Worker RSS 回收对照 |
| 性能与安全 | 固定设备/模型/参数的 TTFT、吞吐、内存与生图基线；路径/超大附件/Markdown/日志隐私及诊断导出验收 |
| 外部 API | 当前默认关闭；兼容聊天接口返回 501，协议、流式响应和独立认证需完成后再开放 |
| 桌面交付 | PyInstaller/MLX 动态库打包、退出清理、嵌套签名、公证、更新/回滚、数据迁移、首次启动引导 |

正式发布仍需执行 `pnpm build:app`，并在无开发工具/Python 的干净 Apple Silicon Mac 上验证安装、Sidecar、离线使用、历史保留、退出清理和 Gatekeeper。至少覆盖两种内存规格，升级失败时旧版本可启动、会话/模型登记/作品完整，卸载不得默认删除外部模型目录。

质量检查通过、Web 构建成功或某个本地模型通过，均不能代替这些发布条件。后续验收结果直接更新本文件，不再累积旧 P0–P9 阶段状态或临时修复日报。


## Coding 界面简化（2026-10-16）

- 顶部移除运行验证、项目设置、验证，仅保留变更与文件。对话、输入与可调整宽度的完整右侧浏览面板并列。
- 文件使用 Naive UI 目录树和 CodeMirror 只读源码；变更使用 Diff2Html，支持行内/并排、本会话/Git、打开文件与冲突保护撤销。依赖许可随包保留。
- 发送时自动准备首次使用的模型，失败保留输入；普通任务不再执行旧项目验证命令，命令工具继续逐次审批。
- 源码检查、117 项前端测试、102 项 Runtime 测试、8 项 Host 测试与 Web 构建通过。浏览器隔离项目验收覆盖目录搜索、空文件、源码搜索、红绿与并排差异、Git 列表内部跳转及面板拖动。
- 新版 `.app` / `.dmg` 构建通过，`codesign --verify --deep --strict` 通过，已更新 `/Applications/MLX Studio.app`；旧版保存在 `.build/application-backups/MLX Studio-before-ui-redesign-20261016.app`。
- 最终安装版的独立 Runtime + 内置 Node Host 工具探针通过：7 次工具调用，预期先失败再修复的退出码为 `[1, 0, 0]`，证据 `.build/coding-ui-installed-fake.json`。首次直接发送任务的自动准备浏览器验收记录 `.build/coding-ui-auto-prepare.json`。
- 桌面已确认仅剩“变更、文件”，原项目的文件访问曾等待 macOS 重新授权文稿目录（临时签名更新导致旧授权不匹配）。用户已允许最终安装包访问，现已恢复；正式签名、公证及干净机器验收仍未完成。
- 安装版桌面隔离项目验收通过：自动准备/发送、逐次命令审批、失败后修复、受管差异、文件树搜索、TypeScript 动态语法模块与 ⌘F 源码搜索。会话名“界面回归验收（隔离）”，只修改隔离项目的 `probe.txt`；任务完成，检查退出码 `[1, 0]`，无额外收尾检查。证据 `.build/coding-ui-installed-task.json`，截图 `.build/coding-ui-installed.png`。

本次主要改动文件：

- `apps/desktop/src/modules/coding/pages/CodingPage.vue` / `CodingPage.styles.css`：简化入口与左右面板布局。
- `components/CodingInspector.vue`、`CodingChangesView.vue`、`CodingFileBrowser.vue`、`CodePreview.vue`、`DiffPreview.vue`：开源查看器与目录浏览（以上组件路径均位于 `apps/desktop/src/modules/coding/`）。
- `presentation/coding-controller.ts`、`coding-inspector-controller.ts`、`coding-activity.ts` 与 `infrastructure/code-preview.ts`、`diff-preview.ts`、`domain/inspector.ts`：自动模型准备、独立浏览状态与安全渲染（同一 Coding 模块）。
- `apps/desktop/src/capabilities/coding-settings/presentation/CodingSettingsPanel.vue`、`components/CodingComposer.vue` / `CodingTimeline.vue`（Coding 模块）：清理旧验证/修复轮数界面与折叠操作记录。
- `services/coding-agent/src/application/runs.ts` / `adapters/workspace.ts`：普通任务不运行旧配置检查，新仓库 Git 差异正确展示工作树。
- `apps/desktop/package.json`、`pnpm-lock.yaml`、`apps/desktop/public/third-party-notices.txt`：添加查看器依赖，保留 57 项依赖许可；新增相应单元/集成回归用例，更新 `docs/coding.md` 与本文。

检查记录：`pnpm check`；`pnpm test`（117 前端 + 102 Runtime + 8 Host）；最后控制器调整后重新运行 `pnpm check` / `pnpm test:frontend`，Git 调整后重新运行 `pnpm check:coding` / `pnpm test:coding`；`pnpm build:web`、`pnpm build:coding:bundle`、`CI=true pnpm --filter @mlx-studio/desktop tauri build --ci` 均通过。Web 构建保留大于 500 kB 的主包提示，查看器已按需拆分；本次未改 Rust 或 Python 生产代码，未重复 Rust 检查或真实 MLX 长任务，之前真实模型回归记录仍保留。

### 原项目授权后的最终验收补充

用户已在 macOS 文稿目录提示中允许访问。安装版重新切回原项目后，原有会话、四个项目文件（`app.js`、`index.html`、`README.md`、`style.css`）与 HTML 源码正常加载；四个受管文件差异正常读取，未修改原项目文件。

此次补查修正了 Diff2Html 将 `/dev/null` 到新文件误判为重命名的展示问题：受管新增文件现在带明确的 Git 新文件标记，并以 A 显示；现有空文件仍标为修改。新增路径含空格/中文和空文件区分的回归覆盖。`pnpm check`、`pnpm test` 再次全部通过：119 项前端 + 102 项 Runtime + 8 项 Host，共 229 项。

最终包已重新生成、安装并通过签名完整性检查；用户允许最终包访问文稿目录后，再次在安装版中打开原项目，四个文件均正确显示 A，`app.js` 差异标记为 ADDED，点击“打开文件”成功读取原始 JavaScript 源码并显示语法着色。无目录权限错误或待处理的系统授权。本次补查仅修改 `diff-preview.ts`、`diff-preview.spec.ts`、`CodingChangesView.vue` 与本文，未新增依赖，未修改用户项目文件。

最终截图：`.build/coding-ui-original-project-changes.png`、`.build/coding-ui-original-project-files.png`。完整源码检查、229 项测试、Web/桌面构建、安装版隔离任务及原项目文件/变更读取验收完成。

## 语音创作（2026-10-17）

已实现独立工作区、模式筛选、模型识别与资源完整性契约、参考 WAV 校验、音色保存/编辑/授权/完整删除、作品历史/复用/试听/波形/WAV 导出。语音与聊天、图片、Coding 共用调度和单活 Worker，增加音频 SQLite 迁移与媒体恢复，默认删除音色后保留的录音可单独管理。新增固定可选依赖 mlx-audio 0.5.9，没有新增前端依赖。

源码 Runtime 已在本机验证固定 revision 的 Qwen3-TTS 1.7B CustomVoice 8bit 预设合成和 0.6B Base 8bit 参考克隆（24 kHz WAV），离线 Worker、运行取消/取消后再生成、卸载退出、重启后作品恢复通过。参考素材来自模型生成的测试样本，没有使用私人录音。自动化及参数、时长、RTF、固定模型 revision 与本地证据见[语音创作](./audio-studio.md)。

声音设计、ASR、录音、长文分段、原生音频流、Kokoro/VoxCPM2 尚未开放。新增语音能力的发布 Sidecar、原生 WebView 导出、签名/公证、干净机器、长文质量及音色相似度专项验收尚未执行；不把源码真机验证当作安装包验收。

`pnpm check`、`pnpm test`（127 项前端 + 116 项 Runtime + 8 项 Coding，共 251 项）、`pnpm build:web` 通过。浏览器隔离数据的音色导入/保存、真实预设合成/克隆、切页恢复、试听、参数复用、WAV 下载及窄窗口布局通过，控制台无错误。源码最终 Worker 额外短文本克隆冒烟成功。没有自动 commit 或 push。

## 移除默认模拟模型（2026-10-17）

正常 Runtime 启动不再自动登记 Fake Text/Image/Speech 模型。SQLite 迁移 6 只移除 `source=builtin`、`engine=fake` 的旧登记，保留真实模型、原模型文件和历史快照；新数据库默认为空模型列表。测试与隔离验收脚本改为显式登记模拟模型，不增加面向用户的开关或新依赖。

当前开发版模型库的 3 个 Fake 条目已清理，5 个真实模型（含两款 Qwen3-TTS）完整保留，在线模型列表已验证。`pnpm check` 和 `pnpm test` 通过（127 前端 + 118 Runtime + 8 Coding，共 253 项）；新增空库启动/重启、旧库迁移保留真实权重与历史的回归测试。

本次修改 `application/model_catalog.py`、`adapters/persistence/model_migrations.py` / `sqlite_repositories.py`，并将模拟登记移到 `tests/runtime_fixtures.py` 与 `scripts/verification_models.py`。相关测试、隔离验证脚本及使用说明同步更新；没有新增依赖，没有重新构建或替换安装包，没有提交或推送代码。

## 架构评审路线落实（2026-10-17）

本次按评审的六个阶段推进，保留桌面、Python Supervisor、单活 Worker 与独立 Pi Host 的进程边界，没有引入新依赖，没有提交、推送或替换 `/Applications` 中的安装版。

| 阶段 | 主要改动位置 | 已落实行为 |
|---|---|---|
| PR1 对应门禁 | `scripts/check-boundaries.mjs` 及 fixtures | TypeScript ESM 源码、引用 tsconfig 与别名解析；未解析内部引用显式失败；反向依赖及循环检查 |
| PR2 对应正确性 | Coding project/session controller、JobPoller、Coding Repository | 查询按身份/代际归属，重叠 pending 正确计数；迟到回调不恢复订阅；语音可重试故障退避；会话关联数据整体事务删除 |
| PR3 对应状态语义 | `domain/verification.ts`、Runs、Snapshot、Coding DTO | 普通命令只保存执行证据；显式检查冻结列表，按当前指纹和每步最新尝试汇总；旧无归属记录不追认为验证通过 |
| PR4 对应职责收口 | 前端提交/能力准备及 AudioHistory 用例；Node ProjectSessions、ChangeService、CapabilityVerifier；Runtime 模态端口 | Controller/RPC 组合用例；业务服务不停止 Worker、不访问任务内部字典；Job 及任务映射对消费者只读 |
| PR5 对应数据与事件 | Coding migrations、Repository、Observer/projection；`packages/coding-protocol` | 增量索引迁移、按会话/任务筛选和游标分页、SQL 内剥离大文件内容；提交唤醒 `events.wait`、持久化回放及连续事件投影；共享方法/请求/结果契约与两端一致 fixtures |
| PR6 对应驱动与交付 | `adapters/worker_runtime/`、打包脚本、验收脚本、手动 release workflow | 中性 WorkerContext 与独立模态驱动，静态注册扩展；打包限定 Qwen3-TTS 且阻止模型隐式下载；验证真正包内 Runtime/Node；原生媒体策略与原生文件保存修复 |

源码检查：`pnpm check`、`pnpm test`（150 前端 + 123 Runtime + 39 Coding，共 312 项）、13 项边界 fixtures，以及 `pnpm check:rust` / `pnpm test:rust`（5 项）通过。Unicode 协议边界、新建会话后的分页游标、乱序响应、轮询恢复、删除回滚、旧库升级、提交身份、事件缺口与模态隔离均有回归用例。

实际 release 引擎 Sidecar 与 `.app` / DMG 已本机构建。包内自动化证据为忽略目录 `.build/release-acceptance/report.json`，包含 Sidecar 摘要及各项实际结果；同时保存 `coding-fake.json`、`coding-real.json`、`speech/report.json` 与生成样本。它检查 Fake 闭环、退出清理、选定 Qwen 文本上下文/取消、MFLUX 图片进度/取消、两款 Qwen3-TTS 预设/合成参考克隆/取消后恢复/重启历史及真实 Pi 工具闭环。包内程序通过明确资源路径启动，不借用开发目录的 Node 或 Python 引擎。

原生 UI 使用相同代码及引擎资源、独立标识 `local.mlxstudio.acceptance` 的 QA 应用，保留用户安装版数据。已实际观察播放进入 Pause 状态且进度非零、应用重启与切页后恢复作品、原生保存对话框、连续两次导出后界面继续响应。两份 WAV 均为 24 kHz、单声道、65280 帧，摘要一致；证据 `.build/release-acceptance/native-qa.json` 及 `native-export*.wav`。桌面导出通过现有 Dialog 插件和受限二进制 IPC，Rust 原子写入用户选择的目标；没有引入文件系统插件或开放前端任意路径写入。

交付边界：以上为本机临时签名产物及选定模型验收，不代表正式 Developer ID 签名、公证、干净机器、所有模型或长期压力验收。手动 release workflow 已提供但未在远端运行。取消强制结束上游语音进程时曾出现 resource_tracker 清理警告，后续生成、卸载与进程退出已复验，长期资源稳定性仍需专项测试。现有 Web 主包超过 500 kB 的构建提示保留。

## 本机隔离与稳定性验收（2026-10-17）

用户选择继续使用临时签名分发，先完成本机隔离测试和可携带验收工具；暂时没有独立测试 Mac。正式 Developer ID/公证不作为此次测试的前置门禁，独立干净机器验收仍未完成。

新增 `scripts/run-bundle-acceptance.sh`、`verify-bundle-stability.mjs` 与 `acceptance-{system,runtime,media,workloads}.mjs`，直接使用发布包的 Node，冻结整份应用后以独立 HOME/数据/缓存和系统 PATH 启动包内 Runtime。没有新依赖，不借用源码 Python 引擎，没有重新打包或替换用户安装版。`acceptance.spec.mjs` 的八项工具回归纳入 `pnpm test`；`package-acceptance-kit.sh` 提供可携带 ZIP，完整步骤和人工检查单见[安装与稳定性验收](./release-acceptance.md)。

已完成的隔离证据：

- `.build/isolation-smoke-20261017/report.json`：两轮空库/认证/包内 Coding Host 检查，以及异常退出清理、会话重启恢复和正常退出通过。
- `.build/isolation-real-qualification-20261017/report.json`：225 秒内完成两轮固定真实文本、图片、预设/克隆语音、Coding 工具闭环与各模态取消恢复。两个卸载检查点分别为 RSS 220561408 / 184156160 字节，均为 3 个进程、38 个数字文件句柄、Worker 内存 0、活跃任务 0。强制父进程退出后观察到的测试进程全部消失；重启校验八个媒体摘要及聊天、音色、Coding 会话通过。
- 两轮语音强制取消各出现一次 semaphore 清理警告，因此资格测试状态为 `passed_with_warnings_requiring_review`，不能据此宣布无泄漏或长期稳定。两轮样本不足以进行资源趋势判定。
- `.build/isolation-kit-smoke-20261017/report.json`：最终可携带工具实际运行通过，两次退出均无残留，正常退出码 0。

这些测试绑定同一应用清单摘要 `4430cce9451a99d2ed91ec3ca85d12c5ba7f1ee87cc800d64e4dd4463a285300`。可携带工具为 `.build/acceptance-kit-20261017.zip`，SHA-256 `7636488680bf3d5821086dd779cd3178e6dd13deaadd82251d8b1be0f2b25647`。本轮 `pnpm check`、`pnpm test`（150 前端 + 123 Runtime + 39 Coding + 8 验收工具，共 320 项）通过；最终退出管道处理调整后补跑工具测试、格式检查与可携带包端到端验证，`git diff --check` 通过。本轮未修改 Rust 或应用生产逻辑，未新增依赖、提交或推送。

八小时真实模型长测已于北京时间 2026-10-17 11:26 启动，最少八轮，Supervisor/Node 在循环期间不重启，以观察累积。使用冻结的可携带工具和应用副本，接入仅测试期间有效的空闲防睡眠；证据持续写入 `.build/isolation-soak-8h-20261017/report.json` / `resources.ndjson`，启动日志与 PID 在相邻 `.launch.*` 文件。已配置本聊天跟进，仅在结束、失败、中断或需要处理时报告。

**当前长测状态：提前失败，未完成八小时验收。** 2026-10-17 12:51 结束，报告耗时 5121 秒（包含宿主机休眠），完成 58 轮；第 59 轮图片取消已成功，随后的 12 步正常图片生成触发 600 秒终态期限，原始错误为 `Task terminal-state deadline exceeded`。失败后的 Runtime 关闭将该任务记录为 `failed / RUNTIME_SHUTDOWN`。

此次失败存在明确的环境中断：本机电源日志显示 12:41:44 电量 1%，进入 `Low Power Sleep`，12:51:19 从休眠唤醒；资源采样在 12:41:45–12:51:20 中断约 574 秒，对应 Runtime uptime 仅增加约 26 秒。低电量休眠跨越了验收超时窗口，不能把此次超时直接归因为模型推理自身死锁，也不能据此认定睡眠唤醒恢复通过。未重启长测、重新构建或替换安装版。

已完成轮次的卸载检查点均为 3 个进程、38 个数字文件句柄。去掉前两轮预热后，最初三点与最后三点的 RSS 中位数增长 13860864 字节（约 13.2 MiB），文件句柄/进程数增长均为 0，在初始门槛内；这仅覆盖已执行区间，不代表八小时稳定性。累计记录 59 次 semaphore/resource_tracker 清理警告，仍需专项查清。

失败清理正常退出码为 0；审查采样中记录的 555 个 PID/出生时间身份，没有发现仍存活的测试进程。因循环提前失败，计划中的最终强制退出及重启后媒体/历史恢复检查没有执行，不能追认为通过。原始结果和采样保留，补充审查记录为 `.build/isolation-soak-8h-20261017/failure-audit.json`。本次跟进在记录结果后停止；重新验收应接通电源，保留此次失败证据并使用新的输出目录。

独立干净机器、原生安装、系统断网与睡眠唤醒仍保留未验证；不能用本机环境隔离替代这些结果。正式签名/公证继续按用户选择排除在此次临时签名验收门禁之外。

### 续验准备（2026-10-19）

用户要求继续并表示已接通电源。已只读核对候选应用完整清单与临时签名完整性，应用摘要仍为 `4430cce9451a99d2ed91ec3ca85d12c5ba7f1ee87cc800d64e4dd4463a285300`（15877 个文件/链接条目），冻结工具包摘要也与上次一致。四个本地模型经静态扫描确认引擎和登记身份均未变化；图片模型使用 MFLUX 导出目录，按其索引和 manifest 识别，不要求根目录存在 config.json。预检证据为 `.build/acceptance-preflight-20261019.json`。

本次使用独立输出目录 `.build/isolation-soak-8h-20261019`，保留 2026-10-17 的全部失败证据。独立电源守卫 `.build/acceptance-power-gate-20261019.py` 已启动，每十秒检查实际供电状态，只有识别到 AC Power 后才启动唯一一轮八小时测试；使用上次已冻结且未经修改的应用副本和同一工具包。运行中持续断电三十秒会向本次验收进程发送中断请求，要求清理并保留记录，不自动把中断追认为通过。

**续验当前状态：用户要求暂不执行，已在启动前取消。** 等待程序已退出，`.build/isolation-soak-8h-20261019.power.json` 的状态为 `cancelled_before_start`；本次没有启动真实模型长测，也没有生成长测结果。原本恢复的自动跟进已经重新暂停，后续接通电源不会自动启动测试。2026-10-17 的失败证据完整保留。

本轮未重建、替换安装版、修改应用生产逻辑或新增依赖，未提交或推送。执行了包清单/签名/工具摘要核对、四模型静态扫描、电源与进程检查，以及一次性守卫的语法编译检查；没有重复运行整套源码测试，也未把本次准备工作描述为验收通过。原有独立干净机器及其他未验证边界继续保留。

### 六项专项验收（2026-10-19）

用户要求执行列出的全部六项专项。已完成包内 API 探针、选定真实模型及隔离原生界面验收，结果为 **五项在下述范围内通过，一项部分通过**；没有恢复八小时长测。总报告为 [report.json](../.build/acceptance-six-20261019/report.json)，后续各证据路径均相对 `.build/acceptance-six-20261019/`。

| 优先级 | 专项 | 实测结果与范围 |
|---|---|---|
| P1 | 旧数据升级与保留 | 通过：支持的旧格式合成库由实际包迁移两次；模型登记及其引用的合成文件、聊天、Coding、音色、图片与音频摘要保持。Runtime/Coding 完整性及外键检查正常，旧审批失效、命令未重放。未使用私人生产数据库。 |
| P1 | 短时异常恢复 | 通过：图片/音频写入失败及恢复、临时目录无写权限后恢复、待审批及正在执行命令时 Host 崩溃、运行中 Runtime 强制退出后重启；审批不重放，受管命令进程组清理，后续任务成功。隔离原生界面断连后点击重试恢复，图片/音频历史可读取。数据故障探针使用 FakeEngine。 |
| P1 | 图片编辑与局部重绘的打包后流程 | 通过：完整 Qwen Image 2.1 Edit 8-bit，包内 Sidecar，512×512 / 40 步 / seed 42；双参考图、取消后生成、蒙版、重启后附件/作品摘要正常。原生复用保留参考顺序与蒙版；PNG 保存摘要一致，取消保存不落文件。蒙版外最大像素误差为 0，蒙版内 17752 像素变化。 |
| P2 | 大量历史下的查询与界面 | **部分通过**：2 万会话、2 万运行、10.2 万事件、120 个大文件变更；项目内 10001 会话分 21 页无重复/遗漏，查询索引与有界快照、按需大文件读取正常。原生旧历史可打开，但搜索只过滤已加载会话，未加载的旧记录会先显示“暂无匹配”，加载更多后才出现。全历史搜索未通过。 |
| P2 | 内容展示与诊断隐私 | 通过：测试敏感标记及令牌不出现在诊断 ZIP/stderr；错误详情不回显私有路径，伪装 SVG/损坏图片被拒绝、正常 PNG 接受，并检查媒体安全响应头。原生聊天将恶意 HTML 显示为文本，危险链接未激活；新增两项 DOM 攻击回归通过。此为固定探针，非全面安全审计。 |
| P2 | 语音长文本与主观质量 | 通过：364 字中文，实际包预设 78.32 秒、克隆 65.76 秒，24 kHz 单声道 WAV，削波比例均为 0；Worker 释放正常。原生播放/暂停、WAV 保存及重试后的历史恢复通过。用户试听参考音与两段样本后确认“听感正常，克隆音色相近”；仅针对本次样本，不代表 MOS、逐字转写或全部音色质量认证。 |

数据/故障/历史证据为 `data-checks-isolated-git/report.json`，附件与诊断补测为 `privacy-attachments/report.json`。分页耗时 P95 为 6.00 ms，快照 6.44 ms / 40637 字节，变更头 20789 字节，按需详情 156000 字节；属于本机此次样本，不能推为其他硬件性能承诺。搜索复现见 `native-search-before.png`、`native-search-before.txt` 与 `native-search-after.txt`，定位在 `apps/desktop/src/modules/coding/components/CodingSidebar.vue` 的已加载数组过滤逻辑，本轮未修改生产逻辑。

真实图片证据为 `image-edit/api-result.json`、`image-mask-export-audit.json`；语音指标及人工试听结论为 `speech-quality/report.json`。原生验收应用使用独立标识 `local.mlxstudio.acceptance.six-20261019`，只写独立数据目录，界面历史使用合成数据及上述真实产物副本。Runtime 强制退出和最终退出均按 PID/出生时间审查；`native-final-cleanup.json` 确认最终观察到的 3 个进程全部退出。没有改动 `/Applications/MLX Studio.app` 或用户原数据。

原生隔离应用单独构建并临时签名，没有安装；其 Runtime、内置 Node Host 资源与候选包逐摘要一致。候选包完整清单摘要仍为 `4430cce9451a99d2ed91ec3ca85d12c5ba7f1ee87cc800d64e4dd4463a285300`，证据 `artifact-provenance.json`。这些结果不改变原有干净机器、原生安装、系统断网与睡眠唤醒未验证的边界，也不消除上次长测尚未查清的 semaphore/resource_tracker 警告。

本轮扩展 `verify_local_edit.py` 的包内 Sidecar 入口，增加数据/故障与长语音验收脚本、Markdown 攻击回归，并将 Python 工具加入既有检查范围。`pnpm check`、`pnpm test`（152 前端 + 123 Runtime + 39 Coding + 8 验收工具，共 322 项）通过，日志为 `source-checks.log` / `source-tests.log`；隔离原生应用构建通过，未修改 Rust 或重复运行 Rust 测试。没有新依赖，没有由代理执行提交或推送。

未开放的外部兼容 API、其他候选模型及设计后续能力不自动列为本版发布阻塞项。独立干净机器仍需对应设备，正式签名/公证按用户当前选择暂不要求。

## 聊天附件与联网改造（2026-10-19）

统一附件、文档准备、会话草稿、联网配置与来源、回答 attempts、锁外准备和取消隔离已接通。迁移 7 增量保存准备版本、快照、草稿/任务/作品引用；完整回填有独立完成标记，自动 GC 保持关闭。使用方式与边界见[聊天附件与联网搜索](./chat-attachments-web.md)。

本次门禁包括 API 类型生成、`pnpm check`、`pnpm test` 和 `pnpm build:web`；前端 172 项、Runtime 156 项、Coding 39 项、验收工具 8 项测试通过。浏览器检查了本地发送/完成与切换菜单保留草稿。Apple Silicon 上 Fake、release sidecar 均构建通过，独立产物验证了 TXT/DOCX/混合 PDF 提取、认证预览、来源保存和重启恢复。

这些打包检查使用 FakeEngine 生成回答。本次变更的真实 Tavily、签名身份下 Keychain、VLM 规范化图片与历史绑定、正式签名/公证和干净机器仍未验收；历史图片复用能力默认关闭。既有版本的真实模型验收不能直接覆盖新的附件准备与输入模板链路。Web 构建仍有现有的大分块提示，不作为测试失败处理。

## Skills、MCP 与本地能力接入（2026-10-20）

本轮根据 2026-10-19 技术方案完成阶段 0、A–D 的代码接入：统一三页签设置、受管 Skill 审阅/导入/版本/读取、绑定与撤销、stdio/Streamable HTTP MCP、白名单与本地只读策略、逐次审批和结果拦截、普通聊天文字 Skill、图片提示词/语音口播助手，以及独立 Agent Chat 和本地媒体工具。详细入口、数据所有权、限制及复验方法见 [Skills、MCP 与本地工具](./extensions.md)。自动 Skill、Git 来源、MCP Resources 读取/媒体、OAuth、多模态 Agent 输入等仍为后续能力。

Host 内部 RPC 升至 v2，同源生成 Node/Python 协议与扩展 HTTP DTO；Runtime 对外 v1 保持。Node 独立扩展库与不可变文件增量保存配置，Python 迁移 8/9 保存助手草稿和能力调用关联。凭据使用新的 MCP Keychain 命名空间，兼容旧 Web Search；版本化秘密引用不会覆盖旧运行使用的值。自动资源/秘密 GC 未启用。

`pnpm rpc:generate`、`pnpm api:generate`、`pnpm check`、`pnpm test`、`pnpm build:web`、`pnpm build:coding:bundle` 已通过。全量测试为前端 179、Runtime 167、Coding 45、验收工具 8 项；最终 MCP 断连/进程登记改进后重跑 Coding 为 46 项且重新通过 check 与分发构建，总计 400 项现行测试通过。Web 构建保留已有大分块提示。Rust 未修改，本轮没有重跑 Rust 检查或完整 `.app` 构建。

实际 Pi SDK 与 stdio/HTTP 假服务验证了受管注册、参数/schema/版本准入、认证失败不进入 OAuth、输出脱敏和取消清理。完整 HTTP → Node/Pi → FakeEngine 在 Coding 和独立 Agent Chat 跑通文字 → 图片 → 文字 → 语音 → 文字，逐次审批、PNG/WAV 可解码且作品归属正确，无父推理锁等待死锁。可控故障测试覆盖排队后激活、撤销、接纳/取消窗口、create 成功 bind 失败后复用同一 Job/seed、重启仅补关联、旧令牌失效，以及认证后撤销不能降级为普通推理。秘密测试使用内存替身，不触碰用户 Keychain。

隔离浏览器检查了设置目录、内置 Skill 资源、MCP 表单、聊天选择器和 Agent 抽屉，修正窄窗口抽屉裁切；临时服务与数据已清理。Node 分发检查实际启动包内 Host，成功读取内置资源目录并正常关闭。

本轮新链路的真实 MLX 文本/VLM、MFLUX 与语音模型、真实远程 MCP 服务和凭据、签名身份下 Keychain、完整 Sidecar/应用包、正式签名/公证、干净机器和长期压力均未验收。历史真实模型结果不自动覆盖此链路。新增锁定依赖仅 `@earendil-works/pi-mcp@1.2.0` 与 `ajv@8.17.1`，未增加第二个 Agent 框架或前端依赖；没有提交或推送代码。
