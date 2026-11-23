import type { PluginWorkspaceSnapshot, WorkspaceIndicator } from "@getpaseo/plugin";
import {
  useWorkspace,
  useWorkspaces,
  useProject,
  type PluginSidebarViewProps,
  type ProjectRef,
  type WorkspaceRef,
} from "@getpaseo/plugin/client";
import { Icon, TextInput } from "@getpaseo/plugin/client/ui";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useDrag, useDragHandle, useDragSlot } from "./drag";
import { DecorIcon, useDecorations } from "./decor";
import { useT } from "./i18n";
import { useLook, type Look } from "./look";
import { LabelChip, labelKey, useLabelCatalog } from "./labels";
import { compactTimeAgo, compareWorkspaceTimes, mostUrgent } from "./model";
import { ProjectIcon } from "./project-icon";
import { RunningSpinner } from "./running-spinner";
import { sidebarNavProps } from "./web";
import type { ProjectGroup } from "../shared/settings";

type Theme = PluginSidebarViewProps["theme"];

export function rowStyles(theme: Theme, look: Look) {
  return {
    row: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      minHeight: look.row,
      paddingRight: 8,
      gap: 6,
    },
    header: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      minHeight: look.header,
      paddingLeft: 8,
      paddingRight: 8,
      // Space between groups comes from spacers in the list, so the first group stays at the top.
      marginTop: 2,
      gap: 6,
    },
    groupName: {
      flex: 1,
      color: theme.colors.foreground,
      fontSize: look.text,
      lineHeight: look.line,
      fontWeight: look.boldGroupNames ? ("600" as const) : ("400" as const),
    },
    mutedHeading: {
      flex: 1,
      color: theme.colors.foregroundMuted,
      fontSize: look.small,
      lineHeight: look.smallLine,
      fontWeight: "600" as const,
    },
    // Project and workspace names follow the app's own sidebar rows.
    projectName: {
      flex: 1,
      color: theme.colors.foregroundMuted,
      fontSize: look.text,
      lineHeight: look.line,
      fontWeight: "400" as const,
    },
    workspaceName: { flex: 1, color: theme.colors.foreground, fontSize: look.text, lineHeight: look.line, opacity: 0.76 },
    detail: { color: theme.colors.foregroundMuted, fontSize: look.small, lineHeight: look.smallLine },
    hint: {
      color: theme.colors.foregroundMuted,
      fontSize: look.small,
      lineHeight: look.smallLine,
      fontStyle: "italic" as const,
    },
    input: {
      flex: 1,
      color: theme.colors.foreground,
      fontSize: look.text,
      lineHeight: look.line,
      paddingVertical: 2,
      paddingHorizontal: 6,
      borderRadius: 4,
      borderWidth: 1,
      borderColor: theme.colors.accent,
      backgroundColor: theme.colors.surface1,
    },
    // The border token is the closest plugin token to the app's own selected-row fill.
    selected: { backgroundColor: theme.colors.border },
    rounded: { borderRadius: 6, marginHorizontal: 4 },
  };
}

export function useRowStyles(theme: Theme) {
  const look = useLook();
  return useMemo(() => rowStyles(theme, look), [theme, look]);
}

function ActionButton({
  icon,
  label,
  color,
  size,
  onPress,
  onHoverIn,
}: {
  icon: string;
  label: string;
  color: string;
  size: number;
  onPress: () => void;
  /** Entering a child counts as leaving the row on web, so the button re-asserts the hover. */
  onHoverIn: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      onPress={onPress}
      onHoverIn={onHoverIn}
      style={{ padding: 3, borderRadius: 4 }}
    >
      <Icon name={icon} size={size} color={color} />
    </Pressable>
  );
}

/**
 * Row buttons stay mounted and only fade, so a click never lands on the row because the
 * button vanished mid-hover. The detail (count or +/−) keeps its place in the layout; the
 * buttons float over it on hover. `slots` reserves room for the buttons when the detail is short.
 */
