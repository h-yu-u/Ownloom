# Lessons from review

[Code standards](docs/code-standards.md) · [Subsystem references](docs/subsystems/README.md)

这里记录 Ownloom 评审中可追溯的经验，每条按**规则 → 原因 → 证据**组织。初始条目来自 2026-10-28 对源码与文档的审计，属于文档一致性发现，不声称曾发生生产事故或已进行多次历史复盘。

## 如何维护

- 仅记录可指向具体提交、PR、源码、测试或经过脱敏报告的发现；不能把推测写成事故。
- `Seen` 统计实际独立评审日期，不统计同一天多个文件或多个测试；复现同类问题时补证据与日期。
- 同一经验在至少三个独立日期出现后，评估是否提升为[编码规范](docs/code-standards.md)，保留证据链接并标记已提升。不要将尚未满足条件的条目包装成反复验证的结论。
- 已有长期规范继续生效；本文件不复制全部规范、不承担待办清单或功能状态表。新发现若改变行为，应同时修改所属参考和相关测试。

## 限额要核对完整请求路径

**规则：** 更改默认值或限制时，从 UI、请求构造、入口校验一直核对到执行器；用户说明引用所属子系统，不能另存一份过时常量。

**原因：** UI 初始值、可配置范围和最终有效范围是不同概念。把其中任一数字当作统一上限，会误导模型选择和实际操作。

**证据：** 审计基线的[入门说明](https://github.com/h-yu-u/MlxDesktop/blob/437f05ba16b89c9d40d23fb0c67fdec5b2c9b953/docs/getting-started.md)仍称聊天默认 4096、最大 8192，而同一提交的[聊天参数](https://github.com/h-yu-u/MlxDesktop/blob/437f05ba16b89c9d40d23fb0c67fdec5b2c9b953/apps/desktop/src/modules/chat/domain/chat-parameters.ts)已由上下文长度计算范围，[输出预算说明](https://github.com/h-yu-u/MlxDesktop/blob/437f05ba16b89c9d40d23fb0c67fdec5b2c9b953/docs/chat-output-budget.md)记录 `null` 自动模式。现由[聊天参考](docs/subsystems/chat.md)维护这项契约。

**Seen：** 2026-10-28（1 次独立审计）。

## 恢复能力必须描述具体状态转移

**规则：** 不笼统写“支持恢复”或“待实现恢复”；说明退出前状态、重启后状态，以及恢复由谁触发。

**原因：** 重启后保留任务、自动继续传输和等待用户恢复是不同承诺。没有写清楚状态，旧计划容易覆盖已经存在的实现。

**证据：** 同一基线的入门说明仍将跨重启下载恢复列为待完善，但[下载仓库](https://github.com/h-yu-u/MlxDesktop/blob/437f05ba16b89c9d40d23fb0c67fdec5b2c9b953/services/runtime/src/mlx_studio_runtime/adapters/persistence/download_repository.py)将未完成任务转为暂停，[下载服务](https://github.com/h-yu-u/MlxDesktop/blob/437f05ba16b89c9d40d23fb0c67fdec5b2c9b953/services/runtime/src/mlx_studio_runtime/application/downloads.py)提供显式恢复入口。现由[模型与下载](docs/subsystems/models.md)维护。

**Seen：** 2026-10-28（1 次独立审计）。

## 验证结论必须绑定环境和制品

**规则：** 长期规范定义证据要求，当前验证文档维护实际范围；不能在多个入口分别宣称全未验证或全已验证。

**原因：** 源码测试、FakeEngine、单个真实模型、包内 Sidecar、原生界面和正式分发不是同一级证据。旧测试数量和本机路径不足以证明当前提交可发布。

**证据：** 基线 [AGENTS.md](https://github.com/h-yu-u/MlxDesktop/blob/437f05ba16b89c9d40d23fb0c67fdec5b2c9b953/AGENTS.md)对真实引擎使用笼统的未验证描述，而[当时的验收记录](https://github.com/h-yu-u/MlxDesktop/blob/437f05ba16b89c9d40d23fb0c67fdec5b2c9b953/docs/status.md)包含有限范围的本机报告。此次将证据层级与当前边界集中到[验证矩阵](docs/verification.md)，保留“仓库记录”和“本次实测”的区别。

**Seen：** 2026-10-28（1 次独立审计）。

## 文档也是构建输入

**规则：** 移动或删除文档前，搜索脚本、工作流和用户入口中的引用，并实际检查消费路径。

**原因：** 一个页面可能既是网站阅读入口，也是交付物的输入。只改 Markdown 链接不能保证打包过程仍可运行。

**证据：** [可携带验收包脚本](scripts/acceptance/package-acceptance-kit.sh)把 `docs/release-acceptance.md` 复制为独立工具包的 `README.md`。该路径在本次整理中保留；本地链接和锚点由 `pnpm check docs` 检查，打包及平台行为仍按[发布验收](docs/release-acceptance.md)执行。

**Seen：** 2026-10-28（1 次独立审计）。
