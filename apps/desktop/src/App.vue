<script setup lang="ts">
import { computed } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import AppProviders from './app/AppProviders.vue'
import StudioNavRail from './app/StudioNavRail.vue'
import ChatSidebar from './modules/chat/presentation/ChatSidebar.vue'
import { RuntimeStatusBanner as RuntimeStatus } from './capabilities/runtime'

const route = useRoute()
const showConversations = computed(() => route.meta.workspace === 'chat')
</script>

<template>
  <AppProviders>
    <div class="app-shell" :class="{ 'has-chat-sidebar': showConversations }">
      <StudioNavRail />
      <ChatSidebar v-if="showConversations" :show-conversations="true" />
      <main class="main-area">
        <header v-if="!route.meta.workspace" class="topbar">
          <span>你的本地 AI 工作台</span><RuntimeStatus />
        </header>
        <RouterView />
      </main>
    </div>
  </AppProviders>
</template>

<style scoped src="./App.styles.css"></style>
