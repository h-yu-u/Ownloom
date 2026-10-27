<script setup lang="ts">
import { NAlert, NButton, NEmpty, NSpin } from 'naive-ui'
import type { ListPhase } from './resource-list.types'
defineProps<{
  phase: ListPhase
  error?: string | null
  hasMore: boolean
  emptyTitle: string
  emptyDescription?: string
}>()
const emit = defineEmits<{ retry: []; loadMore: [] }>()
</script>
<template>
  <section>
    <slot name="header" />
    <NSpin v-if="phase === 'initial-loading'" aria-label="正在读取列表" />
    <NAlert v-else-if="phase === 'initial-error'" type="error"
      >{{ error }}<NButton text @click="emit('retry')">重试</NButton></NAlert
    >
    <NEmpty v-else-if="phase === 'empty'" :description="emptyTitle"
      ><p v-if="emptyDescription">{{ emptyDescription }}</p>
      <slot name="empty-action"
    /></NEmpty>
    <slot v-else />
    <NAlert v-if="phase === 'more-error'" type="warning"
      >{{ error }}<NButton text @click="emit('retry')">重试</NButton></NAlert
    >
    <NButton
      v-if="hasMore"
      :loading="phase === 'loading-more' || phase === 'refreshing'"
      @click="emit('loadMore')"
      >加载更多</NButton
    >
  </section>
</template>