function RowActions({
  show,
  detail,
  slots,
  iconSize,
  children,
}: {
  show: boolean;
  detail: ReactNode;
  slots: number;
  iconSize: number;
  children: ReactNode;
}) {
  const button = iconSize + 6;
  return (
    <View
      style={{
        minWidth: slots * button,
        minHeight: button,
        alignItems: "flex-end",
        justifyContent: "center",
      }}
    >
      {detail !== null ? <View style={{ opacity: show ? 0 : 1 }}>{detail}</View> : null}
      <View
        style={{
          position: "absolute",
          right: 0,
          top: 0,
          bottom: 0,
          flexDirection: "row",
          alignItems: "center",
          opacity: show ? 1 : 0,
        }}
      >
        {children}
      </View>
    </View>
  );
}

/**
 * True when the browser's main pointer cannot hover, as on phones and tablets. Called on the
 * global object itself because a detached `matchMedia` throws in browsers.
 */
const CANNOT_HOVER = (() => {
  const target = globalThis as { matchMedia?: (query: string) => { matches: boolean } };
  return typeof target.matchMedia === "function" && target.matchMedia("(hover: none)").matches;
})();

/**
 * Hover state for row actions. Wherever hover cannot happen (narrow layouts, the native apps,
 * touch-only browsers such as a tablet) the actions always show, because they stay pressable
 * while faded and would otherwise be invisible buttons.
 */
function useHover(layout: PluginSidebarViewProps["layout"]) {
  const alwaysShow = layout.compact || layout.platform !== "web" || CANNOT_HOVER;
  const [hovered, setHovered] = useState(false);
  const onHoverIn = useCallback(() => setHovered(true), []);
  const onHoverOut = useCallback(() => setHovered(false), []);
  return { show: alwaysShow || hovered, hovered, onHoverIn, onHoverOut };
}

