/**
 * Status/Photos View
 * Shows WhatsApp status@broadcast messages and previews media when available.
 */

import { Box, Text, TextAttributes, VChild } from "@opentui/core"

import type { WAMessageExtended } from "~/types"
import { loadMessages } from "~/client"
import { getImagePreviewState } from "~/client/messageActions"
import { WhatsAppTheme } from "~/config/theme"
import { appState } from "~/state/AppState"
import { getRenderer } from "~/state/RendererContext"
import { debugLog } from "~/utils/debug"
import { formatChatTimestamp, getInitials, truncate } from "~/utils/formatters"
import { getMediaLabel } from "~/utils/mediaLabels"
import {
  getStatusMessages,
  getStatusPreviewText,
  getStatusSenderName,
  STATUS_BROADCAST_CHAT_ID,
} from "~/utils/statusMessages"
import { supportsKittyImages, TerminalImageRenderable } from "~/utils/terminalImages"

let statusLoadState: "idle" | "loading" | "loaded" | "error" = "idle"

export function resetStatusLoadRequest(): void {
  statusLoadState = "idle"
}

function requestStatusMessages(): void {
  if (statusLoadState === "loading" || statusLoadState === "loaded") return
  statusLoadState = "loading"
  void loadMessages(STATUS_BROADCAST_CHAT_ID)
    .then(() => {
      statusLoadState = "loaded"
    })
    .catch((error) => {
      debugLog("StatusView", `Failed to load status messages: ${error}`)
      statusLoadState = "error"
    })
    .finally(() => {
      appState.setLastChangeType("data")
    })
}

function isImageStatus(message: WAMessageExtended): boolean {
  const type = message.type ?? message._data?.type ?? ""
  const mimetype = message.mimetype ?? message.media?.mimetype ?? message._data?.mimetype ?? ""
  return type === "image" || mimetype.startsWith("image/")
}

function StatusList(statuses: WAMessageExtended[]) {
  const state = appState.getState()
  const start = Math.max(0, state.statusListScrollOffset)
  const visible = statuses.slice(start, start + 24)

  return Box(
    {
      flexDirection: "column",
      flexGrow: 1,
      backgroundColor: WhatsAppTheme.panelDark,
    },
    Box(
      {
        height: 4,
        flexDirection: "column",
        justifyContent: "center",
        paddingLeft: 2,
        border: true,
        borderColor: WhatsAppTheme.borderColor,
      },
      Text({ content: "Status", fg: WhatsAppTheme.white, attributes: TextAttributes.BOLD }),
      Text({ content: "Recent photos and updates", fg: WhatsAppTheme.textSecondary })
    ),
    ...(statuses.length === 0
      ? [
          Box(
            {
              flexGrow: 1,
              justifyContent: "center",
              alignItems: "center",
              paddingLeft: 2,
              paddingRight: 2,
            },
            Text({
              content:
                statusLoadState === "loading"
                  ? "Loading status updates..."
                  : statusLoadState === "error"
                    ? "Could not load status updates"
                    : "No status updates",
              fg: WhatsAppTheme.textSecondary,
            })
          ),
        ]
      : visible.map((message, index) => {
          const absoluteIndex = start + index
          const selected = absoluteIndex === state.selectedStatusIndex
          const sender = getStatusSenderName(message, state.allContacts)
          const preview = getStatusPreviewText(message)
          const media = getMediaLabel(message)

          return Box(
            {
              height: 4,
              flexDirection: "row",
              alignItems: "center",
              paddingLeft: 1,
              paddingRight: 1,
              backgroundColor: selected ? WhatsAppTheme.activeBg : WhatsAppTheme.panelDark,
              border: true,
              borderColor: WhatsAppTheme.borderColor,
              onMouse(event) {
                if (event.type === "down" && event.button === 0) {
                  appState.setSelectedStatusIndex(absoluteIndex)
                  appState.setLastChangeType("selection")
                  event.stopPropagation()
                }
              },
            },
            Box(
              {
                width: 5,
                height: 3,
                justifyContent: "center",
                alignItems: "center",
                backgroundColor: WhatsAppTheme.green,
                marginRight: 1,
              },
              Text({
                content: getInitials(sender),
                fg: WhatsAppTheme.white,
                attributes: TextAttributes.BOLD,
              })
            ),
            Box(
              {
                flexDirection: "column",
                flexGrow: 1,
              },
              Text({
                content: truncate(sender, 24),
                fg: selected ? WhatsAppTheme.white : WhatsAppTheme.textPrimary,
                attributes: selected ? TextAttributes.BOLD : undefined,
              }),
              Text({
                content: truncate(media.label || preview, 28),
                fg: WhatsAppTheme.textSecondary,
              })
            ),
            Text({
              content: formatChatTimestamp(message.timestamp),
              fg: WhatsAppTheme.textTertiary,
            })
          )
        }))
  )
}

