import { useDocumentVisibility, useIntervalFn } from '@vueuse/core'
import { watch } from 'vue'

export function useRuntimePolling(poll: () => Promise<void>): void {
  const visibility = useDocumentVisibility()
  const { pause, resume } = useIntervalFn(
    () => {
      void poll()
    },
    2500,
    { immediate: false },
  )
  watch(
    visibility,
    (state) => {
      if (state === 'visible') {
        void poll()
        resume()
      } else pause()
    },
    { immediate: true },
  )
}