export function GroupHeader({
  group,
  statusKeys,
  count,
  collapsed,
  renaming,
  dragging,
  view,
  onToggle,
  onStartRename,
  onRename,
  onCancelRename,
  onDelete,
}: {
  group: ProjectGroup;
  /** Ref keys of the group's projects and their sub-projects. */
  statusKeys: readonly string[];
  count: number;
  collapsed: boolean;
  renaming: boolean;
  dragging: boolean;
  view: PluginSidebarViewProps;
  onToggle: (id: string) => void;
  onStartRename: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onCancelRename: () => void;
  onDelete: (id: string) => void;
}) {
  const look = useLook();
  const styles = useRowStyles(view.theme);
  const controller = useDrag();
  const slotRef = useDragSlot(`g:${group.id}`, { kind: "group", groupId: group.id });
  const hover = useHover(view.layout);
  const [initialName, setInitialName] = useState(group.name);
  const draftName = useRef(group.name);
  const muted = view.theme.colors.foregroundMuted;
  const t = useT();
  const decorations = useDecorations();
  const decoration = decorations.get("groups", group.id);
  const decorate = useCallback(() => {
    if (controller.recentlyDropped()) return;
    decorations.open({ kind: "groups", key: group.id, name: group.name });
  }, [controller, decorations, group.id, group.name]);
  const members = useMemo(() => new Set(statusKeys), [statusKeys]);
  const inside = (item: PluginWorkspaceSnapshot) => members.has(item.project.key) && isListed(item, look);
  const status = useFoldedStatus(collapsed && look.showFoldedStatus ? inside : null);
  const holdsActive = useHoldsActive(view, collapsed ? inside : null);

  const toggle = useCallback(() => {
    if (controller.recentlyDropped()) return;
    onToggle(group.id);
  }, [controller, onToggle, group.id]);
  const handle = useDragHandle({ kind: "group", id: group.id, label: group.name }, toggle);

  const beginRename = useCallback(() => {
    draftName.current = group.name;
    setInitialName(group.name);
    onStartRename(group.id);
  }, [group.id, group.name, onStartRename]);

  const submit = useCallback(() => onRename(group.id, draftName.current), [group.id, onRename]);

  if (renaming) {
    return (
      <View ref={slotRef} style={styles.header}>
        <Icon name="FolderPen" size={look.icon} color={muted} />
        <TextInput
          accessibilityLabel={t("group.nameLabel")}
          autoFocus
          selectTextOnFocus
          autoCapitalize="none"
          autoCorrect={false}
          // Avoid sending intermediate IME text back to the native input.
          defaultValue={initialName}
          onChangeText={(text) => {
            draftName.current = text;
          }}
          onSubmitEditing={submit}
          onBlur={submit}
          onKeyPress={(event) => {
            if (event.nativeEvent.key === "Escape") onCancelRename();
          }}
          placeholder={t("group.nameLabel")}
          placeholderTextColor={muted}
          style={styles.input}
        />
      </View>
    );
  }

  return (
    <View ref={slotRef} {...handle.pressCapture} style={dragging ? { opacity: 0.4 } : undefined}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t(collapsed ? "common.expand" : "common.collapse", { name: group.name })}
        accessibilityState={{ expanded: !collapsed }}
          {...sidebarNavProps({ pgNav: "" })}
          accessibilityHint={t("group.dragHint")}
        onPress={toggle}
        onLongPress={handle.onLongPress}
        onPressOut={handle.onPressOut}
        onHoverIn={hover.onHoverIn}
        onHoverOut={hover.onHoverOut}
        style={styles.header}
      >
        {holdsActive ? <ActiveFill theme={view.theme} inset={4} /> : null}
        <Icon name={collapsed ? "ChevronRight" : "ChevronDown"} size={look.icon - 1} color={muted} />
        <Badged status={status} theme={view.theme} reserve={look.showFoldedStatus}>
          {decoration.icon ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("group.decorate", { name: group.name })}
              onPress={decorate}
            >
              <DecorIcon
                icon={decoration.icon}
                fallback={null}
                color={decoration.color ?? muted}
                size={look.icon}
              />
            </Pressable>
          ) : null}
        </Badged>
        <Text
          selectable={false}
          numberOfLines={1}
          style={[styles.groupName, decoration.color ? { color: decoration.color } : null]}
        >
          {group.name}
        </Text>
        <RowActions
          show={hover.show}
          slots={3}
          iconSize={look.icon}
          detail={
            <Text selectable={false} style={styles.detail}>
              {count}
            </Text>
          }
        >
          <ActionButton
            icon="Palette"
            label={t("group.decorate", { name: group.name })}
            color={muted}
            size={look.icon}
            onPress={decorate}
            onHoverIn={hover.onHoverIn}
          />
          <ActionButton
            icon="Pencil"
            label={t("group.rename", { name: group.name })}
            color={muted}
            size={look.icon}
            onPress={beginRename}
            onHoverIn={hover.onHoverIn}
          />
          <ActionButton
            icon="Trash2"
            label={t("group.delete", { name: group.name })}
            color={muted}
            size={look.icon}
            onPress={() => onDelete(group.id)}
            onHoverIn={hover.onHoverIn}
          />
        </RowActions>
      </Pressable>
    </View>
  );
}

/** A small host name after a project name, so projects of different hosts can be told apart. */
function HostTag({ label, theme }: { label: string; theme: Theme }) {
  const look = useLook();
  return (
    <Text
      selectable={false}
      numberOfLines={1}
      style={{
        flexShrink: 0,
        maxWidth: 96,
        color: theme.colors.foregroundMuted,
        fontSize: Math.max(9, look.small - 1),
        lineHeight: look.smallLine,
        paddingHorizontal: 5,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: theme.colors.border,
      }}
    >
      {label}
    </Text>
  );
}

