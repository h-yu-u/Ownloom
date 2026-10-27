<script setup lang="ts">
import { NButton } from 'naive-ui'
import { ref } from 'vue'
import { externalWebUrl, openWebUrl } from '../../../platform/external-links'
import type { MessageSource } from '../domain/message-source'
defineProps<{ sources: readonly MessageSource[]; prefix: string }>()
defineEmits<{ preview: [source: MessageSource] }>()
const list = ref<HTMLElement | null>(null)
const linkError = ref('')
function reveal(id: string): void {
  const item = [...(list.value?.querySelectorAll<HTMLElement>('[data-source-id]') ?? [])].find(
    (node) => node.dataset.sourceId === id,
  )
  if (!item) return
  item.scrollIntoView({ block: 'nearest' })
  item.focus({ preventScroll: true })
}
async function open(url: string): Promise<void> {
  linkError.value = ''
  try {
    await openWebUrl(url)
  } catch (cause) {
    linkError.value = cause instanceof Error ? cause.message : '无法打开来源链接，请重试'
  }
}
defineExpose({ reveal })
function sourceTime(value?: string | null): string {
  if (!value) return '未提供'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '未提供'
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.replaceAll('-', '/')
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(value.length > 10 ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
  }).format(date)
}
</script>
<template>
  <aside v-if="sources.length" class="message-sources" aria-label="参考来源">
    <strong>参考来源</strong>
    <ul ref="list">
      <li
        v-for="source in sources"
        :id="`${prefix}${source.id}`"
        :key="source.id"
        :data-source-id="source.id"
        tabindex="-1"
      >
        <template v-if="source.kind === 'web'">
          <a
            :href="externalWebUrl(source.url)"
            target="_blank"
            rel="noopener noreferrer"
            @click.prevent="open(source.url)"
            >[{{ source.id }}] {{ source.title }}</a
          >
          <small
            >{{
              source.representation === 'snippet_only' ? '仅搜索摘要 · 未读取全文' : '网页摘录'
            }}
            · 发布/更新 {{ sourceTime(source.publishedAt) }} · 检索
            {{ sourceTime(source.retrievedAt) }}</small
          >
        </template>
        <template v-else>
          <NButton text @click="$emit('preview', source)"
            >[{{ source.id }}] {{ source.originalName }}</NButton
          >
          <small
            >{{ source.coverage?.complete ? '已覆盖所选内容' : '仅覆盖部分内容' }} ·
            {{
              source.locations
                ?.map((location) =>
                  location.page ? `第 ${location.page} 页` : location.section || location.blockId,
                )
                .filter((value, index, list) => list.indexOf(value) === index)
                .join('、')
            }}</small
          >
        </template>
      </li>
    </ul>
    <p v-if="linkError" role="alert">{{ linkError }}</p>
  </aside>
</template>
<style scoped>
.message-sources {
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px solid var(--line);
  font-size: 12px;
}
ul {
  list-style: none;
  padding: 0;
  display: grid;
  gap: 10px;
}
li {
  display: grid;
  gap: 4px;
  overflow-wrap: anywhere;
}
li:focus {
  outline: 1px solid var(--accent);
  outline-offset: 4px;
  border-radius: 4px;
}
p[role='alert'] {
  color: var(--status-error);
}
small {
  color: var(--muted);
}
a {
  color: var(--accent);
}
</style>
