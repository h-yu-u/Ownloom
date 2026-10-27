<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import PageHeader from '../../../shared/ui/PageHeader.vue'
import { TextAssistant } from '../../../capabilities/extensions'
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { NAlert, NButton, NTabPane, NTabs, useMessage } from 'naive-ui'
import { useAudioStudioStore } from '../stores/audio-studio.store'
import SpeechEditor from '../components/SpeechEditor.vue'
import AudioPlayer from '../components/AudioPlayer.vue'
import VoiceLibrary from '../components/VoiceLibrary.vue'
import AudioHistory from '../components/AudioHistory.vue'
import { runtimeConnectionStatus } from '../../../platform/runtime-bridge'
import { exportFeedback } from '../../../shared/lib/file-export'
import type { AudioArtifact } from '../application/ports'
const store = useAudioStudioStore()
const tab = ref('create'),
  message = useMessage()
const voiceIntent = ref<{ flowId: string; revision: number } | null>(null)
const createdVoice = ref<string | null>(null)
let voiceRevision = 0,
  alive = true
watch(
  () => [store.form.mode, store.form.voiceId],
  () => {
    voiceRevision++
  },
  { flush: 'sync' },
)
watch(
  tab,
  (value) => {
    if (value !== 'voices') voiceIntent.value = null
  },
  { flush: 'sync' },
)
function openVoiceLibrary(): void {
  voiceIntent.value =
    store.form.mode === 'clone' ? { flowId: crypto.randomUUID(), revision: voiceRevision } : null
  tab.value = 'voices'
}
async function saveVoice(): Promise<void> {
  const intent = voiceIntent.value
  const voice = await store.library.save()
  if (!voice) return
  createdVoice.value = voice.id
  if (
    alive &&
    intent &&
    voiceIntent.value?.flowId === intent.flowId &&
    voiceRevision === intent.revision &&
    store.form.mode === 'clone' &&
    tab.value === 'voices'
  ) {
    store.form.voiceId = voice.id
    tab.value = 'create'
  }
}
function useCreatedVoice(): void {
  if (createdVoice.value && store.form.mode === 'clone') {
    store.form.voiceId = createdVoice.value
    tab.value = 'create'
  }
}
async function save(id: string): Promise<void> {
  const feedback = exportFeedback(await store.save(id))
  if (feedback && alive) message[feedback.type](feedback.message)
}
let reconnect = false
const route = useRoute(),
  router = useRouter()
