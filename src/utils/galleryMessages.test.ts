import type { ChatSummary } from "@muhammedaksam/waha-node"

import { describe, expect, it } from "bun:test"

import type { WAMessageExtended } from "~/types"
import { getGalleryImageItems, isGalleryImageMessage } from "~/utils/galleryMessages"

function message(overrides: Partial<WAMessageExtended>): WAMessageExtended {
  return {
    id: "message-id",
    timestamp: 1,
    fromMe: false,
    body: "",
    ...overrides,
  } as WAMessageExtended
}

describe("galleryMessages", () => {
  it("detects image messages from type or mimetype", () => {
    expect(isGalleryImageMessage(message({ type: "image" }))).toBe(true)
    expect(isGalleryImageMessage(message({ mimetype: "image/jpeg" }))).toBe(true)
    expect(isGalleryImageMessage(message({ _data: { mimetype: "image/png" } }))).toBe(true)
    expect(isGalleryImageMessage(message({ type: "video", mimetype: "video/mp4" }))).toBe(false)
  })

  it("collects image messages across chats newest first", () => {
    const chats = [
      { id: { _serialized: "111@c.us" }, name: "Ada" },
      { id: "222@c.us", name: "Grace" },
    ] as unknown as ChatSummary[]
    const messagesByChat = new Map<string, WAMessageExtended[]>([
      [
        "111@c.us",
        [
          message({ id: "older", timestamp: 10, type: "image" }),
          message({ id: "text", timestamp: 20, type: "chat", body: "hello" }),
        ],
      ],
      ["222@c.us", [message({ id: "newer", timestamp: 30, mimetype: "image/webp" })]],
      ["status@broadcast", [message({ id: "status", timestamp: 40, type: "image" })]],
    ])

    const items = getGalleryImageItems(chats, messagesByChat)

    expect(items.map((item) => item.message.id)).toEqual(["newer", "older"])
    expect(items.map((item) => item.chatName)).toEqual(["Grace", "Ada"])
  })

  it("uses fallback chat names and deterministic ordering for timestamp ties", () => {
    const chats = [
      { id: "111@c.us", contact: { pushname: "Push Name" } },
      { id: "222@c.us", formattedTitle: "Formatted Title" },
    ] as unknown as ChatSummary[]
    const messagesByChat = new Map<string, WAMessageExtended[]>([
      [
        "111@c.us",
        [
          message({ id: "b-tie", timestamp: 50, type: "image" }),
          message({ id: undefined, timestamp: 60, type: "image" }),
        ],
      ],
      ["222@c.us", [message({ id: "a-tie", timestamp: 50, mimetype: "image/gif" })]],
      ["333@c.us", [message({ id: "fallback", timestamp: 40, type: "image" })]],
      ["", [message({ id: "empty-chat", timestamp: 70, type: "image" })]],
    ])

    const items = getGalleryImageItems(chats, messagesByChat)

    expect(items.map((item) => item.message.id)).toEqual(["a-tie", "b-tie", "fallback"])
    expect(items.map((item) => item.chatName)).toEqual(["Formatted Title", "Push Name", "333"])
  })

  it("excludes status broadcast images from aggregated gallery items", () => {
    const chats = [{ id: "status@broadcast", name: "Status" }] as unknown as ChatSummary[]
    const messagesByChat = new Map<string, WAMessageExtended[]>([
      ["status@broadcast", [message({ id: "status-image", timestamp: 99, type: "image" })]],
    ])

    expect(getGalleryImageItems(chats, messagesByChat)).toEqual([])
  })
})
