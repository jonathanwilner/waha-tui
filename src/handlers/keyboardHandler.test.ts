import type { ChatSummary } from "@muhammedaksam/waha-node"
import type { KeyEvent } from "@opentui/core"

import { beforeEach, describe, expect, it, mock } from "bun:test"

import type { WAMessageExtended } from "~/types"

const deleteSession = mock(async () => {})
const fetchMyProfile = mock(async () => {})
const loadChats = mock(async () => {})
const loadContacts = mock(async () => {})
const loadMessages = mock(async () => {})
const loadOlderMessages = mock(async () => {})
const loadSessions = mock(async () => {})
const logoutSession = mock(async () => {})
const markActivity = mock(() => {})
const startPresenceManagement = mock(() => {})
const stopPresenceManagement = mock(() => {})

const downloadAndOpenMedia = mock(async () => {})
const reactToMessage = mock(async () => {})
const sendMediaMessage = mock(async () => {})

const blurSearchInput = mock(() => {})
const clearSearchInput = mock(() => {})
const focusSearchInput = mock(() => {})
const blurMessageInput = mock(() => {})
const focusMessageInput = mock(() => {})
const scrollConversation = mock(() => {})
const destroyConversationScrollBox = mock(() => {})
const requestGalleryRefresh = mock(() => {})
const resetGalleryLoadRequest = mock(() => {})
const resetStatusLoadRequest = mock(() => {})

mock.module("~/client", () => ({
  deleteSession,
  fetchMyProfile,
  loadChats,
  loadContacts,
  loadMessages,
  loadOlderMessages,
  loadSessions,
  logoutSession,
  markActivity,
  startPresenceManagement,
  stopPresenceManagement,
}))

mock.module("~/client/messageActions", () => ({
  downloadAndOpenMedia,
  reactToMessage,
  sendMediaMessage,
}))

mock.module("~/components/ContextMenu", () => ({
  getSelectedContextMenuActionId: mock(() => null),
  handleContextMenuKey: mock(() => false),
}))

mock.module("~/components/EmojiPicker", () => ({
  showEmojiPicker: mock(async () => null),
}))

mock.module("~/components/Modal", () => ({
  handleLogoutConfirm: mock(async () => {}),
  showCaptionModal: mock(async () => null),
  showContactPickerModal: mock(async () => null),
  showFilePickerModal: mock(async () => null),
  showPollModal: mock(async () => null),
}))

mock.module("~/components/Toast", () => ({
  showToast: mock(() => {}),
}))

mock.module("~/config/manager", () => ({
  saveSettings: mock(async () => {}),
}))

mock.module("~/handlers", () => ({
  executeContextMenuAction: mock(async () => {}),
}))

mock.module("~/services/WebSocketService", () => ({
  webSocketService: { connect: mock(() => {}) },
}))

mock.module("~/views/ChatListManager", () => ({
  chatListManager: {},
}))

mock.module("~/views/ChatsView", () => ({
  blurSearchInput,
  clearSearchInput,
  focusSearchInput,
}))

mock.module("~/views/ConversationView", () => ({
  blurMessageInput,
  destroyConversationScrollBox,
  focusMessageInput,
  scrollConversation,
}))

mock.module("~/views/GalleryView", () => ({
  requestGalleryRefresh,
  resetGalleryLoadRequest,
}))

mock.module("~/views/QRCodeView", () => ({
  handlePhoneBackspace: mock(() => {}),
  handlePhoneInput: mock(() => {}),
  submitPhoneNumber: mock(async () => {}),
  toggleAuthMode: mock(() => {}),
}))

mock.module("~/views/SessionCreate", () => ({
  createNewSession: mock(async () => {}),
}))

mock.module("~/views/SettingsView", () => ({
  getSettingsMenuItems: mock(() => []),
}))

mock.module("~/views/StatusView", () => ({
  resetStatusLoadRequest,
}))

mock.module("~/utils/createChat", () => ({
  startNewChat: mock(async () => {}),
}))

const { appState } = await import("~/state/AppState")
const { handleKeyPress } = await import("~/handlers/keyboardHandler")
const { STATUS_BROADCAST_CHAT_ID } = await import("~/utils/statusMessages")

function key(name: string, overrides: Partial<KeyEvent> = {}): KeyEvent {
  return {
    name,
    ctrl: false,
    meta: false,
    shift: false,
    ...overrides,
  } as KeyEvent
}

function chat(id: string, name: string): ChatSummary {
  return { id, name } as unknown as ChatSummary
}

function message(overrides: Partial<WAMessageExtended>): WAMessageExtended {
  return {
    id: "message-id",
    timestamp: 1,
    fromMe: false,
    body: "",
    ...overrides,
  } as WAMessageExtended
}

async function press(name: string, overrides: Partial<KeyEvent> = {}): Promise<void> {
  await handleKeyPress(key(name, overrides), { renderApp: mock(() => {}) })
}

function clearMockCalls(): void {
  for (const fn of [
    deleteSession,
    fetchMyProfile,
    loadChats,
    loadContacts,
    loadMessages,
    loadOlderMessages,
    loadSessions,
    logoutSession,
    markActivity,
    startPresenceManagement,
    stopPresenceManagement,
    downloadAndOpenMedia,
    reactToMessage,
    sendMediaMessage,
    blurSearchInput,
    clearSearchInput,
    focusSearchInput,
    blurMessageInput,
    focusMessageInput,
    scrollConversation,
    destroyConversationScrollBox,
    requestGalleryRefresh,
    resetGalleryLoadRequest,
    resetStatusLoadRequest,
  ]) {
    fn.mockClear()
  }
}

