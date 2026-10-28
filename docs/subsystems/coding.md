# Coding 工作区与 Pi Host

[子系统索引](./README.md) · [系统架构](../architecture.md) · [扩展](./extensions.md) · [验证范围](../verification.md)

## 职责与边界

Coding 面向本地项目的分析、开发和审查。Vue 负责交互，Python 网关提供认证 HTTP/SSE 与 Host 生命周期，Node Pi Host 拥有项目、会话、任务、审批和变更记录。模型请求通过本地 Provider 返回 Runtime 的单活推理 Worker。

Pi transcript 是模型上下文的权威来源，Coding SQLite 是产品状态的权威来源。普通聊天不代存 Coding 历史。Coding 文件工具受项目路径约束，获授权的 shell 命令以本机用户身份执行；应用审批不等于操作系统沙箱。

## 事实来源

| 主题                    | 代码入口与关键符号                                                                                                                                                                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 协议定义与生成          | [schema.json](../../packages/coding-protocol/schema.json)、[generate_coding_rpc.py](../../scripts/generate/generate_coding_rpc.py)                                                                                                                  |
| Host 进程               | [agent_host.py](../../services/runtime/src/mlx_studio_runtime/adapters/agent_host.py)：`AgentHost`；[main.ts](../../services/coding-agent/src/main.ts)                                                                                              |
| 用例与任务              | [service.ts](../../services/coding-agent/src/application/service.ts)：`CodingService`；[runs.ts](../../services/coding-agent/src/application/runs.ts)：`Runs`                                                                                       |
| Pi 装配与流式桥         | [pi-session.ts](../../services/coding-agent/src/adapters/pi-session.ts)：`openPi`；[pi-events.ts](../../services/coding-agent/src/adapters/pi-events.ts)                                                                                            |
| 产品持久化与 transcript | [repository.ts](../../services/coding-agent/src/adapters/repository.ts)、[transcript.ts](../../services/coding-agent/src/adapters/transcript.ts)                                                                                                    |
| 工具与审批              | [run-policy.ts](../../services/coding-agent/src/application/run-policy.ts)、[approvals.ts](../../services/coding-agent/src/application/approvals.ts)、[run-commands.ts](../../services/coding-agent/src/application/run-commands.ts)                |
| 文件版本与撤销          | [workspace.ts](../../services/coding-agent/src/adapters/workspace.ts)、[workspace-version.ts](../../services/coding-agent/src/adapters/workspace-version.ts)、[project-workspace.ts](../../services/coding-agent/src/adapters/project-workspace.ts) |
| 验证计划                | [verification-plan.ts](../../services/coding-agent/src/application/verification-plan.ts)、[verification.ts](../../services/coding-agent/src/domain/verification.ts)                                                                                 |
| UI 控制与观察           | [coding-controller.ts](../../apps/desktop/src/modules/coding/presentation/coding-controller.ts)、[coding-observer.ts](../../apps/desktop/src/modules/coding/presentation/coding-observer.ts)                                                        |

Pi 及相关包的锁定版本以 [Host package.json](../../services/coding-agent/package.json) 和锁文件为准；内部标识、目录和生成文件名应保持与代码一致。

## 产品入口与运行路径

打开项目只登记目录、读取 Git 状态与受限的根目录 `AGENTS.md`，不安装依赖或执行项目初始化。新会话选择模型后可提交任务；模型工具能力证据绑定模型配置与文件版本，失效时重新准备。

1. 输入选择模式、模型、能力与访问权限，提交编号绑定这次意图。
2. Host 预约活动位置或等待队列，固定能力快照；Runtime 准备授权和连接秘密后提交运行。
3. 运行重新读取并冻结项目说明；装配 Pi、检查 transcript，保存上下文描述符后再发 prompt。
4. Pi 每次模型调用独立取得推理租约，释放后执行受管工具或等待审批；文字增量用同一消息标识更新。
5. 文件写入、命令和工具结果进入产品时间线；完成前再次验证 transcript 和当前工作区证据。
6. 若显式选择收尾验证，按冻结计划运行检查并在限额内修复；最终状态、验证证据与上下文分别保存。

