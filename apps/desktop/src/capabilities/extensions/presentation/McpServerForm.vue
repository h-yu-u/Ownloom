<script setup lang="ts">
import {
  NAlert,
  NButton,
  NCheckbox,
  NCollapse,
  NCollapseItem,
  NForm,
  NFormItem,
  NInput,
  NSelect,
  NSpace,
  NSwitch,
} from 'naive-ui'
import { createMcpForm, type McpFormProps } from './mcp-form-draft'
const props = defineProps<McpFormProps>()
const {
  name,
  type,
  executable,
  args,
  cwd,
  url,
  publicValues,
  enabled,
  credentialAction,
  credentialKind,
  credentialField,
  secret,
  error,
  allowed,
  readOnly,
  discovered,
  importedJson,
  importJson,
  toggle,
  save,
} = createMcpForm(props)
</script>
<template>
  <NForm label-placement="top" :disabled="pending || locked" @submit.prevent="save">
    <NAlert v-if="error" type="error">{{ error }}</NAlert>
    <NCollapse
      ><NCollapseItem title="导入公开配置 JSON" name="json">
        <p>使用本产品的 name、transport、allowedTools 等字段。导入后先审阅表单，凭据单独填写。</p>
        <NInput v-model:value="importedJson" type="textarea" aria-label="公开 MCP 配置 JSON" />
        <NButton :disabled="!importedJson.trim()" @click="importJson">填入表单</NButton>
      </NCollapseItem></NCollapse
    >
    <NFormItem label="服务名称"
      ><NInput v-model:value="name" aria-label="服务名称" :maxlength="80"
    /></NFormItem>
    <NFormItem label="连接方式"
      ><NSelect
        v-model:value="type"
        aria-label="连接方式"
        :options="[
          { label: '本地进程（stdio）', value: 'stdio' },
          { label: '远程 HTTP', value: 'streamable-http' },
        ]"
    /></NFormItem>
    <template v-if="type === 'stdio'">
      <NFormItem label="可执行文件绝对路径"
        ><NInput
          v-model:value="executable"
          aria-label="可执行文件绝对路径"
          placeholder="已安装的服务入口或 Node 路径"
      /></NFormItem>
      <NFormItem label="参数数组（JSON）"
        ><NInput v-model:value="args" aria-label="参数数组" type="textarea"
      /></NFormItem>
      <NFormItem label="工作目录绝对路径"
        ><NInput v-model:value="cwd" aria-label="工作目录"
      /></NFormItem>
    </template>
    <NFormItem v-else label="服务 URL"
      ><NInput v-model:value="url" aria-label="服务 URL" placeholder="https://example.com/mcp"
    /></NFormItem>
    <NFormItem :label="type === 'stdio' ? '公开环境变量（JSON）' : '公开 headers（JSON）'"
      ><NInput v-model:value="publicValues" aria-label="公开配置" type="textarea"
    /></NFormItem>
    <NFormItem :label="server?.credentialConfigured ? '凭据（已配置）' : '凭据'"
      ><NSelect
        v-model:value="credentialAction"
        aria-label="凭据操作"
        :options="[
          { label: '保持现有', value: 'keep' },
          { label: '替换', value: 'replace' },
          { label: '清除指定字段', value: 'clear' },
        ]"
    /></NFormItem>
    <template v-if="credentialAction !== 'keep'">
      <NFormItem label="秘密字段名称"
        ><NInput
          v-model:value="credentialField"
          aria-label="秘密字段名称"
          :placeholder="type === 'stdio' ? 'API_KEY' : 'Authorization'"
      /></NFormItem>
      <template v-if="credentialAction === 'replace'">
        <NFormItem label="认证方式"
          ><NSelect
            v-model:value="credentialKind"
            aria-label="认证方式"
            :options="
              type === 'stdio'
                ? [{ label: '环境变量', value: 'env' }]
                : [
                    { label: 'Bearer', value: 'bearer' },
                    { label: 'API Key', value: 'api-key' },
                  ]
            "
        /></NFormItem>
        <NFormItem label="一次性凭据值"
          ><NInput
            v-model:value="secret"
            aria-label="一次性凭据值"
            type="password"
            show-password-on="click"
            :input-props="{ autocomplete: 'off' }"
        /></NFormItem>
      </template>
    </template>
    <NFormItem label="启用（下次任务生效）"
      ><NSwitch v-model:value="enabled" aria-label="启用服务"
    /></NFormItem>
    <NAlert type="info"
      >保存后测试连接以发现工具，再明确授权工具。只读分类是你的本地授权，请核实服务权限范围；服务自报的提示不授予权限。</NAlert
    >
    <NSpace v-for="tool in discovered" :key="tool.id" align="center" style="margin-top: 8px">
      <NCheckbox
        :checked="allowed.includes(tool.originalName)"
        @update:checked="allowed = toggle(allowed, tool.originalName, $event)"
        >{{ tool.originalName }}</NCheckbox
      >
      <NCheckbox
        :disabled="!allowed.includes(tool.originalName)"
        :checked="readOnly.includes(tool.originalName)"
        @update:checked="readOnly = toggle(readOnly, tool.originalName, $event)"
        >已确认只读</NCheckbox
      >
    </NSpace>
    <NButton
      type="primary"
      attr-type="submit"
      :loading="pending"
      :disabled="pending || (!locked && !name.trim())"
      style="margin-top: 16px"
      >{{ locked ? '恢复提交 / 同步配置' : '保存配置' }}</NButton
    >
  </NForm>
</template>
