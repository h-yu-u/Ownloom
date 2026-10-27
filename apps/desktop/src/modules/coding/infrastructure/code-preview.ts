import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { HighlightStyle, LanguageDescription, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { languages } from '@codemirror/language-data'
import { search, searchKeymap } from '@codemirror/search'

export function mountCodePreview(parent: HTMLElement, content: string, path: string): () => void {
  const language = new Compartment()
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: content,
      extensions: [
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        EditorView.contentAttributes.of({ 'aria-label': `${path} 源码（只读）`, tabindex: '0' }),
        lineNumbers(),
        search({ top: true }),
        keymap.of(searchKeymap),
        syntaxHighlighting(
          HighlightStyle.define([
            { tag: tags.keyword, color: '#c4b5fd' },
            { tag: [tags.string, tags.regexp], color: '#a7d7a0' },
            { tag: [tags.number, tags.bool, tags.null], color: '#f5c58b' },
            { tag: tags.comment, color: 'var(--muted)', fontStyle: 'italic' },
            { tag: [tags.typeName, tags.className], color: '#8bd5dc' },
            { tag: tags.function(tags.variableName), color: '#9dc9f5' },
          ]),
        ),
        language.of([]),
        EditorState.phrases.of({
          Find: '查找',
          next: '下一个',
          previous: '上一个',
          all: '全部',
          'match case': '区分大小写',
          regexp: '正则表达式',
          'by word': '全词',
          close: '关闭',
        }),
        EditorView.theme({
          '&': {
            height: '100%',
            color: 'var(--text-primary)',
            backgroundColor: 'var(--surface-body)',
          },
          '.cm-scroller': {
            overflow: 'auto',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: '12px',
            lineHeight: '1.7',
          },
          '.cm-gutters': {
            backgroundColor: 'var(--surface-sidebar)',
            color: 'var(--muted)',
            border: 'none',
          },
          '.cm-content': { padding: '12px 0' },
          '.cm-searchMatch': { backgroundColor: '#eab30845' },
          '.cm-panels': { backgroundColor: 'var(--surface-sidebar)', color: 'var(--text-primary)' },
          '.cm-textfield, .cm-button': {
            color: 'var(--text-primary)',
            background: 'var(--surface-hover)',
            border: '1px solid var(--line)',
            borderRadius: '4px',
          },
          '.cm-panel.cm-search button[name=close]': { color: 'var(--text-primary)' },
        }),
      ],
    }),
  })
  let disposed = false
  const description = LanguageDescription.matchFilename(languages, path)
  if (description)
    void description
      .load()
      .then((support) => {
        if (!disposed) view.dispatch({ effects: language.reconfigure(support) })
      })
      .catch(() => {
        /* Plain text stays readable when an optional syntax module is unavailable. */
      })
  return () => {
    disposed = true
    view.destroy()
  }
}
