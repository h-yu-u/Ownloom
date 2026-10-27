import { describe, expect, it } from 'vitest'
import { codingPrimary, composerShortcut } from './composer-policy'
const key = {
  key: 'Enter',
  isComposing: false,
  repeat: false,
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  keyCode: 13,
}
describe('composer keyboard policy', () => {
  it('preserves IME, alternative combinations, and newline entry', () => {
    for (const event of [
      { ...key, isComposing: true },
      { ...key, keyCode: 229 },
      { ...key, shiftKey: true },
      { ...key, altKey: true },
      { ...key, metaKey: true },
    ])
      expect(composerShortcut(event, 'enter')).toBe('ignore')
    expect(composerShortcut(key, 'enter', true)).toBe('ignore')
    expect(composerShortcut(key, 'enter')).toBe('trigger')
    expect(composerShortcut({ ...key, repeat: true }, 'enter')).toBe('repeat')
    expect(composerShortcut(key, 'modifier-enter')).toBe('ignore')
    expect(composerShortcut({ ...key, metaKey: true }, 'modifier-enter')).toBe('trigger')
    expect(composerShortcut({ ...key, ctrlKey: true }, 'modifier-enter')).toBe('trigger')
  })
  it('chooses exactly the same busy action for a click and a shortcut', () => {
    const input = {
      text: 'task',
      enabled: true,
      ready: true,
      pending: false,
      busy: false,
      current: false,
    }
    expect(codingPrimary(input)).toMatchObject({ action: 'submit', enabled: true })
    expect(codingPrimary({ ...input, busy: true })).toMatchObject({
      action: 'queue',
      enabled: true,
    })
    expect(codingPrimary({ ...input, busy: true, current: true, status: 'running' })).toMatchObject(
      { action: 'steer', enabled: true },
    )
    for (const status of ['starting', 'queued', 'cancelling'])
      expect(codingPrimary({ ...input, busy: true, current: true, status }).enabled).toBe(false)
  })
})
