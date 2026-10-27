import { expect, it, vi } from 'vitest'
import { ChatDrafts } from './chat-drafts'

it('keeps drafts independent and consumes only the accepted revision', () => {
  const drafts = new ChatDrafts(vi.fn())
  drafts.edit('conversation:a', { text: 'A', webSearchEnabled: true })
  const revision = drafts.get('conversation:a').revision
  drafts.edit('conversation:b', { text: 'B' })
  expect(drafts.get('conversation:a').text).toBe('A')
  drafts.edit('conversation:a', { text: 'new A' })
  expect(drafts.consume('conversation:a', revision)).toBe(false)
  expect(drafts.get('conversation:a').text).toBe('new A')
  expect(drafts.consume('conversation:a', drafts.get('conversation:a').revision)).toBe(true)
  expect(drafts.get('conversation:a').webSearchEnabled).toBe(true)
  expect(drafts.get('conversation:b').text).toBe('B')
})
it('binds a new draft without changing its lease identity or late callback owner', () => {
  const drafts = new ChatDrafts(vi.fn())
  drafts.edit('new:a', { text: 'hello' })
  const id = drafts.get('new:a').id
  drafts.bind('new:a', 'real')
  drafts.edit('new:a', { text: 'late original result' })
  expect(drafts.get('conversation:real').id).toBe(id)
  expect(drafts.get('conversation:real').text).toBe('late original result')
})
