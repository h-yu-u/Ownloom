import { createRouter, createWebHashHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/chat' },
    {
      path: '/chat',
      meta: { workspace: 'chat' },
      component: () => import('../modules/chat/pages/ChatPage.vue'),
    },
    {
      path: '/coding',
      meta: { workspace: 'coding' },
      component: () => import('../modules/coding/pages/CodingPage.vue'),
    },
    {
      path: '/coding/projects/:projectId/sessions/:sessionId',
      meta: { workspace: 'coding' },
      component: () => import('../modules/coding/pages/CodingPage.vue'),
    },
    {
      path: '/agent-chat',
      meta: { navKey: 'chat' },
      props: (route) => ({
        standalone: true,
        initialSessionId:
          typeof route.query.sessionId === 'string' ? route.query.sessionId : undefined,
      }),
      component: () => import('../capabilities/extensions/presentation/AgentChat.vue'),
    },
    { path: '/models', component: () => import('../modules/models/pages/ModelsPage.vue') },
    {
      path: '/image-studio',
      component: () => import('../modules/image-studio/pages/ImageStudioPage.vue'),
    },
    {
      path: '/settings',
      meta: { navKey: 'settings' },
      component: () => import('../modules/settings/pages/SettingsLayout.vue'),
      children: [
        { path: '', component: () => import('../modules/settings/pages/SettingsPage.vue') },
        {
          path: 'coding',
          component: () =>
            import('../capabilities/coding-settings/presentation/CodingSettingsPanel.vue'),
        },
        ...(['skills', 'mcp', 'builtin'] as const).map((tab) => ({
          path: `extensions/${tab}`,
          props: { tab },
          component: () => import('../capabilities/extensions/presentation/ExtensionsSettings.vue'),
        })),
        {
          path: 'runtime',
          component: () => import('../modules/settings/pages/RuntimeSettingsPage.vue'),
        },
        {
          path: 'privacy',
          component: () => import('../modules/settings/pages/PrivacySettingsPage.vue'),
        },
      ],
    },
    {
      path: '/audio-studio',
      component: () => import('../modules/audio-studio/pages/AudioStudioPage.vue'),
    },
  ],
})