function StatusPreview(message: WAMessageExtended | undefined) {
  const renderer = getRenderer()
  const state = appState.getState()

  if (!message) {
    return Box(
      {
        flexDirection: "column",
        flexGrow: 1,
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: WhatsAppTheme.deepDark,
      },
      Text({ content: "Select a status update", fg: WhatsAppTheme.textSecondary })
    )
  }

  const sender = getStatusSenderName(message, state.allContacts)
  const media = getMediaLabel(message)
  const caption = media.caption || (media.hasMedia ? "" : message.body || "")
  const previewState =
    isImageStatus(message) && supportsKittyImages()
      ? getImagePreviewState(STATUS_BROADCAST_CHAT_ID, message, () =>
          appState.setLastChangeType("data")
        )
      : { status: "idle" as const }

  const content: VChild[] = [
    Box(
      {
        height: 5,
        flexDirection: "row",
        alignItems: "center",
        paddingLeft: 2,
        paddingRight: 2,
        backgroundColor: WhatsAppTheme.panelLight,
        border: true,
        borderColor: WhatsAppTheme.borderLight,
      },
      Box(
        {
          width: 7,
          height: 3,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: WhatsAppTheme.green,
          marginRight: 2,
        },
        Text({
          content: getInitials(sender),
          fg: WhatsAppTheme.white,
          attributes: TextAttributes.BOLD,
        })
      ),
      Box(
        {
          flexDirection: "column",
          flexGrow: 1,
        },
        Text({ content: sender, fg: WhatsAppTheme.white, attributes: TextAttributes.BOLD }),
        Text({
          content: formatChatTimestamp(message.timestamp),
          fg: WhatsAppTheme.textSecondary,
        })
      )
    ),
  ]

  if (previewState.status === "ready") {
    content.push(
      Box(
        {
          flexGrow: 1,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: WhatsAppTheme.deepDark,
        },
        new TerminalImageRenderable(renderer, `status-${message.id}`, previewState.filePath, 42, 18)
      )
    )
  } else {
    const body =
      previewState.status === "loading"
        ? "Loading photo preview..."
        : media.label || message.body || "Status update"

    content.push(
      Box(
        {
          flexGrow: 1,
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          paddingLeft: 4,
          paddingRight: 4,
          backgroundColor: WhatsAppTheme.deepDark,
        },
        Text({
          content: body,
          fg: WhatsAppTheme.textPrimary,
          attributes: TextAttributes.BOLD,
        }),
        Text({
          content: "Press o to open media externally",
          fg: WhatsAppTheme.textSecondary,
        })
      )
    )
  }

  if (caption) {
    content.push(
      Box(
        {
          minHeight: 3,
          paddingLeft: 2,
          paddingRight: 2,
          justifyContent: "center",
          backgroundColor: WhatsAppTheme.panelLight,
          border: true,
          borderColor: WhatsAppTheme.borderLight,
        },
        Text({ content: truncate(caption, 120), fg: WhatsAppTheme.textPrimary })
      )
    )
  }

  return Box(
    {
      flexDirection: "column",
      flexGrow: 1,
      backgroundColor: WhatsAppTheme.deepDark,
    },
    ...content
  )
}

export function StatusView() {
  requestStatusMessages()

  const state = appState.getState()
  const statuses = getStatusMessages(state.messages.get(STATUS_BROADCAST_CHAT_ID) || [])
  const selectedIndex = Math.min(state.selectedStatusIndex, Math.max(0, statuses.length - 1))
  const selected = statuses[selectedIndex]

  if (selectedIndex !== state.selectedStatusIndex) {
    appState.setSelectedStatusIndex(selectedIndex)
  }

  return {
    leftPanel: StatusList(statuses),
    rightPanel: StatusPreview(selected),
  }
}
