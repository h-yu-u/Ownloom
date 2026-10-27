<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { refThrottled } from '@vueuse/core'
import { renderMarkdown } from '../lib/render-markdown'
import { openWebUrl } from '../../platform/external-links'
import type { CodeCopyIntent, CodeCopyState } from './markdown-copy'
const props = withDefaults(
  defineProps<{
    contentId: string
    source: string
    streaming?: boolean
    citations?: Readonly<Record<string, string>>
    codeCopy?: boolean
    copyState?: CodeCopyState
  }>(),
  { codeCopy: true, citations: undefined, copyState: undefined },
)
const emit = defineEmits<{ copyCode: [intent: CodeCopyIntent]; openCitation: [id: string] }>()
const linkError = ref('')
const source = computed(() => ({ contentId: props.contentId, text: props.source })),
  throttled = refThrottled(source, 100),
  body = ref<HTMLElement | null>(null)
let generation = 0,
  previous = '',
  previousId = ''
watch(
  () => [props.contentId, props.source],
  () => {
    if (props.contentId !== previousId || !props.source.startsWith(previous)) generation++
    previous = props.source
    previousId = props.contentId
  },
  { flush: 'sync', immediate: true },
)
const html = computed(() =>
  renderMarkdown(
    props.streaming && throttled.value.contentId === props.contentId
      ? throttled.value.text
      : props.source,
    props.citations,
  ),
)
function key(index: number, code: string): string {
  return `${generation}:${index}:${code}`
}
watch(
  [html, () => props.copyState, () => props.contentId],
  () => {
    body.value?.querySelectorAll<HTMLButtonElement>('.code-copy').forEach((button, index) => {
      button.hidden = !props.codeCopy
      const text = button.closest('.code-block')?.querySelector('pre > code')?.textContent ?? ''
      const state = props.copyState,
        phase =
          state?.contentId === props.contentId && state.blockKey === key(index, text)
            ? state.phase
            : undefined
      button.textContent =
        phase === 'pending'
          ? '复制中…'
          : phase === 'copied'
            ? '已复制'
            : phase === 'failed'
              ? '复制失败，重试'
              : '复制'
      button.disabled = phase === 'pending'
      button.setAttribute('aria-label', phase ? button.textContent : '复制代码')
    })
  },
  { flush: 'post', immediate: true },
)
function click(event: MouseEvent): void {
  if (!(event.target instanceof Element)) return
  const citation = event.target.closest<HTMLAnchorElement>('a.citation')
  if (citation) {
    event.preventDefault()
    const id = Object.entries(props.citations ?? {}).find(
      ([, href]) => href === citation.getAttribute('href'),
    )?.[0]
    if (id) emit('openCitation', id)
    return
  }
  const link = event.target.closest<HTMLAnchorElement>('a[href]')
  if (link) {
    event.preventDefault()
    linkError.value = ''
    void openWebUrl(link.getAttribute('href') ?? '').catch((cause: unknown) => {
      linkError.value = cause instanceof Error ? cause.message : '无法打开链接，请重试'
    })
    return
  }
  const button = event.target.closest<HTMLButtonElement>('.code-copy')
  if (!props.codeCopy || !button || button.disabled || !body.value?.contains(button)) return
  const code = button.closest('.code-block')?.querySelector('pre > code')
  if (!code) return
  const index = [...body.value.querySelectorAll('.code-copy')].indexOf(button),
    text = code.textContent ?? ''
  emit('copyCode', {
    contentId: props.contentId,
    blockKey: key(index, text),
    requestId: crypto.randomUUID(),
    text,
  })
}
</script>
<template>
  <div class="markdown-content" @click="click">
    <!-- renderMarkdown disables raw HTML and sanitizes the generated markup. -->
    <!-- eslint-disable-next-line vue/no-v-html -->
    <div ref="body" v-html="html" />
    <p v-if="linkError" role="alert">{{ linkError }}</p>
    <p v-if="html.includes('<span class=&quot;citation-unresolved&quot;>')" role="status">
      部分引用无法定位。
    </p>
  </div>
</template>
<style scoped src="./MarkdownContent.styles.css"></style>
