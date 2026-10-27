import { describe, expect, it } from 'vitest'
import { ScopedTextDrafts } from './scoped-text-drafts'
describe('scoped text drafts', () => {
  it('isolates sessions and projects and does not consume later edits, including X → Y → X', () => {
    const drafts = new ScopedTextDrafts()
    const submitted = drafts.edit('p1:s1', 'X')
    drafts.edit('p2:s1', 'other project')
    drafts.edit('p1:s2', 'other session')
    drafts.edit('p1:s1', 'Y')
    drafts.edit('p1:s1', 'X')
    expect(drafts.consume(submitted)).toBe(false)
    expect(drafts.get('p1:s1').text).toBe('X')
    expect(drafts.get('p1:s2').text).toBe('other session')
    expect(drafts.get('p2:s1').text).toBe('other project')
  })
  it('binds a creating draft without losing new edits or accepting a stale revision', () => {
    const drafts = new ScopedTextDrafts(),
      submitted = drafts.edit('new', 'before')
    drafts.edit('new', 'during creation')
    expect(drafts.bind(submitted, 'session')).toBe('bound')
    expect(drafts.get('session').text).toBe('during creation')
    expect(drafts.consume(submitted)).toBe(false)
    expect(drafts.consume(drafts.get('session'))).toBe(true)
    expect(drafts.get('new').text).toBe('')
  })
  it('cannot clear a deleted and recreated draft or replace an occupied target', () => {
    const drafts = new ScopedTextDrafts(),
      old = drafts.edit('session', 'old')
    drafts.discard('session')
    drafts.edit('session', 'new')
    expect(drafts.consume(old)).toBe(false)
    expect(drafts.bind(old, 'target')).toBe('source-replaced')
    const source = drafts.edit('source', 'keep source')
    drafts.edit('target', 'keep target')
    expect(drafts.bind(source, 'target')).toBe('target-exists')
    expect(drafts.get('source').text).toBe('keep source')
    expect(drafts.get('target').text).toBe('keep target')
  })
})
