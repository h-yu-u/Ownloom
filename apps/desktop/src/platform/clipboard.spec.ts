import { afterEach, expect, it, vi } from 'vitest'
import { copyText } from './clipboard'

afterEach(() => {
  vi.unstubAllGlobals()
  Reflect.deleteProperty(document, 'execCommand')
  document.body.replaceChildren()
})
it('uses the clipboard API when available', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  await copyText('  hello\n中文')
  expect(writeText).toHaveBeenCalledWith('  hello\n中文')
  expect(document.querySelector('textarea')).toBeNull()
})
it('falls back when the WebView rejects the clipboard API and restores focus', async () => {
  vi.stubGlobal('navigator', {
    clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
  })
  const button = document.createElement('button')
  document.body.appendChild(button)
  button.focus()
  const execCommand = vi.fn(() => {
    expect(document.querySelector('textarea')?.value).toBe('fallback\n')
    return true
  })
  Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand })
  await copyText('fallback\n')
  expect(execCommand).toHaveBeenCalledWith('copy')
  expect(document.activeElement).toBe(button)
  expect(document.querySelector('textarea')).toBeNull()
})
it('rejects failed fallback copying and removes temporary DOM', async () => {
  vi.stubGlobal('navigator', {})
  Object.defineProperty(document, 'execCommand', { configurable: true, value: () => false })
  await expect(copyText('failed')).rejects.toThrow('无法复制')
  expect(document.querySelector('textarea')).toBeNull()
})
