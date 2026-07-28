import { getDesktopHost } from "@/desktop/host";
import { isAbsolutePath } from "@/utils/path";

/**
 * Open an absolute local filesystem path with the OS default application.
 * Only available in the Electron desktop shell; returns false when unavailable.
 */
export async function openLocalPathWithDefaultApp(targetPath: string): Promise<boolean> {
  const trimmed = targetPath.trim();
  if (trimmed.length === 0 || !isAbsolutePath(trimmed)) {
    return false;
  }
  const openPath = getDesktopHost()?.opener?.openPath;
  if (typeof openPath !== "function") {
    return false;
  }
  await openPath(trimmed);
  return true;
}

export function canOpenLocalPathWithDefaultApp(): boolean {
  return typeof getDesktopHost()?.opener?.openPath === "function";
}
