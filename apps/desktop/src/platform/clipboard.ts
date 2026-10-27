/** Browser and WebView clipboard boundary; fallback failures must remain visible. */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Some WebViews reject the Clipboard API but allow copying from a focused selection.
    }
  }
  const previous = document.activeElement
  const input = document.createElement('textarea')
  input.value = text
  input.readOnly = true
  input.style.cssText = 'position:fixed;left:0;top:0;opacity:0;pointer-events:none'
  document.body.appendChild(input)
  try {
    input.select()
    if (!document.execCommand('copy')) throw new Error('无法复制，请选择代码后手动复制')
  } finally {
    input.remove()
    if (previous instanceof HTMLElement) previous.focus({ preventScroll: true })
  }
}
