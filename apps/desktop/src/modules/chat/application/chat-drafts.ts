import {
  consumeDraft,
  newDraft,
  patchDraft,
  type ChatDraft,
  type DraftAttachment,
} from '../domain/chat-draft'

/** Runtime-only drafts survive view unmounts. File bytes are owned separately by ManageAttachments. */
export class ChatDrafts {
  private drafts = new Map<string, ChatDraft>()
  private aliases = new Map<string, string>()
  constructor(private readonly changed: () => void) {}
  get(key: string): ChatDraft {
    key = this.aliases.get(key) ?? key
    let draft = this.drafts.get(key)
    if (!draft) {
      draft = newDraft(key, crypto.randomUUID())
      this.drafts.set(key, draft)
    }
    return draft
  }
  edit(key: string, patch: Parameters<typeof patchDraft>[1], selection = false): void {
    const draft = this.get(key)
    this.drafts.set(draft.key, patchDraft(draft, patch, selection))
    this.changed()
  }
  item(key: string, clientId: string, update: (item: DraftAttachment) => DraftAttachment): void {
    const draft = this.get(key)
    if (!draft.attachments.some((item) => item.clientId === clientId)) return
    this.edit(key, {
      attachments: draft.attachments.map((item) =>
        item.clientId === clientId ? update(item) : item,
      ),
    })
  }
  bind(key: string, conversation: string): void {
    const draft = this.get(key)
    const target = `conversation:${conversation}`
    this.drafts.set(target, { ...draft, key: target })
    this.drafts.delete(draft.key)
    this.aliases.set(key, target)
    this.changed()
  }
  consume(key: string, revision: number): boolean {
    const draft = this.get(key)
    const consumed = consumeDraft(draft, revision)
    if (consumed === draft) return false
    this.drafts.set(draft.key, consumed)
    this.changed()
    return true
  }
}
