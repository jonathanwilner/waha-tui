/**
 * Message Actions
 * Functions for message-level operations (star, pin, delete, forward, react, load, send)
 */

import { existsSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { basename, join } from "node:path"
import type { WAMessage } from "@muhammedaksam/waha-node"

import type { ChatId, MessageId, WAMessageExtended } from "~/types"
import { getClient, getSession } from "~/client/core"
import { loadChats } from "~/client/sessionActions"
import { loadConfig } from "~/config/manager"
import { TIME_MS, TIME_S } from "~/constants"
import { CacheKeys, cacheService } from "~/services/CacheService"
import { NetworkError } from "~/services/Errors"
import { errorService } from "~/services/ErrorService"
import { RetryPresets, withRetry } from "~/services/RetryService"
import { appState } from "~/state/AppState"
import { debugLog } from "~/utils/debug"
import { getChatIdString } from "~/utils/formatters"
import { getMediaDownloadDir, getMimeType, openLocalFile } from "~/utils/mediaUtils"

function safeMediaName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180)
}

function isImageMessage(message: WAMessageExtended): boolean {
  const type = message.type ?? message._data?.type ?? ""
  const mimetype = message.mimetype ?? message.media?.mimetype ?? message._data?.mimetype ?? ""
  return type === "image" || mimetype.startsWith("image/")
}

async function fetchMessageWithMedia(
  chatId: string,
  messageId: string
): Promise<WAMessageExtended> {
  const session = getSession()
  const wahaClient = getClient()
  const response = await wahaClient.chats.chatsControllerGetChatMessage(
    session,
    chatId,
    messageId,
    {
      downloadMedia: true,
    }
  )
  return response.data as unknown as WAMessageExtended
}

async function downloadMediaToFile(chatId: string, messageId: string): Promise<string> {
  const wahaClient = getClient()
  const message = await fetchMessageWithMedia(chatId, messageId)

  if (!message.hasMedia && !message.mediaUrl) {
    throw new Error("Message does not contain media")
  }

  let mediaUrl = message.media?.url || message.mediaUrl
  if (!mediaUrl) {
    throw new Error("Media URL not found in message payload")
  }

  // WAHA sometimes returns internal docker URLs (e.g. http://localhost:3000) for media.
  // Substitute it with the configured WAHA API origin when possible.
  if (wahaClient.httpClient?.defaults.baseURL && mediaUrl.startsWith("http")) {
    try {
      const parsedMediaUrl = new URL(mediaUrl)
      const baseUrl = new URL(wahaClient.httpClient.defaults.baseURL)
      parsedMediaUrl.protocol = baseUrl.protocol
      parsedMediaUrl.host = baseUrl.host
      parsedMediaUrl.port = baseUrl.port
      mediaUrl = parsedMediaUrl.toString()
    } catch (e) {
      debugLog("Client", `Failed to parse URLs for substitution: ${e}`)
    }
  }

  const extension = message.media?.mimetype?.split("/")[1]?.split(";")[0] || "bin"
  const filename = safeMediaName(message.media?.filename || `media_${messageId}.${extension}`)
  const downloadDir = await getMediaDownloadDir()
  const filePath = join(downloadDir, filename)

  if (existsSync(filePath)) {
    return filePath
  }

  debugLog("Client", `Downloading from ${mediaUrl} to ${filePath}`)

  if (wahaClient.httpClient) {
    let relativeUrl = mediaUrl
    try {
      const parsed = new URL(mediaUrl)
      relativeUrl = parsed.pathname + parsed.search
    } catch {
      // Fallback to absolute if parsing fails
    }

    const config = await loadConfig()
    const apiKey = config?.wahaApiKey
    const headers: Record<string, string> = {}
    if (apiKey) {
      headers["X-Api-Key"] = apiKey
    }

    const fileResponse = await wahaClient.httpClient.get(relativeUrl, {
      responseType: "arraybuffer",
      headers,
    })
    await writeFile(filePath, Buffer.from(fileResponse.data))
  } else {
    const fetchResponse = await fetch(mediaUrl)
    const arrayBuffer = await fetchResponse.arrayBuffer()
    await writeFile(filePath, Buffer.from(arrayBuffer))
  }

  return filePath
}

type MediaPreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; filePath: string }
  | { status: "error"; error: string }

const mediaPreviewCache = new Map<string, MediaPreviewState>()

