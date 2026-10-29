import { expect, it } from 'vitest'
import { commandDescription } from './command-description'

it('explains the multi-package version lookup from the Coding timeline', () => {
  expect(
    commandDescription(
      'npm view @vue/cli-service@5 version && npm view vue@2 version && npm view element-ui version',
    ),
  ).toBe('查询 Vue CLI、Vue 和 Element UI 的可用版本')
})

it.each([
  ['pnpm install', '安装项目依赖'],
  ['cd "my project" && pnpm run build', '构建项目'],
  ['uv run pytest tests/', '运行 Python 测试'],
  ['pnpm test:unit && pnpm lint', '运行脚本 test:unit、检查代码规范'],
  ['npm run test:deploy', '运行脚本 test:deploy'],
  ['pnpm run custom', '运行脚本 custom'],
  ['npm run-script release:production', '运行脚本 release:production'],
  ['yarn test:unit', '运行脚本 test:unit'],
  ['rg "build && test" src/', '搜索项目文件与内容'],
  ['npm view constructor version', '查询 constructor 的可用版本'],
])('explains %s without treating quoted text as commands', (command, expected) => {
  expect(commandDescription(command)).toBe(expected)
})

it.each([
  ['npm install -g typescript', '全局安装 typescript'],
  ['npm --global install @vue/cli@5', '全局安装 @vue/cli@5'],
  ['pnpm add --global typescript vue-tsc', '全局安装 typescript、vue-tsc'],
  ['yarn global add @vue/cli', '全局安装 @vue/cli'],
  ['npm install --location=global typescript', '全局安装 typescript'],
  ['npm install -g --registry https://registry.npmjs.org typescript', '全局安装 typescript'],
  ['npm install -g typescript --registry=https://registry.npmjs.org', '全局安装 typescript'],
  ['pnpm remove -g typescript', '全局移除 typescript'],
  ['npm update --global typescript', '全局更新 typescript'],
])('preserves global scope and package names: %s', (command, expected) => {
  expect(commandDescription(command)).toBe(expected)
})

it('keeps a global operation visible when collapsing a longer command chain', () => {
  expect(commandDescription('pwd && npm install -g typescript && pnpm run build')).toBe(
    '执行多步操作，包含全局安装 typescript',
  )
})

it.each([
  '',
  'pnpm test && deploy-production',
  'npm view $(cat package.txt) version',
  'node -e "run()"',
  'pnpm build > output.txt',
  'pnpm build &',
  'pnpm "build',
  'constructor',
  'git toString',
  'pnpm constructor',
])('keeps unknown or unsupported syntax generic: %s', (command) => {
  expect(commandDescription(command)).toBe('执行项目命令')
})
