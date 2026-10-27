import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import SettingsLayout from '../modules/settings/pages/SettingsLayout.vue'
import { router } from './router'
describe('settings deep-link compatibility', () => {
  it.each(['skills', 'mcp', 'builtin'])('passes the actual %s tab and preserves queries', (tab) => {
    const route = router.resolve(`/settings/extensions/${tab}?from=old-link#section`)
    expect(route.matched.at(-1)?.props.default).toEqual({ tab })
    expect(route.meta.navKey).toBe('settings')
    expect(route.query.from).toBe('old-link')
    expect(route.hash).toBe('#section')
  })
  it.each(['/settings', '/settings/coding', '/settings/runtime', '/settings/privacy'])(
    'keeps %s under the settings navigation',
    (path) => {
      expect(router.resolve(path).meta.navKey).toBe('settings')
    },
  )
  it('keeps one extensions category selected when switching between all three tabs', async () => {
    const navigation = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: '/settings',
          component: SettingsLayout,
          children: [
            '',
            'coding',
            'extensions/skills',
            'extensions/mcp',
            'extensions/builtin',
            'runtime',
            'privacy',
          ].map((path) => ({ path, component: { render: () => null } })),
        },
      ],
    })
    await navigation.push('/settings/extensions/skills')
    const wrapper = mount(SettingsLayout, {
      global: { plugins: [navigation], stubs: { RouterView: true } },
    })
    for (const tab of ['skills', 'mcp', 'builtin']) {
      await navigation.push(`/settings/extensions/${tab}`)
      expect(wrapper.findAll('nav a.selected').map((link) => link.text())).toEqual(['扩展能力'])
      expect(wrapper.get('nav a.selected').attributes('aria-current')).toBe('page')
    }
    expect(wrapper.findAll('nav a').map((link) => link.text())).toEqual([
      '概览',
      'Coding',
      '扩展能力',
      '运行与诊断',
      '隐私与数据',
    ])
    await navigation.push('/settings')
    expect(wrapper.get('nav a.selected').text()).toBe('概览')
    wrapper.unmount()
  })
})
