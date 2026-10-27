import { expect, it } from 'vitest'
import { changePatch, renderDiff } from './diff-preview'
it('renders inserted/deleted lines with numbers in both diff layouts', () => {
  const patch = changePatch('src/中文.ts', 'const a = 1\n', 'const a = 2\n')
  for (const split of [true, false]) {
    const host = document.createElement('div')
    host.innerHTML = renderDiff(patch, split)
    expect(host.querySelector('.d2h-ins')).toBeTruthy()
    expect(host.querySelector('.d2h-del')).toBeTruthy()
    expect(host.textContent).toContain('const a = 2')
  }
})
it('treats source text as code and strips active HTML from generated diffs', () => {
  const host = document.createElement('div')
  host.innerHTML = renderDiff(
    changePatch('unsafe.html', null, '<img src=x onerror=alert(1)><script>alert(1)</script>\n'),
    false,
  )
  expect(host.querySelector('img,script,[onerror]')).toBeNull()
  expect(host.textContent).toContain('<script>')
})

it('labels newly created files as added, including paths with spaces and Unicode', () => {
  const host = document.createElement('div')
  host.innerHTML = renderDiff(
    changePatch('src/中文 file.ts', null, 'export const count = 1\n'),
    false,
  )
  expect(host.textContent).toContain('ADDED')
  expect(host.textContent).not.toContain('RENAMED')
  expect(host.textContent).toContain('中文 file.ts')
})
it('distinguishes an existing empty file from a newly created file', () => {
  const host = document.createElement('div')
  host.innerHTML = renderDiff(changePatch('empty.ts', '', 'export const count = 1\n'), false)
  expect(host.textContent).toContain('CHANGED')
  expect(host.textContent).not.toContain('ADDED')
})
