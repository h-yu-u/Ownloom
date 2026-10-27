import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './render-markdown'

describe('renderMarkdown', () => {
  it('keeps Markdown while escaping raw HTML and active content', () => {
    const html = renderMarkdown('**safe**\n<script>alert(1)</script>')
    expect(html).toContain('<strong>safe</strong>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('removes active URL schemes and renders hostile markup as inert text', () => {
    const node = document.createElement('div')
    node.innerHTML = renderMarkdown(
      '**正常粗体**\n[危险链接](javascript:alert(1))\n[页面](data:text/html,unsafe)\n' +
        '<img src=x onerror=alert(1)>\n<svg onload=alert(1)></svg>\n' +
        '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
    )
    expect(node.querySelector('strong')?.textContent).toBe('正常粗体')
    expect(node.querySelector('script, iframe, svg, img, [onerror], [onload], [srcdoc]')).toBeNull()
    for (const link of node.querySelectorAll('a')) expect(link.getAttribute('href')).toBeNull()
    expect(node.textContent).toContain('<img src=x onerror=alert(1)>')
  })

  it('keeps malicious code-fence labels and contents inside escaped code', () => {
    const node = document.createElement('div')
    node.innerHTML = renderMarkdown(
      '```html\"><img/src=x/onerror=alert(1)>\n<script>alert(1)</script>\n```',
    )
    expect(node.querySelector('pre code')?.textContent).toContain('<script>alert(1)</script>')
    expect(node.querySelector('script, img, [onerror]')).toBeNull()
    expect(node.querySelectorAll('button.code-copy')).toHaveLength(1)
  })
})
