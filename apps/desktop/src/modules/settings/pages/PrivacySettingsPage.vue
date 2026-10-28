<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { NButton, NAlert, NSpace } from 'naive-ui'
import { createDataManagement } from '../../../capabilities/data'
import PageHeader from '../../../shared/ui/PageHeader.vue'
const data = createDataManagement()
onMounted(data.load)
onBeforeUnmount(data.dispose)
function inspect(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) void data.inspect(file)
}
const size = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`
</script>
<template>
  <section>
    <PageHeader title="隐私与数据" subtitle="了解本机存储与外部服务的数据流向" />
    <p>
      模型推理在本机进行。会话和生成文件保存在本机；日志默认不记录完整提示词、模型输出或附件内容。
    </p>
    <p>
      启用联网搜索后，查询关键词会发送给配置的服务。启用 MCP
      工具后，调用参数和结果会与对应服务交换。请按需要选择能力及逐次授权。
    </p>
    <p>内部 Runtime 仅监听回环地址，桌面会话令牌不落盘。兼容 API 默认关闭。</p>
    <NAlert v-if="data.error.value" type="error">{{ data.error.value }}</NAlert>
    <NAlert v-if="data.notice.value" type="success">{{ data.notice.value }}</NAlert>
    <h2>本机数据</h2>
    <NSpace
      ><NButton :loading="data.pending.value" @click="data.load">刷新占用</NButton>
      <NButton :disabled="data.pending.value" @click="data.backup">导出完整备份</NButton></NSpace
    >
    <h2>恢复备份</h2>
    <p>选择备份进行校验。确认后导入独立资料库，原资料库保留，可撤销切换。生效需要重启应用。</p>
    <label
      >备份文件
      <input
        type="file"
        accept=".zip,application/zip"
        :disabled="data.pending.value"
        @change="inspect"
    /></label>
    <template v-if="data.preview.value">
      <p>{{ data.preview.value.files }} 个文件 · {{ size(data.preview.value.bytes) }}</p>
      <ul>
        <li v-for="warning in data.preview.value.warnings" :key="warning">{{ warning }}</li>
      </ul>
      <NSpace>
        <NButton :disabled="data.pending.value || data.restartRequired.value" @click="data.activate"
          >确认恢复为新资料库</NButton
        >
        <NButton :disabled="data.pending.value" @click="data.cancelPreview">取消预览</NButton>
      </NSpace>
    </template>
    <NSpace
      ><NButton :disabled="data.pending.value" @click="data.rollback">撤销上次资料库切换</NButton>
      <NButton v-if="data.restartRequired.value" @click="data.restart"
        >重启并使用资料库</NButton
      ></NSpace
    >
    <template v-if="data.storage.value">
      <p>媒体占用 {{ size(data.storage.value.bytes) }}。自动清理关闭。</p>
      <ul>
        <li v-for="(bytes, name) in data.storage.value.categories" :key="name">
          {{ name }}：{{ size(bytes) }}
        </li>
      </ul>
      <h2>清理预览</h2>
      <p>以下为超过一天且没有历史、任务、草稿或外部保护引用的附件。执行前再次检查引用。</p>
      <ul>
        <li v-for="item in data.storage.value.candidates" :key="item.id">
          {{ item.name }} · {{ size(item.bytes) }}
        </li>
      </ul>
      <NButton
        :disabled="data.pending.value || !data.storage.value.candidates.length"
        @click="data.cleanup"
        >将候选移入回收站</NButton
      >
      <h2>回收站</h2>
      <p v-if="!data.storage.value.trash.length">回收站为空</p>
      <NSpace v-for="item in data.storage.value.trash" :key="item.id"
        ><span>{{ item.kind }} · {{ item.id }}</span>
        <NButton size="small" :disabled="data.pending.value" @click="data.restore(item.id)"
          >恢复</NButton
        ></NSpace
      >
    </template>
  </section>
</template>
