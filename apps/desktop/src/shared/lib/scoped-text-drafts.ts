export interface TextDraftSnapshot {
  readonly key: string
  readonly id: string
  readonly revision: number
  readonly text: string
}
export class ScopedTextDrafts {
  private entries = new Map<string, TextDraftSnapshot>()
  private aliases = new Map<string, string>()
  constructor(
    private readonly changed: () => void = () => {},
    private readonly createId = () => crypto.randomUUID(),
  ) {}
  private key(key: string): string {
    return this.aliases.get(key) ?? key
  }
  get(key: string): TextDraftSnapshot {
    const resolved = this.key(key)
    let value = this.entries.get(resolved)
    if (!value) {
      value = { key: resolved, id: this.createId(), revision: 0, text: '' }
      this.entries.set(resolved, value)
    }
    return value
  }
  edit(key: string, text: string): TextDraftSnapshot {
    const previous = this.get(key)
    if (previous.text === text) return previous
    const value = { ...previous, text, revision: previous.revision + 1 }
    this.entries.set(previous.key, value)
    this.changed()
    return value
  }
  consume(snapshot: TextDraftSnapshot): boolean {
    const key = this.key(snapshot.key),
      current = this.entries.get(key)
    if (!current || current.id !== snapshot.id || current.revision !== snapshot.revision)
      return false
    this.entries.set(key, { ...current, text: '', revision: current.revision + 1 })
    this.changed()
    return true
  }
  bind(
    source: Pick<TextDraftSnapshot, 'key' | 'id'>,
    targetKey: string,
  ): 'bound' | 'target-exists' | 'source-missing' | 'source-replaced' {
    const key = this.key(source.key),
      current = this.entries.get(key)
    if (!current) return 'source-missing'
    if (current.id !== source.id) return 'source-replaced'
    const target = this.entries.get(targetKey)
    if (target && target.id !== current.id) return 'target-exists'
    if (key === targetKey) return 'bound'
    for (const [alias, destination] of this.aliases)
      if (destination === key) this.aliases.set(alias, targetKey)
    this.aliases.set(key, targetKey)
    this.entries.delete(key)
    this.entries.set(targetKey, { ...current, key: targetKey })
    this.changed()
    return 'bound'
  }
  discard(key: string): void {
    const resolved = this.key(key)
    this.entries.delete(resolved)
    for (const [alias, target] of this.aliases) if (target === resolved) this.aliases.delete(alias)
    this.changed()
  }
}
