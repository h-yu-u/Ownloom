import { nextTick, ref } from 'vue'
import type { NButton, InputInst } from 'naive-ui'

export function useSidebarSearch() {
  const query = ref(''),
    showSearch = ref(false),
    searchInput = ref<InputInst | null>(null),
    searchButton = ref<InstanceType<typeof NButton> | null>(null)

  function closeSearch(restoreFocus = false): void {
    showSearch.value = false
    query.value = ''
    const button = searchButton.value?.$el
    if (restoreFocus && button instanceof HTMLElement) button.focus()
  }
  async function toggleSearch(): Promise<void> {
    if (showSearch.value) closeSearch()
    else {
      showSearch.value = true
      await nextTick()
      searchInput.value?.focus()
    }
  }
  return { query, showSearch, searchInput, searchButton, closeSearch, toggleSearch }
}
