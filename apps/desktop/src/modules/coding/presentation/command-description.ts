/** Describe recognized shell syntax for display only; never execute or infer success. */
const fallback = '执行项目命令'
const packageNames: Record<string, string> = {
  '@vue/cli': 'Vue CLI',
  '@vue/cli-service': 'Vue CLI',
  vue: 'Vue',
  'element-ui': 'Element UI',
  'element-plus': 'Element Plus',
  vite: 'Vite',
}
const scripts: Record<string, string> = {
  build: '构建项目',
  test: '运行项目测试',
  lint: '检查代码规范',
  typecheck: '检查代码类型',
  'type-check': '检查代码类型',
  check: '运行项目检查',
  dev: '启动开发服务',
  serve: '启动开发服务',
  start: '启动项目',
  preview: '启动本地预览',
  format: '整理代码格式',
}

export function commandDescription(command: string): string {
  const commands = shellCommands(command)
  if (!commands?.length) return fallback
  const packages = commands.map(versionPackage)
  if (packages.every((name): name is string => name !== null)) {
    const names = [...new Set(packages)]
    const visible = names.slice(0, 3)
    const listed =
      visible.length > 1 ? `${visible.slice(0, -1).join('、')} 和 ${visible.at(-1)}` : visible[0]
    return `查询 ${listed}${names.length > 3 ? ` 等 ${names.length} 个依赖` : ''} 的可用版本`
  }
  const actions = commands.map(describeCommand)
  if (actions.some((action) => !action)) return fallback
  const unique = [...new Set(actions)]
  if (unique.length > 1) {
    const directory = unique.indexOf('切换项目目录')
    if (directory >= 0) unique.splice(directory, 1)
  }
  return unique.length <= 2 ? unique.join('、') : '执行项目的多步操作'
}

function versionPackage(words: string[]): string | null {
  if (!['npm', 'pnpm', 'yarn'].includes(words[0] ?? '')) return null
  if (!['view', 'info', 'show'].includes(words[1] ?? '')) return null
  if (words.length !== 4 || !['version', 'versions'].includes(words[3] ?? '')) return null
  const name = /^(@[\w.-]+\/[\w.-]+|[\w.-]+)(?:@[^\s]+)?$/.exec(words[2] ?? '')?.[1]
  return name ? (Object.hasOwn(packageNames, name) ? packageNames[name]! : name) : null
}

function describeCommand(words: string[]): string | null {
  const [name, action, argument] = words
  if ([name, action].some((value) => value && Object.hasOwn(Object.prototype, value))) return null
  if (['npm', 'pnpm', 'yarn'].includes(name ?? '')) {
    if (!action && name === 'yarn') return '安装项目依赖'
    if (['install', 'i', 'ci', 'add'].includes(action ?? '')) return '安装项目依赖'
    if (['update', 'upgrade', 'up'].includes(action ?? '')) return '更新项目依赖'
    if (['remove', 'uninstall'].includes(action ?? '')) return '移除项目依赖'
    if (action === 'create' || action === 'init') return '初始化项目'
    if (action === 'view' || action === 'info' || action === 'show') return '查询依赖信息'
    return scriptDescription(action === 'run' ? argument : action)
  }
  if (name === 'uv' && action === 'sync') return '同步 Python 项目依赖'
  if (name === 'uv' && action === 'run') return describeCommand(words.slice(2))
  if (name === 'vue' && action === 'create') return '创建 Vue 项目'
  if (name === 'npx' && argument === 'create' && /^@vue\/cli(?:@|$)/.test(action ?? ''))
    return '创建 Vue 项目'
  if (
    ['node', 'python', 'python3', 'uv'].includes(name ?? '') &&
    ['--version', '-V', '-v'].includes(action ?? '')
  )
    return '检查开发环境版本'
  if (name === 'git') {
    return (
      (
        { status: '查看 Git 工作区状态', diff: '查看代码改动', log: '查看提交记录' } as Record<
          string,
          string
        >
      )[action ?? ''] ?? null
    )
  }
  return (
    (
      {
        ls: '浏览项目目录',
        pwd: '查看当前工作目录',
        cd: '切换项目目录',
        cat: '读取文件内容',
        head: '查看文件开头',
        tail: '查看文件末尾',
        rg: '搜索项目文件与内容',
        grep: '搜索文件内容',
        mkdir: '创建项目目录',
        pytest: '运行 Python 测试',
        tsc: '检查 TypeScript 项目',
      } as Record<string, string>
    )[name ?? ''] ?? null
  )
}

function scriptDescription(script: string | undefined): string | null {
  if (!script) return null
  const base = script.split(':')[0] ?? script
  return Object.hasOwn(scripts, base) ? scripts[base]! : null
}

/** Conservative tokenizer: quoted separators stay literal; unsupported shell syntax stays generic. */
function shellCommands(source: string): string[][] | null {
  if (!source.trim() || source.length > 8192) return null
  const commands: string[][] = []
  let words: string[] = [],
    word = '',
    quote = '',
    escaped = false
  const flushWord = () => {
    if (word) words.push(word)
    word = ''
  }
  const flushCommand = () => {
    flushWord()
    if (words.length) commands.push(words)
    words = []
  }
  for (let index = 0; index < source.length; index++) {
    const char = source[index]!
    if (escaped) {
      word += char
      escaped = false
      continue
    }
    if (char === '\\' && quote !== "'") {
      escaped = true
      continue
    }
    if (quote) {
      if (char === quote) quote = ''
      else if (quote === '"' && /[$`]/.test(char)) return null
      else word += char
    } else if (char === '"' || char === "'") quote = char
    else if (/[$`()<>#]/.test(char)) return null
    else if (char === ';' || char === '\n' || char === '|' || char === '&') {
      if (char === '&' && source[index + 1] !== '&') return null
      if ((char === '|' || char === '&') && source[index + 1] === char) index++
      flushCommand()
    } else if (/\s/.test(char)) flushWord()
    else word += char
  }
  if (quote || escaped) return null
  flushCommand()
  return commands
}
