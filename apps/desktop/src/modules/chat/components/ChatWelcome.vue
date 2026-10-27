<script setup lang="ts">
import StudioIcon from '../../../shared/components/StudioIcon.vue'
import { RouterLink } from 'vue-router'

defineEmits<{ image: [value: string] }>()
</script>

<template>
  <section class="chat-welcome" aria-label="欢迎使用 Ownloom">
    <h1>今天，我们来做点什么？</h1>
    <p>让灵感在你的设备上发生。</p>
    <div class="welcome-suggestions" aria-label="创作入口">
      <button
        class="example-card"
        @click="$emit('image', '生成一张壮丽的山湖风景图，日落时分，雪山倒映在宁静的湖面上。')"
      >
        <StudioIcon name="image" :size="16" />创作一张图片
      </button>
      <RouterLink class="example-card" to="/coding">
        <StudioIcon name="code" :size="16" />帮我写代码
      </RouterLink>
      <RouterLink class="example-card" to="/audio-studio">
        <StudioIcon name="audio" :size="16" />创作一段语音
      </RouterLink>
    </div>
  </section>
</template>

<style scoped src="./ChatWelcome.styles.css"></style>
