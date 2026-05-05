import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { isAbsolute } from "node:path"

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

export type TerminalImageProtocol = "kitty" | "sixel"

export interface TerminalImageSupport {
  protocol: TerminalImageProtocol
  passthrough: boolean
  command?: "chafa"
  reason: string
}

type TerminalEnv = NodeJS.ProcessEnv
type ChafaRunner = (args: string[]) => {
  status: number | null
  stdout: string
  stderr: string
}

const placements = new Map<string, ImagePlacement>()
let frameRegistered = false
let wroteImages = false
let lastSignature = ""
let lastWriteAt = 0
let cachedSupport: TerminalImageSupport | null | undefined
const chafaOutputCache = new Map<string, string | null>()

function envValue(env: TerminalEnv, name: string): string {
  return (env[name] || "").toLowerCase()
}

function insideTmux(env: TerminalEnv): boolean {
  return !!env.TMUX
}

function tmuxClientTerminal(env: TerminalEnv): string {
  if (!insideTmux(env)) return ""
  if (env.WAHA_TUI_TMUX_CLIENT_TERM) return env.WAHA_TUI_TMUX_CLIENT_TERM.toLowerCase()

  const result = spawnSync(
    "tmux",
    ["display-message", "-p", "#{client_termname} #{client_termfeatures} #{client_termtype}"],
    {
      encoding: "utf8",
    }
  )
  if (result.status !== 0) return ""
  return result.stdout.toLowerCase()
}

function hasKnownKittySupport(env: TerminalEnv): boolean {
  const term = envValue(env, "TERM")
  const termProgram = envValue(env, "TERM_PROGRAM")
  const tmuxClient = tmuxClientTerminal(env)

  return Boolean(
    termProgram.includes("ghostty") ||
    termProgram.includes("wezterm") ||
    tmuxClient.includes("ghostty") ||
    tmuxClient.includes("kitty") ||
    tmuxClient.includes("wezterm") ||
    !!env.KITTY_WINDOW_ID ||
    !!env.WEZTERM_PANE ||
    term.includes("kitty") ||
    term.includes("ghostty") ||
    term.includes("wezterm")
  )
}

function hasKnownSixelSupport(env: TerminalEnv): boolean {
  if (env.WAHA_TUI_SIXEL === "1") return true

  const term = envValue(env, "TERM")
  const termProgram = envValue(env, "TERM_PROGRAM")

  return Boolean(
    termProgram.includes("wezterm") ||
    termProgram.includes("mlterm") ||
    termProgram.includes("foot") ||
    term.includes("sixel") ||
    term.includes("mlterm") ||
    term.includes("foot") ||
    term.includes("contour")
  )
}

function commandExists(command: string): boolean {
  const result = spawnSync("sh", ["-lc", `command -v ${command}`], {
    stdio: "ignore",
  })
  return result.status === 0
}

export function detectTerminalImageSupport(
  env: TerminalEnv = process.env,
  hasCommand: (command: string) => boolean = commandExists
): TerminalImageSupport | null {
  if (env.WAHA_TUI_INLINE_IMAGES === "0") {
    return null
  }

  const tmux = insideTmux(env)
  const tmuxPassthroughDisabled = tmux && env.WAHA_TUI_TMUX_PASSTHROUGH === "0"
  const passthrough = tmux && !tmuxPassthroughDisabled
  const forcedProtocol = env.WAHA_TUI_IMAGE_PROTOCOL?.toLowerCase()
  const chafaAvailable = (): boolean => hasCommand("chafa")

  if (forcedProtocol === "kitty") {
    if (tmuxPassthroughDisabled) return null
    return { protocol: "kitty", passthrough, reason: "forced-kitty" }
  }
  if (forcedProtocol === "sixel") {
    if (tmuxPassthroughDisabled) return null
    return chafaAvailable()
      ? { protocol: "sixel", passthrough, command: "chafa", reason: "forced-sixel" }
      : null
  }
  if (forcedProtocol === "symbols") {
    return null
  }

  if (env.WAHA_TUI_INLINE_IMAGES === "1") {
    if (tmuxPassthroughDisabled) return null
    return { protocol: "kitty", passthrough, reason: "forced" }
  }
  if (!tmuxPassthroughDisabled && hasKnownKittySupport(env)) {
    return { protocol: "kitty", passthrough, reason: passthrough ? "tmux-kitty" : "kitty" }
  }
  if (!tmuxPassthroughDisabled && hasKnownSixelSupport(env) && chafaAvailable()) {
    return { protocol: "sixel", passthrough, command: "chafa", reason: "sixel-chafa" }
  }
  return null
}

export function detectKittyImageSupport(env: TerminalEnv = process.env): {
  supported: boolean
  passthrough: boolean
  reason: string
} {
  const support = detectTerminalImageSupport(env)
  if (env.WAHA_TUI_INLINE_IMAGES === "0") {
    return { supported: false, passthrough: false, reason: "disabled" }
  }
  if (insideTmux(env) && env.WAHA_TUI_TMUX_PASSTHROUGH === "0") {
    return { supported: false, passthrough: false, reason: "tmux-passthrough-disabled" }
  }
  return {
    supported: support?.protocol === "kitty",
    passthrough: support?.protocol === "kitty" ? support.passthrough : false,
    reason: support?.protocol === "kitty" ? support.reason : "unsupported-terminal",
  }
}

