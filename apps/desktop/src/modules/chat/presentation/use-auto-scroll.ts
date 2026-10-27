import { useMutationObserver, useRafFn } from '@vueuse/core'
import { onBeforeUnmount, watch, type Ref } from 'vue'
export function useAutoScroll(target: Ref<HTMLElement | null>): void {
  let following = true
  const scrolled = (): void => {
    const node = target.value
    if (node) following = node.scrollHeight - node.scrollTop - node.clientHeight < 48
  }
  const stopTarget = watch(target, (node, previous) => {
    previous?.removeEventListener('scroll', scrolled)
    node?.addEventListener('scroll', scrolled, { passive: true })
  })
  const { pause, resume } = useRafFn(
    () => {
      if (following && target.value) target.value.scrollTop = target.value.scrollHeight
    },
    { immediate: false, once: true },
  )
  useMutationObserver(target, () => following && resume(), {
    childList: true,
    subtree: true,
    characterData: true,
  })
  onBeforeUnmount(() => {
    stopTarget()
    pause()
    target.value?.removeEventListener('scroll', scrolled)
  })
}