export function UngroupedHeader({
  projects,
  count,
  collapsed,
  view,
  onToggle,
  hostId = null,
  hostLabel = null,
}: {
  /** Ref keys of the projects in no group and their sub-projects. */
  projects: readonly string[];
  count: number;
  collapsed: boolean;
  view: PluginSidebarViewProps;
  onToggle: () => void;
  /** Set when Ungrouped is split by host: this section holds that host's projects. */
  hostId?: string | null;
  hostLabel?: string | null;
}) {
  const look = useLook();
  const styles = useRowStyles(view.theme);
  const t = useT();
  const slotRef = useDragSlot(hostId ? `ungrouped:${hostId}` : "ungrouped", { kind: "ungrouped", hostId });
  const title = hostLabel ? `${t("sidebar.ungrouped")} · ${hostLabel}` : t("sidebar.ungrouped");
  const controller = useDrag();
  const muted = view.theme.colors.foregroundMuted;
  const toggle = useCallback(() => {
    if (controller.recentlyDropped()) return;
    onToggle();
  }, [controller, onToggle]);
  const members = useMemo(() => new Set(projects), [projects]);
  const inside = (item: PluginWorkspaceSnapshot) => members.has(item.project.key) && isListed(item, look);
  const status = useFoldedStatus(collapsed && look.showFoldedStatus ? inside : null);
  const holdsActive = useHoldsActive(view, collapsed ? inside : null);
  return (
    <View ref={slotRef}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t(collapsed ? "common.expand" : "common.collapse", { name: title })}
        accessibilityState={{ expanded: !collapsed }}
        {...sidebarNavProps({ pgNav: "" })}
        onPress={toggle}
        style={styles.header}
      >
        {holdsActive ? <ActiveFill theme={view.theme} inset={4} /> : null}
        <Icon name={collapsed ? "ChevronRight" : "ChevronDown"} size={look.icon - 1} color={muted} />
        <Badged status={status} theme={view.theme} reserve={look.showFoldedStatus}>
          {null}
        </Badged>
        <Text selectable={false} numberOfLines={1} style={styles.mutedHeading}>
          {title}
        </Text>
        <Text selectable={false} style={styles.detail}>
          {count}
        </Text>
      </Pressable>
    </View>
  );
}

export function EmptyGroupRow({ groupId, view }: { groupId: string; view: PluginSidebarViewProps }) {
  const look = useLook();
  const styles = useRowStyles(view.theme);
  const t = useT();
  const slotRef = useDragSlot(`e:${groupId}`, { kind: "empty", groupId });
  return (
    <View ref={slotRef} style={[styles.row, { paddingLeft: look.emptyIndent }]}>
      <Text selectable={false} style={styles.hint}>
        {t("sidebar.dropHere")}
      </Text>
    </View>
  );
}

const INDICATOR_COLOR = {
  running: "accent",
  needs_input: "statusWarning",
  failed: "statusDanger",
  attention: "statusSuccess",
} as const;

export function StatusDot({ color, running = false }: { color: string; running?: boolean }) {
  return (
    <View
      pointerEvents="none"
      style={{ width: 12, height: 12, flexShrink: 0, alignItems: "center", justifyContent: "center" }}
    >
      {running ? (
        <RunningSpinner color={color} size={12} />
      ) : (
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
      )}
    </View>
  );
}

/** A workspace that appears under its project row. */
function isListed(item: PluginWorkspaceSnapshot, look: Look): boolean {
  // Pinned workspaces live in the Pinned section unless the user hid it.
  return (!look.showPinned || !item.pinnedAt) && (look.showBackground || !item.background) && !item.archivingAt;
}

/**
 * Most urgent workspace status for a folded row, or "done" when `where` is null.
 * Grouping by indicator returns only the statuses present, not every workspace.
 */
