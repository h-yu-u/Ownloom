export function phaseLabel(phase: string): string {
  return (
    {
      accepted: '已提交',
      preparing_context: '正在准备资料',
      searching: '正在搜索网页',
      reading_sources: '正在读取来源',
      waiting_model: '等待模型可用',
      loading_model: '正在加载模型',
      generating: '正在生成回答',
    }[phase] ?? '正在处理'
  )
}
