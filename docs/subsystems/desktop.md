# 桌面与共享交互子系统

[子系统目录](./README.md) · [架构](../architecture.md) · [代码规范](../code-standards.md)

## 职责与边界

桌面层提供导航、工作区装配、共享交互和平台接入。业务由各工作区 application/controller 管理；展示组件通过 Props/Events 交互，不能直接持有 HTTP、Tauri、数据库或引擎。跨功能共享经过 capability 公开入口。

| 事实来源                                                                                             | 维护内容                                     |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| [组合根](../../apps/desktop/src/app/composition-root.ts)                                             | 端口、网关和工作区工厂                       |
| [路由](../../apps/desktop/src/app/router.ts)、[主导航](../../apps/desktop/src/app/StudioNavRail.vue) | 页面、工作区和任务中心入口                   |
| [共享 UI](../../apps/desktop/src/shared/ui/)                                                         | 输入壳、会话项、Markdown、表单结果和资源状态 |
| [平台边界](../../apps/desktop/src/platform/)                                                         | Runtime 桥、保存、剪贴板与外链               |
| [任务中心](../../apps/desktop/src/capabilities/tasks/)                                               | 聚合、观察、分组与跳转                       |
| [设置布局](../../apps/desktop/src/modules/settings/pages/SettingsLayout.vue)                         | 设置导航及分类                               |
| [Tauri 配置](../../apps/desktop/src-tauri/tauri.conf.json)                                           | 产品名、窗口、CSP、资源和签名                |

## 运行路径

Vue 路由懒加载工作区；Pinia 入口暴露组合根配置的 controller。Controller 编排用例、查询和视图资源，平台适配器承担原生 I/O。Runtime 连接通过 `RuntimeSession` 共享，代际失效同时清理过期查询与观察。

Rust 只启动固定 Runtime、维护握手/代际、处理原生导出和受限外链。应用展示名称为 Ownloom；`local.mlxstudio.app`、`mlx-studio-runtime`、`@mlx-studio/*` 和 `MLX_STUDIO_*` 是实际技术标识，不能因改界面文案而任意更改。

浏览器调试只验证 Web 能力，不能证明原生对话框、剪贴板 fallback、系统浏览器、输入法或 WebView 媒体行为正常。连接配置与构建命令见[开发指南](../development.md)。

## 当前交互约束

### 草稿与提交

Coding/工具助手草稿按项目和会话隔离，以 ID/revision 决定是否消费；Chat 另有附件草稿与租约。草稿仅保存在当前进程，不写 localStorage，不承诺重启恢复。

任务已接纳后的快照失败应提示同步失败，不能把任务当作未提交而重建。未知结果保留请求身份并先查询；steer 等不可安全重放的操作不能自动重复。迟到结果不能清空用户已编辑的内容。

### 设置与默认值

编辑草稿、保存结果、测试结果分别管理。Web 搜索只测试已保存的 config/revision，dirty 时说明需先保存。MCP 保存结果未知时保留 mutationId，有回执后只回读，不重复创建配置或凭据。

默认绑定按工作区、项目或工具助手 scope 解释；明确空选择不能继续继承，读取失败不能被保存为空默认值。音色“保存并用于当前草稿”只回填引用，不能自动生成。

### 任务中心

[分组规则](../../apps/desktop/src/capabilities/tasks/task-groups.ts)以 `groupId` 或 owner/session 身份归并，不能按同名标题合并。主任务决定卡片状态，子推理步骤默认折叠，旧失败步骤不能覆盖主任务成功；待批准和活动任务优先显示。

首次加载、失败、成功空列表分别呈现。刷新复用当前请求并保护观察代际，失败可以保留上次结果但应说明可能过期。聚合不读取全部聊天正文；后端投影归 [Runtime](./runtime.md)。

### 媒体、导出与内容

恢复作品需检查目标草稿版本；缺失项明确显示，不能静默选择其他模型或音色。列表、详情和文件错误独立；删除 A 的迟到响应不能影响已选中的 B。

保存返回已保存、已发起浏览器下载、取消或失败等明确结果。读取期间离页不得弹出迟到的保存窗口，已经发生的保存结果不能改成取消。实现见 [files.ts](../../apps/desktop/src/platform/files.ts)。

Markdown 统一使用 [MarkdownContent.vue](../../apps/desktop/src/shared/ui/MarkdownContent.vue)及受控渲染器。HTML、危险链接和引用定位走既有安全路径。外链由平台验证 HTTP/HTTPS 和凭据，不能开放通用 Shell 权限或改变聊天 Hash 路由。

### 样式与可访问性

唯一手写 token 来源是 [theme.tokens.json](../../apps/desktop/src/shared/styles/theme.tokens.json)。生成 CSS/TS 同时供 Naive UI 和产品样式使用，不手改生成值。基础控件优先 Naive UI，通用响应式能力优先 VueUse。

复用 `ComposerShell`、`SessionListItem`、`TaskStatusPanel`、`FormActionBar`、`ResourceListState`、`PageHeader` 等真实公共入口；提交和审批仍由功能容器负责。检查键盘、焦点、读屏标签、加载/空/错误/取消和窄窗口，不能只用静态截图验收。

## 验证与维护

```bash
pnpm tokens:generate
pnpm check:frontend
pnpm test:frontend
pnpm build:web
```

仅在修改 token 源时生成，命令详情见[开发指南](../development.md)。关键回归包括 AppProviders/设置路由、输入法与停止、草稿并发、设置回执恢复、任务分组、媒体分页/迟到结果及导出取消。Rust 变更另需 `pnpm check:rust`、`pnpm test:rust` 和实际桌面操作。

模块 UI 更新对应子系统；导航、平台或公共组件更新本文。新增页面包含失败恢复与资源释放，新增公共组件需有真实消费者，不能为统一外观接管功能状态。真机与发布边界见[验证范围](../verification.md)。
