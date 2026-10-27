<script setup lang="ts">
withDefaults(defineProps<{ name: string; size?: number }>(), { size: 20 })
const paths: Record<string, string> = {
  compose:
    'M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M16 3l5 5M9 15l1-5L19 1l4 4-9 9-5 1Z',
  code: 'm8 5-7 7 7 7m8-14 7 7-7 7m-3-16-2 18',
  tasks: 'M9 5h12M9 12h12M9 19h12M3 4h2v2H3zM3 11h2v2H3zM3 18h2v2H3z',
  audio: 'M4 9v6m4-10v14m4-17v20m4-17v14m4-10v6',
  up: 'M12 19V5m-6 6 6-6 6 6',
  chat: 'M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z',
  cube: 'm12 3 9 5v9l-9 5-9-5V8l9-5Zm0 10 9-5M12 13 3 8m9 5v9M7.5 5.5l9 5',
  image:
    'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm-2 14 5-5 4 4 4-6 5 7M7.5 7.5h.01',
  settings:
    'm9 3-.7 2.5-2 .9L4 5.8 2 9l1.9 1.8v2.4L2 15l2 3.2 2.3-.6 2 .9L9 21h6l.7-2.5 2-.9 2.3.6 2-3.2-1.9-1.8v-2.4L22 9l-2-3.2-2.3.6-2-.9L15 3H9Zm6.5 9a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z',
  monitor: 'M4 3h16a1 1 0 0 1 1 1v13H3V4a1 1 0 0 1 1-1Zm8 14v4m-5 0h10',
  bolt: 'm13 2-9 12h7l-1 8 10-13h-8l1-7Z',
  tool: 'M14 6a6 6 0 0 0-7 7L2 18a3 3 0 0 0 4 4l6-6a6 6 0 0 0 7-8l-4 4-3-3 4-4-2 1Z',
  plus: 'M12 5v14M5 12h14',
  folder: 'M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z',
  'panel-right': 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm10 0v18',
  arrow: 'M5 12h14m-5-5 5 5-5 5',
  chevron: 'm9 5 7 7-7 7',
  down: 'm6 9 6 6 6-6',
  search: 'M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15ZM16 16l5 5',
  pin: 'm16 3 5 5-4 1-3 5-1 4-7-7 4-1 5-3 1-4ZM3 21l6-6',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  copy: 'M9 9h12v12H9zM15 5V3H3v12h2',
  check: 'm5 12 4 4L19 6',
  refresh: 'M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 14 6M4 12a8 8 0 0 0 14 6',
  play: 'm8 5 11 7-11 7V5Z',
  stop: 'M6 6h12v12H6z',
  shield: 'M12 3 3 7v5c0 5 9 10 9 10s9-5 9-10V7l-9-4Z',
  paperclip: 'm8 13 7-7a3 3 0 0 1 4 4l-9 9a5 5 0 0 1-7-7L13 2m-5 11 7-7m-7 7a1.5 1.5 0 0 0 2 2l7-7',
  globe: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z',
  send: 'm22 2-7 20-4-9L2 9l20-7ZM11 13 22 2',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  info: 'M12 11v6m0-10h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
}
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="paths[name] ?? paths.chat" />
  </svg>
</template>
