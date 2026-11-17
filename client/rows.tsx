import {
  useWorkspace,
  useWorkspaces,
  useProject,
  type PluginSidebarViewProps,
  type ProjectRef,
  type WorkspaceRef,
} from "@getpaseo/plugin/client";
import { Icon, TextInput } from "@getpaseo/plugin/client/ui";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useDrag, useDragHandle, useDragSlot } from "./drag";
import { DecorIcon, useDecorations } from "./decor";
import { useT } from "./i18n";
import { useLook, type Look } from "./look";
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
    projectName: {
      flex: 1,
      color: theme.colors.foreground,
      fontSize: look.text,
      lineHeight: look.line,
      fontWeight: "500" as const,
    },
    workspaceName: { flex: 1, color: theme.colors.foreground, fontSize: look.text, lineHeight: look.line },
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

/** Hover state on desktop; touch layouts always show row actions. */
function useHover(alwaysShow: boolean) {
  const [hovered, setHovered] = useState(false);
  const onHoverIn = useCallback(() => setHovered(true), []);
  const onHoverOut = useCallback(() => setHovered(false), []);
  return { show: alwaysShow || hovered, onHoverIn, onHoverOut };
}

export function GroupHeader({
  group,
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
  const handle = useDragHandle({ kind: "group", id: group.id, label: group.name });
  const hover = useHover(view.layout.compact);
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

  const toggle = useCallback(() => {
    if (controller.recentlyDropped()) return;
    onToggle(group.id);
  }, [controller, onToggle, group.id]);

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
        accessibilityHint={t("group.dragHint")}
        onPress={toggle}
        onLongPress={handle.onLongPress}
        onPressOut={handle.onPressOut}
        onHoverIn={hover.onHoverIn}
        onHoverOut={hover.onHoverOut}
        style={styles.header}
      >
        <Icon name={collapsed ? "ChevronRight" : "ChevronDown"} size={look.icon - 1} color={muted} />
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

export function UngroupedHeader({
  count,
  collapsed,
  view,
  onToggle,
}: {
  count: number;
  collapsed: boolean;
  view: PluginSidebarViewProps;
  onToggle: () => void;
}) {
  const look = useLook();
  const styles = useRowStyles(view.theme);
  const t = useT();
  const slotRef = useDragSlot("ungrouped", { kind: "ungrouped" });
  const controller = useDrag();
  const muted = view.theme.colors.foregroundMuted;
  const toggle = useCallback(() => {
    if (controller.recentlyDropped()) return;
    onToggle();
  }, [controller, onToggle]);
  return (
    <View ref={slotRef}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t(collapsed ? "common.expand" : "common.collapse", {
          name: t("sidebar.ungrouped"),
        })}
        onPress={toggle}
        style={styles.header}
      >
        <Icon name={collapsed ? "ChevronRight" : "ChevronDown"} size={look.icon - 1} color={muted} />
        <Text selectable={false} numberOfLines={1} style={styles.mutedHeading}>
          {t("sidebar.ungrouped")}
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

/** The native spinner animates without re-rendering the workspace row on every frame. */
export function StatusDot({ color, running = false }: { color: string; running?: boolean }) {
  return (
    <View
      pointerEvents="none"
      style={{ width: 12, height: 12, flexShrink: 0, alignItems: "center", justifyContent: "center" }}
    >
      {running ? (
        <ActivityIndicator
          accessible={false}
          color={color}
          size="small"
          style={{ transform: [{ scale: 0.6 }] }}
        />
      ) : (
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
      )}
    </View>
  );
}

export function WorkspaceRow({
  reference,
  indent,
  view,
  onMenu,
}: {
  reference: WorkspaceRef;
  indent: number;
  view: PluginSidebarViewProps;
  onMenu: (reference: WorkspaceRef) => void;
}) {
  const look = useLook();
  const styles = useRowStyles(view.theme);
  const hover = useHover(view.layout.compact);
  const t = useT();
  const nameColor = useDecorations().get("workspaces", reference.key).color;
  const workspace = useWorkspace(reference, (item) => ({
    title: item.title ?? item.name,
    indicator: item.indicator,
    indicatorLabel: item.indicatorLabel,
    additions: item.diffStat?.additions ?? 0,
    deletions: item.diffStat?.deletions ?? 0,
  }));
  const open = useCallback(() => view.navigation.openWorkspace(reference), [view.navigation, reference]);
  if (!workspace) return null;
  const active = view.active.workspace?.key === reference.key;
  const tone = workspace.indicator === "done" ? null : INDICATOR_COLOR[workspace.indicator];
  const color = tone ? view.theme.colors[tone] : "transparent";
  const diff =
    look.showDiffStats && (workspace.additions || workspace.deletions) ? (
      <Text selectable={false} numberOfLines={1} style={styles.detail}>
        <Text style={{ color: view.theme.colors.statusSuccess }}>+{workspace.additions}</Text>{" "}
        <Text style={{ color: view.theme.colors.statusDanger }}>−{workspace.deletions}</Text>
      </Text>
    ) : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        workspace.indicatorLabel
          ? t("workspace.openWithStatus", { name: workspace.title, status: workspace.indicatorLabel })
          : t("workspace.open", { name: workspace.title })
      }
      onPress={open}
      onHoverIn={hover.onHoverIn}
      onHoverOut={hover.onHoverOut}
      style={[styles.row, styles.rounded, { paddingLeft: indent }, active ? styles.selected : null]}
    >
      {look.showStatusDots ? <StatusDot color={color} running={workspace.indicator === "running"} /> : null}
      <Text
        selectable={false}
        numberOfLines={1}
        style={[styles.workspaceName, nameColor ? { color: nameColor } : null]}
      >
        {workspace.title}
      </Text>
      <RowActions show={hover.show} slots={1} iconSize={look.icon} detail={diff}>
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

export function ProjectBlock({
  reference,
  groupId,
  collapsed,
  dragging,
  view,
  onToggle,
  onMenu,
  onWorkspaceMenu,
}: {
  reference: ProjectRef;
  groupId: string | null;
  collapsed: boolean;
  dragging: boolean;
  view: PluginSidebarViewProps;
  onToggle: (key: string) => void;
  onMenu: (reference: ProjectRef) => void;
  onWorkspaceMenu: (reference: WorkspaceRef) => void;
}) {
  const look = useLook();
  const styles = useRowStyles(view.theme);
  const controller = useDrag();
  const project = useProject(reference, (item) => ({ name: item.displayName }));
  const workspaces = useWorkspaces({
    where: (item) =>
      item.project.key === reference.key &&
      // Pinned workspaces live in the Pinned section unless the user hid it.
      (!look.showPinned || !item.pinnedAt) &&
      !item.background &&
      !item.archivingAt,
    orderBy: "name",
  });
  const name = project?.name ?? reference.id;
  const slotRef = useDragSlot(`p:${reference.key}`, {
    kind: "project",
    projectKey: reference.key,
    groupId,
  });
  const handle = useDragHandle({ kind: "project", key: reference.key, label: name });
  const hover = useHover(view.layout.compact);
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
  const create = useCallback(() => view.navigation.openProject(reference), [view.navigation, reference]);

  if (!project) return null;
  return (
    <View ref={slotRef} style={dragging ? { opacity: 0.4 } : undefined}>
      <View {...handle.pressCapture}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(collapsed ? "common.expand" : "common.collapse", { name })}
          accessibilityHint={t("project.dragHint")}
          onPress={toggle}
          onLongPress={handle.onLongPress}
          onPressOut={handle.onPressOut}
          onHoverIn={hover.onHoverIn}
          onHoverOut={hover.onHoverOut}
          style={[styles.row, styles.rounded, { paddingLeft: look.projectIndent }]}
        >
          <Icon name={collapsed ? "ChevronRight" : "ChevronDown"} size={look.icon - 1} color={muted} />
          {decoration.icon || look.showProjectIcons ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("group.decorate", { name })}
              hitSlop={4}
              onPress={decorate}
              onHoverIn={hover.onHoverIn}
            >
              <DecorIcon
                icon={decoration.icon}
                fallback="Folder"
                color={decoration.color ?? muted}
                size={look.icon}
              />
            </Pressable>
          ) : null}
          <Text
            selectable={false}
            numberOfLines={1}
            style={[styles.projectName, decoration.color ? { color: decoration.color } : null]}
          >
            {name}
          </Text>
          <RowActions
            show={hover.show}
            slots={2}
            iconSize={look.icon}
            detail={
              collapsed && workspaces.length ? (
                <Text selectable={false} style={styles.detail}>
                  {workspaces.length}
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
        : workspaces.map((workspace) => (
            <WorkspaceRow
              key={workspace.key}
              reference={workspace}
              indent={look.workspaceIndent}
              view={view}
              onMenu={onWorkspaceMenu}
            />
          ))}
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
      style={[styles.row, styles.rounded, { paddingLeft: 8, paddingRight: 8 }]}
    >
      <Icon name={icon} size={look.icon} color={muted} />
      <Text selectable={false} style={styles.detail}>
        {label}
      </Text>
    </Pressable>
  );
}