function useFoldedStatus(where: ((item: PluginWorkspaceSnapshot) => boolean) | null): WorkspaceIndicator {
  const groups = useWorkspaces({ where: where ?? (() => false), groupBy: (item) => item.indicator });
  return mostUrgent(groups.map((group) => group.key));
}

/** True when the open workspace matches `where`, so a folded row can show it is inside. */
function useHoldsActive(
  view: PluginSidebarViewProps,
  where: ((item: PluginWorkspaceSnapshot) => boolean) | null,
): boolean {
  const key = view.active.workspace?.key;
  const hits = useWorkspaces({ where: (item) => !!where && item.ref.key === key && where(item) });
  return hits.length > 0;
}

/**
 * A half-strength selected fill behind a folded row that hides the open workspace. `inset` matches
 * the selected workspace row's side margin on rows that have none of their own.
 */
function ActiveFill({ theme, inset }: { theme: Theme; inset: number }) {
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        left: inset,
        right: inset,
        borderRadius: 6,
        backgroundColor: theme.colors.border,
        opacity: 0.5,
      }}
    />
  );
}

/**
 * Paseo's folded-project badge: alert for input, spinner for running, dot otherwise.
 * `backdrop` cuts it out of the icon it sits on.
 */
function StatusBadge({
  status,
  theme,
  backdrop,
}: {
  status: WorkspaceIndicator;
  theme: Theme;
  backdrop: boolean;
}) {
  const t = useT();
  if (status === "done") return null;
  const color = theme.colors[INDICATOR_COLOR[status]];
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={t(`status.${status}`)}
      pointerEvents="none"
      style={{
        width: 12,
        height: 12,
        borderRadius: 6,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: backdrop ? theme.colors.surface0 : undefined,
      }}
    >
      {status === "running" ? (
        <RunningSpinner color={color} size={10} />
      ) : status === "needs_input" ? (
        <Icon name="CircleAlert" size={11} color={color} />
      ) : (
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
      )}
    </View>
  );
}

/**
 * Puts the status badge on the icon's lower right corner, like Paseo. Without an icon the badge
 * takes the icon's place, in a slot kept while `reserve` is on so the name never shifts.
 */
export function Badged({
  status,
  theme,
  reserve,
  children,
}: {
  status: WorkspaceIndicator;
  theme: Theme;
  reserve: boolean;
  children: ReactNode;
}) {
  if (!children) {
    return reserve ? (
      <View style={{ width: 12, height: 12 }}>
        <StatusBadge status={status} theme={theme} backdrop={false} />
      </View>
    ) : null;
  }
  if (status === "done") return <>{children}</>;
  return (
    <View>
      {children}
      <View pointerEvents="none" style={{ position: "absolute", right: -4, bottom: -4 }}>
        <StatusBadge status={status} theme={theme} backdrop />
      </View>
    </View>
  );
}

