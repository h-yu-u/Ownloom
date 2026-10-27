import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
    proxy: process.env.MLX_STUDIO_DEV_RUNTIME_URL
      ? {
          '/runtime-proxy': {
            target: process.env.MLX_STUDIO_DEV_RUNTIME_URL,
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/runtime-proxy/, ''),
          },
        }
      : undefined,
  },
  clearScreen: false,
  test: { environment: 'jsdom', include: ['src/**/*.spec.ts'] },
})
