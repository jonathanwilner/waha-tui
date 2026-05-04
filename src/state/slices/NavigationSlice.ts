import { SliceActions, StateSlice } from "~/state/slices/types"

// Type of state change - enables render optimization
export type ChangeType = "selection" | "scroll" | "data" | "view" | "other"

export interface NavigationState {
  selectedSessionIndex: number
  selectedChatIndex: number
  selectedStatusIndex: number
  chatListScrollOffset: number
  statusListScrollOffset: number
  lastChangeType: ChangeType
}

export const initialNavigationState: NavigationState = {
  selectedSessionIndex: 0,
  selectedChatIndex: 0,
  selectedStatusIndex: 0,
  chatListScrollOffset: 0,
  statusListScrollOffset: 0,
  lastChangeType: "other",
}

export interface NavigationActions extends SliceActions<NavigationState> {
  setSelectedSessionIndex(selectedSessionIndex: number): void
  setSelectedChatIndex(selectedChatIndex: number): void
  setSelectedStatusIndex(selectedStatusIndex: number): void
  setChatListScrollOffset(chatListScrollOffset: number): void
  setStatusListScrollOffset(statusListScrollOffset: number): void
}

export function createNavigationSlice(): StateSlice<NavigationState> & NavigationActions {
  let state: NavigationState = { ...initialNavigationState }
  const listeners: Array<(state: NavigationState) => void> = []

  const notify = () => {
    listeners.forEach((l) => l(state))
  }

  return {
    name: "navigation",
    get: () => ({ ...state }),
    set: (updates: Partial<NavigationState>) => {
      state = { ...state, ...updates }
      notify()
    },
    getState: () => ({ ...state }),
    setState: (updates: Partial<NavigationState>) => {
      state = { ...state, ...updates }
      notify()
    },
    subscribe: (listener: (state: NavigationState) => void) => {
      listeners.push(listener)
      return () => {
        const index = listeners.indexOf(listener)
        if (index > -1) listeners.splice(index, 1)
      }
    },
    reset: () => {
      state = { ...initialNavigationState }
      notify()
    },

    setSelectedSessionIndex(selectedSessionIndex: number) {
      state = { ...state, selectedSessionIndex }
      notify()
    },

    setSelectedChatIndex(selectedChatIndex: number) {
      state = { ...state, selectedChatIndex }
      notify()
    },

    setSelectedStatusIndex(selectedStatusIndex: number) {
      state = { ...state, selectedStatusIndex }
      notify()
    },

    setChatListScrollOffset(chatListScrollOffset: number) {
      state = { ...state, chatListScrollOffset }
      notify()
    },

    setStatusListScrollOffset(statusListScrollOffset: number) {
      state = { ...state, statusListScrollOffset }
      notify()
    },
  }
}
