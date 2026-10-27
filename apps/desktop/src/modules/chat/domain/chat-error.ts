const messages: Record<string, string> = {
  WEB_FRESHNESS_UNVERIFIED:
    '未找到符合本次日期要求的可靠资料，请更换关键词或稍后重试。不会使用旧网页作为今日信息。',
  WEB_NO_RESULTS: '搜索服务已连接，但没有可用的网页正文或摘要，请更换关键词后重试。',
  WEB_SEARCH_TIMEOUT: '联网检索超时，请稍后重试。',
  WEB_SEARCH_FAILED: '搜索服务请求失败，请检查联网配置后重试。',
  WEB_NOT_CONFIGURED: '请先在设置中配置联网搜索。',
  WEB_CREDENTIAL_UNAVAILABLE: '无法读取搜索凭据，请在设置中检查 API Key。',
}

export function chatError(value?: unknown): string {
  const code = typeof value === 'string' ? value : undefined
  return messages[code ?? ''] ?? `生成失败${code ? `（${code}）` : ''}`
}