export function clearImagePreviewStateCache(): void {
  mediaPreviewCache.clear()
}

export function getImagePreviewState(
  chatId: string,
  message: WAMessageExtended,
  onChange?: () => void
): MediaPreviewState {
  if (!message.id || !isImageMessage(message)) return { status: "idle" }

  const key = `${chatId}:${message.id}`
  const cached = mediaPreviewCache.get(key)
  if (cached) return cached

  mediaPreviewCache.set(key, { status: "loading" })
  void downloadMediaToFile(chatId, message.id)
    .then((filePath) => {
      mediaPreviewCache.set(key, { status: "ready", filePath })
      onChange?.()
    })
    .catch((error) => {
      debugLog("Client", `Failed to download image preview for ${message.id}: ${error}`)
      mediaPreviewCache.set(key, {
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      })
      onChange?.()
    })

  return { status: "loading" }
}

/**
 * Star or unstar a message.
 * @param messageId - The message ID to star/unstar
 * @param chatId - The chat containing message
 * @param star - True to star, false to unstar
 * @throws {NetworkError} If network connection fails
 * @throws {AuthError} If authentication fails
 * @throws {ServerError} If server error occurs
 */
export async function starMessage(
  messageId: MessageId,
  chatId: ChatId,
  star: boolean
): Promise<void> {
  try {
    const session = getSession()
    debugLog("Client", `${star ? "Starring" : "Unstarring"} message: ${messageId}`)
    const wahaClient = getClient()
    await wahaClient.chatting.chattingControllerSetStar({
      session,
      messageId,
      chatId,
      star,
    })
    debugLog("Client", `Message ${star ? "starred" : "unstarred"}: ${messageId}`)
  } catch (error) {
    errorService.handle(error, { context: { action: "starMessage", messageId, star } })
    throw error instanceof Error
      ? new NetworkError(
          `Failed to ${star ? "star" : "unstar"} message`,
          { messageId, star },
          error
        )
      : new NetworkError(`Failed to ${star ? "star" : "unstar"} message`, { messageId, star })
  }
}

/**
 * Pin a message in a chat.
 * @param chatId - The chat ID
 * @param messageId - The message ID to pin
 * @param duration - Pin duration in seconds (default: 7 days)
 * @throws {NetworkError} If network connection fails
 * @throws {AuthError} If authentication fails
 * @throws {ServerError} If server error occurs
 */
export async function pinMessage(
  chatId: ChatId,
  messageId: MessageId,
  duration: number = TIME_S.PIN_MESSAGE_DEFAULT_DURATION
): Promise<void> {
  try {
    const session = getSession()
    debugLog("Client", `Pinning message: ${messageId}`)
    const wahaClient = getClient()
    await wahaClient.chats.chatsControllerPinMessage(session, chatId, messageId, {
      duration,
    })
    debugLog("Client", `Message pinned: ${messageId}`)
  } catch (error) {
    errorService.handle(error, { context: { action: "pinMessage", messageId } })
    throw error instanceof Error
      ? new NetworkError("Failed to pin message", { messageId }, error)
      : new NetworkError("Failed to pin message", { messageId })
  }
}

/**
 * Unpin a previously pinned message.
 * @param chatId - The chat ID
 * @param messageId - The message ID to unpin
 * @throws {NetworkError} If network connection fails
 * @throws {AuthError} If authentication fails
 * @throws {ServerError} If server error occurs
 */
export async function unpinMessage(chatId: ChatId, messageId: MessageId): Promise<void> {
  try {
    const session = getSession()
    debugLog("Client", `Unpinning message: ${messageId}`)
    const wahaClient = getClient()
    await wahaClient.chats.chatsControllerUnpinMessage(session, chatId, messageId)
    debugLog("Client", `Message unpinned: ${messageId}`)
  } catch (error) {
    errorService.handle(error, { context: { action: "unpinMessage", messageId } })
    throw error instanceof Error
      ? new NetworkError("Failed to unpin message", { messageId }, error)
      : new NetworkError("Failed to unpin message", { messageId })
  }
}

/**
 * Delete a message from a chat.
 * @param chatId - The chat ID
 * @param messageId - The message ID to delete
 * @throws {NetworkError} If network connection fails
 * @throws {AuthError} If authentication fails
 * @throws {ServerError} If server error occurs
 */
