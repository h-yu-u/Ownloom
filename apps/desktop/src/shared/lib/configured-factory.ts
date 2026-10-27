/** The composition root registers implementations before a Store is instantiated. */
export function configuredFactory<T>() {
  let factory: (() => T) | undefined
  return {
    configure(next: () => T): void {
      factory = next
    },
    create(): T {
      if (!factory) throw new Error('Workspace dependencies are not configured')
      return factory()
    },
  }
}
