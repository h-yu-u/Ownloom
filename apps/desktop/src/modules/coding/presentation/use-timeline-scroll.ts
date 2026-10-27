import { nextTick, onMounted, ref, watch, type WatchSource } from 'vue'
import { useScroll } from '@vueuse/core'

export function useTimelineScroll(source: WatchSource<unknown>) {
  const scroller = ref<HTMLElement | null>(null)
  const { arrivedState } = useScroll(scroller, { offset: { bottom: 48 } })
  async function bottom(): Promise<void> {
    await nextTick()
    if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight
  }
  onMounted(() => {
    void bottom()
  })
  watch(source, () => {
    if (arrivedState.bottom) void bottom()
  })
  return scroller
}