export async function deleteMessage(chatId: ChatId, messageId: MessageId): Promise<void> {
  try {
    const session = getSession()
    debugLog("Client", `Deleting message: ${messageId}`)
    const wahaClient = getClient()
    await wahaClient.chats.chatsControllerDeleteMessage(session, chatId, messageId)
    debugLog("Client", `Message deleted: ${messageId}`)
  } catch (error) {
    errorService.handle(error, { context: { action: "deleteMessage", messageId } })
    throw error instanceof Error
      ? new NetworkError("Failed to delete message", { messageId }, error)
      : new NetworkError("Failed to delete message", { messageId })
  }
}

export async function forwardMessage(
  chatId: ChatId,
  messageId: MessageId,
  toChatId: ChatId
): Promise<void> {
  try {
    const session = getSession()
    debugLog("Client", `Forwarding message ${messageId} to ${toChatId}`)
    const wahaClient = getClient()
    await wahaClient.chatting.chattingControllerForwardMessage({
      session,
      chatId: toChatId,
      messageId,
    })
    debugLog("Client", `Message forwarded: ${messageId} -> ${toChatId}`)
  } catch (error) {
    errorService.handle(error, { context: { action: "forwardMessage", messageId, toChatId } })
    throw error instanceof Error
      ? new NetworkError("Failed to forward message", { messageId, toChatId }, error)
      : new NetworkError("Failed to forward message", { messageId, toChatId })
  }
}

export async function reactToMessage(messageId: string, reaction: string): Promise<void> {
  try {
    const session = getSession()
    debugLog("Client", `Reacting to message ${messageId} with ${reaction}`)
    const wahaClient = getClient()
    await wahaClient.chatting.chattingControllerSetReaction({
      session,
      messageId,
      reaction,
    })
    debugLog("Client", `Reaction set: ${reaction} on ${messageId}`)
  } catch (error) {
    errorService.handle(error, { context: { action: "reactToMessage", messageId, reaction } })
    throw error instanceof Error
      ? new NetworkError("Failed to set reaction", { messageId, reaction }, error)
      : new NetworkError("Failed to set reaction", { messageId, reaction })
  }
}

export async function loadMessages(chatId: string): Promise<void> {
  try {
    const wahaClient = getClient()
    const session = getSession()

    const response = await withRetry(
      () =>
        wahaClient.chats.chatsControllerGetChatMessages(session, chatId, {
          limit: 50,
          downloadMedia: false,
          sortBy: "messageTimestamp",
          sortOrder: "desc",
        }),
      {
        ...RetryPresets.quick,
        onRetry: (attempt, delay) => {
          debugLog("Messages", `Retry attempt ${attempt}, waiting ${delay}ms...`)
        },
      }
    )

    const messages = (response.data as unknown as WAMessage[]) || []

    // Attempt to normalize reactions if found in _data
    messages.forEach((msg: WAMessageExtended) => {
      if (
        msg._data?.hasReaction &&
        msg._data?.reactions &&
        (!msg.reactions || msg.reactions.length === 0)
      ) {
        try {
          const rawReactions = msg._data.reactions as Array<{
            aggregateEmoji: string
            senders: Array<{ id: string }>
          }>

          if (Array.isArray(rawReactions)) {
            const normalizedReactions: Array<{ text: string; id: string; from?: string }> = []

            rawReactions.forEach((reactionGroup) => {
              const emoji = reactionGroup.aggregateEmoji
              if (Array.isArray(reactionGroup.senders)) {
                reactionGroup.senders.forEach((sender) => {
                  normalizedReactions.push({
                    text: emoji,
                    id: `${msg.id}_${emoji}_${sender.id}`,
                    from: sender.id,
                  })
                })
              }
            })

            if (normalizedReactions.length > 0) {
              msg.reactions = normalizedReactions
            }
          }
        } catch (e) {
          debugLog("Messages", `Failed to parse reactions for message ${msg.id}: ${e}`)
        }
      }
    })

    appState.setMessages(chatId, messages as WAMessageExtended[])
  } catch (error) {
    debugLog("Messages", `Failed to load messages: ${error}`)
    appState.setMessages(chatId, [])
  }
}

