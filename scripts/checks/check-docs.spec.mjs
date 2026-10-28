import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { checkDocumentation } from './check-docs.mjs'

async function inspect(files) {
  const root = await mkdtemp(join(tmpdir(), 'ownloom-docs-'))
  try {
    await mkdir(join(root, 'docs'), { recursive: true })
    const defaults = {
      'AGENTS.md': '# Agents\n',
      'LESSONS.md': '# Lessons\n',
      LICENSE: 'License fixture\n',
      'README.md': '# Project\n',
      'README.zh-CN.md': '# 项目\n',
    }
    for (const [path, content] of Object.entries({ ...defaults, ...files })) {
      if (content === null) continue
      await mkdir(dirname(join(root, path)), { recursive: true })
      await writeFile(join(root, path), content)
    }
    return await checkDocumentation(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('accepts root, document, source, image, encoded and duplicate-heading links', async () => {
  const result = await inspect({
    'README.md': '# Project\n[Guide](docs/guide.md#local-api)\n![Logo](docs/logo.svg)\n',
    'docs/guide.md': [
      '# Guide',
      '## Local `API`',
      '## Local API',
      '[Duplicate](#local-api-1)',
      '[Home](../README.md#project)',
      '[Source](../src/main.ts#L1)',
      '[Encoded](details%20page.md#%E7%8A%B6%E6%80%81)',
      '[Reference][details]',
      '[details]: <details page.md#状态> "Details"',
      '<img src="logo.svg" alt="Logo">',
    ].join('\n'),
    'docs/details page.md': '状态\n====\n',
    'docs/logo.svg': '<svg></svg>\n',
    'src/main.ts': 'export const value = 1\n',
  })
  assert.deepEqual(result.errors, [])
  assert.equal(result.files, 6)
})

test('rejects missing local links, image targets and invalid heading anchors', async () => {
  const result = await inspect({
    'docs/guide.md': '# Guide\n[Missing](missing.md)\n![Missing](image.png)\n[Anchor](#absent)\n',
  })
  assert.equal(result.errors.length, 3)
  assert.match(result.errors[0], /docs\/guide.md:2: missing.md: target does not exist/)
  assert.match(result.errors[1], /image.png: target does not exist/)
  assert.match(result.errors[2], /anchor "absent" does not exist/)
})

test('ignores external links, comments, inline code and both fenced-code styles', async () => {
  const result = await inspect({
    'docs/guide.md': [
      '# Guide',
      '[Remote](https://example.invalid/missing#anchor)',
      '[Mail](mailto:maintainer@example.invalid)',
      '![Remote image](//example.invalid/image.png)',
      '`[Example](missing-inline.md)`',
      '<!-- [Draft](missing-comment.md) -->',
      '```md',
      '[Sample](missing-fence.md)',
      '```',
      '~~~~',
      '[Sample](missing-tilde.md)',
      '~~~',
      '[Still fenced](also-missing.md)',
      '~~~~',
    ].join('\n'),
  })
  assert.deepEqual(result.errors, [])
})

test('reports missing and empty required files', async () => {
  const result = await inspect({ LICENSE: null, 'README.zh-CN.md': '' })
  assert.equal(result.errors.length, 2)
  assert.match(result.errors[0], /LICENSE: required file is missing/)
  assert.match(result.errors[1], /README.zh-CN.md: required file is empty/)
})

test('checks reference destinations, explicit anchors and balanced parentheses', async () => {
  const result = await inspect({
    'docs/guide.md': [
      '# Guide',
      '<a id="custom-anchor"></a>',
      '[Anchor](#custom-anchor)',
      '[Detail](details(v2).md#detail)',
      '[Missing][broken]',
      '[broken]: missing-reference.md',
    ].join('\n'),
    'docs/details(v2).md': '# Detail\n',
  })
  assert.equal(result.errors.length, 1)
  assert.match(result.errors[0], /missing-reference.md: target does not exist/)
})

test('rejects targets outside the repository and malformed URL escapes', async () => {
  const result = await inspect({
    'docs/guide.md': '# Guide\n[Escape](../../outside.md)\n[Bad](bad%ZZ.md)\n',
  })
  assert.equal(result.errors.length, 2)
  assert.match(result.errors[0], /outside the repository/)
  assert.match(result.errors[1], /URI malformed/)
})
