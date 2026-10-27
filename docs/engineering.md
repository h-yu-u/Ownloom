# 工程规范

[文档入口](./README.md) · [AGENTS.md](../AGENTS.md) · [架构](./architecture.md)

本文收敛原工程模板与技术计划中的长期约束。实现和审查按这些规则执行；实际能力和验收证据见[验收状态](./status.md)。

## 基本原则与依赖方向

- 高内聚、低耦合；优先纯函数、不可变转换与组合，副作用集中在显式边界。
- 仅为真实变化点或重复场景引入抽象，不建立无明确主题的 `utils.ts`、`helpers.py`、`common/`。
- 保持现有风格，避免无关重构；新增依赖先说明用途、替代方案与影响，优先现有组件库和 VueUse。
- 使用 pnpm 与 uv，保留锁文件；不顺手大范围升级依赖，不修改 secrets 或生产敏感配置。

允许的依赖方向：

```text
UI → Application → Domain
Infrastructure / Adapters → Domain Ports
Entrypoints → Application
```

禁止 Domain 引入 Vue、Pinia、Naive UI、FastAPI、Pydantic、Tauri、SQLite 或 MLX。组件不直接请求 HTTP；模型适配器不访问 UI 或会话持久化；Rust 不实现模型/聊天业务。

状态转移、能力推导、请求构造、校验、错误映射与调度决策优先纯函数。I/O 只出现在 API 客户端、Repository、文件/下载服务、Worker Host、Engine Adapter 或 Tauri 平台模块；Pinia getter、Vue computed 和 Domain 函数不得执行 I/O。

## 前端

- Vue 3 Composition API 与 `<script setup lang="ts">`，TypeScript 保持严格类型；外部边界使用 `unknown`，避免 `any` 和掩盖错误的类型断言。
- Naive UI 提供按钮、输入、选择器、弹窗、上传、表格、进度等基础控件；自定义组件表达产品领域，不重复实现 UI 原语。通用响应式/浏览器能力优先 VueUse。
- 页面组合功能，容器编排状态，展示组件通过 Props/Events 交互；复杂计算下沉到普通 TypeScript，生命周期和平台副作用放入 composable。
- Pinia 入口暴露已配置的工作区 controller；提交编排归属 application，查询和视图资源归属 presentation/capabilities，平台 I/O 归属 platform。Store 不直接持有 SSE、计时器、Object URL 或 RuntimeClient；Store 间不得循环依赖。
- API DTO 从 FastAPI OpenAPI 生成，不手写重复协议；事件保持可辨识类型，协议不兼容时阻止继续调用。
- 表单和外部输入明确校验，列表使用稳定 key，模板避免复杂表达式；按钮语义、label 和键盘操作应可访问。

## Python Runtime

- Python 3.12 由 uv 管理，使用 Ruff 与 Pyright；公开函数/方法完整类型标注，业务逻辑与 I/O 分离。
- Domain 优先不可变 dataclass/值对象；Pydantic 只用于入口 DTO，不侵入领域模型。
- MLX 导入只允许在 Engine Adapter/Worker 入口，不能用隐藏全局单例持有模型；长时间推理在 Worker 内运行，不阻塞 Supervisor 事件循环。
- 上游异常转换为稳定领域错误码；只在顶层进程/任务边界捕获宽泛异常，内部业务代码不裸捕获、不吞异常。
- 避免可变默认参数和隐式修改输入；`async` 用于实际异步边界，配置与常量集中管理。

## Rust / Tauri

Rust 保持精简，负责固定 Sidecar 生命周期、安全、原生对话框和平台集成。校验 command 参数，权限仅覆盖所需可执行文件和参数，不接受前端传入任意可执行路径或 shell 命令。子进程句柄集中管理，退出清理幂等。

## 长度与复杂度

| 项目 | 软上限 | 硬上限 |
|---|---:|---:|
| Vue SFC | 220 行 | 320 行 |
| TypeScript | 220 行 | 350 行 |
| Python / Rust | 250 行 | 400 行 |
| 函数 | 35 行 | 60 行 |