export async function loadRecentGalleryMessages(
  options: {
    chatLimit?: number
    force?: boolean
  } = {}
): Promise<void> {
  const { chatLimit = 30, force = false } = options
  let state = appState.getState()

  if (state.chats.length === 0) {
    await loadChats()
    state = appState.getState()
  }

  const recentChats = state.chats.slice(0, chatLimit)
  debugLog("Gallery", `Refreshing gallery messages from ${recentChats.length} chats`)

  for (const chat of recentChats) {
    const chatId = getChatIdString(chat.id)
    if (!chatId) continue

    const cachedMessages = appState.getState().messages.get(chatId)
    if (!force && cachedMessages && cachedMessages.length > 0) continue

    await loadMessages(chatId)
  }
}

let isLoadingMore = false

export async function loadOlderMessages(): Promise<void> {
  const state = appState.getState()
  if (!state.currentChatId || !state.currentSession || isLoadingMore) {
    return
  }

  const currentMessages = state.messages.get(state.currentChatId) || []
  if (currentMessages.length === 0) return

  isLoadingMore = true
  const offset = currentMessages.length
  debugLog("Messages", `Loading older messages with offset ${offset}`)

  try {
    const wahaClient = getClient()
    const response = await wahaClient.chats.chatsControllerGetChatMessages(
      state.currentSession,
      state.currentChatId,
      {
        limit: 50,
        offset: offset,
        downloadMedia: false,
        sortBy: "messageTimestamp",
        sortOrder: "desc",
      }
    )

    const newMessages = (response.data as unknown as WAMessage[]) || []

    if (newMessages.length > 0) {
      debugLog("Messages", `Loaded ${newMessages.length} older messages`)
      const combinedMessages = [...currentMessages, ...newMessages]
      appState.setMessages(state.currentChatId, combinedMessages)
    } else {
      debugLog("Messages", "No more older messages available")
    }
  } catch (error) {
    debugLog("Messages", `Failed to load older messages: ${error}`)
  } finally {
    isLoadingMore = false
  }
}

export async function sendMessage(
  chatId: string,
  text: string,
  replyToMsgId?: string
): Promise<void> {
  try {
    const session = getSession()
    debugLog(
      "Messages",
      `Sending message to ${chatId}: ${text}${replyToMsgId ? ` (replying to ${replyToMsgId})` : ""}`
    )
    appState.setIsSending(true)

    const wahaClient = getClient()
    await wahaClient.chatting.chattingControllerSendText({
      session,
      chatId,
      text,
      ...(replyToMsgId && { reply_to: replyToMsgId }),
    })

    debugLog("Messages", "Message sent successfully")
    appState.setReplyingToMessage(null)

    await loadMessages(chatId)
    // Update chat list to show new last message after a brief delay
    // to ensure WAHA backend has processed the message
    setTimeout(() => {
      cacheService.delete(CacheKeys.chats(session))
      loadChats()
    }, TIME_MS.SEND_MESSAGE_RELOAD_DELAY)
    appState.setIsSending(false)
  } catch (error) {
    debugLog("Messages", `Failed to send message: ${error}`)
    appState.setIsSending(false)
    errorService.handle(error, { context: { action: "sendMessage", chatId, replyToMsgId } })
    throw error instanceof Error
      ? new NetworkError("Failed to send message", { chatId }, error)
      : new NetworkError("Failed to send message", { chatId })
  }
}

export async function sendTypingState(
  chatId: string,
  state: "composing" | "paused"
): Promise<void> {
  try {
    const session = getSession()
    const wahaClient = getClient()

    if (state === "composing") {
      await wahaClient.chatting.chattingControllerStartTyping({
        session,
        chatId,
      })
    } else {
      await wahaClient.chatting.chattingControllerStopTyping({
        session,
        chatId,
      })
    }
  } catch (error) {
    debugLog("Typing", `Failed to send typing state: ${error}`)
  }
}

/**
 * Pre-fetch messages for top N chats in the background
 * This improves chat switching performance by having messages ready
 * Only runs if backgroundSync setting is enabled
 */
