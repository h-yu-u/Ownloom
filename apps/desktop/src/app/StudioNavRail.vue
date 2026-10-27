<script setup lang="ts">
import { useRoute } from 'vue-router'
import { TaskCenter } from '../capabilities/tasks'
const route = useRoute()
import StudioIcon from '../shared/components/StudioIcon.vue'
const links = [
  { to: '/chat', icon: 'chat', label: '聊天' },
  { to: '/coding', icon: 'code', label: 'Coding' },
  { to: '/models', icon: 'cube', label: '模型库' },
  { to: '/image-studio', icon: 'image', label: '图片创作' },
  { to: '/audio-studio', icon: 'audio', label: '语音创作' },
  { to: '/settings', icon: 'settings', label: '设置' },
]
</script>
<template>
  <nav class="icon-rail" aria-label="主导航">
    <RouterLink to="/chat" class="rail-brand" aria-label="Ownloom 首页">
      <img src="/ownloom.svg" alt="" width="32" height="32" />
    </RouterLink>
    <RouterLink
      v-for="link in links"
      :key="link.to"
      class="rail-link"
      :class="{ selected: route.meta.navKey === link.to.slice(1) }"
      :to="link.to"
      :title="link.label"
      :aria-label="link.label"
      ><StudioIcon :name="link.icon" :size="21"
    /></RouterLink>
    <div class="rail-tasks"><TaskCenter /></div>
  </nav>
</template>
<style scoped>
.icon-rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 16px 6px;
  color: var(--text-tertiary);
}
.rail-brand,
.rail-link {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 11px;
  text-decoration: none;
}
.rail-brand {
  color: var(--text-primary);
  margin-bottom: 10px;
}
.rail-link:hover,
.rail-link.router-link-active,
.rail-link.selected {
  background: var(--surface-card);
  color: var(--text-primary);
}
.rail-tasks {
  margin-top: auto;
}
@media (max-width: 680px) {
  .icon-rail {
    flex-direction: row;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--line);
  }
  .rail-brand {
    margin: 0 auto 0 0;
  }
  .rail-tasks {
    margin-top: 0;
  }
}
@media (max-width: 400px) {
  .icon-rail {
    gap: 4px;
    padding-inline: 8px;
  }
  .rail-brand,
  .rail-link {
    width: 34px;
  }
}
</style>
