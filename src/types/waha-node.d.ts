import "@muhammedaksam/waha-node"

declare module "@muhammedaksam/waha-node" {
  interface ChatSummary {
    unreadCount?: number | null
    isMuted?: boolean
    _chat?: {
      unreadCount?: number | null
      isMuted?: boolean
    }
  }
}

export {}
