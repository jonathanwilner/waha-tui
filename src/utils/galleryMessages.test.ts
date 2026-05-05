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
})