export function getTerminalImageSupport(): TerminalImageSupport | null {
  if (cachedSupport === undefined) {
    cachedSupport = detectTerminalImageSupport()
  }
  return cachedSupport
}

export function resetTerminalImageSupportCache(): void {
  cachedSupport = undefined
}

export function resetTerminalImageOutputCache(): void {
  chafaOutputCache.clear()
}

export function supportsKittyImages(env: TerminalEnv = process.env): boolean {
  return detectKittyImageSupport(env).supported
}

export function supportsTerminalImages(): boolean {
  return getTerminalImageSupport() !== null
}

export function tmuxPassthrough(data: string): string {
  return `\x1bPtmux;${data.replaceAll("\x1b", "\x1b\x1b")}\x1b\\`
}

export function wrapKittyGraphics(data: string, env: TerminalEnv = process.env): string {
  return detectKittyImageSupport(env).passthrough ? tmuxPassthrough(data) : data
}

function wrapTerminalGraphics(data: string, support: TerminalImageSupport): string {
  return support.passthrough ? tmuxPassthrough(data) : data
}

function writeRaw(renderer: CliRenderer, data: string): void {
  const renderWrite = (renderer as unknown as { writeOut?: (data: string) => void }).writeOut
  if (typeof renderWrite === "function") {
    renderWrite.call(renderer, data)
    return
  }
  process.stdout.write(data)
}

export function buildKittyFileImageCommand(
  filePath: string,
  width: number,
  height: number
): string | null {
  if (!isAbsolute(filePath)) {
    debugLog("TerminalImage", `Skipping non-absolute image preview path: ${filePath}`)
    return null
  }

  if (!existsSync(filePath)) {
    debugLog("TerminalImage", `Skipping missing image preview path: ${filePath}`)
    return null
  }

  const columns = Math.max(1, Math.floor(width))
  const rows = Math.max(1, Math.floor(height))
  const payload = Buffer.from(filePath, "utf8").toString("base64")
  return `\x1b_Ga=T,t=f,c=${columns},r=${rows};${payload}\x1b\\`
}

export function buildChafaImageCommandArgs(
  filePath: string,
  width: number,
  height: number,
  protocol: string
): string[] | null {
  if (protocol !== "sixel") {
    debugLog("TerminalImage", `Skipping unsupported chafa image protocol: ${protocol}`)
    return null
  }

  if (!isAbsolute(filePath)) {
    debugLog("TerminalImage", `Skipping non-absolute image preview path: ${filePath}`)
    return null
  }

  if (!existsSync(filePath)) {
    debugLog("TerminalImage", `Skipping missing image preview path: ${filePath}`)
    return null
  }

  const columns = Math.max(1, Math.floor(width))
  const rows = Math.max(1, Math.floor(height))
  return ["--format=sixels", `--size=${columns}x${rows}`, filePath]
}

export function buildChafaImageOutput(
  filePath: string,
  width: number,
  height: number,
  protocol: string,
  runChafa: ChafaRunner = (args) => {
    const result = spawnSync("chafa", args, {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    })
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    }
  }
): string | null {
  const cacheKey = `${protocol}:${filePath}:${Math.max(1, Math.floor(width))}x${Math.max(1, Math.floor(height))}`
  if (chafaOutputCache.has(cacheKey)) {
    return chafaOutputCache.get(cacheKey) ?? null
  }

  const args = buildChafaImageCommandArgs(filePath, width, height, protocol)
  if (!args) {
    chafaOutputCache.set(cacheKey, null)
    return null
  }

  const result = runChafa(args)

  if (result.status !== 0) {
    debugLog("TerminalImage", `chafa failed for image preview ${filePath}: ${result.stderr}`)
    chafaOutputCache.set(cacheKey, null)
    return null
  }

  chafaOutputCache.set(cacheKey, result.stdout)
  return result.stdout
}

function buildTerminalImageOutput(
  placement: ImagePlacement,
  support: TerminalImageSupport
): string | null {
  if (support.protocol === "kitty") {
    return buildKittyFileImageCommand(placement.filePath, placement.width, placement.height)
  }

  return buildChafaImageOutput(
    placement.filePath,
    placement.width,
    placement.height,
    support.protocol
  )
}

function flushKittyImages(renderer: CliRenderer): void {
  const support = getTerminalImageSupport()
  if (!support) return

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
      if (support.protocol === "kitty") {
        writeRaw(renderer, wrapTerminalGraphics("\x1b_Ga=d,d=A\x1b\\", support))
      }
      wroteImages = false
    }
    return
  }

  const chunks = ["\x1b7"]
  if (support.protocol === "kitty") {
    chunks.push(wrapTerminalGraphics("\x1b_Ga=d,d=A\x1b\\", support))
  }

  for (const placement of ordered) {
    const image = buildTerminalImageOutput(placement, support)
    if (!image) continue
    chunks.push(`\x1b[${placement.y + 1};${placement.x + 1}H`, wrapTerminalGraphics(image, support))
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

    if (!supportsTerminalImages()) return
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
