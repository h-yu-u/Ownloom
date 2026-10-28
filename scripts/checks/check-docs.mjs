import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const requiredFiles = ['AGENTS.md', 'LESSONS.md', 'LICENSE', 'README.md', 'README.zh-CN.md']

// This deliberately checks the repository's Markdown subset, not all of CommonMark.
// Inline/reference destinations, HTML href/src, ATX/Setext headings and explicit
// HTML anchors are supported. Remote URLs and fragments in non-Markdown are not checked.
function withoutFences(source) {
  let fence
  return source
    .replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((line) => {
      const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
      if (fence) {
        if (
          marker &&
          marker[1][0] === fence[0] &&
          marker[1].length >= fence.length &&
          !marker[2].trim()
        )
          fence = undefined
        return ''
      }
      if (marker) {
        fence = marker[1]
        return ''
      }
      return line
    })
    .join('\n')
}

function entities(text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, name) => {
    if (!name.startsWith('#')) return named[name.toLowerCase()]
    const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1))
    return code <= 0x10ffff ? String.fromCodePoint(code) : match
  })
}

function headingSlug(text) {
  return entities(text)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/(^|\s)([_*]{1,2})(.+?)\2(?=\s|$)/g, '$1$3')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}_\s-]/gu, '')
    .replace(/\s/g, '-')
}

function anchors(source) {
  const markdown = withoutFences(source)
  const found = new Set()
  const lines = markdown.split('\n')
  for (const [index, line] of lines.entries()) {
    const atx = line.match(/^ {0,3}#{1,6}\s+(.+?)(?:\s+#+\s*)?$/)
    const setext = line.trim() && /^ {0,3}(?:=+|-+)\s*$/.test(lines[index + 1] ?? '')
    if (!atx && !setext) continue
    const base = headingSlug(atx ? atx[1] : line)
    let anchor = base
    let suffix = 0
    while (found.has(anchor)) anchor = `${base}-${++suffix}`
    found.add(anchor)
  }
  for (const tag of markdown.matchAll(/<[a-z][^>]*>/gi)) {
    for (const attribute of tag[0].matchAll(/\b(?:id|name)\s*=\s*(["'])(.*?)\1/g))
      found.add(entities(attribute[2]))
  }
  return found
}

function destination(text) {
  const value = text.trimStart()
  if (value.startsWith('<')) return value.slice(1, value.indexOf('>'))
  let depth = 0
  let end = 0
  for (; end < value.length; end++) {
    if (value[end] === '\\') {
      end++
      continue
    }
    if (value[end] === '(') depth++
    if (value[end] === ')') {
      if (depth === 0) break
      depth--
    }
    if (/\s/.test(value[end]) && depth === 0) break
  }
  return value.slice(0, end)
}

function links(source) {
  const markdown = withoutFences(source).replace(/(`+)([^`]|(?!\1)`)*?\1/g, '')
  const found = []
  for (const [index, line] of markdown.split('\n').entries()) {
    for (const match of line.matchAll(/(?<!\\)\]\(/g))
      found.push({ target: destination(line.slice(match.index + 2)), line: index + 1 })
    const definition = line.match(/^ {0,3}\[(?!\^)[^\]]+\]:\s*(.*)$/)
    if (definition) found.push({ target: destination(definition[1]), line: index + 1 })
    for (const tag of line.matchAll(/<[a-z][^>]*>/gi)) {
      for (const attribute of tag[0].matchAll(/\b(?:href|src)\s*=\s*(["'])(.*?)\1/g))
        found.push({ target: attribute[2], line: index + 1 })
    }
  }
  return found
}

async function markdownFiles(root) {
  const files = []
  async function collect(directory, recursive) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (recursive && entry.isDirectory()) await collect(path, true)
      else if (entry.isFile() && /\.md$/i.test(entry.name)) files.push(path)
    }
  }
  await collect(root, false)
  await collect(join(root, 'docs'), true)
  return files.sort()
}

async function checkTarget(root, file, target, cache) {
  const href = entities(target).replace(/\\([!"#$%&'()*+,./:;<=>?@[\\\]^_`{|}~-])/g, '$1')
  if (!href || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) return
  const hash = href.indexOf('#')
  const pathname = (hash < 0 ? href : href.slice(0, hash)).split('?')[0]
  const fragment = hash < 0 ? '' : decodeURIComponent(href.slice(hash + 1))
  const decodedPath = decodeURIComponent(pathname)
  if (isAbsolute(decodedPath)) return 'use a repository-relative path'
  const path = decodedPath ? resolve(dirname(file), decodedPath) : file
  const within = relative(root, path)
  if (within === '..' || within.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`))
    return 'target is outside the repository'
  let entry
  try {
    entry = await stat(path)
  } catch {
    return 'target does not exist or cannot be read'
  }
  if (!fragment || entry.isDirectory() || extname(path).toLowerCase() !== '.md') return
  if (!cache.has(path)) cache.set(path, anchors(await readFile(path, 'utf8')))
  if (!cache.get(path).has(fragment))
    return `heading or explicit anchor "${fragment}" does not exist`
}

export async function checkDocumentation(directory) {
  const root = resolve(directory)
  const errors = []
  const cache = new Map()
  for (const name of requiredFiles) {
    try {
      if (!(await readFile(join(root, name), 'utf8')).trim())
        errors.push(`${name}: required file is empty`)
    } catch {
      errors.push(`${name}: required file is missing or unreadable`)
    }
  }
  let files
  try {
    files = await markdownFiles(root)
  } catch (error) {
    errors.push(`Documentation discovery failed: ${error.message}`)
    return { files: 0, links: 0, errors }
  }
  let count = 0
  for (const file of files) {
    const source = await readFile(file, 'utf8')
    cache.set(file, anchors(source))
    for (const { target, line } of links(source)) {
      count++
      try {
        const error = await checkTarget(root, file, target, cache)
        if (error) errors.push(`${relative(root, file)}:${line}: ${target}: ${error}`)
      } catch (error) {
        errors.push(`${relative(root, file)}:${line}: ${target}: ${error.message}`)
      }
    }
  }
  return { files: files.length, links: count, errors }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await checkDocumentation(process.argv[2] ?? process.cwd())
  if (result.errors.length) {
    process.stderr.write(`${result.errors.join('\n')}\n`)
    process.exitCode = 1
  } else
    process.stdout.write(
      `Documentation checks passed: ${result.files} Markdown files, ${result.links} links.\n`,
    )
}
