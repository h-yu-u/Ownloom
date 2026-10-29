# 模型子系统

[子系统目录](./README.md) · [使用手册](../reference.md) · [验证范围](../verification.md)

## 职责与边界

本子系统管理发现、静态扫描、安装身份、下载与登记、能力投影及移除。加载、推理租约和 Worker 生命周期归 [Runtime](./runtime.md)；工作区各自保留模型选择，不反向修改共享目录查询状态。

| 事实来源                                                                               | 维护内容                         |
| -------------------------------------------------------------------------------------- | -------------------------------- |
| [前端模型模块](../../apps/desktop/src/modules/models/)                                 | 本地目录、发现与导入交互         |
| [共享模型能力](../../apps/desktop/src/capabilities/models/)                            | 只读目录、选择器与任务 readiness |
| [领域类型](../../services/runtime/src/mlx_studio_runtime/domain/models.py)             | 引擎、模态、能力和输入限制       |
| [静态扫描](../../services/runtime/src/mlx_studio_runtime/adapters/model_scan.py)       | 本地检查与 Manifest              |
| [下载用例](../../services/runtime/src/mlx_studio_runtime/application/downloads.py)     | 状态、暂停/取消、恢复及登记      |
| [下载进程](../../services/runtime/src/mlx_studio_runtime/entrypoints/download.py)      | revision、模型根目录与文件获取   |
| [移除用例](../../services/runtime/src/mlx_studio_runtime/application/model_removal.py) | 引用保护与登记/文件删除          |

## 运行路径

发现页通过 [Hugging Face 适配器](../../services/runtime/src/mlx_studio_runtime/adapters/huggingface_catalog.py)查询公开目录；下载独立于推理队列。任务先保存状态，再由受管理子进程获取资源、校验并静态登记。下载固定解析出的 revision，恢复继续使用该身份，不随上游默认分支漂移。

导入只读取本地配置和文件结构，不执行模型仓库代码。扫描按配置和导出布局推导文本、视觉、图片编辑及语音能力。模型名称仅用于显示，不能作为选择引擎或许可删除的依据。

安装 ID 表示登记/安装实例，不是权重哈希。元数据指纹不能证明权重内容一致。相同路径的已有登记保留身份，作品和历史使用提交时冻结的模型信息。

## 状态与失败

| 状态          | 含义                         |
| ------------- | ---------------------------- |
| `queued`      | 已登记，等待下载资源         |
| `downloading` | 子进程获取固定 revision 文件 |
| `verifying`   | 校验资源，尚未宣布可用       |
| `available`   | 下载完成并已登记             |
| `paused`      | 传输停止，可显式恢复         |
| `failed`      | 保存稳定错误码，可按条件重试 |
| `cancelled`   | 当前下载取消                 |

[下载仓库](../../services/runtime/src/mlx_studio_runtime/adapters/persistence/download_repository.py)启动时将未完成状态设为 `paused / DOWNLOAD_INTERRUPTED`，不自动恢复网络活动。暂停必须等待子进程停止，不能只改界面状态。当前下载并发为 2，活动任务接纳有上限；具体值由用例维护，不属于不变架构。

删除先检查活动、排队和别名引用。导入的外部目录只移除登记；托管文件删除要求可信安装所有权、规范路径和引用保护。文件删除失败时保留登记并返回失败，不把部分删除报告为完成。目录规则见[托管文件适配器](../../services/runtime/src/mlx_studio_runtime/adapters/managed_models.py)。

## 实验性草稿加速

模型库的 MLX-VLM 模型卡提供 **草稿加速**，包含开启开关和三个方案：自动、仅 MTP、仅 DFlash2。自动模式按入口选择普通聊天 MTP、Coding/结构化推理 DFlash2，不按提示词语言判断；同一次生成只使用一种草稿。MTP 可选块长 3（默认）/4，DFlash2 可选 5（默认）/4。新登记默认关闭；已配置的旧 MTP 保持启用和原块长。带图片的请求使用普通生成。

