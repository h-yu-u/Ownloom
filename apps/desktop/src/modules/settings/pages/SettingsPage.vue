<script setup lang="ts">
import PageHeader from '../../../shared/ui/PageHeader.vue'
import { useWebSearch } from '../../../capabilities/web-search'
import { useCodingSettings } from '../../../capabilities/coding-settings'
import { onMounted } from 'vue'
const web = useWebSearch(),
  coding = useCodingSettings()
onMounted(() => {
  void web.load()
  void coding.load()
})
</script>
<template>
  <section>
    <PageHeader title="设置" subtitle="管理默认行为、工具与本机运行环境" />
    <div class="settings-overview">
      <RouterLink to="/settings/coding"
        ><h2>Coding 默认设置</h2>
        <p>默认模型：{{ coding.settings.defaultModelId || '未选择' }}</p></RouterLink
      >
      <RouterLink to="/settings/extensions/skills"
        ><h2>扩展能力</h2>
        <p>管理 Skills、MCP 服务、内置工具与联网搜索</p>
        <small>{{
          web.settings?.credentialConfigured ? '搜索凭据已保存' : '搜索凭据尚未配置'
        }}</small></RouterLink
      >
      <RouterLink to="/settings/runtime"
        ><h2>运行与诊断</h2>
        <p>查看本机资源、重启 Worker、导出诊断</p></RouterLink
      >
    </div>
  </section>
</template>
<style scoped>
.settings-overview {
  display: grid;
  gap: 16px;
}
a {
  padding: 16px;
  background: var(--surface-card);
  color: inherit;
  text-decoration: none;
  border-radius: var(--radius-panel);
}
h2 {
  font-size: 16px;
  margin: 0;
}
p,
small {
  color: var(--muted);
}
p {
  margin-bottom: 0;
}
small {
  display: block;
  margin-top: 8px;
}
</style>
