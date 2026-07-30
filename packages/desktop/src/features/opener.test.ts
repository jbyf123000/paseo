import { ipcMain, shell } from "electron";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { isAllowedExternalUrl, isAllowedLocalOpenPath, registerOpenerHandlers } from "./opener";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
  shell: { openExternal: vi.fn(), openPath: vi.fn() },
}));

function getRegisteredHandler(
  channel: string,
): (_event: unknown, payload: unknown) => Promise<void> {
  registerOpenerHandlers();
  const handler = vi.mocked(ipcMain.handle).mock.calls.find(([registeredChannel]) => {
    return registeredChannel === channel;
  })?.[1];
  if (typeof handler !== "function") {
    throw new Error(`${channel} handler was not registered`);
  }
  return handler as (_event: unknown, payload: unknown) => Promise<void>;
}

describe("desktop opener", () => {
  beforeEach(() => {
    vi.mocked(ipcMain.handle).mockReset();
    vi.mocked(shell.openExternal).mockReset();
    vi.mocked(shell.openPath).mockReset();
    vi.mocked(shell.openPath).mockResolvedValue("");
  });

  it("allows only http and https external URLs", () => {
    expect(isAllowedExternalUrl("https://example.com/path")).toBe(true);
    expect(isAllowedExternalUrl("http://localhost:8081")).toBe(true);
    expect(isAllowedExternalUrl("file:///etc/passwd")).toBe(false);
    expect(isAllowedExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedExternalUrl("paseo://settings")).toBe(false);
    expect(isAllowedExternalUrl("/relative/path")).toBe(false);
    expect(isAllowedExternalUrl(null)).toBe(false);
  });

  it("opens allowed URLs through Electron shell", async () => {
    const handler = getRegisteredHandler("paseo:opener:openUrl");

    await handler({}, "https://example.com");

    expect(shell.openExternal).toHaveBeenCalledWith("https://example.com");
  });

  it("rejects blocked URLs before invoking Electron shell", async () => {
    const handler = getRegisteredHandler("paseo:opener:openUrl");

    await expect(handler({}, "file:///etc/passwd")).rejects.toThrow("Unsupported external URL");

    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  it("allows only absolute local filesystem paths", () => {
    expect(isAllowedLocalOpenPath(path.resolve("/tmp/notes.md"))).toBe(true);
    expect(isAllowedLocalOpenPath("relative/notes.md")).toBe(false);
    expect(isAllowedLocalOpenPath("")).toBe(false);
    expect(isAllowedLocalOpenPath("  ")).toBe(false);
    expect(isAllowedLocalOpenPath("notes\0.md")).toBe(false);
    expect(isAllowedLocalOpenPath(null)).toBe(false);
    expect(isAllowedLocalOpenPath("https://example.com")).toBe(false);
  });

  it("opens absolute paths through Electron shell.openPath", async () => {
    const handler = getRegisteredHandler("paseo:opener:openPath");
    const absolutePath = path.resolve("/tmp/notes.md");

    await handler({}, absolutePath);

    expect(shell.openPath).toHaveBeenCalledWith(absolutePath);
  });

  it("rejects non-absolute paths before invoking shell.openPath", async () => {
    const handler = getRegisteredHandler("paseo:opener:openPath");

    await expect(handler({}, "relative/notes.md")).rejects.toThrow("Unsupported local path");

    expect(shell.openPath).not.toHaveBeenCalled();
  });

  it("surfaces shell.openPath error messages", async () => {
    const handler = getRegisteredHandler("paseo:opener:openPath");
    const absolutePath = path.resolve("/tmp/missing.md");
    vi.mocked(shell.openPath).mockResolvedValue("Failed to open path");

    await expect(handler({}, absolutePath)).rejects.toThrow("Failed to open path");
  });
});