[设置契约](../../services/runtime/src/mlx_studio_runtime/entrypoints/http/draft_contracts.py)和 [领域设置](../../services/runtime/src/mlx_studio_runtime/domain/drafts.py)维护 Manifest 的可空 `draft` 字段：`enabled`、`mode`、`mtpPath`、`dflashPath`、`mtpBlockSize`、`dflashBlockSize`。`POST /internal/v1/models/{model_id}/draft` 需要内部认证。关闭只改变 `enabled`，保留目录；文件丢失时仍可关闭。同路径重新导入和 Runtime 重启保留设置。旧 `mtp` 字段与 `/mtp` 入口兼容；保存新设置清空旧字段，旧入口显式更新会清空新字段，避免两套配置同时生效。

[配置用例](../../services/runtime/src/mlx_studio_runtime/application/model_acceleration.py)先取得与父任务互斥的[模型引用保留](../../services/runtime/src/mlx_studio_runtime/application/model_run_references.py)，再等待推理租约、校验已选择方案、卸载同 ID 模型并持久化。Coding / Agent 从 Host 准备前到运行授权关闭一直保留模型引用，包含排队、工具执行和审批等待；有引用时，新旧草稿配置接口均返回 `MODEL_IN_USE`，保留原设置和 Worker。配置更新期间同一模型的新任务也被拒绝，不让异步验证或 Worker 停止产生接纳空隙。失败或取消的准备保留会释放，已授予的运行引用在取消清理完成后释放；配置失败不提交新设置。即使设置相同，空闲时保存仍会卸载已驻留模型，确保下次加载时重新校验可能已替换的草稿文件。新设置下次加载生效。

自动模式要求两套草稿目录。MTP 的静态检查接受 `qwen3_5_mtp` 配 `qwen3_5` / `qwen3_5_moe`。DFlash2 仅接受已适配的滑动窗口、卷积及 selector 配置与 dense `qwen3_5` 主模型，并检查词表、hidden size、目标层数和有界参数。两种路径都要求本地 `config.json`、`model.safetensors`，加载时严格检查全部权重；保存设置不能代表推理质量已验收。

提交 Coding / Agent 任务时，MCP 连接凭据先异步读取为实际字符串，再创建运行授权并发送 Host RPC；凭据读取失败不会留下运行授权。若提交 RPC 的结果未知，运行可能已经开始，授权和模型引用继续保留，直到显式停止、Host 关闭授权或授权过期清理完成；不因丢失回复而假定任务没有执行或自动重放。

草稿共用目标 tokenizer、embedding 和输出头；不下载权重、不执行模型仓库代码。其他模型登记的草稿路径（包括关闭后保留的目录）位于待删除目录内时阻止物理删除；移除登记不删除草稿文件。执行与缓存规则见 [Runtime 草稿接入](./runtime.md#实验性草稿接入)，验收范围见[验证记录](../verification.md)。

## 兼容约束

- 未知、部分支持、资源缺失和已验证是不同状态。目录可见或下载完成不授予 `validated`。
- 文本模型不接受视觉图片；图片数量来自 Manifest `inputLimits`，不是 UI 自行推测。
- 文生图导出不自动具备编辑能力，编辑要求视觉编码器、处理器及对应组件完整。
- 语音 CustomVoice 和 Base 用途不同，资源检查由[语音扫描](../../services/runtime/src/mlx_studio_runtime/adapters/speech_model_scan.py)维护。
- 工具协议能力还取决于引擎、模板与权重身份，探针归 [Coding](./coding.md)。
- 正常启动不登记 Fake 模型，隔离测试显式创建模拟数据。

## 验证与维护

工具链和命令详情见[开发指南](../development.md)：

```bash
pnpm test frontend
pnpm test runtime
```

重点回归包括[模型目录](../../tests/test_model_catalog.py)、[Manifest](../../tests/test_model_manifest.py)、[下载生命周期](../../tests/test_download_lifecycle.py)、[模型移除](../../tests/test_model_removal.py)及前端 models store。扫描变更覆盖缺失分片、未知配置、同路径导入和旧登记；下载变更覆盖暂停时实际退出、重启对账和固定 revision。

真实兼容性通过固定版本模型另行验证，并更新[验证范围](../verification.md)。增加适配分支不能自动扩大 README 的支持声明。
