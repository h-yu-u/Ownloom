export type InspectorPanel = 'changes' | 'files'
export type FileTreeNode = {
  key: string
  label: string
  isLeaf: boolean
  children?: FileTreeNode[]
}

export function fileTree(paths: readonly string[], query = ''): FileTreeNode[] {
  const roots: FileTreeNode[] = []
  const nodes = new Map<string, FileTreeNode>()
  for (const path of [...new Set(paths)].sort()) {
    if (!path.toLowerCase().includes(query.trim().toLowerCase())) continue
    const parts = path.split('/').filter(Boolean)
    let siblings = roots
    for (const [index, label] of parts.entries()) {
      const key = parts.slice(0, index + 1).join('/')
      let node = nodes.get(key)
      if (!node) {
        const isLeaf = index === parts.length - 1
        node = { key, label, isLeaf, ...(isLeaf ? {} : { children: [] }) }
        nodes.set(key, node)
        siblings.push(node)
      }
      siblings = node.children ?? []
    }
  }
  function sort(items: FileTreeNode[]): FileTreeNode[] {
    return items
      .sort((a, b) => Number(a.isLeaf) - Number(b.isLeaf) || a.label.localeCompare(b.label))
      .map((node) => (node.children ? { ...node, children: sort(node.children) } : node))
  }
  return sort(roots)
}

export function latestChanges<T extends { path: string; restored: boolean }>(
  changes: readonly T[],
): T[] {
  const files = new Map<string, T>()
  for (const change of changes) if (!change.restored) files.set(change.path, change)
  return [...files.values()].sort((a, b) => a.path.localeCompare(b.path))
}
