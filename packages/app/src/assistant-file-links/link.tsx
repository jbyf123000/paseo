import { useMemo, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import {
  Platform,
  Pressable,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import * as Clipboard from "expo-clipboard";
import { AppWindow, Copy } from "lucide-react-native";
import { getIsElectron, isNative, isWeb } from "@/constants/platform";
import { MarkdownTextSpan } from "@/components/markdown-text";
import { AssistantLinkPressProvider, type AssistantLinkPress } from "./link-press-context";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Shortcut } from "@/components/ui/shortcut";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/contexts/toast-context";
import { useLocalDaemonServerId } from "@/hooks/use-is-local-daemon";
import { useStableEvent } from "@/hooks/use-stable-event";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import type { Theme } from "@/styles/theme";
import {
  canOpenLocalPathWithDefaultApp,
  openLocalPathWithDefaultApp,
} from "@/utils/open-local-path";
import { useAssistantFileLinkResolverContext } from "./provider";
import { classifyForResolution, type AssistantFileLinkSource } from "./resolver";
import { useFileLink } from "./use-file-link";

interface AssistantMarkdownLinkProps {
  source: AssistantFileLinkSource;
  style: StyleProp<TextStyle>;
  monoSurface?: boolean;
  children: ReactNode;
}

const ThemedAppWindow = withUnistyles(AppWindow);
const ThemedCopy = withUnistyles(Copy);
const mutedIconColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const openWithDefaultLeading = <ThemedAppWindow size={14} uniProps={mutedIconColorMapping} />;
const copyAbsolutePathLeading = <ThemedCopy size={14} uniProps={mutedIconColorMapping} />;

export function AssistantMarkdownLink({
  source,
  style,
  monoSurface,
  children,
}: AssistantMarkdownLinkProps) {
  const [hovered, setHovered] = useState(false);
  const { t } = useTranslation();
  const toast = useToast();
  const { target, onHoverIn, onPress, onAuxPress, resolveFileTarget } = useFileLink(source);
  const { configRef, serverId } = useAssistantFileLinkResolverContext();
  const workspaceRoot = configRef.current.workspaceRoot;
  // Only hide when we know the active host is a remote daemon. While the local
  // daemon id is still loading (null), keep the item available on Electron —
  // otherwise the OS default Copy/Paste menu wins and the feature looks missing.
  const localDaemonServerId = useLocalDaemonServerId();
  const isDefinitelyRemoteDaemon =
    localDaemonServerId !== null &&
    (serverId ?? "").trim().length > 0 &&
    localDaemonServerId !== (serverId ?? "").trim();
  const canResolveToFile = useMemo(() => {
    const resolution = classifyForResolution(source, { workspaceRoot });
    return resolution.kind === "needsLookup" || resolution.value.kind === "file";
  }, [source, workspaceRoot]);
  const showFileLinkContextMenu =
    isWeb &&
    getIsElectron() &&
    !isDefinitelyRemoteDaemon &&
    canOpenLocalPathWithDefaultApp() &&
    canResolveToFile;
  const tooltipPath = useMemo(
    () => (target ? formatInlinePathTargetForTooltip(target, workspaceRoot) : null),
    [target, workspaceRoot],
  );
  const handleAnchorClickCapture = useStableEvent((event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    if (!isModifiedOpenEvent(event)) {
      return;
    }
    event.stopPropagation();
    onAuxPress();
  });
  const handleHoverIn = useStableEvent(() => {
    setHovered(true);
    onHoverIn();
  });
  const handleHoverOut = useStableEvent(() => setHovered(false));
  const handleOpenWithDefaultApp = useStableEvent(() => {
    void (async () => {
      try {
        const fileTarget = await resolveFileTarget();
        if (!fileTarget) {
          return;
        }
        const opened = await openLocalPathWithDefaultApp(fileTarget.path);
        if (!opened) {
          toast.error(t("workspace.fileActions.openWithDefaultAppFailed"));
        }
      } catch (error) {
        console.warn("[assistant-file-link] open with default app failed", error);
        toast.error(t("workspace.fileActions.openWithDefaultAppFailed"));
      }
    })();
  });
  const handleCopyAbsolutePath = useStableEvent(() => {
    void (async () => {
      try {
        const fileTarget = await resolveFileTarget();
        if (!fileTarget) {
          return;
        }
        await Clipboard.setStringAsync(fileTarget.path);
        toast.copied(t("workspace.fileActions.copyAbsolutePath"));
      } catch (error) {
        console.warn("[assistant-file-link] copy absolute path failed", error);
        toast.error(t("workspace.fileActions.copyAbsolutePathFailed"));
      }
    })();
  });
  const hoveredTextStyle = useMemo<StyleProp<TextStyle>>(
    () => [style, hovered && { textDecorationLine: "underline" as const }],
    [style, hovered],
  );
  const linkPress = useMemo<AssistantLinkPress>(
    () => ({ onPress, accessibilityRole: "link" }),
    [onPress],
  );

  if (isNative) {
    // Must be a MarkdownTextSpan, not a plain <Text>: on iOS the link renders
    // inside the paragraph's native UITextView, and a plain <Text> nested there
    // is not hoisted into a UITextViewChild, so its text is silently dropped
    // (the link disappears). The span composes correctly and stays selectable.
    //
    // Tap-to-open: react-native-uitextview only wires onPress onto the *string*
    // children it turns into RNUITextViewChild nodes — the element children that
    // markdown emits for link text pass through untouched, so an onPress placed
    // here never reaches a tappable native node. We thread it down through
    // AssistantLinkPressProvider so each leaf text span re-attaches it to its
    // own string children, where the native tap recognizer can find it. iOS
    // only: Android forwards onPress through nested <Text> already, and web uses
    // the <a> path below.
    const span = (
      <MarkdownTextSpan
        accessibilityRole="link"
        monoSurface={monoSurface}
        onPress={onPress}
        style={style}
      >
        {children}
      </MarkdownTextSpan>
    );
    return (
      <FileLinkHoverTooltip filePath={tooltipPath}>
        {Platform.OS === "ios" ? (
          <AssistantLinkPressProvider value={linkPress}>{span}</AssistantLinkPressProvider>
        ) : (
          span
        )}
      </FileLinkHoverTooltip>
    );
  }

  const anchor = (
    <a
      href={source.href}
      onClickCapture={handleAnchorClickCapture}
      onAuxClickCapture={preventAnchorNavigation}
      style={LINK_ANCHOR_STYLE}
    >
      <Pressable
        accessibilityRole="link"
        onPress={onPress}
        onHoverIn={handleHoverIn}
        onHoverOut={handleHoverOut}
      >
        <Text dataSet={monoSurface ? CODE_SURFACE_DATASET : undefined} style={hoveredTextStyle}>
          {children}
        </Text>
      </Pressable>
    </a>
  );

  const linkWithTooltip = (
    <FileLinkHoverTooltip filePath={tooltipPath}>{anchor}</FileLinkHoverTooltip>
  );

  if (!showFileLinkContextMenu) {
    return linkWithTooltip;
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger enabledOnMobile={false} style={FILE_LINK_CONTEXT_TRIGGER_STYLE}>
        {linkWithTooltip}
      </ContextMenuTrigger>
      <ContextMenuContent align="start" minWidth={220} testID="assistant-file-link-context-menu">
        <ContextMenuItem
          leading={openWithDefaultLeading}
          onSelect={handleOpenWithDefaultApp}
          testID="assistant-file-link-open-with-default-app"
        >
          {t("workspace.fileActions.openWithDefaultApp")}
        </ContextMenuItem>
        <ContextMenuItem
          leading={copyAbsolutePathLeading}
          onSelect={handleCopyAbsolutePath}
          testID="assistant-file-link-copy-absolute-path"
        >
          {t("workspace.fileActions.copyAbsolutePath")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

interface AssistantMarkdownCodeLinkProps {
  source: AssistantFileLinkSource;
  inheritedStyles: TextStyle;
  codeInlineStyle: TextStyle;
  linkStyle: TextStyle;
  children: ReactNode;
}

export function AssistantMarkdownCodeLink({
  source,
  inheritedStyles,
  codeInlineStyle,
  linkStyle,
  children,
}: AssistantMarkdownCodeLinkProps) {
  const style = useMemo(
    () => [inheritedStyles, codeInlineStyle, linkStyle],
    [inheritedStyles, codeInlineStyle, linkStyle],
  );
  return (
    <AssistantMarkdownLink source={source} style={style} monoSurface>
      {children}
    </AssistantMarkdownLink>
  );
}

function formatInlinePathTargetForTooltip(
  target: { path: string; lineStart?: number; lineEnd?: number },
  workspaceRoot: string | undefined,
): string {
  let result = relativizePathToWorkspace(target.path, workspaceRoot);
  if (target.lineStart) {
    result += `:${target.lineStart}`;
    if (target.lineEnd && target.lineEnd !== target.lineStart) {
      result += `-${target.lineEnd}`;
    }
  }
  return result;
}

function relativizePathToWorkspace(filePath: string, workspaceRoot: string | undefined): string {
  if (!workspaceRoot) {
    return filePath;
  }
  const root = workspaceRoot.replace(/\/+$/, "");
  if (!root) {
    return filePath;
  }
  if (filePath === root) {
    return ".";
  }
  const prefix = `${root}/`;
  if (filePath.startsWith(prefix)) {
    return filePath.slice(prefix.length);
  }
  return filePath;
}

interface AssistantInlineCodePathLinkProps {
  content: string;
  inheritedStyles: TextStyle;
  codeInlineStyle: TextStyle;
  linkStyle: TextStyle;
}

export function AssistantInlineCodePathLink({
  content,
  inheritedStyles,
  codeInlineStyle,
  linkStyle,
}: AssistantInlineCodePathLinkProps) {
  const source = useMemo<AssistantFileLinkSource>(
    () => ({
      href: content,
      text: content,
      sourceType: "inline-code",
    }),
    [content],
  );

  return (
    <AssistantMarkdownCodeLink
      source={source}
      inheritedStyles={inheritedStyles}
      codeInlineStyle={codeInlineStyle}
      linkStyle={linkStyle}
    >
      {content}
    </AssistantMarkdownCodeLink>
  );
}

const FILE_LINK_TOOLTIP_TRIGGER_STYLE: ViewStyle = {
  // RN doesn't type "inline-flex" but RN-web honors it at runtime, which keeps
  // the tooltip wrapper from breaking inline link flow.
  display: "inline-flex" as ViewStyle["display"],
};

const FILE_LINK_CONTEXT_TRIGGER_STYLE: ViewStyle = {
  display: "inline-flex" as ViewStyle["display"],
};

const FILE_LINK_TOOLTIP_MOD_KEYS = ["mod"];

function FileLinkHoverTooltip({
  filePath,
  children,
}: {
  filePath: string | null;
  children: ReactNode;
}) {
  if (!isWeb) {
    return children;
  }
  return (
    <Tooltip delayDuration={400}>
      <TooltipTrigger asChild>
        <View style={FILE_LINK_TOOLTIP_TRIGGER_STYLE}>{children}</View>
      </TooltipTrigger>
      {filePath ? (
        <TooltipContent side="top" align="start" maxWidth={520}>
          <View style={styles.tooltipBody}>
            <Text selectable={false} style={styles.tooltipPath}>
              {filePath}
            </Text>
            <View style={styles.tooltipHintRow}>
              <Shortcut keys={FILE_LINK_TOOLTIP_MOD_KEYS} />
              <Text selectable={false} style={styles.tooltipHintText}>
                click for side pane
              </Text>
            </View>
          </View>
        </TooltipContent>
      ) : null}
    </Tooltip>
  );
}

const LINK_ANCHOR_STYLE: CSSProperties = {
  display: "contents",
  color: "inherit",
  textDecoration: "none",
};

function preventAnchorNavigation(event: MouseEvent<HTMLAnchorElement>): void {
  event.preventDefault();
}

function isModifiedOpenEvent(event: MouseEvent<HTMLElement>): boolean {
  return event.metaKey || event.ctrlKey;
}

const styles = StyleSheet.create((theme) => ({
  tooltipBody: {
    gap: theme.spacing[1],
  },
  tooltipPath: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
  },
  tooltipHintRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  tooltipHintText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
  },
}));
