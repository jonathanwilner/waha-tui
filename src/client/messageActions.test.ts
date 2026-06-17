import type { ChatSummary } from "@muhammedaksam/waha-node"

import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test"

import type { WAMessageExtended } from "~/types"
import * as core from "~/client/core"
import {
  clearImagePreviewStateCache,
  getImagePreviewState,
  loadRecentGalleryMessages,
} from "~/client/messageActions"
import { appState } from "~/state/AppState"

function chat(id: string, name = id): ChatSummary {
  return { id, name } as unknown as ChatSummary
}

function message(overrides: Partial<WAMessageExtended> = {}): WAMessageExtended {
  return {
    id: "message-id",
    timestamp: 1,
    fromMe: false,
    body: "",
    type: "image",
    ...overrides,
  } as WAMessageExtended
}

function waitForMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe("messageActions gallery helpers", () => {
  const getChatMessages = mock(() => Promise.resolve({ data: [] }))
  const getChatMessage = mock(() => Promise.reject(new Error("download failed")))

  beforeEach(() => {
    appState.reset()
    appState.setCurrentSession("test-session")
    clearImagePreviewStateCache()
    getChatMessages.mockClear()
    getChatMessages.mockResolvedValue({ data: [] })
    getChatMessage.mockClear()
    getChatMessage.mockRejectedValue(new Error("download failed"))

    spyOn(core, "getClient").mockReturnValue({
      chats: {
        chatsControllerGetChatMessages: getChatMessages,
        chatsControllerGetChatMessage: getChatMessage,
      },
    } as unknown as ReturnType<typeof core.getClient>)
  })

  describe("loadRecentGalleryMessages", () => {
    it("loads only uncached or empty recent chat message lists by default", async () => {
      appState.setChats([chat("cached@c.us"), chat("empty@c.us"), chat("missing@c.us")])
      appState.setMessages("cached@c.us", [message({ id: "cached-image" })])
      appState.setMessages("empty@c.us", [])

      await loadRecentGalleryMessages()

      expect(getChatMessages).toHaveBeenCalledTimes(2)
      expect(getChatMessages).toHaveBeenCalledWith("test-session", "empty@c.us", {
        limit: 50,
        downloadMedia: false,
        sortBy: "timestamp",
        sortOrder: "desc",
      })
      expect(getChatMessages).toHaveBeenCalledWith("test-session", "missing@c.us", {
        limit: 50,
        downloadMedia: false,
        sortBy: "timestamp",
        sortOrder: "desc",
      })
    })

    it("reloads cached recent chats when forced and respects the chat limit", async () => {
      appState.setChats([chat("first@c.us"), chat("second@c.us"), chat("third@c.us")])
      appState.setMessages("first@c.us", [message({ id: "first-cached" })])
      appState.setMessages("second@c.us", [message({ id: "second-cached" })])
      appState.setMessages("third@c.us", [message({ id: "third-cached" })])

      await loadRecentGalleryMessages({ chatLimit: 2, force: true })

      expect(getChatMessages).toHaveBeenCalledTimes(2)
      expect(getChatMessages).toHaveBeenCalledWith("test-session", "first@c.us", {
        limit: 50,
        downloadMedia: false,
        sortBy: "timestamp",
        sortOrder: "desc",
      })
      expect(getChatMessages).toHaveBeenCalledWith("test-session", "second@c.us", {
        limit: 50,
        downloadMedia: false,
        sortBy: "timestamp",
        sortOrder: "desc",
      })
    })
  })

  describe("getImagePreviewState", () => {
    it("returns idle without starting async work for non-image or missing-id messages", () => {
      expect(getImagePreviewState("chat@c.us", message({ id: undefined }))).toEqual({
        status: "idle",
      })
      expect(
        getImagePreviewState("chat@c.us", message({ type: "chat", mimetype: "text/plain" }))
      ).toEqual({
        status: "idle",
      })
      expect(getChatMessage).toHaveBeenCalledTimes(0)
    })

    it("caches an in-flight preview request and stores async errors without unhandled rejection", async () => {
      const unhandled = mock(() => {})
      process.once("unhandledRejection", unhandled)
      const onChange = mock(() => {})

      expect(getImagePreviewState("chat@c.us", message({ id: "image-1" }), onChange)).toEqual({
        status: "loading",
      })
      expect(getImagePreviewState("chat@c.us", message({ id: "image-1" }), onChange)).toEqual({
        status: "loading",
      })

      await waitForMicrotasks()

      expect(getChatMessage).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledTimes(1)
      expect(unhandled).toHaveBeenCalledTimes(0)
      expect(getImagePreviewState("chat@c.us", message({ id: "image-1" }))).toEqual({
        status: "error",
        error: "download failed",
      })

      process.removeListener("unhandledRejection", unhandled)
    })
  })
})
