import type { WAMessageExtended } from "~/types"
import { getContactName, truncate } from "~/utils/formatters"
import { getMediaLabel } from "~/utils/mediaLabels"

export const STATUS_BROADCAST_CHAT_ID = "status@broadcast"

export function getStatusMessages(messages: WAMessageExtended[]): WAMessageExtended[] {
  return messages
    .filter((message) => {
      const type = message.type ?? message._data?.type ?? ""
      return type !== "revoked" && type !== "e2e_notification" && type !== "notification"
    })
    .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
}

export function getStatusSenderId(message: WAMessageExtended): string {
  return message.participant || message.from || message.author || ""
}

export function getStatusSenderName(
  message: WAMessageExtended,
  contacts: Map<string, string>
): string {
  const senderId = getStatusSenderId(message)
  if (message.fromMe) return "You"
  if (!senderId) return "Status"
  return getContactName(
    senderId,
    contacts,
    message._data?.notifyName || message._data?.pushName || undefined
  )
}

export function getStatusPreviewText(message: WAMessageExtended): string {
  const media = getMediaLabel(message)
  const text = media.caption || message.body || media.label || "Status update"
  return truncate(text.replace(/\r?\n/g, " "), 80)
}