嵌套不超过 3 层；参数超过 4 个优先使用有类型的参数对象。超过硬上限需明确书面例外；专门目录中的生成文件、迁移和兼容性数据豁免。

## 状态、模型与安全

- 异步操作处理 idle、loading/preparing、empty、success、error，以及适用的 cancelled；任务不能长期停在 loading/cancelling。
- 模型由 Manifest 和兼容性数据驱动，不以名称或字符串片段分支；未知、部分支持、不兼容、损坏须区分。
- `trust_remote_code` 默认关闭，扫描模型不执行代码。Runtime 只绑定 `127.0.0.1`，桌面 Session Token 不落盘；外部 API 默认关闭，使用独立 Token。
- 默认日志不输出完整提示词、回复、文件内容、图片或秘密；错误应保留 request/job 上下文和稳定错误码。
- 校验路径、文件类型和大小；Markdown 默认禁用 raw HTML。诊断导出应脱敏，发布前补齐内容展示与隐私验收。
- 不提交模型文件、下载产物、私有诊断、签名身份或凭据。

## 测试与完成标准

选择最窄且有意义的验证：纯函数用单元测试，Engine 用契约测试，API/SQLite 用集成测试，Vue 状态与交互用 Vitest/Vue Test Utils。完整浏览器流程和打包应用分别验收，真实 MLX 用 Apple Silicon 上固定版本的模型测试。Bug 修复补回归测试。

不要比较完整的不确定模型输出。文本断言非空、协议顺序、终态与取消后无 delta；图片断言可解码、格式/尺寸和元数据正确，不以跨版本像素完全一致作为硬门槛。

原计划的覆盖率目标保留为质量目标：Domain 90%、状态机/调度分支 100%、Application 和前端 Store/composable 80%、整体 75%。这些目标不代表当前已有覆盖率门禁或已达成，Adapter 重点验证真实契约与系统行为。

`pnpm rpc:generate` 从内部 Coding RPC schema 生成两端契约，门禁检查漂移及共享 fixtures。生成的协议数据有明确的格式与长度豁免，手写校验器仍参加检查。

完成代码修改前运行：

```bash
pnpm check
pnpm test
```

Runtime/Engine 改动还需相关契约、集成或系统验证；构建与 Rust 改动使用[对应命令](./getting-started.md)。当前 CI 执行 API 类型生成一致性、check、test、Web 构建，Rust 单独运行 fmt/clippy/test；不能把规划中的全部质量项描述为现有门禁。

`pnpm check` 包含 Prettier/Ruff 格式、类型、lint、TypeScript/Vue/Python AST 依赖边界及违规 fixture、生产源码长度与公共样式归属检查。AST 检查解析别名、re-export、动态导入和环路；生成文件与测试的豁免由检查器显式声明。长度门禁覆盖文件硬上限，函数长度、覆盖率目标和所有运行时行为仍需审查/测试，不宣称已经自动覆盖。Rust CI 同时运行 `cargo test`，占位 Sidecar 只用于编译期检查。

`MLX_STUDIO_BUILD_PROFILE=release` 为默认 Sidecar 构建，使用独立 uv 环境和锁定构建工具并收集真实引擎及动态依赖；`fake` profile 明确排除真实引擎，仅供开发验证。发布包必须通过实际 Sidecar 启动和固定真实模型冒烟；正式签名、公证与干净机器验收另行执行，不由普通 CI 的占位文件代替。

完成时检查验收条件、类型/lint、错误/空/加载/取消状态、依赖边界、文档和必要迁移，并说明修改文件、新增依赖、检查结果和未验证风险。缺工具或命令失败时如实记录，不宣称通过。不自动 commit、push、merge 或 rebase。

PR 说明应包含变更目的、修改范围，以及已执行的验证命令和结果；未执行的检查需明确说明。
