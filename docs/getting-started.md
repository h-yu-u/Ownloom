# Ownloom 使用与开发

[文档入口](./README.md)

## 环境与启动

桌面应用面向 Apple Silicon macOS。开发环境使用 Node.js 22、pnpm 11、uv 管理的 Python 3.12、Rust stable（至少 1.77.2）和 macOS Command Line Tools。仓库提供 `.nvmrc`；依赖版本由锁文件约束。

在仓库根目录执行：

```bash
nvm use
pnpm bootstrap
pnpm dev
```

`bootstrap` 安装前端依赖与 Runtime 的 `mlx-vlm`、`mflux`、`audio` 可选依赖。桌面 Debug 启动使用项目 Runtime；发布版本使用打包后的 Sidecar。首次安装依赖及下载模型需要网络。

`pnpm dev:web` 只启动前端开发服务器。完整本地交互还需要 Runtime 连接。正常启动不登记模拟模型；自动化测试在隔离数据库中显式登记 FakeEngine。

## 模型库

1. 打开“模型库”，点击“发现模型”后展开 Hugging Face 模型下拉列表。
2. 输入名称或关键词搜索，选择仓库后点击“下载模型”。
3. 下载完成后自动登记到本地模型库；返回聊天、图片创作或语音创作页选择兼容模型使用。

目录通过 Hugging Face 公开 API 按 `mlx` 元数据筛选、按下载量排序，只显示无需申请访问的仓库。目录查询不读取或发送本机 HF 凭据；模型下载使用 Runtime 的 `huggingface-hub` 适配器。出现在目录中或下载成功不代表已验证兼容，具体范围见[验收状态](./status.md)。

默认下载位置为 `~/MLXModels`，可由 Runtime 的模型目录设置覆盖。下载期间可切换页面，需要保持应用运行；失败可重试，已登记的同一 HF 仓库不会重复发起下载。跨应用重启的下载恢复尚需完善。

已有模型可直接导入本地目录。目录必须包含完整的模型配置和权重；扫描仅检查静态元数据与文件结构，不执行仓库代码。移除模型登记与删除磁盘文件是独立操作。

## 聊天

聊天页优先选择已登记的真实文本模型，首次发送时自动加载。后续轮次使用已保存的对话历史；生成中可停止，连接失效后可重新启动 Runtime。发送失败会保留草稿和附件。

默认最大输出长度为 4096 token，可在右上角模型设置中调整，最高 8192。达到上限时，最后一条回答的底部操作栏提供「继续回答」，悬停可查看截断说明；继续会沿用已有对话上下文发起下一轮。达到长度上限与推理失败分开显示，停止原因随历史保存。

已验证的 Qwen3.8-27B MLX 模型应导入包含 `config.json` 和权重的 `4-bit` 子目录。当前已验证纯文本场景；模型经 `mlx-vlm` 运行不代表图片理解已经验收。没有真实模型时列表为空，需要先下载或导入模型。

## 图片创作与历史

1. 选择本地生图模型，填写提示词、比例或尺寸、步数和 Seed；Seed 留空时随机生成。
2. 提交任务，查看排队、准备和生成进度；运行中可取消。
3. 完成后自动保存 PNG 和参数。在页面顶部点击“作品历史”，进入“作品”视图。
4. 点击缩略图预览大图、导出 PNG，或复用模型、提示词、尺寸、步数和 Seed。

图片任务与聊天共用单个推理 Worker，忙碌时排队；切换页面不会丢失任务。失败或重启中断的任务保留参数，可从“最近任务”复用后再生成；中断任务不会自动续算。历史记录在应用重启后仍可查看。

Runtime 接口允许宽高 64–2048 且为 16 的倍数，步数 1–100，Seed 为 0–4294967295；这只是参数校验范围，不能据此推定所有模型和分辨率已验证。

Qwen Image 2.1 原生 MFLUX 导出应包含 `transformer/`、`text_encoder/`、`vae/` 的分片索引和权重，以及 `processor/` 分词器。模型通过结构识别，目录名称不影响行为。生成时只使用本地权重，不隐式下载缺失组件。Fake Image Engine 仅在隔离验证中显式使用。

### 图片编辑与参考图

