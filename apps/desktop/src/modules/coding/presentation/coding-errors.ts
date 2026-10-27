import { RuntimeError } from '@mlx-studio/api-client'
const labels: Record<string, string> = {
  FIXED_CONTEXT_BUDGET_EXCEEDED: '系统规则或工具定义超过窗口，请减少技能/工具或更换模型。',
  EXTENSION_CONTEXT_BUDGET_EXCEEDED: '上下文超过窗口，请压缩历史或更换更大窗口的模型。',
  VERIFICATION_PLAN_CHANGED: '验证配置已改变，本轮验证已停止，请重新建立验证计划。',
  TRANSCRIPT_CORRUPT: '会话日志校验失败，原记录已保留，请从备份恢复或新建会话。',
  MODEL_TOOLS_UNVERIFIED: '模型或模板发生变化，请重新验证工具能力。',
  RESTORE_CONFLICT: '文件已被人工或外部程序修改，无法撤销。当前内容已保留。',
  FILE_VERSION_CONFLICT: '文件版本发生变化，请重新读取后再修改。',
  CODING_HOST_NOT_AVAILABLE: 'Coding 服务暂不可用，请重试连接。',
  RUN_NOT_READY: '任务仍在准备，请稍后再补充。输入已保留。',
  CODING_BUSY: '另一个开发任务正在执行，请停止它或等待完成。',
  READ_ONLY_MODE: '分析和审查模式保持只读；请切换到开发模式后选择完全访问。',
  CODING_QUEUE_FULL: '已有一个下一任务排队，请等待它开始。',
  SESSION_IN_USE: '该会话仍有运行或排队任务，请先停止任务。',
  VERIFICATION_COMMANDS_REQUIRED: '请先在项目设置中填写验证命令。',
  APPROVAL_ALREADY_RESOLVED: '此审批已处理或已过期，请刷新状态。',
  TOOL_FORMAT_INVALID: '模型返回了不完整的工具调用，请重试。',
  TOOL_ARGUMENTS_INVALID: '模型返回的工具参数无效，请重试。',
  TOOL_JSON_INVALID: '模型返回的 JSON 工具调用无效，请重试。',
  TOOL_XML_INVALID: '模型返回的 XML 工具调用无效，请重试。',
  TOOL_OUTPUT_TRUNCATED: '工具调用超过输出长度，未执行该批调用，请缩小任务后重试。',
  MODEL_OUTPUT_TRUNCATED: '模型输出达到长度上限，请缩小任务后继续。',
  MODEL_CONNECTION_FAILED: '本地推理连接已中断，请重新连接后重试。',
  MODEL_REQUEST_TIMEOUT: '本地模型响应超时，请检查模型状态后重试。',
  MODEL_INFERENCE_FAILED: '本地模型推理失败，请查看推理记录后重试。',
  STRUCTURED_INFERENCE_FAILED: '本地结构化推理失败，请检查模型是否正常加载。',
  UNKNOWN_TOOL: '模型请求了未提供的工具，未执行该批调用。',
  MODEL_NOT_FOUND: '模型已移除，请重新选择本地模型。',
}
export function codingRunErrorText(code: string): string {
  return labels[code] ? `${labels[code]}（${code}）` : code
}
export function codingErrorText(cause: unknown): string {
  if (cause instanceof RuntimeError)
    return labels[cause.code] ?? `${cause.message}（${cause.code}）`
  return cause instanceof Error ? cause.message : 'Coding 请求失败'
}
