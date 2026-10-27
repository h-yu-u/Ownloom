import { expect, it } from 'vitest'
import { fileTree, latestChanges } from './inspector'
it('builds stable directory keys, filters full paths, and leaves input intact', () => {
  const paths = ['z.ts', 'src/中文.ts', 'src/app.ts', 'src/app.ts']
  const before = [...paths]
  const tree = fileTree(paths)
  expect(tree.map((node) => node.key)).toEqual(['src', 'z.ts'])
  expect(tree[0]?.children?.map((node) => node.key)).toContain('src/中文.ts')
  expect(fileTree(paths, '中文')[0]?.children).toHaveLength(1)
  expect(paths).toEqual(before)
})
it('shows one latest active version per path after an undo', () => {
  const changes = [
    { path: 'a', restored: false, id: 1 },
    { path: 'a', restored: false, id: 2 },
    { path: 'a', restored: true, id: 3 },
  ]
  expect(latestChanges(changes)).toEqual([changes[1]])
})
