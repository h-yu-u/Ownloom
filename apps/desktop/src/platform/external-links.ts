import { invoke, isTauri } from '@tauri-apps/api/core'

export function externalWebUrl(value: string): string | undefined {
  if (value.length > 8192 || /[\s\p{Cc}]/u.test(value)) return undefined
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : undefined
  } catch {
    return undefined
  }
}

/** Keep the desktop WebView on its current conversation when opening a website. */
export async function openWebUrl(value: string): Promise<void> {
  const url = externalWebUrl(value)
  if (!url) throw new Error('网页地址无效，仅支持 HTTP 或 HTTPS 链接')
  if (isTauri()) {
    try {
      await invoke('open_external_url', { url })
    } catch {
      throw new Error('无法打开系统浏览器，请重试或复制链接地址')
    }
  } else {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}
