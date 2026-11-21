import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './render-markdown'

describe('renderMarkdown', () => {
  it.each(['toString', 'constructor', '__proto__', 'hasOwnProperty'])(
    'keeps inherited citation ID %s unresolved without losing the message',
    (id) => {
      const node = document.createElement('div')
      node.innerHTML = renderMarkdown(`**回答** [[cite:${id}]] [[cite:w1]]`, {
        w1: '#source-answer-w1',
      })
      expect(node.querySelector('strong')?.textContent).toBe('回答')
      expect(node.querySelector('.citation-unresolved')?.textContent).toBe(`[[cite:${id}]]`)
      expect(node.querySelectorAll('a.citation')).toHaveLength(1)
      expect(node.querySelector('a.citation')?.getAttribute('href')).toBe('#source-answer-w1')
    },
  )

  it('resolves explicitly owned citation IDs even when they match prototype names', () => {
    const citations = Object.fromEntries([
      ['__proto__', '#source-answer-proto'],
      ['toString', '#source-answer-string'],
    ])
    const node = document.createElement('div')
    node.innerHTML = renderMarkdown('[[cite:__proto__]] [[cite:toString]]', citations)
    expect(
      Array.from(node.querySelectorAll('a.citation'), (link) => link.getAttribute('href')),
    ).toEqual(['#source-answer-proto', '#source-answer-string'])
  })

  it('does not resolve citation targets inherited from a custom prototype', () => {
    const citations = Object.setPrototypeOf(
      { w1: '#source-answer-w1' },
      {
        inherited: '#source-another-answer',
      },
    )
    const node = document.createElement('div')
    node.innerHTML = renderMarkdown('[[cite:inherited]]', citations)
    expect(node.querySelector('a')).toBeNull()
    expect(node.querySelector('.citation-unresolved')?.textContent).toBe('[[cite:inherited]]')
  })

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