“补充当前任务”发送 steering；“接下来再做”使用 Host 的一项等待队列。Coding 与 Agent Chat 共用活动准入。切页或切换会话只切换观察对象，不隐式取消运行。

## 模式与授权

| 模式 / 权限     | 当前行为                                                                   |
| --------------- | -------------------------------------------------------------------------- |
| 分析、审查      | 只暴露受管读取、搜索、目录和 Git 查询；不能通过完全访问变成开发模式        |
| 开发 + 需要审批 | 常规受管编辑可执行；命令、测试/验证配置修改和非只读 MCP 调用请求审批       |
| 开发 + 完全访问 | 相应操作按明确选择执行并留授权记录；取消、路径限制、撤销和模式约束继续有效 |

访问权限可在运行中切换；切回审批后，新操作恢复审批，其他会话不会自动获得授权。项目说明和 Skill 正文只是方法输入，不能授予命令或扩展权限。

shell 环境只包含明确工具链路径和少量运行变量，不继承桌面 Token、Provider 凭据或完整登录 shell 环境。命令仍能访问本机用户可访问的项目外文件及网络。Git 修改禁令属于应用策略，不能当作任意 shell 代码的安全隔离保证。

## 文件、历史与恢复

受管文件工具拒绝越界、符号链接、凭据/私钥路径、依赖及构建目录。写入要求先读并提交预期摘要；真正打开的文件仍需与目标路径一致。修改前保留恢复记录，崩溃后不能确认完成的写入保留 `pending`。

工具在请求审批前将路径规范化为项目相对路径，审批记录、敏感文件策略和实际写入使用同一个目标；`/.`、重复分隔符、绝对路径或 `..` 别名不能改变审批要求。测试和验证配置的名称判断不区分大小写，写入时仍重新校验路径及文件摘要。

撤销前比对当前内容与该次写入结果，外部编辑后拒绝覆盖。命令产生的修改不能可靠归因到某次受管文件写入，不自动 reset、stash 或回滚整个项目。

Node 在同一事务保存产品状态与事件，提交后唤醒等待者。观察器使用持久化序列、快照 watermark 与增量投影；首次打开、缺口和重连时恢复快照。文件正文按需读取，不能塞进每条事件和重连快照。

同一会话观察代际内，HTTP 快照与 SSE 投影共用单调递增的 watermark：迟到快照不能覆盖较新的事件，已被快照涵盖的事件只推进观察器游标，不重复投影。打开会话（包括重连后重新加载工作区）会释放旧观察器、递增归属代际并清空快照基线，因此可以接纳新数据源的较低序列；旧代际的快照和回调始终失效。

Host 重启把未结束运行标为 `interrupted`、拒绝旧待审批操作，不自动重放命令。Pi JSONL 恢复校验会话身份、cwd、完整行和父链；上下文文件存在不等于完整可用。

删除会话事务删除 Coding 产品记录，不删除用户项目，也不自动删除独立 Pi JSONL。数据库、transcript 和项目文件不共享事务；备份与恢复见[存储](./storage.md)。

## 验证证据与当前限制

普通命令记录 `purpose=command`，退出码为零不会把任务标记成验证通过。显式验证记录 `purpose=verification`，绑定冻结命令、配置摘要、cwd 与文件版本；缺步骤、外部变动、计划变更或不完整扫描产生 `partial` 或过期证据。`passed` 只证明该计划在对应状态下执行成功。

