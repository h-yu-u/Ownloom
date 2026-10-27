<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { NButton, NImage } from 'naive-ui'
import { MediaCache } from '../media-cache'
import AssetPickerDialog from './AssetPickerDialog.vue'
import { createMediaAssets } from '../configuration'
import type { AssetOptionView } from '../application/asset-catalog'
import { prepareImageReference } from '../application/prepare-image-reference'
const props = defineProps<{
  kind: 'voice' | 'image' | 'mask'
  ids: readonly string[]
  targetKey: string
  disabled?: boolean
}>()
const emit = defineEmits<{ change: [ids: string[]] }>()
const gateway = createMediaAssets(),
  show = ref(false),
  options = ref<AssetOptionView[]>([]),
  selected = ref<string | null>(null),
  loading = ref(false),
  pending = ref(false),
  error = ref(''),
  hasMore = ref(false)
const previewUrls = ref<Record<string, string>>({}),
  voiceAssets = new Map<string, string>()
const previews = new MediaCache(
  (key) =>
    key.startsWith('voice:')
      ? gateway.voiceContent(key.slice(6))
      : gateway.imageContent(key.slice(6)),
  () => {
    previewUrls.value = previews.snapshot()
  },
  2,
)
const names = ref<Record<string, string>>({})
watch(selected, (value) => {
  if (!value) return
  const option = options.value.find((item) => item.key === value)
  const key =
    option?.selection.kind === 'voice'
      ? `voice:${voiceAssets.get(option.selection.voiceId) ?? ''}`
      : value.startsWith('artifact:')
        ? `image:${value.slice(9)}`
        : ''
  const owner = epoch
  if (key)
    void previews.get(key).catch(() => {
      if (owner === epoch) error.value = '预览读取失败，仍可重试选择资产'
    })
})
function previewKey(option: AssetOptionView): string {
  return option.selection.kind === 'voice'
    ? `voice:${voiceAssets.get(option.selection.voiceId) ?? ''}`
    : option.key.startsWith('artifact:')
      ? `image:${option.key.slice(9)}`
      : ''
}
const summary = computed(() =>
  props.ids
    .map(
      (id, index) =>
        names.value[id] ?? (props.kind === 'voice' ? '已选择音色' : `引用 ${index + 1}`),
    )
    .join('、'),
)
let epoch = 0,
  revision = 0,
  offset = 0
let captured: { target: string; revision: number } | undefined
let uploadIdentity:
  | { uploadId: string; draftId: string; revision: number; artifactId: string }
  | undefined