export function WorkspaceRow({
  reference,
  indent,
  view,
  onMenu,
  relation,
}: {
  reference: WorkspaceRef;
  indent: number;
  view: PluginSidebarViewProps;
  onMenu: (reference: WorkspaceRef) => void;
  relation?: {
    key: string;
    highlighted: boolean;
    open(): void;
    onHover(hovered: boolean): void;
    trailing: ReactNode;
  };
}) {
  const look = useLook();
  const styles = useRowStyles(view.theme);
  const hover = useHover(view.layout);
  const t = useT();
  const nameColor = useDecorations().get("workspaces", reference.key).color;
  const workspace = useWorkspace(reference, (item) => ({
    title: (look.workspaceTitle === "branch" ? item.branch : null) ?? item.title ?? item.name,
    indicator: item.indicator,
    indicatorLabel: item.indicatorLabel,
    additions: item.diffStat?.additions ?? 0,
    deletions: item.diffStat?.deletions ?? 0,
    branch: item.branch,
    labels: item.labels,
    enteredAt: item.statusEnteredAt,
  }));
  const open = useCallback(() => view.navigation.openWorkspace(reference), [view.navigation, reference]);
  if (!workspace) return null;
  const branch = look.showBranch && workspace.branch && workspace.branch !== workspace.title ? workspace.branch : null;
  const labels = look.showLabels ? workspace.labels : [];
  const active = view.active.workspace?.key === reference.key;
  const tone = workspace.indicator === "done" ? null : INDICATOR_COLOR[workspace.indicator];
  const color = tone ? view.theme.colors[tone] : "transparent";
  const trailing =
    look.trailing === "diff" && (workspace.additions || workspace.deletions) ? (
      <Text selectable={false} numberOfLines={1} style={styles.detail}>
        <Text style={{ color: view.theme.colors.statusSuccess }}>+{workspace.additions}</Text>{" "}
        <Text style={{ color: view.theme.colors.statusDanger }}>−{workspace.deletions}</Text>
      </Text>
    ) : look.trailing === "timestamp" && workspace.enteredAt ? (
      <TimeAgo iso={workspace.enteredAt} style={styles.detail} />
    ) : null;
  const { flex: _fill, ...titleStyle } = styles.workspaceName;
  return (
    <Pressable
      {...sidebarNavProps({ pgNav: "", ...(relation ? { pgAgent: relation.key } : {}) })}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={
        workspace.indicatorLabel
          ? t("workspace.openWithStatus", { name: workspace.title, status: workspace.indicatorLabel })
          : t("workspace.open", { name: workspace.title })
      }
      onPress={relation?.open ?? open}
      onHoverIn={() => { hover.onHoverIn(); relation?.onHover(true); }}
      onHoverOut={() => { hover.onHoverOut(); relation?.onHover(false); }}
      style={[
        styles.row, styles.rounded, { paddingLeft: indent },
        active ? styles.selected : relation?.highlighted && { backgroundColor: view.theme.colors.surface1 },
      ]}
    >
      {look.showStatusDots ? <StatusDot color={color} running={workspace.indicator === "running"} /> : null}
      <View style={{ flex: 1, minWidth: 0, paddingVertical: branch || labels.length ? 3 : 0 }}>
        <Text
          selectable={false}
          numberOfLines={1}
          style={[
            titleStyle,
            nameColor ? { color: nameColor } : null,
            active || hover.hovered ? { opacity: 1 } : null,
          ]}
        >
          {workspace.title}
        </Text>
        {branch || labels.length ? (
          <MetaLine hostId={reference.hostId} branch={branch} labels={labels} theme={view.theme} />
        ) : null}
      </View>
      {relation?.trailing}
      <RowActions show={hover.show} slots={1} iconSize={look.icon} detail={trailing}>
        <ActionButton
          icon="Ellipsis"
          label={t("workspace.actions", { name: workspace.title })}
          color={view.theme.colors.foregroundMuted}
          size={look.icon}
          onPress={() => onMenu(reference)}
          onHoverIn={hover.onHoverIn}
        />
      </RowActions>
    </Pressable>
  );
}

/** The line under a workspace name: its branch, then its labels, like the app's meta row. */
function MetaLine({
  hostId,
  branch,
  labels,
  theme,
}: {
  hostId: string;
  branch: string | null;
  labels: readonly string[];
  theme: Theme;
}) {
  const look = useLook();
  const styles = useRowStyles(theme);
  const catalog = useLabelCatalog(hostId);
  const colors = new Map((catalog.labels ?? []).map((label) => [labelKey(label.name), label.color]));
  const items: ReactNode[] = [];
  if (branch) {
    items.push(
      <View key="branch" style={{ flexDirection: "row", alignItems: "center", gap: 3, flexShrink: 1, minWidth: 0 }}>
        <Icon name="GitBranch" size={look.small} color={theme.colors.foregroundMuted} />
        <Text selectable={false} numberOfLines={1} style={[styles.detail, { flexShrink: 1 }]}>
          {branch}
        </Text>
      </View>,
    );
  }
  for (const label of labels) {
    items.push(
      <LabelChip
        key={`label:${labelKey(label)}`}
        name={label}
        color={colors.get(labelKey(label))}
        theme={theme}
        fontSize={look.small}
        lineHeight={look.smallLine}
      />,
    );
  }
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, minWidth: 0, overflow: "hidden" }}>
      {items.map((item, index) => (
        <Fragment key={index}>
          {index > 0 && index === 1 && branch ? <Text style={styles.detail}>·</Text> : null}
          {item}
        </Fragment>
      ))}
    </View>
  );
}

