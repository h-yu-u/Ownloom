import type { Session } from './types.js'

export const defaultSessionTitles = ['新对话', '新开发会话']

export function sessionWithInputTitle(session: Session, text: string): Session {
  if (session.titleSource || !defaultSessionTitles.includes(session.title)) return session
  const title = Array.from(text.trim().replace(/\s+/gu, ' ')).slice(0, 7).join('')
  return title ? { ...session, title, titleSource: 'input' } : session
}
