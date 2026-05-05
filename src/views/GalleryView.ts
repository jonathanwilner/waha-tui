/**
 * Gallery View
 * Browse recent WhatsApp image messages across chats.
 */

import { Box, Text, TextAttributes, VChild } from "@opentui/core"

import type { GalleryImageItem } from "~/utils/galleryMessages"
import { getImagePreviewState, loadRecentGalleryMessages } from "~/client/messageActions"
import { WhatsAppTheme } from "~/config/theme"
import { appState } from "~/state/AppState"
import { getRenderer } from "~/state/RendererContext"
import { debugLog } from "~/utils/debug"
import { formatChatTimestamp, truncate } from "~/utils/formatters"
import { getGalleryImageItems } from "~/utils/galleryMessages"
import { getMediaLabel } from "~/utils/mediaLabels"
import { supportsKittyImages, TerminalImageRenderable } from "~/utils/terminalImages"

let galleryLoadState: "idle" | "loading" | "loaded" | "error" = "idle"

export function resetGalleryLoadRequest(): void {
  galleryLoadState = "idle"
}

export function requestGalleryRefresh(force = false): void {
  if (galleryLoadState === "loading") return
  if (!force && galleryLoadState === "loaded") return

  galleryLoadState = "loading"
  void loadRecentGalleryMessages({ force })
    .then(() => {
      galleryLoadState = "loaded"
    })
    .catch((error) => {
      debugLog("GalleryView", `Failed to load gallery messages: ${error}`)
      galleryLoadState = "error"
    })
    .finally(() => {
      appState.setLastChangeType("data")
    })
}

function GalleryList(items: GalleryImageItem[]) {
  const state = appState.getState()
  const start = Math.max(0, state.galleryListScrollOffset)
  const visible = items.slice(start, start + 24)

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
      Text({ content: "Gallery", fg: WhatsAppTheme.white, attributes: TextAttributes.BOLD }),
      Text({
        content:
          galleryLoadState === "loading"
            ? "Scanning recent chats for images"
            : `${items.length} image${items.length === 1 ? "" : "s"}`,
        fg: WhatsAppTheme.textSecondary,
      })
    ),
    ...(items.length === 0
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
                galleryLoadState === "loading"
                  ? "Loading image gallery..."
                  : galleryLoadState === "error"
                    ? "Could not load image gallery"
                    : "No images found in recent chats",
              fg: WhatsAppTheme.textSecondary,
            })
          ),
        ]
      : visible.map((item, index) => {
          const absoluteIndex = start + index
          const selected = absoluteIndex === state.selectedGalleryIndex
          const media = getMediaLabel(item.message)
          const caption = media.caption || item.message.body || media.label || "Photo"

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
                  appState.setSelectedGalleryIndex(absoluteIndex)
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
                backgroundColor: item.message.fromMe
                  ? WhatsAppTheme.greenDark
                  : WhatsAppTheme.green,
                marginRight: 1,
              },
              Text({
                content: item.message.fromMe ? "Me" : "Img",
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
                content: truncate(item.chatName, 24),
                fg: selected ? WhatsAppTheme.white : WhatsAppTheme.textPrimary,
                attributes: selected ? TextAttributes.BOLD : undefined,
              }),
              Text({
                content: truncate(caption.replace(/\r?\n/g, " "), 28),
                fg: WhatsAppTheme.textSecondary,
              })
            ),
            Text({
              content: formatChatTimestamp(item.message.timestamp),
              fg: WhatsAppTheme.textTertiary,
            })
          )
        }))
  )
}

function GalleryPreview(item: GalleryImageItem | undefined) {
  const renderer = getRenderer()

  if (!item) {
    return Box(
      {
        flexDirection: "column",
        flexGrow: 1,
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: WhatsAppTheme.deepDark,
      },
      Text({ content: "Select an image", fg: WhatsAppTheme.textSecondary })
    )
  }

  const media = getMediaLabel(item.message)
  const caption = media.caption || item.message.body || ""
  const previewState = supportsKittyImages()
    ? getImagePreviewState(item.chatId, item.message, () => appState.setLastChangeType("data"))
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
          backgroundColor: item.message.fromMe ? WhatsAppTheme.greenDark : WhatsAppTheme.green,
          marginRight: 2,
        },
        Text({
          content: item.message.fromMe ? "Sent" : "Got",
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
          content: truncate(item.chatName, 80),
          fg: WhatsAppTheme.white,
          attributes: TextAttributes.BOLD,
        }),
        Text({
          content: `${formatChatTimestamp(item.message.timestamp)} - press o to open externally`,
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
        new TerminalImageRenderable(
          renderer,
          `gallery-${item.message.id}`,
          previewState.filePath,
          52,
          22
        )
      )
    )
  } else {
    const body =
      previewState.status === "loading"
        ? "Loading image preview..."
        : previewState.status === "error"
          ? "Preview unavailable; press o to open externally"
          : media.label || "Photo"

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
        Text({ content: "Press r to refresh the gallery", fg: WhatsAppTheme.textSecondary })
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
        Text({
          content: truncate(caption.replace(/\r?\n/g, " "), 120),
          fg: WhatsAppTheme.textPrimary,
        })
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

export function GalleryView() {
  requestGalleryRefresh()

  const state = appState.getState()
  const items = getGalleryImageItems(state.chats, state.messages)
  const selectedIndex = Math.min(state.selectedGalleryIndex, Math.max(0, items.length - 1))
  const selected = items[selectedIndex]

  if (selectedIndex !== state.selectedGalleryIndex) {
    appState.setSelectedGalleryIndex(selectedIndex)
  }

  return {
    leftPanel: GalleryList(items),
    rightPanel: GalleryPreview(selected),
  }
}