- 页面提供「文字生图」「图片编辑」「局部重绘」三种模式；首次打开优先选完整的本地编辑模型。切换到编辑模式时会自动选择兼容模型，文生图专用导出不提供编辑能力。
- 图片编辑中点击或拖入原图和参考图，最多 10 张 PNG/JPEG/WebP，每张不超过 20 MB。图 1 是原图，其余图片按编号引用，例如“把图 1 的茶壶改成图 2 的蓝色”。使用前移、后移按钮调整顺序；移除或更换原图后需重新涂抹区域。
- 局部重绘中点击「涂抹需要修改的区域」，紫色表示会重新绘制的位置。画笔大小、橡皮擦、撤销和清空用于修整范围，保存区域后输入修改要求并开始编辑。
- 修改强度越低越贴近原图；高强度更容易产生明显变化。比例常驻，步数、Seed 和自定义尺寸位于「更多设置」。Qwen Image 2.1 完整编辑管线要求宽高为 32 的倍数，默认编辑使用 40 步。
- 结果支持原图对比和 PNG 导出。「继续编辑」把选中作品作为新的原图；「复用参数」恢复原任务的模型、指令、参考图、蒙版和强度。参考图与蒙版也保存在应用数据目录，重启后可复用。

已本机验证 `OsaurusAI/Qwen-Image-2.1-mflux-8bit`，包含视觉编码器、组件配置和处理器。之前的文生图 BF16 导出继续用于文字生图。蒙版可固定未涂抹区域，但边界仍可能有接缝，需要按实际素材调整。

## 数据位置

| 数据 | 位置 |
|---|---|
| 桌面应用数据 | Tauri `app_data_dir()`，应用标识为 `local.mlxstudio.app` |
| 数据库 | 应用数据目录内 `app.db`；保存会话、模型、任务和作品元数据 |
| 生成图片 | 应用数据目录对应的 `media/images/` |
| 下载模型 | 默认 `~/MLXModels`，与应用数据分开保存 |

桌面壳通过 `MLX_STUDIO_DATA_DIR` 将数据目录交给 Runtime。独立运行 Runtime 且未指定目录时，数据库默认在 `~/Library/Application Support/MLX Studio/data/app.db`，媒体文件在同一应用目录的 `media/`。备份历史时应同时保留数据库和媒体文件。

品牌升级后继续使用上述应用标识与数据位置，不搬迁或重建资料库。Keychain 的 `MLX Studio Web Search` / `MLX Studio MCP Connections` 命名空间、`MLX_STUDIO_*` 环境变量、`mlx-studio-runtime` Sidecar、Pi 的 `mlx-studio` Provider ID，以及内部 `@mlx-studio/*` / `mlx_studio_runtime` 包名均为兼容标识。新的展示名称与应用包名为 Ownloom / `Ownloom.app`，导出文件以 `ownloom-` 开头；已有旧品牌备份仍可恢复。

## 常用检查与构建

以下命令均在仓库根目录执行，具体脚本以 [package.json](../package.json) 为准。

| 命令 | 用途 |
|---|---|
| `pnpm check` | 格式、类型、lint、AST 依赖边界与违规 fixture、文件长度和样式归属检查 |
| `pnpm test` | 前端 Vitest 和 Runtime unittest |
| `pnpm format` | 使用统一 Prettier/Ruff 规则格式化源码 |
| `pnpm api:generate` | 根据 FastAPI OpenAPI 更新 API 类型 |
| `pnpm check:rust` | Rust fmt 与 clippy |
| `pnpm test:rust` | Rust 握手与连接代际回归测试 |
| `pnpm build:web` | 构建 Vue 前端 |
| `pnpm build:runtime:check` | Python 源码编译检查；`build:runtime` 为其别名 |
| `pnpm build:sidecar` | Apple Silicon macOS 上构建 PyInstaller Runtime |
| `pnpm build:app` | Web → Sidecar → Tauri `.app`/`.dmg`；`build:desktop` 为其别名 |

Web 构建和源码检查不能代替打包应用、签名、公证或干净机器验收。真实模型复验命令见[验收状态](./status.md)。

Sidecar 默认采用 `release` profile，安装真实引擎并在独立 `.build/runtime/venv-release` 环境构建；仅开发验证可使用 `MLX_STUDIO_BUILD_PROFILE=fake pnpm build:sidecar`。Fake profile 不包含真实推理依赖，不能作为正式发布产物。桌面壳通过专用 stdin 管道声明生命周期所有权；关闭或重启后，管道 EOF 触发 Runtime 清理，避免 onefile bootloader 被强制停止时遗留内部进程。
