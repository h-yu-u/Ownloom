import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { createCodingInspector } from './coding-inspector-controller'
import type { CodingChange } from '../application/ports'
const change: CodingChange = {
  id: 'first',
  runId: 'r',
  sessionId: 's',
  path: 'src/app.ts',
  before: 'original',
  after: 'middle',
  restored: false,
  state: 'written',
  contentLoaded: true,
}
function fixture() {
  const gateway = {
    files: vi.fn(async () => ['src/app.ts', 'empty.txt']),
    read: vi.fn(async () => 'content'),
    changes: vi.fn(async () => ({
      managed: [change, { ...change, id: 'last', before: 'middle', after: 'final' }],
      diff: '',
      workspace: '',
      scope: '',
    })),
    change: vi.fn(async (id: string) =>
      id === 'first' ? change : { ...change, id, before: 'middle', after: 'final' },
    ),
    restore: vi.fn(async () => ({})),
  }
  const sessionId = ref('s')
  const inspector = createCodingInspector({
    gateway,
    sessionId,
    busy: ref(false),
    onRestored: vi.fn(async () => {}),
  })
  return { gateway, inspector, sessionId }
}
describe('file and change inspection', () => {
  it('a single toggle opens changes by default and remembers the last tab after either close action', async () => {
    const { inspector, gateway } = fixture()
    await inspector.toggleInspector()
    expect(inspector.panel.value).toBe('changes')
    await inspector.inspect('files')
    await inspector.toggleInspector()
    expect(inspector.panel.value).toBeNull()
    await inspector.toggleInspector()
    expect(inspector.panel.value).toBe('files')
    expect(gateway.files).toHaveBeenCalledTimes(2)
    inspector.resetInspector()
    await inspector.toggleInspector()
    expect(inspector.panel.value).toBe('files')
    await inspector.inspect('changes')
    await inspector.toggleInspector()
    await inspector.toggleInspector()
    expect(inspector.panel.value).toBe('changes')
  })
  it('closing and reopening during loading discards stale results and reloads the remembered tab', async () => {
    const { inspector, gateway } = fixture()
    let finish!: (paths: string[]) => void
    gateway.files.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const opening = inspector.inspect('files')
    await inspector.toggleInspector()
    await inspector.toggleInspector()
    finish(['stale.txt'])
    await opening
    expect(inspector.panel.value).toBe('files')
    expect(inspector.fileList.value).toEqual(['src/app.ts', 'empty.txt'])
    expect(inspector.inspectorPending.value).toBe(false)
  })
  it('does not load an inspector before selecting a session', async () => {
    const { inspector, gateway, sessionId } = fixture()
    sessionId.value = ''
    await inspector.toggleInspector()
    expect(inspector.panel.value).toBeNull()
    expect(gateway.changes).not.toHaveBeenCalled()
  })
  it('aggregates a file from its first before-content to its latest after-content', async () => {
    const { inspector, gateway } = fixture()
    await inspector.inspect('changes')
    expect(inspector.selectedChange.value).toMatchObject({
      id: 'last',
      before: 'original',
      after: 'final',
    })
    expect(gateway.change).toHaveBeenCalledTimes(2)
  })
  it('a slower file response cannot replace the selected file, including empty files', async () => {
    const { inspector, gateway } = fixture()
    await inspector.inspect('files')
    let finish!: (text: string) => void
    gateway.read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const first = inspector.readFile('src/app.ts')
    gateway.read.mockResolvedValueOnce('')
    await inspector.readFile('empty.txt')
    finish('stale')
    await first
    expect(inspector.filePath.value).toBe('empty.txt')
    expect(inspector.fileContent.value).toBe('')
    expect(inspector.inspectorPending.value).toBe(false)
  })
  it('closing or switching sessions invalidates outstanding inspector responses', async () => {
    const { inspector, gateway, sessionId } = fixture()
    await inspector.inspect('files')
    let finish!: (text: string) => void
    gateway.read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const reading = inspector.readFile('src/app.ts')
    sessionId.value = 'other'
    inspector.resetInspector()
    finish('old session contents')
    await reading
    expect(inspector.fileContent.value).toBeNull()
    expect(inspector.panel.value).toBeNull()
  })
  it.each(['resolve', 'reject'] as const)(
    'a late %s while opening a preview cannot replace a newer file selection',
    async (outcome) => {
      const { inspector, gateway } = fixture()
      let finish!: (paths: string[]) => void
      let fail!: (error: Error) => void
      gateway.files.mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            finish = resolve
            fail = reject
          }),
      )
      const opening = inspector.previewFile('src/app.ts')
      gateway.read.mockResolvedValueOnce('new selection')
      await inspector.previewFile('empty.txt')
      if (outcome === 'resolve') finish(['src/app.ts', 'empty.txt'])
      else fail(new Error('old listing failed'))
      await opening
      expect(inspector.filePath.value).toBe('empty.txt')
      expect(inspector.fileContent.value).toBe('new selection')
      expect(inspector.inspectorError.value).toBeNull()
      expect(gateway.read).toHaveBeenCalledTimes(1)
      inspector.resetInspector()
    },
  )
  it('a pending preview cannot reopen its file after closing and reopening the panel', async () => {
    const { inspector, gateway } = fixture()
    let finish!: (paths: string[]) => void
    gateway.files.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const opening = inspector.previewFile('src/app.ts')
    await inspector.toggleInspector()
    await inspector.toggleInspector()
    finish(['src/app.ts'])
    await opening
    expect(inspector.panel.value).toBe('files')
    expect(inspector.filePath.value).toBe('')
    expect(inspector.fileContent.value).toBeNull()
    expect(gateway.read).not.toHaveBeenCalled()
    inspector.resetInspector()
  })
  it('keeps the requested preview when a background refresh arrives during opening', async () => {
    const { inspector, gateway } = fixture()
    let finish!: (paths: string[]) => void
    gateway.files.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const opening = inspector.previewFile('src/app.ts')
    await inspector.refreshInspector()
    finish(['src/app.ts'])
    await opening
    expect(inspector.filePath.value).toBe('src/app.ts')
    expect(inspector.fileContent.value).toBe('content')
    expect(gateway.files).toHaveBeenCalledTimes(2)
    expect(gateway.read).toHaveBeenCalledWith('s', 'src/app.ts')
    inspector.resetInspector()
  })
  it('opens the requested preview normally when no newer action supersedes it', async () => {
    const { inspector, gateway } = fixture()
    await inspector.previewFile('src/app.ts')
    expect(inspector.panel.value).toBe('files')
    expect(inspector.filePath.value).toBe('src/app.ts')
    expect(inspector.fileContent.value).toBe('content')
    expect(gateway.read).toHaveBeenCalledWith('s', 'src/app.ts')
    inspector.resetInspector()
  })
  it('a failed read stays within the inspector and a new selection recovers', async () => {
    const { inspector, gateway } = fixture()
    await inspector.inspect('files')
    gateway.read.mockRejectedValueOnce(new Error('binary file'))
    await inspector.readFile('binary')
    expect(inspector.inspectorError.value).toBe('binary file')
    await inspector.readFile('src/app.ts')
    expect(inspector.inspectorError.value).toBeNull()
  })
})
