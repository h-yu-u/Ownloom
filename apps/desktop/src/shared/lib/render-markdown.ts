import DOMPurify from 'dompurify'
import { marked, Marked, type Tokens } from 'marked'

const renderer = new marked.Renderer()
renderer.html = (token: Tokens.HTML | Tokens.Tag) => escapeHtml(token.text)
renderer.code = (token: Tokens.Code) => {
  const language = token.lang?.trim().split(/\s+/)[0] || '代码'
  return `<div class="code-block"><div class="code-toolbar"><span>${escapeHtml(language)}</span><button type="button" class="code-copy" aria-label="复制代码">复制</button></div><pre><code>${escapeHtml(token.text)}\n</code></pre></div>\n`
}

export function renderMarkdown(
  source: string,
  citations?: Readonly<Record<string, string>>,
): string {
  const parser = citations ? new Marked() : marked
  if (citations)
    parser.use({
      extensions: [
        {
          name: 'citation',
          level: 'inline',
          start: (source) => source.indexOf('[[cite:'),
          tokenizer: (source) => {
            const match = /^\[\[cite:([A-Za-z0-9_-]+)\]\]/.exec(source)
            return match ? { type: 'citation', raw: match[0], sourceId: match[1] } : undefined
          },
          renderer: (token) => {
            const id = String(token.sourceId),
              target = citations[id]
            return target?.startsWith('#')
              ? `<a class="citation" href="${escapeHtml(target)}">[${escapeHtml(id)}]</a>`
              : `<span class="citation-unresolved">${escapeHtml(token.raw)}</span>`
          },
        },
      ],
    })
  const parsed = parser.parse(source, { async: false, gfm: true, breaks: true, renderer })
  return DOMPurify.sanitize(parsed, {
    FORBID_TAGS: ['style', 'iframe', 'form', 'input', 'object', 'embed'],
    FORBID_ATTR: ['style'],
  })
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character] ?? character,
  )
}
