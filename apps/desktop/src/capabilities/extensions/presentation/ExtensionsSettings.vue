<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  NAlert,
  NButton,
  NCard,
  NDrawer,
  NDrawerContent,
  NEmpty,
  NSelect,
  NSpace,
  NSpin,
  NTabs,
  NTabPane,
  NTag,
} from 'naive-ui'
import type { ExtensionServer, McpWriteRequest } from '@mlx-studio/api-client'
import { createExtensionsSettings } from '../configuration'
import { WebSearchSettings } from '../../web-search'
import McpServerForm from './McpServerForm.vue'
const state = createExtensionsSettings(),
  router = useRouter()
defineProps<{ tab: 'skills' | 'mcp' | 'builtin' }>()
const workspaces = ref<('coding' | 'chat' | 'image' | 'audio')[]>(['coding']),
  server = ref<ExtensionServer | null>(null),
  formOpen = ref(false),
  skillOpen = ref(false)
const inventory = computed(() =>
  state.catalog.value?.inventories.find(
    (item) => item.serverId === server.value?.id && item.configRevision === server.value.revision,
  ),
)
function edit(value: ExtensionServer | null): void {
  if (state.editor.locked.value || state.editor.savePending.value) {
    formOpen.value = true
    return
  }
  state.editor.reset()
  server.value = value
  formOpen.value = true
}
async function save(
  body: McpWriteRequest,
): Promise<import('../../../shared/lib/save-outcome').SaveOutcome<ExtensionServer>> {
  const saved = await state.saveServer(body)
  if (saved.kind === 'saved') {
    formOpen.value = false
    if (saved.refreshWarning) state.error.value = saved.refreshWarning
  }
  return saved
}
async function inspect(id: string): Promise<void> {
  await state.inspect(id)
  skillOpen.value = true
}
onMounted(state.load)
onUnmounted(state.dispose)
</script>
<template>
  <section class="page-content">
    <NSpace justify="space-between"
      ><h1>扩展能力</h1>
      <RouterLink to="/settings">返回设置</RouterLink></NSpace
    >
    <p>统一管理技能与工具。配置更新下次任务生效；立即撤销会停止使用该能力的任务。</p>
    <NAlert v-if="state.error.value" type="error" closable @close="state.error.value = ''">{{
      state.error.value
    }}</NAlert>
    <NSpin :show="state.pending.value">
      <NTabs
        :value="tab"
        type="line"
        @update:value="router.replace(`/settings/extensions/${$event}`)"
      >
        <NTabPane name="skills" tab="Skills">
          <NSpace align="center"
            ><NSelect
              v-model:value="workspaces"
              multiple
              style="min-width: 260px"
              :options="[
                { label: 'Coding', value: 'coding' },
                { label: '聊天', value: 'chat' },
                { label: '图片创作', value: 'image' },
                { label: '语音创作', value: 'audio' },
              ]"
              aria-label="导入技能适用工作区"
            /><NButton :disabled="!workspaces.length" @click="state.importSkill(workspaces)"
              >导入本地 Skill</NButton
            ></NSpace
          >
          <p>导入静态文件，不执行安装或 setup。仅支持指令与文本参考资源，脚本执行未接入。</p>
          <NEmpty v-if="!state.catalog.value?.skills.length" description="尚未导入技能" />
          <NCard
            v-for="skill in state.catalog.value?.skills"
            :key="skill.id"
            :title="skill.name"
            size="small"
            style="margin-top: 12px"
          >
            <p>{{ skill.description }}</p>
            <small
              >{{ skill.sourceRef }} · v{{ skill.revision }} ·
              {{ skill.workspaces.join(' / ') }}</small
            >
            <NSpace style="margin-top: 12px"
              ><NTag :type="skill.enabled ? 'success' : 'default'">{{
                skill.enabled ? '已启用' : '已停用'
              }}</NTag
              ><NButton size="small" @click="inspect(skill.id)">查看资源</NButton
              ><NButton size="small" @click="state.importSkill(skill.workspaces, skill)"
                >更新版本</NButton
              ><NButton
                size="small"
                @click="state.toggle(skill.id, skill.revision, !skill.enabled)"
                >{{ skill.enabled ? '下次停用' : '启用' }}</NButton
              ><NButton size="small" type="error" secondary @click="state.revoke(skill.id)"
                >立即撤销</NButton
              ></NSpace
            >
          </NCard>
        </NTabPane>
        <NTabPane name="mcp" tab="MCP 服务">
          <NButton @click="edit(null)">添加 MCP 服务</NButton>
          <p>
            支持本地 stdio 与 Streamable HTTP；OAuth、Prompts、Apps、资源读取和媒体结果尚未开放。
          </p>
          <NEmpty v-if="!state.catalog.value?.servers.length" description="尚未配置 MCP 服务" />
          <NCard
            v-for="item in state.catalog.value?.servers"
            :key="item.id"
            :title="item.name"
            size="small"
            style="margin-top: 12px"
          >
            <p>
              {{ item.transport.type }} · 配置 v{{ item.revision }} ·
              {{ item.credentialConfigured ? '凭据已配置' : '无凭据' }} ·
              {{ item.enabled ? '已启用' : '已停用' }}
            </p>
            <p>
              已授权 {{ item.allowedTools.length }} 个工具 ·
              {{
                state.catalog.value?.inventories.some(
                  (inv) => inv.serverId === item.id && inv.configRevision === item.revision,
                )
                  ? '当前版本已发现工具'
                  : '当前版本待测试'
              }}
            </p>
            <NAlert
              v-if="state.operationRevisions.value[item.id] === item.revision"
              :type="
                state.operations.value[item.id]?.state === 'failed'
                  ? 'error'
                  : state.operations.value[item.id]?.state === 'succeeded'
                    ? 'success'
                    : 'info'
              "
              >{{
                {
                  running: '正在测试此版本',
                  succeeded: '当前版本已发现工具',
                  failed: '此版本测试失败',
                  cancelled: '本次测试已取消',
                  interrupted: '测试已中断',
                }[state.operations.value[item.id]!.state]
              }}<NButton
                v-if="state.operations.value[item.id]?.state === 'running'"
                text
                @click="state.cancelTest"
                >取消本次测试</NButton
              ></NAlert
            >
            <NSpace
              ><NButton
                size="small"
                :disabled="state.operations.value[item.id]?.state === 'running'"
                @click="edit(item)"
                >配置与工具授权</NButton
              ><NButton
                size="small"
                :disabled="state.operation.value?.state === 'running'"
                @click="state.test(item)"
                >测试连接</NButton
              ><NButton size="small" type="error" secondary @click="state.revoke(item.id)"
                >立即撤销</NButton
              ></NSpace
            >
          </NCard>
        </NTabPane>
        <NTabPane name="builtin" tab="内置工具">
          <WebSearchSettings />
          <NCard title="本地图片与语音" style="margin-top: 16px"
            ><p>提示词助手与口播助手使用文字模型整理可编辑草稿，生成继续使用原有图片和语音任务。</p>
            <p>
              Coding 与聊天工具助手可在逐次审批后调用已选择的本地媒体模型；不支持录音转写。
            </p></NCard
          >
        </NTabPane>
      </NTabs>
    </NSpin>
    <NDrawer
      :show="!!state.importPreview.value"
      width="min(680px, 100vw)"
      @update:show="!$event && (state.importPreview.value = null)"
      ><NDrawerContent title="审阅技能导入" closable
        ><template v-if="state.importPreview.value"
          ><NAlert v-if="state.error.value" type="error">{{ state.error.value }}</NAlert>
          <h2>{{ state.importPreview.value.skill.name }}</h2>
          <p>{{ state.importPreview.value.skill.description }}</p>
          <p>适用工作区：{{ state.importPreview.value.skill.workspaces.join(' / ') }}</p>
          <p>
            依赖：{{
              state.importPreview.value.skill.requiredCapabilities.join(' / ') || '未声明工具依赖'
            }}；脚本仅作为静态资源。
          </p>
          <pre style="white-space: pre-wrap">{{ state.importPreview.value.body }}</pre>
          <p v-for="file in state.importPreview.value.skill.files" :key="file.relativePath">
            {{ file.relativePath }} · {{ file.size }} bytes
          </p>
          <NButton type="primary" :loading="state.pending.value" @click="state.publishImport"
            >确认创建受管版本</NButton
          ></template
        ></NDrawerContent
      ></NDrawer
    >
    <NDrawer v-model:show="formOpen" display-directive="show" width="min(560px, 100vw)"
      ><NDrawerContent title="MCP 服务配置" closable
        ><NAlert v-if="state.editor.error.value" type="error">{{ state.editor.error.value }}</NAlert
        ><McpServerForm
          :server="server"
          :inventory="inventory"
          :pending="state.editor.savePending.value"
          :memory="state.editor.drafts"
          :locked="state.editor.locked.value"
          :save-request="save" /></NDrawerContent
    ></NDrawer>
    <NDrawer v-model:show="skillOpen" width="min(680px, 100vw)"
      ><NDrawerContent :title="state.inspection.value?.skill.name" closable
        ><template v-if="state.inspection.value">
          <pre style="white-space: pre-wrap">{{ state.inspection.value.body }}</pre>
          <p v-for="file in state.inspection.value.skill.files" :key="file.relativePath">
            {{ file.relativePath }} · {{ file.size }} bytes
          </p></template
        ></NDrawerContent
      ></NDrawer
    >
  </section>
</template>
