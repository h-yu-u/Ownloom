import { RuntimeError } from '@mlx-studio/api-client'
const messages: Record<string, string> = {
  EXTENSION_REVISION_CONFLICT: '配置已被其他窗口更新，请刷新后合并。当前草稿已保留。',
  IDEMPOTENCY_CONFLICT: '请求编号对应的内容已改变，请重新提交。',
  SKILL_FORMAT_UNSUPPORTED: 'SKILL.md 格式不受支持，请检查名称、描述和 frontmatter。',
  SKILL_FILE_NOT_FOUND: '所选目录缺少 SKILL.md。',
  SKILL_NAME_CONFLICT: '已有同名技能，请更新原技能或更改名称。',
  SKILL_PATH_NOT_ALLOWED: '技能包含软链或越界路径，请复制为普通文件后导入。',
  SKILL_CONTENT_CHANGED: '技能文件与批准版本不同，请重新导入。',
  SKILL_DEPENDENCY_MISSING: '此技能依赖的工具尚未选择或授权。',
  SKILL_PACKAGE_TOO_LARGE: '技能包超过 20 MiB 或 200 个文件。',
  SKILL_NOT_AVAILABLE: '所选技能已停用或不适用于当前工作区。',
  MCP_EXECUTABLE_NOT_FOUND: '找不到可执行文件，请检查绝对路径和执行权限。',
  MCP_EXECUTABLE_NOT_ALLOWED: '请使用已安装服务的绝对入口路径；当前不自动运行 npx/uvx 安装。',
  MCP_AUTH_REQUIRED: '服务要求认证，请更新此连接的凭据。',
  MCP_PERMISSION_DENIED: '凭据没有所需权限。',
  MCP_INVENTORY_REQUIRED: '请先测试当前版本的连接并发现工具。',
  MCP_SCHEMA_UNSUPPORTED: '此服务包含当前无法校验的工具定义。',
  MCP_SCHEMA_CHANGED: '服务工具定义已改变，请重新测试并提交新任务。',
  MCP_TOOL_NOT_ALLOWED: '所选工具不在当前连接白名单中。',
  MCP_CONNECT_FAILED: '连接失败，请检查服务地址、入口与运行依赖。',
  MCP_CONNECT_TIMEOUT: '连接超时，请检查服务是否可用。',
  MCP_SECRET_FIELD_REQUIRED: '认证信息请填写在独立凭据栏，不要放入公开配置。',
  READ_ONLY_MODE: '分析和审查模式仅允许已批准为只读的工具。',
  CAPABILITY_REVOKED: '此能力已撤销，相关任务已停止。',
  TOOL_BUDGET_EXCEEDED: '工具总数超过 16 个，请减少选择。',
  EXTENSION_CONTEXT_BUDGET_EXCEEDED: '技能与工具占用上下文过多，请减少选择。',
  SECRET_STORE_UNAVAILABLE: '系统安全存储不可用，凭据没有写入普通文件。',
  AGENT_CHANNEL_NOT_AVAILABLE: '此工作区暂未开放 MCP Agent 调用。',
}
export function extensionError(cause: unknown): string {
  const code =
    cause instanceof RuntimeError ? cause.code : cause instanceof Error ? cause.message : ''
  return messages[code] ?? `扩展操作未完成${/^[A-Z][A-Z0-9_]+$/.test(code) ? `（${code}）` : ''}`
}
