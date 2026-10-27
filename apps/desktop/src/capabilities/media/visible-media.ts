import type { ObjectDirective } from 'vue'

export function visibleMedia(
  needsRead: (id: string) => boolean,
  request: (id: string) => void,
  release?: (id: string) => void,
): ObjectDirective<HTMLElement, string> {
  const visible = new Set<string>(),
    observers = new WeakMap<HTMLElement, IntersectionObserver>()
  return {
    mounted(element, binding) {
      if (typeof IntersectionObserver === 'undefined') {
        visible.add(binding.value)
        request(binding.value)
        return
      }
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry?.isIntersecting) {
            visible.add(binding.value)
            request(binding.value)
          } else if (visible.delete(binding.value)) release?.(binding.value)
        },
        { rootMargin: '200px' },
      )
      observer.observe(element)
      observers.set(element, observer)
    },
    updated(_element, binding) {
      if (visible.has(binding.value) && needsRead(binding.value)) request(binding.value)
    },
    unmounted(element, binding) {
      observers.get(element)?.disconnect()
      if (visible.delete(binding.value)) release?.(binding.value)
    },
  }
}