describe("keyboardHandler", () => {
  beforeEach(() => {
    appState.reset()
    clearMockCalls()
    blurSearchInput.mockImplementation(() => appState.setInputMode(false))
    clearSearchInput.mockImplementation(() => {
      appState.setSearchQuery("")
      appState.setInputMode(false)
    })
    focusSearchInput.mockImplementation(() => appState.setInputMode(true))
    blurMessageInput.mockImplementation(() => appState.setInputMode(false))
    focusMessageInput.mockImplementation(() => appState.setInputMode(true))
  })

  it("routes g and 4 to gallery after leaving the current chat", async () => {
    appState.setCurrentSession("default")
    appState.setCurrentChat("111@c.us")
    appState.setSelectedGalleryIndex(7)
    appState.setGalleryListScrollOffset(4)

    await press("g")

    expect(stopPresenceManagement).toHaveBeenCalledTimes(1)
    expect(appState.getState().currentChatId).toBeNull()
    expect(appState.getState().currentView).toBe("gallery")
    expect(appState.getState().selectedGalleryIndex).toBe(0)
    expect(appState.getState().galleryListScrollOffset).toBe(0)
    expect(resetGalleryLoadRequest).toHaveBeenCalledTimes(1)
    expect(requestGalleryRefresh).toHaveBeenCalledWith(true)

    appState.setCurrentView("status")
    appState.setSelectedGalleryIndex(3)
    appState.setGalleryListScrollOffset(2)
    clearMockCalls()

    await press("4")

    expect(appState.getState().currentView).toBe("gallery")
    expect(appState.getState().selectedGalleryIndex).toBe(0)
    expect(appState.getState().galleryListScrollOffset).toBe(0)
    expect(requestGalleryRefresh).toHaveBeenCalledWith(true)
  })

  it("blocks gallery shortcuts while input mode is active", async () => {
    appState.setCurrentSession("default")
    appState.setCurrentView("chats")
    appState.setInputMode(true)

    await press("g")
    await press("4")

    expect(appState.getState().currentView).toBe("chats")
    expect(requestGalleryRefresh).not.toHaveBeenCalled()
  })

  it("treats a blank tmux key name as Escape in status and gallery views", async () => {
    appState.setCurrentSession("default")
    appState.setCurrentView("status")

    await press("")

    expect(appState.getState().currentView).toBe("chats")
    expect(appState.getState().currentChatId).toBeNull()

    appState.setCurrentView("gallery")

    await press("")

    expect(appState.getState().currentView).toBe("chats")
    expect(appState.getState().currentChatId).toBeNull()
  })

  it("uses blank Escape to leave chat search without backing out to sessions", async () => {
    appState.setCurrentSession("default")
    appState.setCurrentView("chats")
    appState.setSearchQuery("ada")

    await press("")

    expect(clearSearchInput).toHaveBeenCalledTimes(1)
    expect(appState.getState().searchQuery).toBe("")
    expect(appState.getState().currentView).toBe("chats")
  })

  it("moves Tab to sidebar focus after blurring an active search input", async () => {
    appState.setCurrentSession("default")
    appState.setCurrentView("chats")
    appState.setInputMode(true)

    await press("tab")

    expect(blurSearchInput).toHaveBeenCalledTimes(1)
    expect(appState.getState().inputMode).toBe(false)
    expect(appState.getState().sidebarFocused).toBe(true)
  })

  it("keeps view shortcuts from firing while chat search is focused", async () => {
    appState.setCurrentSession("default")
    appState.setCurrentView("chats")
    appState.setInputMode(true)

    await press("r")
    await press("s")
    await press("n")

    expect(loadChats).not.toHaveBeenCalled()
    expect(appState.getState().currentView).toBe("chats")
  })

  it("navigates status messages and opens the selected status media", async () => {
    appState.setCurrentSession("default")
    appState.setCurrentView("status")
    appState.setMessages(STATUS_BROADCAST_CHAT_ID, [
      message({ id: "old", timestamp: 10, type: "image" }),
      message({ id: "new", timestamp: 20, type: "image" }),
    ])

    await press("down")
    expect(appState.getState().selectedStatusIndex).toBe(1)

    await press("o")
    expect(downloadAndOpenMedia).toHaveBeenCalledWith(STATUS_BROADCAST_CHAT_ID, "old")
  })

  it("navigates gallery items newest first and opens the selected chat media", async () => {
    appState.setCurrentSession("default")
    appState.setCurrentView("gallery")
    appState.setChats([chat("111@c.us", "Ada"), chat("222@c.us", "Grace")])
    appState.setMessages("111@c.us", [message({ id: "older", timestamp: 10, type: "image" })])
    appState.setMessages("222@c.us", [message({ id: "newer", timestamp: 20, type: "image" })])

    await press("down")
    expect(appState.getState().selectedGalleryIndex).toBe(1)

    await press("o")
    expect(downloadAndOpenMedia).toHaveBeenCalledWith("111@c.us", "older")
  })
})
