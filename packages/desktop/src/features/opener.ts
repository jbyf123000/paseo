import { shell, ipcMain } from "electron";
import path from "node:path";

const ALLOWED_EXTERNAL_URL_PROTOCOLS = new Set(["http:", "https:"]);

export function isAllowedExternalUrl(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  try {
    const url = new URL(value);
    return ALLOWED_EXTERNAL_URL_PROTOCOLS.has(url.protocol);
  } catch {
    return false;
  }
}

/** Absolute local filesystem path suitable for shell.openPath. */
export function isAllowedLocalOpenPath(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const targetPath = value.trim();
  if (targetPath.length === 0 || targetPath.includes("\0")) {
    return false;
  }
  return path.isAbsolute(targetPath);
}

export function registerOpenerHandlers(): void {
  ipcMain.handle("paseo:opener:openUrl", async (_event, url: unknown) => {
    if (!isAllowedExternalUrl(url)) {
      throw new Error("Unsupported external URL");
    }
    await shell.openExternal(url);
  });

  ipcMain.handle("paseo:opener:openPath", async (_event, targetPath: unknown) => {
    if (!isAllowedLocalOpenPath(targetPath)) {
      throw new Error("Unsupported local path");
    }
    const errorMessage = await shell.openPath(targetPath);
    if (errorMessage) {
      throw new Error(errorMessage);
    }
  });
}
