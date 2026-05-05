import type { ChatSummary } from "@muhammedaksam/waha-node"

import type { WAMessageExtended } from "~/types"
import { getChatIdString, getContactName } from "~/utils/formatters"

export interface GalleryImageItem {
  chatId: string
  chatName: string
  message: WAMessageExtended
}

type ChatNameShape = {
  name?: string
  formattedTitle?: string
  contact?: {
    name?: string
    pushname?: string
  }
}

export function isGalleryImageMessage(message: WAMessageExtended): boolean {
  const type = message.type ?? message._data?.type ?? ""
  const mimetype = message.mimetype ?? message.media?.mimetype ?? message._data?.mimetype ?? ""
  return type === "image" || mimetype.startsWith("image/")
}

function getGalleryChatName(chat: ChatSummary | undefined, chatId: string): string {
  const shaped = chat as ChatNameShape | undefined
  return (
    shaped?.name ||
    shaped?.formattedTitle ||
    shaped?.contact?.name ||
    shaped?.contact?.pushname ||
    getContactName(chatId, new Map())
  )
}

export function getGalleryImageItems(
  chats: ChatSummary[],
  messagesByChat: Map<string, WAMessageExtended[]>
): GalleryImageItem[] {
  const chatById = new Map<string, ChatSummary>()
  for (const chat of chats) {
    const chatId = getChatIdString(chat.id)
    if (chatId) chatById.set(chatId, chat)
  }

  const items: GalleryImageItem[] = []
  for (const [chatId, messages] of messagesByChat) {
    if (!chatId || chatId === "status@broadcast") continue

    const chat = chatById.get(chatId)
    const chatName = getGalleryChatName(chat, chatId)

    for (const message of messages) {
      if (!message.id || !isGalleryImageMessage(message)) continue
      items.push({ chatId, chatName, message })
    }
  }

  return items.sort((a, b) => {
    const byTime = (b.message.timestamp ?? 0) - (a.message.timestamp ?? 0)
    if (byTime !== 0) return byTime
    return a.message.id.localeCompare(b.message.id)
  })
}