| 项目           | 当前限制或语义                                                                          | 代码来源                                                                                                                                                                                                                                                |
| -------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 受管文本读写   | 512 KiB                                                                                 | [workspace.ts](../../services/coding-agent/src/adapters/workspace.ts)                                                                                                                                                                                   |
| 单条命令       | 120 秒；捕获输出保留前 65,536 个 UTF-16 码元并标记截断，非字节上限                      | [commands.ts](../../services/coding-agent/src/adapters/commands.ts)                                                                                                                                                                                     |
| 单次运行       | 最多 48 次工具调用，任务执行有 20 分钟期限                                              | [tool-gateway.ts](../../services/coding-agent/src/application/tool-gateway.ts)、[runs.ts](../../services/coding-agent/src/application/runs.ts)                                                                                                          |
| 内容指纹       | 深度 32；文件数达到 100,000 时不完整；单文件 64 MiB、累计 256 MiB                       | [workspace.ts](../../services/coding-agent/src/adapters/workspace.ts)                                                                                                                                                                                   |
| 版本元数据索引 | 新文件捕获前索引达到 8192 项即标记不完整；目录项也计入索引                              | [workspace-version.ts](../../services/coding-agent/src/adapters/workspace-version.ts)                                                                                                                                                                   |
| 上下文设置     | 可配置 4096–1,048,576；当前 Provider 再按模型窗口与 32,768 上限收敛，随后受用户设置限制 | [settings.ts](../../services/coding-agent/src/domain/settings.ts)、[coding_model_requests.py](../../services/runtime/src/mlx_studio_runtime/application/coding_model_requests.py)、[service.ts](../../services/coding-agent/src/application/service.ts) |

设置上限不代表真实模型能使用同等窗口。Pi 压缩与输出预留仍受实际 Provider 窗口约束；工具模板、模型能力探针与长上下文质量需要分别验证。

内部推理协议支持文本与完整工具历史、工具 JSON Schema、自动/禁止工具选择和流式正文。工具参数整批解析并验证后才执行；目前包含 JSON `<tool_call>` 与 Qwen XML 模板路径，其他模板不能凭模型名称放行。Coding 多模态输入、Worktree、交互 PTY、IDE 交接与多 Agent 调度不应写成现有能力。

## 协议与打包维护

Host RPC 版本当前为 2，与 Runtime 握手及 `/internal/v1` 分开。修改 [schema.json](../../packages/coding-protocol/schema.json) 后运行 `pnpm generate rpc`；生成内容包含两端类型/校验数据、扩展 HTTP DTO 和 Coding 限额，再通过 OpenAPI 生成前端类型。

发行资源由 [build-coding-host.sh](../../scripts/build/build-coding-host.sh) 打包固定 Node、Host、锁定依赖与内置 Skill，并生成来源摘要。依赖副本的裁剪规则、体积报告和仓库外包内验收见[开发指南](../development.md#coding-host-依赖边界)。冻结 Runtime 从固定资源目录启动 Host，不接受前端给出的任意程序路径；仅 Web 构建成功不能验证这条分发链路。

## 验证命令

从仓库根目录执行：

```bash
pnpm build coding
pnpm check coding
pnpm test coding
pnpm test runtime
pnpm check boundaries
pnpm build coding-bundle
```

契约变化另运行 `pnpm generate rpc` 和 `pnpm generate api`。重点回归包括 [permissions](../../services/coding-agent/tests/permissions.test.mjs)、[workspace](../../services/coding-agent/tests/workspace.test.mjs)、[reliability](../../services/coding-agent/tests/reliability.test.mjs)、[verification](../../services/coding-agent/tests/verification.test.mjs)、[streaming](../../services/coding-agent/tests/streaming.test.mjs)及 [HTTP 集成](../../tests/test_coding_workspace.py)。

真实模型与包内 Host 使用 [verify_local_coding.py](../../scripts/verify/verify_local_coding.py)；参数和环境以脚本 `--help` 为准。协议假服务、FakeEngine、真实模型开发任务和最终安装包分别记录结果，统一进入[验证范围](../verification.md)，不以历史单机结果替代当前版本验收。
