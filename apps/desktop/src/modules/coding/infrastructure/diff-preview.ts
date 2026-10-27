import { createTwoFilesPatch } from 'diff'
import { html, parse } from 'diff2html'
import DOMPurify from 'dompurify'

export function changePatch(path: string, before: string | null, after: string): string {
  const patch = createTwoFilesPatch(
    before === null ? '/dev/null' : `a/${path}`,
    `b/${path}`,
    before ?? '',
    after,
  )
  if (before !== null) return patch
  return `diff --git ${JSON.stringify(`a/${path}`)} ${JSON.stringify(`b/${path}`)}\nnew file mode 100644\n${patch}`
}
export function renderDiff(patch: string, split: boolean, fileList = false): string {
  return DOMPurify.sanitize(
    html(parse(patch, { diffMaxChanges: 20000 }), {
      outputFormat: split ? 'side-by-side' : 'line-by-line',
      drawFileList: fileList,
      matching: 'lines',
      renderNothingWhenEmpty: true,
    }),
  )
}