/** A compact age that keeps itself current. */
function TimeAgo({ iso, style }: { iso: string; style: object }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return (
    <Text selectable={false} numberOfLines={1} style={style}>
      {compactTimeAgo(iso, now)}
    </Text>
  );
}

export function ProjectBlock({
  reference,
  groupId,
  nested,
  subProjects,
  collapsed,
  dragging,
  view,
  onToggle,
  onMenu,
  renderWorkspace,
  hostLabel = null,
  children,
}: {
  reference: ProjectRef;
  groupId: string | null;
  /** Shown under its parent project, one indent step in. */
  nested: boolean;
  /** Ref keys of the projects shown under this one; folding rolls their status up. */
  subProjects: readonly string[];
  collapsed: boolean;
  dragging: boolean;
  view: PluginSidebarViewProps;
  onToggle: (key: string) => void;
  onMenu: (reference: ProjectRef) => void;
  renderWorkspace: (workspace: WorkspaceRef, indent: number) => ReactNode;
  /** Host name shown after the project name when several hosts are connected; null hides it. */
  hostLabel?: string | null;
  /** Sub-project blocks, hidden while folded. */
  children?: ReactNode;
}) {
  const look = useLook();
  const styles = useRowStyles(view.theme);
  const controller = useDrag();
  const project = useProject(reference, (item) => ({ name: item.displayName }));
  const listed = (item: PluginWorkspaceSnapshot) =>
    item.project.key === reference.key && isListed(item, look);
  const workspaces = useWorkspaces({
    where: listed,
    orderBy: look.workspaceSort === "name" ? "name" : compareWorkspaceTimes(look.workspaceSort),
  });
  const rolledUp = (item: PluginWorkspaceSnapshot) =>
    (item.project.key === reference.key || subProjects.includes(item.project.key)) && isListed(item, look);
  const status = useFoldedStatus(collapsed && look.showFoldedStatus ? rolledUp : null);
  const holdsActive = useHoldsActive(view, collapsed ? rolledUp : null);
  // A sub-project sits where its parent's workspaces start.
  const shift = nested ? look.workspaceIndent - look.projectIndent : 0;
  const name = project?.name ?? reference.id;
  // The name shrinks to fit next to the host tag instead of filling the row, which would push the
  // tag to the far edge. `flex: 0` would collapse it on web, so drop `flex` altogether.
  const { flex: _fill, ...nameBase } = styles.projectName;
  const nameText = { ...nameBase, flexShrink: 1 };
  const slotRef = useDragSlot(`p:${reference.key}`, {
    kind: "project",
    projectKey: reference.key,
    groupId,
  });
  const hover = useHover(view.layout);
  const muted = view.theme.colors.foregroundMuted;
  const t = useT();
  const decorations = useDecorations();
  const decoration = decorations.get("projects", reference.key);
  const decorate = useCallback(() => {
    if (controller.recentlyDropped()) return;
    decorations.open({ kind: "projects", key: reference.key, name });
  }, [controller, decorations, reference.key, name]);
  const toggle = useCallback(() => {
    if (controller.recentlyDropped()) return;
    onToggle(reference.key);
  }, [controller, onToggle, reference.key]);
  const handle = useDragHandle({ kind: "project", key: reference.key, label: name }, toggle);
  const create = useCallback(() => view.navigation.openProject(reference), [view.navigation, reference]);

  if (!project) return null;
  return (
    // A sub-project is no drop slot of its own: its parent's slot spans it, so a drop next to it
    // lands next to the parent.
    <View ref={nested ? undefined : slotRef} style={dragging ? { opacity: 0.4 } : undefined}>
      <View {...handle.pressCapture}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(collapsed ? "common.expand" : "common.collapse", { name })}
          accessibilityState={{ expanded: !collapsed }}
          {...sidebarNavProps({ pgNav: "" })}
          accessibilityHint={t("project.dragHint")}
          onPress={toggle}
          onLongPress={handle.onLongPress}
          onPressOut={handle.onPressOut}
          onHoverIn={hover.onHoverIn}
          onHoverOut={hover.onHoverOut}
          style={[styles.row, styles.rounded, { paddingLeft: look.projectIndent + shift }]}
        >
          {holdsActive ? <ActiveFill theme={view.theme} inset={0} /> : null}
          <Icon name={collapsed ? "ChevronRight" : "ChevronDown"} size={look.icon - 1} color={muted} />
          <Badged status={status} theme={view.theme} reserve={look.showFoldedStatus}>
            {decoration.icon || look.showProjectIcons ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("group.decorate", { name })}
                hitSlop={4}
                onPress={decorate}
                onHoverIn={hover.onHoverIn}
              >
                <ProjectIcon
                  reference={reference}
                  icon={decoration.icon}
                  color={decoration.color ?? muted}
                  size={look.icon}
                />
              </Pressable>
            ) : null}
          </Badged>
          <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 }}>
            <Text
              selectable={false}
              numberOfLines={1}
              style={[nameText, decoration.color ? { color: decoration.color } : null]}
            >
              {name}
            </Text>
            {hostLabel ? <HostTag label={hostLabel} theme={view.theme} /> : null}
          </View>
          <RowActions
            show={hover.show}
            slots={2}
            iconSize={look.icon}
            detail={
              collapsed && workspaces.length + subProjects.length ? (
                <Text selectable={false} style={styles.detail}>
                  {workspaces.length + subProjects.length}
                </Text>
              ) : null
            }
          >
            <ActionButton
              icon="Plus"
              label={t("project.newWorkspace", { name })}
              color={muted}
              size={look.icon}
              onPress={create}
              onHoverIn={hover.onHoverIn}
            />
            <ActionButton
              icon="Ellipsis"
              label={t("project.actions", { name })}
              color={muted}
              size={look.icon}
              onPress={() => onMenu(reference)}
              onHoverIn={hover.onHoverIn}
            />
          </RowActions>
        </Pressable>
      </View>
      {collapsed
        ? null
        : workspaces.map((workspace) => renderWorkspace(workspace, look.workspaceIndent + shift))}
      {collapsed ? null : children}
    </View>
  );
}

export function SectionHeading({ title, view }: { title: string; view: PluginSidebarViewProps }) {
  const styles = useRowStyles(view.theme);
  return (
    <View style={styles.header}>
      <Text accessibilityRole="header" selectable={false} style={styles.mutedHeading}>
        {title}
      </Text>
    </View>
  );
}

export function TextButton({
  icon,
  label,
  view,
  onPress,
}: {
  icon: string;
  label: string;
  view: PluginSidebarViewProps;
  onPress: () => void;
}) {
  const look = useLook();
  const styles = useRowStyles(view.theme);
  const muted = view.theme.colors.foregroundMuted;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.row, styles.rounded, { paddingLeft: 8, paddingRight: 8, minWidth: 0 }]}
    >
      <Icon name={icon} size={look.icon} color={muted} />
      <Text selectable={false} numberOfLines={1} style={[styles.detail, { flexShrink: 1 }]}>
        {label}
      </Text>
    </Pressable>
  );
}
