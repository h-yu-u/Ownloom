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
  ['pnpm test:unit && pnpm lint', '运行项目测试、检查代码规范'],
  ['rg "build && test" src/', '搜索项目文件与内容'],
  ['npm view constructor version', '查询 constructor 的可用版本'],
])('explains %s without treating quoted text as commands', (command, expected) => {
  expect(commandDescription(command)).toBe(expected)
})

it.each([
  '',
  'pnpm run custom',
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
