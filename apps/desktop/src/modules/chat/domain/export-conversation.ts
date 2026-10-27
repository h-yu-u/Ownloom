import type { ChatMessage } from './chat-state'
export function formatConversation(title: string, messages: ChatMessage[]): string {
  return [
    `# ${title}`,
    ...messages.map((item) => {
      const attachments = item.attachments?.map((file) => `附件：${file.originalName}`).join('\n')
      const sources = item.sources
        ?.map((source) =>
          source.kind === 'web'
            ? `[${source.id}] ${source.title} — ${source.url}（检索于 ${source.retrievedAt}；${source.representation === 'snippet_only' ? '仅摘要' : '网页摘录'}）`
            : `[${source.id}] ${source.originalName}（${source.locations?.map((location) => (location.page ? `第 ${location.page} 页` : location.section || location.blockId)).join('、')}）`,
        )
        .join('\n')
      return `## ${item.role === 'user' ? '你' : 'Ownloom'}\n\n${item.content}${attachments ? `\n\n${attachments}` : ''}${sources ? `\n\n参考来源\n${sources}` : ''}`
    }),
  ].join('\n\n')
}
