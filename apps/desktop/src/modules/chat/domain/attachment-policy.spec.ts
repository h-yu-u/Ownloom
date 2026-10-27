import { expect, it } from 'vitest'
import { attachmentPolicy, getSendEligibility } from './attachment-policy'
import { newDraft, type DraftAttachment } from './chat-draft'

const document: DraftAttachment = {
  clientId: 'doc',
  uploadKey: 'key',
  originalName: 'a.txt',
  sizeBytes: 10,
  kind: 'document',
  format: 'txt',
  transfer: 'stored',
  processing: 'ready',
  processingRevision: 1,
  warnings: [],
  retryable: false,
}
const image: DraftAttachment = { ...document, clientId: 'image', kind: 'image', format: 'png' }
it('counts documents separately from the visual limit and preserves incompatible images', () => {
  const draft = {
    ...newDraft('conversation:a', 'draft'),
    text: 'question',
    attachments: [image, document, document, document],
  }
  expect(getSendEligibility(draft, 1, false).allowed).toBe(true)
  expect(
    getSendEligibility({ ...draft, attachments: [...draft.attachments, image] }, 1, false).allowed,
  ).toBe(false)
  expect(getSendEligibility(draft, 0, false).reason).toContain('当前模型不支持此图片')
  expect(draft.attachments).toHaveLength(4)
  expect(getSendEligibility(draft, 4, false).allowed).toBe(true)
})
it('enforces counts, file size and total bytes at the exact boundaries', () => {
  const draft = { ...newDraft('a', 'b'), attachments: Array.from({ length: 8 }, () => document) }
  expect(getSendEligibility(draft, 0, false).allowed).toBe(true)
  expect(
    getSendEligibility({ ...draft, attachments: [...draft.attachments, document] }, 0, false)
      .allowed,
  ).toBe(false)
  expect(
    getSendEligibility(
      { ...draft, attachments: [{ ...document, sizeBytes: attachmentPolicy.maxFileBytes + 1 }] },
      0,
      false,
    ).allowed,
  ).toBe(false)
  const full = Array.from({ length: 3 }, () => ({
    ...document,
    sizeBytes: attachmentPolicy.maxFileBytes,
  }))
  expect(getSendEligibility({ ...draft, attachments: full }, 0, false).allowed).toBe(true)
  expect(
    getSendEligibility(
      { ...draft, attachments: [...full, { ...document, sizeBytes: 1 }] },
      0,
      false,
    ).allowed,
  ).toBe(false)
})
it('counts the effective history group and honours none', () => {
  const draft = { ...newDraft('a', 'b'), text: 'follow up' }
  expect(getSendEligibility(draft, 0, false, 1).allowed).toBe(false)
  expect(
    getSendEligibility({ ...draft, visualSelection: { mode: 'none' } }, 0, false, 1).allowed,
  ).toBe(true)
  expect(
    getSendEligibility(
      { ...draft, text: '', webSearchEnabled: true, attachments: [document] },
      0,
      false,
    ).reason,
  ).toContain('联网')
})
