<script setup lang="ts">
import { computed } from 'vue'
import { artifactLinks } from '../domain/artifact-links'
const props = defineProps<{ data: unknown }>()
const links = computed(() => artifactLinks(props.data))
</script>
<template>
  <div v-if="links.length" style="display: flex; gap: 12px">
    <RouterLink v-for="link in links" :key="link.id" :to="link.path">{{ link.label }}</RouterLink>
  </div>
</template>