export async function prefetchMessagesForTopChats(count: number = 5): Promise<void> {
  const state = appState.getState()

  // Check if background sync is enabled
  if (!state.backgroundSync) {
    debugLog("BackgroundSync", "Background sync disabled, skipping prefetch")
    return
  }

  const chats = state.chats.slice(0, count)
  if (chats.length === 0) {
    debugLog("BackgroundSync", "No chats to prefetch")
    return
  }

  debugLog("BackgroundSync", `Pre-fetching messages for top ${chats.length} chats`)

  // Process chats sequentially to avoid overwhelming the API
  for (const chat of chats) {
    const chatId = getChatIdString(chat.id)
    if (!chatId) continue

    // Skip if already cached
    if (state.messages.has(chatId) && (state.messages.get(chatId)?.length ?? 0) > 0) {
      debugLog("BackgroundSync", `Chat ${chatId} already cached, skipping`)
      continue
    }

    try {
      const wahaClient = getClient()
      const session = getSession()
      const response = await wahaClient.chats.chatsControllerGetChatMessages(session, chatId, {
        limit: 50,
        downloadMedia: false,
        sortBy: "messageTimestamp",
        sortOrder: "desc",
      })
      const messages = (response.data as unknown as WAMessage[]) || []

      // Store in state without triggering UI update for non-current chat
      appState.setMessages(chatId, messages as WAMessageExtended[])
      debugLog("BackgroundSync", `Pre-fetched ${messages.length} messages for ${chatId}`)

      // Small delay between requests to be nice to the API
      await new Promise((resolve) => setTimeout(resolve, TIME_MS.SEND_MESSAGE_RELOAD_DELAY))
    } catch (error) {
      debugLog("BackgroundSync", `Failed to prefetch messages for ${chatId}: ${error}`)
    }
  }

  debugLog("BackgroundSync", "Pre-fetch complete")
}

/**
 * Downloads media from a message and opens it in the system's default viewer.
 * @param chatId - The chat ID
 * @param messageId - The message ID containing the media
 * @throws {NetworkError} If network connection fails
 */
export async function downloadAndOpenMedia(chatId: string, messageId: string): Promise<void> {
  try {
    debugLog("Client", `Downloading media for message: ${messageId}`)
    const filePath = await downloadMediaToFile(chatId, messageId)
    debugLog("Client", `Opening media file: ${filePath}`)
    const opened = await openLocalFile(filePath)

    if (!opened) {
      throw new Error("System failed to open the file")
    }
  } catch (error) {
    errorService.handle(error, { context: { action: "downloadAndOpenMedia", messageId } })
    throw error instanceof Error
      ? new NetworkError("Failed to download and open media", { messageId }, error)
      : new NetworkError("Failed to download and open media", { messageId })
  }
}

/**
 * Sends a media message (image, video, audio, or document) to a chat.
 * @param chatId - The chat ID
 * @param filePath - The absolute path to the local file
 * @param caption - Optional caption for the media
 * @param replyToMessageId - Optional message ID to reply to
 */
export async function sendMediaMessage(
  chatId: string,
  filePath: string,
  caption?: string,
  replyToMessageId?: string
): Promise<void> {
  try {
    const session = getSession()
    const wahaClient = getClient()

    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`)
    }

    const mimeType = getMimeType(filePath)
    const filename = basename(filePath)

    // Read file and convert to base64
    const fileBuffer = await readFile(filePath)
    const base64Data = fileBuffer.toString("base64")

    const filePayload = {
      mimetype: mimeType,
      filename: filename,
      data: base64Data,
    }

    debugLog("Client", `Sending media message to ${chatId}. Mimetype: ${mimeType}`)

    // Route based on mimetype
    if (mimeType.startsWith("image/")) {
      await wahaClient.chatting.chattingControllerSendImage({
        session,
        chatId,
        file: filePayload,
        caption,
        reply_to: replyToMessageId,
      })
    } else if (mimeType.startsWith("video/")) {
      await wahaClient.chatting.chattingControllerSendVideo({
        session,
        chatId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        file: filePayload as any, // VideoBinaryFile types are incorrect in the SDK
        caption,
        reply_to: replyToMessageId,
        convert: false,
      })
    } else if (mimeType.startsWith("audio/")) {
      await wahaClient.chatting.chattingControllerSendVoice({
        session,
        chatId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        file: filePayload as any, // VoiceBinaryFile types are incorrect in the SDK
        reply_to: replyToMessageId,
        convert: false,
      })
    } else {
      // Document / other
      await wahaClient.chatting.chattingControllerSendFile({
        session,
        chatId,
        file: filePayload,
        caption,
        reply_to: replyToMessageId,
      })
    }

    debugLog("Client", `Media message sent successfully to ${chatId}`)

    // Reload messages to show the new one
    await loadMessages(chatId)
  } catch (error) {
    errorService.handle(error, { context: { action: "sendMediaMessage", chatId } })
    throw error instanceof Error
      ? new NetworkError("Failed to send media", { chatId }, error)
      : new NetworkError("Failed to send media", { chatId })
  }
}