watch(
  () => [props.targetKey, ...props.ids],
  () => {
    revision++
    if (show.value) close()
    void metadata()
  },
  { flush: 'sync' },
)
async function metadata(): Promise<void> {
  if (props.kind === 'voice') return
  const owner = epoch
  await Promise.allSettled(
    props.ids.map(async (id) => {
      const item = await gateway.metadata(id)
      if (owner === epoch) names.value[id] = item.originalName
    }),
  )
}
async function load(reset = true): Promise<void> {
  const owner = epoch
  loading.value = true
  error.value = ''
  try {
    if (props.kind === 'voice') {
      const voices = await gateway.voices()
      if (owner !== epoch) return
      options.value = voices.map((voice) => ({
        key: voice.id,
        name: voice.name,
        description: `${voice.language} · 当前版本 v${voice.version}`,
        selectable: true,
        selection: { kind: 'voice', voiceId: voice.id, displayedVersion: voice.version },
      }))
      for (const voice of voices) {
        names.value[voice.id] = voice.name
        voiceAssets.set(voice.id, voice.reference_asset_id)
      }
    } else if (props.kind === 'image') {
      const page = await gateway.images(reset ? 0 : offset)
      if (owner !== epoch) return
      const next: AssetOptionView[] = page.map((item) => ({
        key: `artifact:${item.id}`,
        name: item.prompt.slice(0, 80),
        description: `${item.width} × ${item.height} · ${item.model_name} · ${new Date(item.created_at * 1000).toLocaleDateString()}`,
        selectable: true,
        selection: { kind: 'image-artifact', artifactId: item.id },
      }))
      options.value = reset ? next : [...options.value, ...next]
      offset = (reset ? 0 : offset) + page.length
      hasMore.value = page.length === 24
    }
  } catch (cause) {
    if (owner === epoch) error.value = cause instanceof Error ? cause.message : '读取资产失败'
  } finally {
    if (owner === epoch) loading.value = false
  }
}
async function open(): Promise<void> {
  epoch++
  show.value = true
  captured = { target: props.targetKey, revision }
  selected.value = null
  options.value = []
  uploadIdentity = undefined
  await metadata()
  await load()
}
function close(): void {
  epoch++
  show.value = false
  pending.value = false
  loading.value = false
  uploadIdentity = undefined
  previews.dispose()
}
function valid(owner: number): boolean {
  return (
    show.value &&
    owner === epoch &&
    captured?.target === props.targetKey &&
    captured.revision === revision
  )
}
function adopt(id: string, name: string, owner: number): void {
  if (!valid(owner)) return
  names.value[id] = name
  emit('change', props.kind === 'image' ? [...new Set([...props.ids, id])] : [id])
  close()
}
async function confirm(): Promise<void> {
  if (pending.value || !selected.value) return
  const option = options.value.find((item) => item.key === selected.value)
  if (!option?.selectable) return
  const owner = epoch
  if (option.selection.kind === 'voice') {
    adopt(option.selection.voiceId, option.name, owner)
    return
  }
  if (option.selection.kind !== 'image-artifact' || props.ids.length >= 10) return
  pending.value = true
  error.value = ''
  uploadIdentity ??= {
    artifactId: option.selection.artifactId,
    uploadId: crypto.randomUUID(),
    draftId: crypto.randomUUID(),
    revision,
  }
  if (uploadIdentity.artifactId !== option.selection.artifactId)
    uploadIdentity = {
      ...uploadIdentity,
      artifactId: option.selection.artifactId,
      uploadId: crypto.randomUUID(),
    }
  try {
    const item = await prepareImageReference(uploadIdentity, gateway)
    adopt(item.id, item.originalName, owner)
  } catch (cause) {
    if (valid(owner)) error.value = cause instanceof Error ? cause.message : '准备引用失败，请重试'
  } finally {
    if (owner === epoch) pending.value = false
  }
}
async function upload(file: File): Promise<void> {
  if (pending.value) return
  if (
    file.size > 20 * 1024 * 1024 ||
    !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
    (props.kind === 'mask' && file.type !== 'image/png')
  ) {
    error.value = '请使用不超过 20 MiB 的图片；遮罩需为 PNG'
    return
  }
  if (props.kind === 'image' && props.ids.length >= 10) {
    error.value = '最多使用 10 张参考图'
    return
  }
  const owner = epoch
  pending.value = true
  const identity = { uploadId: crypto.randomUUID(), draftId: crypto.randomUUID(), revision }
  try {
    const item = await gateway.upload(file, identity)
    adopt(item.id, item.originalName, owner)
  } catch (cause) {
    if (valid(owner)) error.value = cause instanceof Error ? cause.message : '上传失败'
  } finally {
    if (owner === epoch) pending.value = false
  }
}
onUnmounted(close)
void metadata()
</script>
<template>
  <div>
    <p v-if="summary">{{ summary }}</p>
    <NButton
      size="small"
      :disabled="disabled || (kind === 'image' && ids.length >= 10)"
      @click="open"
      >{{
        kind === 'voice' ? '选择参考音色' : kind === 'mask' ? '上传遮罩' : '从作品选择 / 上传参考图'
      }}</NButton
    ><NButton v-if="ids.length" text :disabled="disabled" @click="emit('change', [])"
      >移除选择</NButton
    >
    <AssetPickerDialog
      :show="show"
      :title="
        kind === 'voice'
          ? '选择已保存音色'
          : kind === 'mask'
            ? '选择当前原图的遮罩'
            : '选择图片作品作为参考'
      "
      :options="options"
      :loading="loading"
      :pending="pending"
      :selected-key="selected"
      :has-more="hasMore"
      :error="error"
      :allow-upload="kind !== 'voice'"
      @close="close"
      @select="selected = $event"
      @confirm="confirm"
      @more="load(false)"
      @upload="upload"
      ><template #preview="{ option }"
        ><template v-if="selected === option.key && previewUrls[previewKey(option)]"
          ><audio
            v-if="option.selection.kind === 'voice'"
            :src="previewUrls[previewKey(option)]"
            controls
            aria-label="音色参考试听"
            style="max-width: 160px" /><NImage
            v-else
            :src="previewUrls[previewKey(option)]"
            alt="所选图片作品预览"
            width="64" /></template></template
    ></AssetPickerDialog>
  </div>
</template>
