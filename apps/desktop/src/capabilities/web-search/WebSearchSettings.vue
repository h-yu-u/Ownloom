<script setup lang="ts">
import { onMounted } from 'vue'
import { NAlert, NButton, NCard, NForm, NFormItem, NInput, useMessage } from 'naive-ui'
import FormActionBar from '../../shared/ui/FormActionBar.vue'
import { useWebSearch } from './store'
const web = useWebSearch(),
  message = useMessage()
onMounted(web.load)
async function save(andTest = false): Promise<void> {
  const result = await web.save()
  if (result.kind === 'saved') {
    message.success('联网设置已保存')
    if (andTest) await web.test()
  }
}
</script>
<template>
  <NCard title="联网搜索">
    <p>使用 Tavily 获取参考资料，回答由当前本地模型生成。</p>
    <NForm label-placement="top" @submit.prevent="save()">
      <NFormItem label="Tavily 服务地址"
        ><NInput v-model:value="web.baseUrl" :disabled="web.pending" aria-label="搜索服务地址"
      /></NFormItem>
      <NFormItem
        :label="web.settings?.credentialConfigured ? 'API Key（已保存，留空沿用）' : 'API Key'"
        ><NInput
          v-model:value="web.apiKey"
          type="password"
          autocomplete="off"
          :disabled="web.pending"
          aria-label="搜索 API Key"
      /></NFormItem>
      <NAlert v-if="web.error" type="error">{{ web.error }}</NAlert>
      <NAlert
        v-else-if="web.verification.kind === 'passed' && !web.dirty"
        :type="web.verification.partial ? 'warning' : 'success'"
      >
        <template v-if="web.verification.partial">
          {{
            web.verification.readCount === 0
              ? '搜索服务已连接，当前可使用搜索摘要，暂未取得网页正文。'
              : '搜索服务已连接，部分网页正文暂不可用，已保留搜索摘要。'
          }}
        </template>
        <template v-else>搜索与网页读取测试通过。</template>
      </NAlert>
      <FormActionBar
        :dirty="web.dirty"
        :save-pending="web.savePending"
        :save-disabled-reason="!web.settings ? '请先读取配置' : undefined"
        :test="{
          pending: web.testPending,
          disabledReason: web.dirty
            ? '先保存更改，再测试此配置'
            : !web.settings?.credentialConfigured
              ? '请先保存 API Key'
              : undefined,
        }"
        @save="save()"
        @test="web.test"
        @reset="web.reset"
      />
      <NButton v-if="web.dirty" :disabled="web.pending || !web.settings" @click="save(true)"
        >保存并测试</NButton
      >
    </NForm>
    <p v-if="web.verification.kind !== 'untested'">
      已保存版本 {{ web.verification.revision }} ·
      {{
        web.verification.kind === 'passed'
          ? '此次测试通过'
          : web.verification.kind === 'failed'
            ? '此次测试失败'
            : '正在测试'
      }}<span v-if="web.verification.elapsedMs !== undefined">
        · {{ web.verification.elapsedMs }} ms</span
      >
    </p>
    <p v-else-if="web.settings?.ready">此配置曾通过验证 · 已保存版本 {{ web.settings.revision }}</p>
    <p>搜索关键词会发送给所配置的服务；密钥保存在系统安全存储中。</p>
  </NCard>
</template>
