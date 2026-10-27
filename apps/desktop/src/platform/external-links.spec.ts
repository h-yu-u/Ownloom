import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { externalWebUrl, openWebUrl } from './external-links'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: vi.fn() }))
beforeEach(() => vi.resetAllMocks())
afterEach(() => vi.restoreAllMocks())

it('opens desktop web links through the native bridge without navigating the WebView', async () => {
  vi.mocked(isTauri).mockReturnValue(true)
  const browser = vi.spyOn(window, 'open').mockReturnValue(null)
  await openWebUrl('https://github.com/trending?since=daily#top')
  expect(invoke).toHaveBeenCalledWith('open_external_url', {
    url: 'https://github.com/trending?since=daily#top',
  })
  expect(browser).not.toHaveBeenCalled()
})

it('opens browser links synchronously with opener isolation, even when no window handle is returned', async () => {
  vi.mocked(isTauri).mockReturnValue(false)
  const browser = vi.spyOn(window, 'open').mockReturnValue(null)
  const result = openWebUrl('https://example.com/中文')
  expect(browser).toHaveBeenCalledWith(
    'https://example.com/%E4%B8%AD%E6%96%87',
    '_blank',
    'noopener,noreferrer',
  )
  await expect(result).resolves.toBeUndefined()
  expect(invoke).not.toHaveBeenCalled()
})

it('reports native opening failures instead of silently falling back to a blocked WebView popup', async () => {
  vi.mocked(isTauri).mockReturnValue(true)
  vi.mocked(invoke).mockRejectedValueOnce(new Error('EXTERNAL_BROWSER_UNAVAILABLE'))
  const browser = vi.spyOn(window, 'open').mockReturnValue(null)
  await expect(openWebUrl('https://example.com')).rejects.toThrow('无法打开系统浏览器')
  expect(browser).not.toHaveBeenCalled()
})

it.each([
  'javascript:alert(1)',
  'file:///etc/passwd',
  'data:text/html,hello',
  'https://user:secret@example.com',
  'https://example.com\n/next',
  '/tmp/command',
  '//example.com',
  'https://example.com/with space',
  'tauri://localhost',
  `https://example.com/${'a'.repeat(8192)}`,
])('rejects unsafe or malformed targets before invoking any opener (%s)', async (url) => {
  expect(externalWebUrl(url)).toBeUndefined()
  await expect(openWebUrl(url)).rejects.toThrow('网页地址无效')
  expect(invoke).not.toHaveBeenCalled()
})
