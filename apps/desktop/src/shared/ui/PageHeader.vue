<script setup lang="ts">
defineProps<{ title: string; subtitle?: string }>()
</script>
<template>
  <header class="page-header">
    <div class="heading-content">
      <slot name="eyebrow" />
      <h1 class="page-title">{{ title }}</h1>
      <p v-if="subtitle" class="page-subtitle">{{ subtitle }}</p>
      <slot name="status" />
    </div>
    <div v-if="$slots.actions" class="header-actions"><slot name="actions" /></div>
  </header>
</template>
<style scoped>
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
  margin-bottom: 24px;
  min-width: 0;
}
.heading-content {
  min-width: 0;
  flex: 1 1 260px;
  overflow-wrap: anywhere;
}
.header-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.page-subtitle {
  margin-bottom: 0;
}
@media (max-width: 680px) {
  .page-header {
    align-items: start;
  }
}
</style>
