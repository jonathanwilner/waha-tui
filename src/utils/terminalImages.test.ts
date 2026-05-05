import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "bun:test"

import {
  buildChafaImageCommandArgs,
  buildChafaImageOutput,
  buildKittyFileImageCommand,
  detectKittyImageSupport,
  detectTerminalImageSupport,
  resetTerminalImageOutputCache,
  tmuxPassthrough,
  wrapKittyGraphics,
} from "~/utils/terminalImages"

function hasCommands(commands: string[]): (command: string) => boolean {
  return (command: string) => commands.includes(command)
}

function withTempImage(assertions: (filePath: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "waha-tui-terminal-images-"))
  const filePath = join(dir, "photo.png")
  writeFileSync(filePath, "not-a-real-image")

  try {
    assertions(filePath)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe("terminalImages", () => {
  it("selects Kitty graphics for Ghostty through chafa", () => {
    const support = detectTerminalImageSupport(
      { TERM_PROGRAM: "ghostty", TERM: "xterm-256color" },
      hasCommands(["chafa"])
    )

    expect(support).toEqual({
      protocol: "kitty",
      passthrough: false,
      command: "chafa",
      reason: "kitty",
    })
  })

  it("does not use remote file-path Kitty graphics for Ghostty without chafa", () => {
    const support = detectTerminalImageSupport(
      { TERM: "xterm-ghostty", SSH_CONNECTION: "192.0.2.1 50000 192.0.2.2 22" },
      hasCommands([])
    )

    expect(support).toBeNull()
  })

  it("uses tmux passthrough for known Kitty-capable terminals without sixel", () => {
    const support = detectTerminalImageSupport(
      {
        TERM_PROGRAM: "tmux",
        TERM: "tmux-256color",
        TMUX: "/tmp/tmux",
        WAHA_TUI_TMUX_CLIENT_TERM: "xterm-kitty RGB,title",
      },
      hasCommands(["chafa"])
    )

    expect(support?.protocol).toBe("kitty")
    expect(support?.passthrough).toBe(true)
    expect(support?.command).toBe("chafa")
  })

  it("prefers sixel for tmux clients that advertise sixel support", () => {
    const support = detectTerminalImageSupport(
      {
        TERM_PROGRAM: "tmux",
        TERM: "tmux-256color",
        TMUX: "/tmp/tmux",
        WAHA_TUI_TMUX_CLIENT_TERM: "xterm-ghostty bpaste,RGB,sixel,title",
      },
      hasCommands(["chafa"])
    )

    expect(support).toEqual({
      protocol: "sixel",
      passthrough: false,
      command: "chafa",
      reason: "sixel-chafa",
    })
  })

  it("prefers sixel for Ghostty tmux clients even when tmux omits the sixel feature", () => {
    const support = detectTerminalImageSupport(
      {
        TERM_PROGRAM: "tmux",
        TERM: "tmux-256color",
        TMUX: "/tmp/tmux",
        WAHA_TUI_TMUX_CLIENT_TERM: "xterm-ghostty bpaste,RGB,title",
      },
      hasCommands(["chafa"])
    )

    expect(support).toEqual({
      protocol: "sixel",
      passthrough: false,
      command: "chafa",
      reason: "sixel-chafa",
    })
  })

  it("detects Kitty-capable tmux clients when sixel is not available", () => {
    const support = detectTerminalImageSupport(
      {
        TERM_PROGRAM: "tmux",
        TERM: "tmux-256color",
        TMUX: "/tmp/tmux",
        WAHA_TUI_TMUX_CLIENT_TERM: "xterm-ghostty bpaste,RGB,title ghostty 1.3.1",
      },
      hasCommands([])
    )

    expect(support).toBeNull()
  })

  it("does not assume tmux alone means inline image support", () => {
    const support = detectTerminalImageSupport(
      { TERM: "tmux-256color", TMUX: "/tmp/tmux", WAHA_TUI_TMUX_CLIENT_TERM: "unknown" },
      hasCommands([])
    )

    expect(support).toBeNull()
  })

  it("does not emit Kitty graphics through tmux when passthrough is disabled", () => {
    const support = detectKittyImageSupport({
      TERM: "xterm-kitty",
      TMUX: "/tmp/tmux",
      WAHA_TUI_TMUX_PASSTHROUGH: "0",
    })

    expect(support).toEqual({
      supported: false,
      passthrough: false,
      reason: "tmux-passthrough-disabled",
    })
  })

  it("selects sixel through chafa for sixel-capable terminals", () => {
    const support = detectTerminalImageSupport(
      { TERM: "xterm-sixel", TERM_PROGRAM: "foot" },
      hasCommands(["chafa"])
    )

    expect(support).toEqual({
      protocol: "sixel",
      passthrough: false,
      command: "chafa",
      reason: "sixel-chafa",
    })
  })

  it("does not use symbol fallback because raw text output corrupts TUI layout", () => {
    const support = detectTerminalImageSupport(
      { TERM: "xterm-256color", TERM_PROGRAM: "Alacritty" },
      hasCommands(["chafa"])
    )

    expect(support).toBeNull()
  })

  it("does not honor forced symbol fallback", () => {
    const support = detectTerminalImageSupport(
      { TERM: "xterm-256color", WAHA_TUI_IMAGE_PROTOCOL: "symbols" },
      hasCommands(["chafa"])
    )

    expect(support).toBeNull()
  })

  it("honors inline image disable even when the terminal is capable", () => {
    const support = detectTerminalImageSupport(
      { WAHA_TUI_INLINE_IMAGES: "0", TERM_PROGRAM: "ghostty" },
      hasCommands(["chafa"])
    )

    expect(support).toBeNull()
  })

  it("builds chafa sixel command args with the selected terminal format", () => {
    withTempImage((filePath) => {
      expect(buildChafaImageCommandArgs(filePath, 42.8, 18.2, "sixel")).toEqual([
        "--format=sixels",
        "--size=42x18",
        filePath,
      ])
    })
  })

  it("builds chafa Kitty command args for SSH-safe inline image data", () => {
    withTempImage((filePath) => {
      expect(buildChafaImageCommandArgs(filePath, 42.8, 18.2, "kitty")).toEqual([
        "--format=kitty",
        "--size=42x18",
        filePath,
      ])
    })
  })

  it("does not build chafa symbol fallback output that could spill text into layout", () => {
    withTempImage((filePath) => {
      expect(buildChafaImageCommandArgs(filePath, 30, 10, "symbols")).toBeNull()
    })
  })

  it("does not emit chafa commands for fallback paths", () => {
    expect(buildChafaImageCommandArgs("relative.png", 10, 5, "sixel")).toBeNull()
    expect(
      buildChafaImageCommandArgs("/tmp/waha-tui-missing-preview.png", 10, 5, "sixel")
    ).toBeNull()
  })

  it("caches chafa output for the same image placement", () => {
    let runs = 0
    resetTerminalImageOutputCache()

    withTempImage((filePath) => {
      const runChafa = (): { status: number; stdout: string; stderr: string } => {
        runs += 1
        return { status: 0, stdout: "\x1bPqcached\x1b\\", stderr: "" }
      }

      expect(buildChafaImageOutput(filePath, 12, 6, "sixel", runChafa)).toBe("\x1bPqcached\x1b\\")
      expect(buildChafaImageOutput(filePath, 12.9, 6.8, "sixel", runChafa)).toBe(
        "\x1bPqcached\x1b\\"
      )
      expect(runs).toBe(1)
    })

    resetTerminalImageOutputCache()
  })

  it("caches chafa Kitty output for the same image placement", () => {
    let runs = 0
    resetTerminalImageOutputCache()

    withTempImage((filePath) => {
      const runChafa = (): { status: number; stdout: string; stderr: string } => {
        runs += 1
        return { status: 0, stdout: "\x1b_Ga=T,f=32;data\x1b\\", stderr: "" }
      }

      expect(buildChafaImageOutput(filePath, 12, 6, "kitty", runChafa)).toBe(
        "\x1b_Ga=T,f=32;data\x1b\\"
      )
      expect(buildChafaImageOutput(filePath, 12.9, 6.8, "kitty", runChafa)).toBe(
        "\x1b_Ga=T,f=32;data\x1b\\"
      )
      expect(runs).toBe(1)
    })

    resetTerminalImageOutputCache()
  })

  it("keeps Kitty file-transfer commands path-based instead of embedding image bytes", () => {
    withTempImage((filePath) => {
      const command = buildKittyFileImageCommand(filePath, 12, 5)

      const payload = Buffer.from(filePath, "utf8").toString("base64")
      expect(command).toBe(`\x1b_Ga=T,t=f,c=12,r=5;${payload}\x1b\\`)
    })
  })

  it("does not emit Kitty commands for fallback paths", () => {
    expect(buildKittyFileImageCommand("relative.png", 10, 5)).toBeNull()
    expect(buildKittyFileImageCommand("/tmp/waha-tui-missing-preview.png", 10, 5)).toBeNull()
  })

  it("escapes nested control sequences for tmux passthrough", () => {
    const command = "\x1b_Gtest\x1b\\"
    const wrapped = "\x1bPtmux;\x1b\x1b_Gtest\x1b\x1b\\\x1b\\"

    expect(tmuxPassthrough(command)).toBe(wrapped)
    expect(wrapKittyGraphics(command, { TERM: "xterm-kitty" })).toBe(command)
  })
})
