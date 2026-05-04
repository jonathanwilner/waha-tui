import { describe, expect, it } from "bun:test"

import type { WAMessageExtended } from "~/types"
import {
  getStatusMessages,
  getStatusPreviewText,
  getStatusSenderId,
  getStatusSenderName,
  STATUS_BROADCAST_CHAT_ID,
} from "~/utils/statusMessages"

describe("statusMessages", () => {
  it("uses the WhatsApp status broadcast chat id", () => {
    expect(STATUS_BROADCAST_CHAT_ID).toBe("status@broadcast")
  })

  it("filters system messages and sorts newest first", () => {
    const messages = [
      { id: "old", timestamp: 10, type: "image" },
      { id: "system", timestamp: 30, type: "notification" },
      { id: "new", timestamp: 20, type: "chat", body: "hello" },
    ] as WAMessageExtended[]

    expect(getStatusMessages(messages).map((message) => message.id)).toEqual(["new", "old"])
  })

  it("extracts sender identity from participant or from", () => {
    expect(getStatusSenderId({ participant: "123@c.us" } as WAMessageExtended)).toBe("123@c.us")
    expect(getStatusSenderId({ from: "456@c.us" } as WAMessageExtended)).toBe("456@c.us")
  })

  it("formats sender name and preview text", () => {
    const contacts = new Map([["123@c.us", "Ada"]])
    const message = {
      participant: "123@c.us",
      body: "status body",
      type: "image",
      _data: { caption: "photo caption" },
    } as WAMessageExtended

    expect(getStatusSenderName(message, contacts)).toBe("Ada")
    expect(getStatusPreviewText(message)).toBe("photo caption")
  })
})
