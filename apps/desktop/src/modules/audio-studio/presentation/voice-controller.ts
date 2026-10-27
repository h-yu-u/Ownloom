import { computed, reactive, ref, type Ref } from 'vue'
import type { AudioAsset, AudioGateway, Voice, VoiceInput, VoicePatch } from '../application/ports'
import { MediaCache } from '../../../capabilities/media'

const empty = (): VoiceInput => ({
  name: '',
  reference_asset_id: '',
  reference_text: '',
  language: 'zh',
  source: 'self',
  consent: true,
})
export function createVoiceController(gateway: AudioGateway, voices: Ref<Voice[]>) {
  const form = ref(empty())
  const consent = ref(false)
  const reference = ref<AudioAsset | null>(null)
  const references = ref<AudioAsset[]>([])
  const looseReferences = computed(() =>
    references.value.filter(
      (asset) =>
        asset.id !== reference.value?.id &&
        !voices.value.some((voice) => voice.reference_asset_id === asset.id),
    ),
  )
  const urls = ref<Record<string, string>>({})
  const busy = ref(false)
  const error = ref<string | null>(null)
  const cleanupError = ref<string | null>(null)
  const media = new MediaCache(
    gateway.reference,
    () => {
      urls.value = media.snapshot()
    },
    4,
  )
  let epoch = 0
  let pending: string | undefined
  let saving: string | undefined
  const orphans = new Set<string>()

  async function clean(id: string): Promise<void> {
    try {
      await gateway.deleteAsset(id)
      references.value = references.value.filter((asset) => asset.id !== id)
      orphans.delete(id)
    } catch {
      orphans.add(id)
      cleanupError.value = '有未保存的参考录音未能清除，请重试清理。'
    }
  }
  async function retryCleanup(): Promise<void> {
    cleanupError.value = null
    for (const id of orphans) await clean(id)
  }
  async function perform(run: () => Promise<void>): Promise<void> {
    if (busy.value) return
    const owner = epoch
    busy.value = true
    error.value = null
    try {
      await run()
    } catch (cause) {
      if (owner === epoch) error.value = cause instanceof Error ? cause.message : '音色操作失败'
    } finally {
      if (owner === epoch) busy.value = false
    }
  }
  async function upload(file: File): Promise<void> {
    const owner = epoch
    await perform(async () => {
      if (pending) {
        await clean(pending)
        pending = undefined
      }
      reference.value = null
      form.value.reference_asset_id = ''
      const asset = await gateway.upload(file)
      if (owner !== epoch) {
        await clean(asset.id)
        return
      }
      pending = asset.id
      references.value = [asset, ...references.value]
      reference.value = asset
      form.value.reference_asset_id = asset.id
      form.value.name ||= file.name.replace(/\.wav$/i, '')
      await media.get(asset.id)
    })
  }
  async function save(): Promise<Voice | undefined> {
    let created: Voice | undefined
    const owner = epoch
    await perform(async () => {
      if (
        !consent.value ||
        !form.value.name.trim() ||
        !form.value.reference_text.trim() ||
        !reference.value
      )
        throw new Error('请导入参考音频、填写名称和准确原文，并确认声音授权。')
      const asset = form.value.reference_asset_id
      saving = asset
      let voice: Voice
      try {
        voice = await gateway.createVoice({ ...form.value })
      } catch (cause) {
        if (owner !== epoch) await clean(asset)
        throw cause
      } finally {
        if (saving === asset) saving = undefined
      }
      if (pending === asset) pending = undefined
      created = voice
      voices.value = [voice, ...voices.value.filter((item) => item.id !== voice.id)]
      if (owner !== epoch) return
      reference.value = null
      form.value = empty()
      consent.value = false
    })
    return created
  }
  async function update(id: string, patch: VoicePatch): Promise<boolean> {
    let saved = false
    const owner = epoch
    await perform(async () => {
      const next = await gateway.updateVoice(id, { ...patch })
      saved = true
      if (owner === epoch)
        voices.value = voices.value.map((voice) => (voice.id === id ? next : voice))
    })
    return saved
  }
  async function remove(id: string, complete: boolean): Promise<void> {
    const owner = epoch
    await perform(async () => {
      await gateway.deleteVoice(id, complete)
      if (owner !== epoch) return
      voices.value = voices.value.filter((voice) => voice.id !== id)
      if (complete) {
        const next = await gateway.references()
        if (owner !== epoch) return
        references.value = next
      }
      media.dispose()
    })
  }
  async function preview(id: string): Promise<void> {
    await perform(async () => {
      await media.get(id)
    })
  }
  async function removeReference(id: string): Promise<void> {
    const owner = epoch
    await perform(async () => {
      await gateway.deleteAsset(id)
      if (owner !== epoch) return
      references.value = references.value.filter((asset) => asset.id !== id)
      media.dispose()
    })
  }
  function dispose(): void {
    epoch++
    busy.value = false
    media.dispose()
    if (pending && pending !== saving) {
      void clean(pending)
    }
    pending = undefined
    reference.value = null
    form.value.reference_asset_id = ''
  }
  return reactive({
    form,
    consent,
    reference,
    references,
    looseReferences,
    removeReference,
    urls,
    busy,
    error,
    cleanupError,
    upload,
    save,
    update,
    remove,
    preview,
    retryCleanup,
    dispose,
  })
}
