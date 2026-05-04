import { readFileSync } from "node:fs"

import { BoxRenderable, CliRenderer } from "@opentui/core"

import { debugLog } from "~/utils/debug"

interface ImagePlacement {
  id: string
  filePath: string
  x: number
  y: number
  width: number
  height: number
}

const placements = new Map<string, ImagePlacement>()
let frameRegistered = false
let wroteImages = false
let lastSignature = ""
let lastWriteAt = 0

function envValue(name: string): string {
  return (process.env[name] || "").toLowerCase()
}

export function supportsKittyImages(): boolean {
  if (process.env.WAHA_TUI_INLINE_IMAGES === "0") return false
  if (process.env.WAHA_TUI_INLINE_IMAGES === "1") return true

  const term = envValue("TERM")
  const termProgram = envValue("TERM_PROGRAM")

  return (
    termProgram.includes("ghostty") ||
    termProgram.includes("wezterm") ||
    !!process.env.KITTY_WINDOW_ID ||
    !!process.env.WEZTERM_PANE ||
    term.includes("kitty") ||
    term.includes("ghostty") ||
    term.includes("wezterm")
  )
}

function writeRaw(renderer: CliRenderer, data: string): void {
  const renderWrite = (renderer as unknown as { writeOut?: (data: string) => void }).writeOut
  if (typeof renderWrite === "function") {
    renderWrite.call(renderer, data)
    return
  }
  process.stdout.write(data)
}

function encodeKittyImage(filePath: string, width: number, height: number): string | null {
  try {
    const payload = readFileSync(filePath).toString("base64")
    return `\x1b_Ga=T,f=100,t=d,c=${width},r=${height};${payload}\x1b\\`
  } catch (error) {
    debugLog("TerminalImage", `Failed to read image preview ${filePath}: ${error}`)
    return null
  }
}

function flushKittyImages(renderer: CliRenderer): void {
  if (!supportsKittyImages()) return

  const ordered = [...placements.values()].sort((a, b) => a.y - b.y || a.x - b.x)
  const signature = ordered
    .map((p) => `${p.id}:${p.filePath}:${p.x}:${p.y}:${p.width}:${p.height}`)
    .join("|")
  const now = Date.now()

  if (signature === lastSignature && now - lastWriteAt < 1000) return

  lastSignature = signature
  lastWriteAt = now

  if (ordered.length === 0) {
    if (wroteImages) {
      writeRaw(renderer, "\x1b_Ga=d,d=A\x1b\\")
      wroteImages = false
    }
    return
  }

  const chunks = ["\x1b7", "\x1b_Ga=d,d=A\x1b\\"]
  for (const placement of ordered) {
    const image = encodeKittyImage(placement.filePath, placement.width, placement.height)
    if (!image) continue
    chunks.push(`\x1b[${placement.y + 1};${placement.x + 1}H`, image)
  }
  chunks.push("\x1b8")

  writeRaw(renderer, chunks.join(""))
  wroteImages = true
}

export function setupTerminalImageRenderer(renderer: CliRenderer): void {
  if (frameRegistered) return
  frameRegistered = true

  renderer.setFrameCallback(async () => {
    placements.clear()
    setTimeout(() => flushKittyImages(renderer), 0)
  })
}

export class TerminalImageRenderable extends BoxRenderable {
  private readonly imageId: string
  private readonly filePath: string

  constructor(
    renderer: CliRenderer,
    imageId: string,
    filePath: string,
    width: number,
    height: number
  ) {
    super(renderer, {
      id: `terminal-image-${imageId}`,
      width,
      height,
      flexShrink: 0,
    })
    this.imageId = imageId
    this.filePath = filePath
  }

  render(buffer: Parameters<BoxRenderable["render"]>[0], deltaTime: number): void {
    super.render(buffer, deltaTime)

    if (!supportsKittyImages()) return
    if (this.width <= 0 || this.height <= 0) return

    placements.set(this.imageId, {
      id: this.imageId,
      filePath: this.filePath,
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
    })
  }
}