async function remove(id: string): Promise<void> {
  if ((await store.remove(id)) && route.query.artifactId === id)
    await router.replace({ query: { ...route.query, artifactId: undefined } })
}
onMounted(() => {
  void store.loadWorkspace()
  const id = route.query.artifactId
  if (typeof id === 'string') void store.select(id)
})
watch(
  () => route.query.artifactId,
  (id) => {
    if (typeof id === 'string') void store.select(id)
  },
)
onUnmounted(() => {
  alive = false
  voiceIntent.value = null
  store.dispose()
})
watch(runtimeConnectionStatus, (status) => {
  if (status !== 'ready') {
    reconnect = true
    store.dispose()
  } else if (reconnect) {
    reconnect = false
    void store.loadWorkspace()
  }
})
function select(id: string): void {
  tab.value = 'create'
  void store.select(id)
}
function reuse(item: AudioArtifact): void {
  store.reuse(item)
  tab.value = 'create'
}
</script>
<template>
  <section class="page-content audio-page">
    <PageHeader title="语音创作" subtitle="用文字表达，让熟悉的声音讲述。"
      ><template #actions
        ><RouterLink to="/models"><NButton>管理语音模型</NButton></RouterLink></template
      ></PageHeader
    >
    <NAlert v-if="store.error" type="error" class="audio-notice">{{ store.error }}</NAlert>
    <NAlert v-if="store.loading" type="info" class="audio-notice">正在读取模型、音色与作品…</NAlert>
    <NAlert v-if="store.detailError" type="error"
      >{{ store.detailError
      }}<NButton @click="store.selectedId && store.select(store.selectedId)"
        >重试详情</NButton
      ></NAlert
    >
    <NAlert v-if="store.selectedId && store.mediaErrors[store.selectedId]" type="warning">{{
      store.mediaErrors[store.selectedId]
    }}</NAlert>
    <NAlert v-if="store.restoreCandidate" type="warning"
      >恢复期间输入已改变，作品参数已保留为候选。<NButton @click="store.applyRestoreCandidate"
        >应用这份作品参数</NButton
      ></NAlert
    >
    <NAlert v-for="(notice, index) in store.restoreAdjustments" :key="index" type="warning">{{
      notice.message
    }}</NAlert>
    <NButton v-if="store.voiceChange && !store.voiceConfirmed" @click="store.voiceConfirmed = true"
      >确认使用当前音色版本</NButton
    >
    <NAlert
      v-if="
        store.activeJob?.state === 'succeeded' &&
        store.activeJob.artifact_id &&
        store.activeJob.artifact_id !== store.selectedId
      "
      type="info"
      >新作品已生成。<NButton @click="store.select(store.activeJob!.artifact_id!)"
        >查看新作品</NButton
      ></NAlert
    >
    <NTabs v-model:value="tab" type="line" animated>
      <NTabPane name="create" tab="创作">
        <NAlert v-if="!store.speechModels.length" type="info" class="audio-notice"
          >没有支持此模式的完整语音模型，请在模型库下载或导入 Qwen3-TTS Base / CustomVoice。</NAlert
        >
        <TextAssistant
          workspace="audio"
          target-key="audio:current:speechText"
          :text="store.form.text"
          :disabled="store.busy || store.submitting"
          @apply="store.form = { ...store.form, text: $event }"
        />
        <div class="audio-creation">
          <SpeechEditor
            v-model:form="store.form"
            :models="store.speechModels"
            :voices="store.voices"
            :locked="store.busy || store.submitting"
            :submitting="store.submitting"
            :readiness="store.readiness"
            @generate="store.generate"
            @library="openVoiceLibrary"
          />
          <AudioPlayer
            :artifact="store.selectedArtifact"
            :url="store.selectedId ? store.urls[store.selectedId] : undefined"
            :job="store.activeJob"
            :busy="store.busy"
            :cancelling="store.cancelling"
            :saving="!!store.savingId"
            :sync-error="store.syncError"
            @cancel="store.cancel"
            @save="store.selectedId && save(store.selectedId)"
            @reuse="store.selectedArtifact && store.reuse(store.selectedArtifact)"
            @retry="store.selectedId && store.select(store.selectedId)"
            @reconnect="store.refreshJob"
          />
        </div>
      </NTabPane>
      <NTabPane name="voices" tab="音色库">
        <NButton v-if="createdVoice && store.form.mode === 'clone'" @click="useCreatedVoice"
          >将新音色用于当前创作</NButton
        >
        <VoiceLibrary
          v-model:form="store.library.form"
          v-model:consent="store.library.consent"
          :reference="store.library.reference"
          :save-label="voiceIntent ? '保存并用于当前草稿' : '保存音色'"
          :voices="store.voices"
          :loose-references="store.library.looseReferences"
          :urls="store.library.urls"
          :busy="store.library.busy"
          :error="store.library.error"
          :cleanup-error="store.library.cleanupError"
          :update-request="store.library.update"
          @upload="store.library.upload"
          @save="saveVoice"
          @preview="store.library.preview"
          @remove="store.library.remove"
          @cleanup="store.library.retryCleanup"
          @remove-reference="store.library.removeReference"
        />
      </NTabPane>
      <NTabPane name="works" tab="作品">
        <AudioHistory
          :artifacts="store.artifacts"
          :error="store.historyError"
          :saving-by-id="store.savingById"
          :loading="store.historyLoading"
          :has-more="store.hasMore"
          :busy="store.busy"
          @select="select"
          @reuse="reuse"
          @save="save"
          @remove="remove"
          @more="store.loadHistory(false)"
          @refresh="store.loadHistory(true)"
        />
      </NTabPane>
    </NTabs>
  </section>
</template>
<style scoped>
.audio-creation {
  display: grid;
  grid-template-columns: minmax(320px, 1fr) minmax(320px, 1fr);
  gap: 20px;
  align-items: start;
}
.audio-notice {
  margin-bottom: 16px;
}
@media (max-width: 960px) {
  .audio-creation {
    grid-template-columns: 1fr;
  }
}
</style>
