import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { installWorkspaces } from './app/composition-root'
import { router } from './app/router'
import './app/theme.css'

installWorkspaces()
createApp(App).use(createPinia()).use(router).mount('#app')
