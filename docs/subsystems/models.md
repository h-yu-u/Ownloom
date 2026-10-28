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
