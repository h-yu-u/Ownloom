<script setup lang="ts">
import { ArtifactLinks } from '../../../capabilities/extensions'
import { computed } from 'vue'
import { NEmpty } from 'naive-ui'
import type { CodingEvent, CodingRun } from '../application/ports'
import { codingRunErrorText } from '../presentation/coding-errors'
import {
  activityText,
  activitySummary,
  activityItemDescription,
  eventError,
  timelineEntries,
} from '../presentation/coding-activity'
import { statusLabel, activeStatus } from '../domain/status'
import MarkdownContent from '../../../shared/ui/MarkdownContent.vue'
import { useMarkdownCopy } from '../../../shared/ui/markdown-copy'
import { copyText } from '../../../platform/clipboard'
import { useTimelineScroll } from '../presentation/use-timeline-scroll'
const { copyState, copyCode } = useMarkdownCopy(copyText)
const props = defineProps<{ events: CodingEvent[]; runs: CodingRun[]; preparing?: boolean }>()
const entries = computed(() => timelineEntries(props.events, props.runs))
const lastRun = computed(() => props.runs.at(-1))
const active = computed(() => props.runs.find((run) => activeStatus(run.status)))
const toolWorking = computed(() =>
  entries.value.some(
    (entry) => entry.kind === 'activity' && entry.items.some((item) => item.status === 'running'),
  ),
)
const scroller = useTimelineScroll(entries)
</script>
<template>
  <section ref="scroller" class="coding-timeline" aria-label="开发任务时间线">
    <NEmpty v-if="!events.length && !preparing" description="描述需要完成的开发任务" />
    <template v-for="entry in entries" :key="entry.kind === 'message' ? entry.key : entry.seq">
      <details v-if="entry.kind === 'activity'" class="coding-activity">
        <summary>
          <span
            v-if="entry.items.some((item) => item.status === 'running')"
            class="activity-spinner"
            aria-hidden="true"
          />
          <span class="activity-description" :title="activitySummary(entry.items)">{{
            activitySummary(entry.items)
          }}</span>
        </summary>
        <details v-for="item in entry.items" :key="item.id" :data-state="item.status">
          <summary>
            <span v-if="item.status === 'running'" class="activity-spinner" aria-hidden="true" />
            <span class="activity-description" :title="activityItemDescription(item)">{{
              activityItemDescription(item)
            }}</span>
          </summary>
          <pre v-if="item.command" class="activity-command" aria-label="执行的命令">{{
            item.command
          }}</pre>
          <pre v-if="activityText(item.event)">{{ activityText(item.event) }}</pre>
          <ArtifactLinks :data="item.event.data" />
        </details>
      </details>
      <article
        v-else
        :class="{ user: ['run.started', 'user.steering'].includes(entry.event.type) }"
      >
        <pre v-if="['run.started', 'user.steering'].includes(entry.event.type)">{{
          entry.event.text
        }}</pre>
        <MarkdownContent
          v-else-if="entry.event.text.trim()"
          :content-id="`${entry.event.sessionId}:${entry.key}`"
          :source="entry.event.text"
          :streaming="entry.event.type === 'assistant.delta'"
          :copy-state="copyState"
          @copy-code="copyCode"
        />
        <details v-if="eventError(entry.event.data)">
          <summary>错误详情</summary>
          <pre>{{ codingRunErrorText(eventError(entry.event.data) ?? '') }}</pre>
        </details>
      </article>
      <!-- eslint-enable vue/no-v-html -->
    </template>
    <footer
      v-if="preparing || (active && (active.status !== 'running' || !toolWorking))"
      class="live-status"
      role="status"
    >
      <span class="activity-spinner" aria-hidden="true" />
      {{
        preparing
          ? '正在准备本地模型'
          : active?.status === 'running'
            ? statusLabel(active.phase)
            : statusLabel(active?.status ?? '')
      }}
    </footer>
    <footer v-else-if="!active && lastRun && lastRun.status !== 'completed'">
      {{ statusLabel(lastRun.status)
      }}<span v-if="lastRun.error"> · {{ codingRunErrorText(lastRun.error) }}</span>
    </footer>
  </section>
</template>
<style scoped>
.coding-timeline {
  flex: 1;
  height: 100%;
  box-sizing: border-box;
  min-height: 0;
  overflow-y: auto;
  padding: 24px clamp(20px, 5%, 64px);
  display: flex;
  flex-direction: column;
  gap: 20px;
}
article {
  max-width: 100%;
  font-size: 14px;
  line-height: 1.7;
}
.user {
  align-self: flex-end;
  max-width: min(85%, 760px);
  border-radius: 16px;
  background: var(--surface-hover);
  padding: 10px 16px;
}
pre {
  font: inherit;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin: 0;
}
.coding-activity {
  color: var(--muted);
  font-size: 12px;
}
.coding-activity summary {
  white-space: nowrap;
}
.activity-description {
  display: inline-block;
  max-width: calc(100% - 30px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: middle;
}
.activity-command {
  margin-bottom: 8px;
}
.coding-activity details {
  margin: 10px 0 0 14px;
}
.coding-activity pre {
  padding: 10px;
  max-height: 260px;
  overflow-y: auto;
  background: var(--surface-sidebar);
  border-radius: 8px;
  font-family: monospace;
}
summary {
  cursor: pointer;
  color: var(--muted);
  font-size: 12px;
}
footer {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--muted);
  font-size: 12px;
}
.activity-spinner {
  display: inline-block;
  width: 9px;
  height: 9px;
  margin-right: 5px;
  border: 1.5px solid var(--line);
  border-top-color: currentColor;
  border-radius: 50%;
  animation: coding-spin 0.9s linear infinite;
}
@keyframes coding-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .activity-spinner {
    animation: none;
  }
}
</style>
