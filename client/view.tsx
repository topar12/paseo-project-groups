import {
  useAgents,
  useHosts,
  useProjects,
  useRpc,
  useSettings,
  useWorkspaces,
  type AgentRef,
  type PluginSidebarViewProps,
  type ProjectRef,
  type WorkspaceRef,
} from "@getpaseo/plugin/client";
import { Icon, ScrollView, useToast } from "@getpaseo/plugin/client/ui";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, Platform, Pressable, Text, View, type ScrollView as NativeScrollView } from "react-native";
import { projectIdsRpc, removeProjectRpc } from "../shared/rpc";
import {
  appearanceDocument,
  decorationsDocument,
  groupsDocument,
  layoutDocument,
  type Decoration,
  type DecorationKind,
  type DecorationsValues,
  type ProjectGroup,
} from "../shared/settings";
import {
  DecorateDialog,
  DecorationsContext,
  DecorIcon,
  EMPTY_DECORATION,
  isEmptyDecoration,
  useDecorations,
  type DecorateTarget,
  type Decorations,
} from "./decor";
import { DeleteGroupDialog, ProjectMenuDialog, RemoveProjectDialog, WorkspaceMenuDialog } from "./dialogs";
import { DragProvider, useDragController } from "./drag";
import type { Hit } from "./hit";
import { useT } from "./i18n";
import { DEFAULT_APPEARANCE, LookContext, lookFrom, useLook, useViewActions } from "./look";
import { ProjectIcon } from "./project-icon";
import {
  addGroup,
  canNest,
  dropProjects,
  foldAllKeys,
  groupOfProject,
  moveGroup,
  nestProject,
  nextGroupName,
  placeProject,
  parseProjectKey,
  projectSettingsPath,
  removeGroup,
  renameGroup,
  sectionOf,
  sidebarLayout,
  type DragSubject,
  type DropTarget,
  type Parents,
  type Placement,
} from "./model";
import {
  EmptyGroupRow,
  GroupHeader,
  ProjectBlock,
  SectionHeading,
  TextButton,
  UngroupedHeader,
  WorkspaceRow,
  useRowStyles,
} from "./rows";
import { useSettingsSaver } from "./save";
import { activeFamily, agentRelationships, relationshipFamilies } from "./relationship-model";
import { RelationshipRail, useRelationshipRail } from "./relationship-rail";
import { RelationshipWorkspace, RelationshipsList, type RelationshipActions } from "./relationships";
import { bindSidebarKeys } from "./web";

const UNGROUPED_KEY = "u";
const WEB = Platform.OS === "web";

/** No plugin API opens it; on web the app's router follows a pushed URL without a reload. */
function navigateTo(path: string) {
  // The plugin builds without DOM types.
  const browser = globalThis as unknown as {
    history: { pushState(state: null, unused: string, url: string): void };
    dispatchEvent(event: unknown): void;
    PopStateEvent: new (type: string) => unknown;
  };
  browser.history.pushState(null, "", path);
  browser.dispatchEvent(new browser.PopStateEvent("popstate"));
}
const EMPTY_GROUPS: readonly ProjectGroup[] = [];
const EMPTY_KEYS: readonly string[] = [];
const EMPTY_PARENTS: Parents = {};
/** Startup and reconnects settle before a missing parent is checked with the daemon. */
const PARENT_CHECK_DELAY_MS = 3000;
const PARENT_CHECK_RETRY_MS = 30_000;
const EMPTY_DECORATIONS: DecorationsValues = { groups: {}, projects: {}, workspaces: {} };

type Theme = PluginSidebarViewProps["theme"];

type Dialog =
  | { kind: "project"; reference: ProjectRef }
  | { kind: "remove-project"; reference: ProjectRef }
  | { kind: "workspace"; reference: WorkspaceRef }
  | { kind: "delete-group"; group: ProjectGroup }
  | { kind: "decorate"; target: DecorateTarget };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function DropIndicator({ hit, theme }: { hit: Hit; theme: Theme }) {
  const indicator = hit.indicator;
  if (indicator.kind === "line") {
    return (
      <View
        style={{
          position: "absolute",
          left: 8,
          right: 8,
          top: indicator.y - 1,
          height: 2,
          borderRadius: 1,
          backgroundColor: theme.colors.accent,
          pointerEvents: "none",
        }}
      />
    );
  }
  return (
    <View
      style={{
        position: "absolute",
        left: 4,
        right: 4,
        top: indicator.y,
        height: indicator.height,
        borderRadius: 6,
        borderWidth: 1.5,
        borderColor: theme.colors.accent,
        pointerEvents: "none",
      }}
    />
  );
}

function Ghost({ subject, reference, y, theme }: {
  subject: DragSubject;
  reference?: ProjectRef;
  y: Animated.Value;
  theme: Theme;
}) {
  const look = useLook();
  const decoration = useDecorations().get(
    subject.kind === "group" ? "groups" : "projects",
    subject.kind === "group" ? subject.id : subject.key,
  );
  return (
    <Animated.View
      style={{
        position: "absolute",
        left: 20,
        right: 8,
        top: 0,
        minHeight: look.row,
        // Opaque with a shadow so rows underneath never show through the dragged row.
        shadowColor: "#000",
        shadowOpacity: 0.18,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 3 },
        elevation: 6,
        paddingHorizontal: 10,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.accent,
        backgroundColor: theme.colors.surface1,
        pointerEvents: "none",
        transform: [{ translateY: y }],
      }}
    >
      {reference ? (
        <ProjectIcon
          reference={reference}
          icon={decoration.icon}
          color={decoration.color ?? theme.colors.foregroundMuted}
          size={look.icon}
        />
      ) : (
        <DecorIcon
          icon={decoration.icon}
          fallback={subject.kind === "group" ? "Layers" : "Folder"}
          color={decoration.color ?? theme.colors.foregroundMuted}
          size={look.icon}
        />
      )}
      <Text
        numberOfLines={1}
        style={{
          color: decoration.color ?? theme.colors.foreground,
          fontSize: look.text,
          lineHeight: look.line,
        }}
      >
        {subject.label}
      </Text>
    </Animated.View>
  );
}

function StatusMessage({
  message,
  view,
  actions,
}: {
  message: string;
  view: PluginSidebarViewProps;
  actions?: { label: string; icon: string; onPress: () => void }[];
}) {
  const styles = useRowStyles(view.theme);
  return (
    <View style={{ padding: 12, gap: 4 }}>
      <Text style={styles.detail}>{message}</Text>
      {actions?.map((action) => (
        <TextButton
          key={action.label}
          icon={action.icon}
          label={action.label}
          view={view}
          onPress={action.onPress}
        />
      ))}
    </View>
  );
}

function ToolbarRow({
  view,
  allFolded,
  onCreateGroup,
  onFoldAll,
  byRelation,
  setByRelation,
}: {
  view: PluginSidebarViewProps;
  allFolded: boolean;
  onCreateGroup: () => void;
  onFoldAll: () => void;
  byRelation: boolean;
  setByRelation: (value: boolean) => void;
}) {
  const t = useT();
  const look = useLook();
  const actions = useViewActions();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingTop: 4,
        paddingBottom: 4,
        borderBottomWidth: 1,
        borderBottomColor: view.theme.colors.border,
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <TextButton icon="FolderPlus" label={t("sidebar.newGroup")} view={view} onPress={onCreateGroup} />
      </View>
      <View
        style={{
          flexDirection: "row",
          flexShrink: 0,
          gap: 2,
          borderRadius: 6,
          padding: 2,
          borderWidth: 1,
          borderColor: view.theme.colors.border,
          backgroundColor: view.theme.colors.surface1,
        }}
      >
        {([false, true] as const).map((value) => {
          const selected = byRelation === value;
          const label = t(value ? "relation.relationships" : "relation.projects");
          return (
            <Pressable
              key={label}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={{ selected }}
              hitSlop={4}
              onPress={() => setByRelation(value)}
              style={{
                justifyContent: "center",
                minHeight: view.layout.compact ? 30 : 22,
                paddingHorizontal: 6,
                borderRadius: 4,
                backgroundColor: selected ? view.theme.colors.surface0 : undefined,
              }}
            >
              <Text
                selectable={false}
                numberOfLines={1}
                style={{
                  color: selected ? view.theme.colors.foreground : view.theme.colors.foregroundMuted,
                  fontSize: look.small,
                  lineHeight: look.smallLine,
                  fontWeight: selected ? "500" : "400",
                }}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {/* Folds belong to the project view; the relation tree has none. */}
      {byRelation ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={allFolded ? t("sidebar.expandAll") : t("sidebar.collapseAll")}
          hitSlop={4}
          onPress={onFoldAll}
          style={{ padding: 6, borderRadius: 6 }}
        >
          <Icon
            name={allFolded ? "ChevronsUpDown" : "ChevronsDownUp"}
            size={look.icon}
            color={view.theme.colors.foregroundMuted}
          />
        </Pressable>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("sidebar.appearance")}
        hitSlop={4}
        onPress={actions.openAppearanceSettings}
        style={{ padding: 6, marginRight: 6, borderRadius: 6 }}
      >
        <Icon name="SlidersHorizontal" size={look.icon} color={view.theme.colors.foregroundMuted} />
      </Pressable>
    </View>
  );
}

export function GroupsView(view: PluginSidebarViewProps) {
  const appearance = useSettings(appearanceDocument);
  const look = useMemo(
    () => lookFrom(appearance.status === "ready" ? appearance.values : DEFAULT_APPEARANCE),
    [appearance],
  );
  return (
    <LookContext.Provider value={look}>
      <GroupsList {...view} />
    </LookContext.Provider>
  );
}

function GroupsList(view: PluginSidebarViewProps) {
  const groupsState = useSettings(groupsDocument);
  const layoutState = useSettings(layoutDocument);
  const decorationsState = useSettings(decorationsDocument);
  const removeProjectCall = useRpc(removeProjectRpc);
  const projectIdsCall = useRpc(projectIdsRpc);
  const toast = useToast();
  const t = useT();
  const look = useLook();
  const styles = useRowStyles(view.theme);

  const groupsSaver = useSettingsSaver(groupsState);
  const layoutSaver = useSettingsSaver(layoutState);
  const decorationsSaver = useSettingsSaver(decorationsState);

  // Optimistic copies make drops and folding feel instant. They clear when a new revision
  // arrives with no save left in flight, or when a save fails. Clearing between two queued
  // saves would briefly show the first save without the second.
  const [pendingPlacement, setPendingPlacement] = useState<Placement | null>(null);
  const [pendingCollapsed, setPendingCollapsed] = useState<string[] | null>(null);
  const groupsRevision = groupsState.status === "ready" ? groupsState.revision : null;
  const layoutRevision = layoutState.status === "ready" ? layoutState.revision : null;
  useEffect(() => {
    if (!groupsSaver.busy()) setPendingPlacement(null);
  }, [groupsRevision, groupsSaver]);
  useEffect(() => {
    if (!layoutSaver.busy()) setPendingCollapsed(null);
  }, [layoutRevision, layoutSaver]);
  const [pendingDecorations, setPendingDecorations] = useState<DecorationsValues | null>(null);
  const decorationsRevision = decorationsState.status === "ready" ? decorationsState.revision : null;
  useEffect(() => {
    if (!decorationsSaver.busy()) setPendingDecorations(null);
  }, [decorationsRevision, decorationsSaver]);
  const decorationValues: DecorationsValues =
    pendingDecorations ?? (decorationsState.status === "ready" ? decorationsState.values : EMPTY_DECORATIONS);

  const groups: readonly ProjectGroup[] =
    pendingPlacement?.groups ?? (groupsState.status === "ready" ? groupsState.values.groups : EMPTY_GROUPS);
  const parents: Parents =
    pendingPlacement?.parents ?? (groupsState.status === "ready" ? groupsState.values.parents : EMPTY_PARENTS);
  const collapsedList: readonly string[] =
    pendingCollapsed ?? (layoutState.status === "ready" ? layoutState.values.collapsed : EMPTY_KEYS);
  const collapsed = useMemo(() => new Set(collapsedList), [collapsedList]);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const renamingRef = useRef<string | null>(null);
  renamingRef.current = renamingId;
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [removing, setRemoving] = useState(false);
  const closeDialog = useCallback(() => setDialog(null), []);

  const projects = useProjects({ orderBy: "displayName" });
  const pinned = useWorkspaces({
    where: (item) =>
      look.showPinned && !!item.pinnedAt && (look.showBackground || !item.background) && !item.archivingAt,
    orderBy: "pinnedAt",
  });
  const [byRelation, setByRelation] = useState(false);
  const [hoveredAgent, setHoveredAgent] = useState<string | null>(null);
  const visibleWorkspaces = useWorkspaces({
    where: (item) => (look.showBackground || !item.background) && !item.archivingAt,
    groupBy: (item) => item.project.key,
  });
  const workspaceProjects = useMemo(() => {
    const result = new Map<string, string>();
    for (const group of visibleWorkspaces) {
      for (const workspace of group.items) result.set(workspace.key, group.key);
    }
    return result;
  }, [visibleWorkspaces]);
  const agentGroups = useAgents({
    where: (agent) => !agent.background && workspaceProjects.has(agent.workspace.key),
    orderBy: ["createdAt", "asc"],
    groupBy: (agent) => agent.parentAgent
      ? [`w:${agent.workspace.key}`, `a:${agent.parentAgent.key}`]
      : `w:${agent.workspace.key}`,
  });
  const relationships = useMemo(() => agentRelationships(agentGroups), [agentGroups]);
  const families = useMemo(() => relationshipFamilies(relationships), [relationships]);
  const activeAgentKey = useMemo(() => {
    if (view.active.agent && relationships.agents.has(view.active.agent.key)) {
      return view.active.agent.key;
    }
    const workspaceKey = view.active.workspace?.key;
    if (!workspaceKey) return null;
    const agents = relationships.byWorkspace.get(workspaceKey);
    return agents?.length === 1 ? agents[0].key : null;
  }, [relationships.agents, relationships.byWorkspace, view.active.agent, view.active.workspace]);
  const family = useMemo(
    () => activeFamily(relationships, hoveredAgent) ?? activeFamily(relationships, activeAgentKey),
    [activeAgentKey, hoveredAgent, relationships],
  );
  const highlighted = useMemo(
    () => new Set(family ? [family.parent.key, ...family.children.map((agent) => agent.key)] : []),
    [family],
  );

  const byKey = useMemo(() => new Map(projects.map((project) => [project.key, project])), [projects]);
  const order = useMemo(() => projects.map((project) => project.key), [projects]);
  const layout = useMemo(() => sidebarLayout(groups, parents, order), [groups, order, parents]);
  const refsOf = useCallback(
    (keys: readonly string[]) =>
      keys.map((key) => byKey.get(key)).filter((item): item is ProjectRef => item !== undefined),
    [byKey],
  );
  /** The keys plus their sub-projects, for the status of a folded section. */
  const withSubProjects = useCallback(
    (keys: readonly string[]) => keys.flatMap((key) => [key, ...(layout.children.get(key) ?? [])]),
    [layout],
  );

  // With projects from more than one host, Ungrouped is split by host and grouped projects carry a
  // small host tag. With a single host nothing changes, including the fold key of Ungrouped.
  const hosts = useHosts();
  const hostIds = useMemo(() => {
    const seen: string[] = [];
    for (const key of order) {
      const id = parseProjectKey(key)?.hostId;
      if (id && !seen.includes(id)) seen.push(id);
    }
    // The app's host order keeps the sections steady while hosts connect.
    const rank = (id: string) => {
      const index = hosts.findIndex((host) => host.serverId === id);
      return index < 0 ? hosts.length : index;
    };
    return seen.sort((left, right) => rank(left) - rank(right));
  }, [hosts, order]);
  const multiHost = hostIds.length > 1;
  const hostLabel = useCallback(
    (id: string) => hosts.find((host) => host.serverId === id)?.label || id,
    [hosts],
  );
  /** The fold key of the Ungrouped section a project shows in. */
  const ungroupedKeyOf = useCallback(
    (projectKey: string) => {
      const id = parseProjectKey(projectKey)?.hostId;
      return multiHost && id ? `${UNGROUPED_KEY}:${id}` : UNGROUPED_KEY;
    },
    [multiHost],
  );
  const ungroupedSections = useMemo(() => {
    const all = [{ hostId: null as string | null, foldKey: UNGROUPED_KEY, keys: layout.ungrouped }];
    if (!multiHost) return all;
    const split = hostIds
      .map((id) => ({
        hostId: id as string | null,
        foldKey: `${UNGROUPED_KEY}:${id}`,
        keys: layout.ungrouped.filter((key) => parseProjectKey(key)?.hostId === id),
      }))
      .filter((section) => section.keys.length > 0);
    // Keep one header as a drop target even when every project is in a group.
    return split.length ? split : all;
  }, [hostIds, layout, multiHost]);

  /**
   * `quiet` is for the automatic cleanup of removed parents. Another device may run the same
   * cleanup first; its save then wins and this one conflicts, though the groups are already right.
   */
  const savePlacement = useCallback(
    async (next: Placement, { quiet = false }: { quiet?: boolean } = {}) => {
      if (groupsState.status !== "ready") return;
      setPendingPlacement(next);
      const saved = await groupsSaver.save(next);
      if (!saved) {
        setPendingPlacement(null);
        if (!quiet) toast.error(t("toast.groupsSaveFailed"));
      }
    },
    [groupsSaver, groupsState.status, t, toast],
  );
  const saveGroups = useCallback(
    (next: ProjectGroup[]) => savePlacement({ groups: next, parents: { ...parents } }),
    [parents, savePlacement],
  );

  const saveDecorations = useCallback(
    async (next: DecorationsValues) => {
      if (decorationsState.status !== "ready") {
        toast.error(t("toast.looksNotLoaded"));
        return;
      }
      setPendingDecorations(next);
      const saved = await decorationsSaver.save(next);
      if (!saved) {
        setPendingDecorations(null);
        toast.error(t("toast.looksSaveFailed"));
      }
    },
    [decorationsSaver, decorationsState.status, t, toast],
  );

  /** Returns the document with one entry replaced, or removed when it is back to defaults. */
  const withDecoration = useCallback(
    (kind: DecorationKind, key: string, decoration: Decoration | null): DecorationsValues | null => {
      const bucket = { ...decorationValues[kind] };
      const had = key in bucket;
      if (!decoration || isEmptyDecoration(decoration)) {
        if (!had) return null;
        delete bucket[key];
      } else {
        bucket[key] = decoration;
      }
      return { ...decorationValues, [kind]: bucket };
    },
    [decorationValues],
  );

  /** Drops looks whose items are gone, so the stored document does not keep stale keys. */
  const withoutDecorations = useCallback(
    (removals: readonly [DecorationKind, readonly string[]][]): DecorationsValues | null => {
      let changed = false;
      const next = { ...decorationValues };
      for (const [kind, keys] of removals) {
        const bucket = { ...next[kind] };
        for (const key of keys) {
          if (!(key in bucket)) continue;
          delete bucket[key];
          changed = true;
        }
        next[kind] = bucket;
      }
      return changed ? next : null;
    },
    [decorationValues],
  );

  const decorations = useMemo<Decorations>(
    () => ({
      values: decorationValues,
      get: (kind, key) => decorationValues[kind][key] ?? EMPTY_DECORATION,
      open: (target) => setDialog({ kind: "decorate", target }),
    }),
    [decorationValues],
  );

  const toggle = useCallback(
    (key: string) => {
      if (layoutState.status !== "ready") return;
      const next = collapsed.has(key)
        ? collapsedList.filter((item) => item !== key)
        : [...collapsedList, key];
      setPendingCollapsed(next);
      void layoutSaver.save({ collapsed: next }).then((saved) => {
        if (!saved) setPendingCollapsed(null);
      });
    },
    [collapsed, collapsedList, layoutSaver, layoutState.status],
  );
  /** Every group, Ungrouped section, project and sub-project. */
  const foldKeys = useMemo(
    () => [
      ...groups.map((group) => `g:${group.id}`),
      ...ungroupedSections.map((section) => section.foldKey),
      ...order.map((key) => `p:${key}`),
    ],
    [groups, order, ungroupedSections],
  );
  const allFolded = foldKeys.every((key) => collapsed.has(key));
  const foldAll = useCallback(() => {
    if (layoutState.status !== "ready") return;
    const next = foldAllKeys(collapsedList, foldKeys);
    setPendingCollapsed(next);
    void layoutSaver.save({ collapsed: next }).then((saved) => {
      if (!saved) setPendingCollapsed(null);
    });
  }, [collapsedList, foldKeys, layoutSaver, layoutState.status]);
  const toggleGroup = useCallback((id: string) => toggle(`g:${id}`), [toggle]);
  const toggleProject = useCallback((key: string) => toggle(`p:${key}`), [toggle]);

  /** Unfolds sections so a project the user just moved is visible where it landed. */
  const reveal = useCallback(
    (keys: readonly string[]) => {
      if (layoutState.status !== "ready" || !keys.some((key) => collapsed.has(key))) return;
      const next = collapsedList.filter((item) => !keys.includes(item));
      setPendingCollapsed(next);
      void layoutSaver.save({ collapsed: next }).then((saved) => {
        if (!saved) setPendingCollapsed(null);
      });
    },
    [collapsed, collapsedList, layoutSaver, layoutState.status],
  );

  const onDrop = useCallback(
    (subject: DragSubject, target: DropTarget) => {
      if (subject.kind === "project") {
        const next = placeProject(groups, parents, subject.key, target);
        if (next) void savePlacement(next);
        return;
      }
      const next = target.kind === "group-at" ? moveGroup(groups, subject.id, target.index) : null;
      if (next) void saveGroups(next);
    },
    [groups, parents, saveGroups, savePlacement],
  );

  const viewportRef = useRef<View>(null);
  const contentRef = useRef<View>(null);
  const scrollRef = useRef<NativeScrollView>(null);
  const drag = useDragController(viewportRef, scrollRef, onDrop);
  const railFamilies = useMemo(
    () => (byRelation || !look.showRelations ? [] : families),
    [byRelation, families, look.showRelations],
  );
  const {
    register,
    refresh,
    revealAgent,
    onScroll: onRailScroll,
    onViewportHeight,
    rails,
    laneCount,
    gutterExtra,
  } = useRelationshipRail(railFamilies, contentRef, scrollRef);
  useEffect(() => { refresh(); }, [collapsedList, layout, refresh]);

  /** Normal click/tap opens the agent directly without disturbing sidebar scroll or folds. */
  const openAgent = useCallback((agent: AgentRef) => {
    view.navigation.openAgent(agent);
  }, [view.navigation]);

  /** Explicit keyboard jump unfolds collapsed sections and minimally scrolls only when off-screen. */
  const jumpToAgent = useCallback((agent: AgentRef) => {
    let wasCollapsed = false;
    const workspace = relationships.workspaces.get(agent.key);
    const project = workspace ? workspaceProjects.get(workspace) : undefined;
    if (!byRelation && project) {
      const section = sectionOf(layout, project);
      const containingProject = parents[project];
      const folds = [`p:${project}`];
      if (containingProject) folds.push(`p:${containingProject}`);
      if (section !== undefined) folds.push(section === null ? ungroupedKeyOf(project) : `g:${section}`);
      wasCollapsed = folds.some((foldKey) => collapsed.has(foldKey));
      if (wasCollapsed) reveal(folds);
    }
    revealAgent(agent.key, { focus: true, wasCollapsed });
    view.navigation.openAgent(agent);
  }, [byRelation, collapsed, layout, parents, relationships, reveal, revealAgent, ungroupedKeyOf, view.navigation, workspaceProjects]);

  useEffect(() => bindSidebarKeys(viewportRef.current, (key, direction) => {
    const parent = relationships.parents.get(key);
    if (direction === "parent") {
      if (!parent) return false;
      jumpToAgent(parent);
      return true;
    }
    if (parent) {
      const siblings = relationships.children.get(parent.key);
      if (!siblings || siblings.length < 2) return false;
      const index = siblings.findIndex((agent) => agent.key === key);
      const step = direction === "next" ? 1 : siblings.length - 1;
      jumpToAgent(siblings[(index + step) % siblings.length]);
      return true;
    }
    const children = relationships.children.get(key);
    if (!children?.length) return false;
    jumpToAgent(direction === "next" ? children[0] : children[children.length - 1]);
    return true;
  }), [jumpToAgent, relationships, groupsState.status, layoutState.status]);

  const switchMode = (next: boolean) => {
    if (next === byRelation) return;
    setByRelation(next);
    setHoveredAgent(null);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  const createGroup = useCallback(() => {
    const created = addGroup(
      groups,
      nextGroupName(groups, (number) => t("group.defaultName", { number })),
    );
    setRenamingId(created.id);
    void saveGroups(created.groups);
  }, [groups, saveGroups, t]);

  const rename = useCallback(
    (id: string, name: string) => {
      // Submit and blur both arrive; only the first one counts.
      if (renamingRef.current !== id) return;
      renamingRef.current = null;
      setRenamingId(null);
      const next = renameGroup(groups, id, name);
      if (next) void saveGroups(next);
    },
    [groups, saveGroups],
  );
  const cancelRename = useCallback(() => {
    renamingRef.current = null;
    setRenamingId(null);
  }, []);

  const requestDelete = useCallback(
    (id: string) => {
      const group = groups.find((item) => item.id === id);
      if (!group) return;
      if (group.projects.some((key) => byKey.has(key))) {
        setDialog({ kind: "delete-group", group });
        return;
      }
      void saveGroups(removeGroup(groups, id));
      const cleaned = withDecoration("groups", id, null);
      if (cleaned) void saveDecorations(cleaned);
    },
    [byKey, groups, saveDecorations, saveGroups, withDecoration],
  );

  const openProjectMenu = useCallback(
    (reference: ProjectRef) => setDialog({ kind: "project", reference }),
    [],
  );
  const openWorkspaceMenu = useCallback(
    (reference: WorkspaceRef) => setDialog({ kind: "workspace", reference }),
    [],
  );
  const openProjectSettings = useCallback(
    (reference: ProjectRef) => {
      setDialog(null);
      navigateTo(projectSettingsPath(reference));
      view.dismiss();
    },
    [view],
  );

  const chooseGroup = useCallback(
    (reference: ProjectRef, groupId: string | null) => {
      setDialog(null);
      // Picking the group the project is already in must not move it to the end.
      if (!(reference.key in parents) && groupOfProject(groups, reference.key) === groupId) return;
      const next = placeProject(
        groups,
        parents,
        reference.key,
        groupId === null ? { kind: "ungroup" } : { kind: "into-group", groupId },
      );
      if (!next) return;
      void savePlacement(next);
      reveal([groupId === null ? ungroupedKeyOf(reference.key) : `g:${groupId}`]);
    },
    [groups, parents, reveal, savePlacement, ungroupedKeyOf],
  );

  const chooseParent = useCallback(
    (reference: ProjectRef, parentKey: string) => {
      setDialog(null);
      const next = nestProject(groups, parents, reference.key, parentKey);
      if (!next) return;
      void savePlacement(next);
      const parentGroup = groupOfProject(groups, parentKey);
      reveal([`p:${parentKey}`, parentGroup === null ? ungroupedKeyOf(parentKey) : `g:${parentGroup}`]);
    },
    [groups, parents, reveal, savePlacement, ungroupedKeyOf],
  );

  /** Back to the top level, right after its parent so it stays where the user was looking. */
  const unnest = useCallback(
    (reference: ProjectRef) => {
      setDialog(null);
      const parent = parents[reference.key];
      if (parent === undefined) return;
      const groupId = groupOfProject(groups, parent);
      const next = placeProject(
        groups,
        parents,
        reference.key,
        groupId === null ? { kind: "ungroup" } : { kind: "project-after", groupId, projectKey: parent },
      );
      if (!next) return;
      void savePlacement(next);
      reveal([groupId === null ? ungroupedKeyOf(reference.key) : `g:${groupId}`]);
    },
    [groups, parents, reveal, savePlacement, ungroupedKeyOf],
  );

  // A parent missing from the list may still be loading or on a reconnecting host. Only the
  // daemon's own answer that it has no such project counts as a removal; any failure keeps the
  // links and tries again later.
  const latest = useRef({ groups, parents, order, savePlacement });
  latest.current = { groups, parents, order, savePlacement };
  const missingParents = layout.missingParents.join("\n");
  const [parentCheck, setParentCheck] = useState(0);
  useEffect(() => {
    if (!missingParents || groupsState.status !== "ready") return;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      projectIdsCall({}).then(
        (daemon) => {
          if (cancelled) return;
          const listed = new Set(daemon.projectIds);
          const gone = missingParents.split("\n").filter((key) => {
            const parsed = parseProjectKey(key);
            return parsed !== null && parsed.hostId === daemon.serverId && !listed.has(parsed.projectId);
          });
          if (!gone.length) return;
          const { groups, parents, order, savePlacement } = latest.current;
          const next = dropProjects(groups, parents, gone, order);
          if (next) void savePlacement(next, { quiet: true });
        },
        () => {
          if (!cancelled) retry = setTimeout(() => setParentCheck((count) => count + 1), PARENT_CHECK_RETRY_MS);
        },
      );
    }, PARENT_CHECK_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearTimeout(retry);
    };
  }, [groupsState.status, missingParents, parentCheck, projectIdsCall]);

  const confirmRemoveProject = useCallback(
    async (reference: ProjectRef, workspaceKeys: readonly string[]) => {
      setRemoving(true);
      try {
        const result = await removeProjectCall({ projectId: reference.id, hostId: reference.hostId });
        setDialog(null);
        toast.show(
          result.removedWorkspaceIds.length
            ? t("project.removedWithWorkspaces", { count: result.removedWorkspaceIds.length })
            : t("project.removed"),
        );
        // Drop the removed project and its look so no stale key stays behind. Its sub-projects
        // take its place.
        const next = dropProjects(groups, parents, [reference.key], order);
        if (next) void savePlacement(next);
        const cleaned = withoutDecorations([
          ["projects", [reference.key]],
          ["workspaces", workspaceKeys],
        ]);
        if (cleaned) void saveDecorations(cleaned);
      } catch (error) {
        toast.error(t("project.removeFailed", { reason: errorText(error) }));
      } finally {
        setRemoving(false);
      }
    },
    [groups, order, parents, removeProjectCall, saveDecorations, savePlacement, t, toast, withoutDecorations],
  );

  if (groupsState.status === "loading" || layoutState.status === "loading") {
    return <StatusMessage message={t("sidebar.loading")} view={view} />;
  }
  if (groupsState.status === "error") {
    return (
      <StatusMessage
        message={t("sidebar.loadFailed", { reason: groupsState.error })}
        view={view}
        actions={[{ label: t("common.reload"), icon: "RefreshCw", onPress: () => void groupsState.reload() }]}
      />
    );
  }
  if (groupsState.status === "invalid") {
    return (
      <StatusMessage
        message={t("sidebar.invalid", { reason: groupsState.error })}
        view={view}
        actions={[
          { label: t("common.reload"), icon: "RefreshCw", onPress: () => void groupsState.reload() },
          { label: t("sidebar.resetGroups"), icon: "RotateCcw", onPress: () => void groupsState.reset() },
        ]}
      />
    );
  }

  /**
   * Projects `reference` can go under: the other top-level projects of the section it shows in (its
   * parent's section for a sub-project), in sidebar order.
   */
  const parentChoices = (reference: ProjectRef): ProjectRef[] => {
    const parent = parents[reference.key];
    const section = sectionOf(layout, reference.key);
    if (section === undefined) return [];
    const keys = section === null ? layout.ungrouped : (layout.groups.get(section) ?? []);
    return refsOf(keys).filter(
      (item) => item.key === parent || canNest(parents, reference.key, item.key),
    );
  };

  const draggingKey =
    drag.subject?.kind === "project"
      ? drag.subject.key
      : drag.subject?.kind === "group"
        ? drag.subject.id
        : null;

  const sidebar: RelationshipActions = {
    view,
    model: relationships,
    highlighted,
    open: openAgent,
    hover: setHoveredAgent,
    register,
    refresh,
  };
  // With relationships off, the project view shows plain rows: no lines, child count or highlight.
  const renderWorkspace = (reference: WorkspaceRef, indent: number) =>
    look.showRelations ? (
      <RelationshipWorkspace key={reference.key} reference={reference} indent={indent} sidebar={sidebar} onMenu={openWorkspaceMenu} />
    ) : (
      <WorkspaceRow key={reference.key} reference={reference} indent={indent} view={view} onMenu={openWorkspaceMenu} />
    );

  const projectBlock = (reference: ProjectRef, groupId: string | null, nested = false): ReactNode => {
    const children = nested
      ? []
      : refsOf(layout.children.get(reference.key) ?? []);
    return (
      <ProjectBlock
        key={reference.key}
        reference={reference}
        groupId={groupId}
        nested={nested}
        subProjects={children.map((child) => child.key)}
        collapsed={collapsed.has(`p:${reference.key}`)}
        dragging={draggingKey === reference.key}
        view={view}
        onToggle={toggleProject}
        onMenu={openProjectMenu}
        renderWorkspace={renderWorkspace}
        // Inside a host's own Ungrouped section the header already names the host.
        hostLabel={multiHost && look.showHostTags && groupId !== null ? hostLabel(reference.hostId) : null}
      >
        {children.map((child) => projectBlock(child, groupId, true))}
      </ProjectBlock>
    );
  };

  return (
    <DecorationsContext.Provider value={decorations}>
      <DragProvider value={drag.controller}>
        <View style={{ flex: 1 }}>
          <ToolbarRow
            view={view}
            allFolded={allFolded}
            onFoldAll={foldAll}
            byRelation={byRelation}
            setByRelation={switchMode}
            onCreateGroup={() => { switchMode(false); createGroup(); }}
          />
          <View
            ref={viewportRef}
            {...drag.surfaceHandlers}
            onLayout={(event) => onViewportHeight(event.nativeEvent.layout.height)}
            style={{ flex: 1 }}
          >
            <ScrollView
              ref={scrollRef}
              scrollEnabled={!drag.scrollLocked}
              scrollEventThrottle={16}
              onScroll={(event) => {
                const y = event.nativeEvent.contentOffset.y;
                drag.controller.onScroll(y);
                onRailScroll(y);
              }}
              onContentSizeChange={(_width, height) => { drag.controller.onContentHeight(height); refresh(); }}
              contentContainerStyle={{ paddingBottom: 24 }}
            >
              <View ref={contentRef} collapsable={false} onLayout={refresh} style={gutterExtra ? { paddingLeft: gutterExtra } : undefined}>
                {byRelation ? <RelationshipsList sidebar={sidebar} /> : <>
                  {pinned.length ? (
                    <View>
                      <SectionHeading title={t("sidebar.pinned")} view={view} />
                      {pinned.map((reference) => renderWorkspace(reference, 18))}
                    </View>
                  ) : null}

                  {groups.length === 0 ? (
                    <View style={{ paddingHorizontal: 12, paddingTop: 10 }}>
                      <Text style={styles.detail}>{t("sidebar.emptyHint")}</Text>
                    </View>
                  ) : null}

                  {groups.map((group, index) => {
                    const members = refsOf(layout.groups.get(group.id) ?? []);
                    const folded = collapsed.has(`g:${group.id}`);
                    return (
                      <Fragment key={group.id}>
                        {index > 0 || pinned.length ? <View style={{ height: look.groupGap }} /> : null}
                        <GroupHeader
                          group={group}
                          statusKeys={withSubProjects(members.map((reference) => reference.key))}
                          count={members.length}
                          collapsed={folded}
                          renaming={renamingId === group.id}
                          dragging={draggingKey === group.id}
                          view={view}
                          onToggle={toggleGroup}
                          onStartRename={setRenamingId}
                          onRename={rename}
                          onCancelRename={cancelRename}
                          onDelete={requestDelete}
                        />
                        {folded ? null : members.length ? (
                          members.map((reference) => projectBlock(reference, group.id))
                        ) : (
                          <EmptyGroupRow groupId={group.id} view={view} />
                        )}
                      </Fragment>
                    );
                  })}

                  {ungroupedSections.map((section, index) => (
                    <Fragment key={section.foldKey}>
                      {index > 0 || groups.length || pinned.length ? (
                        <View style={{ height: look.groupGap }} />
                      ) : null}
                      <UngroupedHeader
                        projects={withSubProjects(section.keys)}
                        count={section.keys.length}
                        collapsed={collapsed.has(section.foldKey)}
                        view={view}
                        onToggle={() => toggle(section.foldKey)}
                        hostId={section.hostId}
                        hostLabel={section.hostId ? hostLabel(section.hostId) : null}
                      />
                      {collapsed.has(section.foldKey)
                        ? null
                        : refsOf(section.keys).map((reference) => projectBlock(reference, null))}
                    </Fragment>
                  ))}

                </>}
                <RelationshipRail rails={rails} laneCount={laneCount} activeParentKey={family?.parent.key ?? null} theme={view.theme} />
              </View>
              {drag.hit ? <DropIndicator hit={drag.hit} theme={view.theme} /> : null}
            </ScrollView>
            {drag.subject ? (
              <Ghost
                subject={drag.subject}
                reference={drag.subject.kind === "project" ? byKey.get(drag.subject.key) : undefined}
                y={drag.ghostY}
                theme={view.theme}
              />
            ) : null}
          </View>
        </View>

        {dialog?.kind === "project" ? (
          <ProjectMenuDialog
            reference={dialog.reference}
            groups={groups}
            parents={parents}
            parentChoices={parentChoices(dialog.reference)}
            theme={view.theme}
            onChooseGroup={(groupId) => chooseGroup(dialog.reference, groupId)}
            onChooseParent={(parentKey) => chooseParent(dialog.reference, parentKey)}
            onUnnest={() => unnest(dialog.reference)}
            onNewWorkspace={() => {
              setDialog(null);
              view.navigation.openProject(dialog.reference);
            }}
            onOpenSettings={WEB ? () => openProjectSettings(dialog.reference) : undefined}
            onDecorate={(name) =>
              setDialog({ kind: "decorate", target: { kind: "projects", key: dialog.reference.key, name } })
            }
            onRemove={() => setDialog({ kind: "remove-project", reference: dialog.reference })}
            onClose={closeDialog}
          />
        ) : null}
        {dialog?.kind === "remove-project" ? (
          <RemoveProjectDialog
            reference={dialog.reference}
            theme={view.theme}
            busy={removing}
            onConfirm={(workspaceKeys) => void confirmRemoveProject(dialog.reference, workspaceKeys)}
            onClose={closeDialog}
          />
        ) : null}
        {dialog?.kind === "workspace" ? (
          <WorkspaceMenuDialog
            reference={dialog.reference}
            theme={view.theme}
            onDecorate={(name) =>
              setDialog({ kind: "decorate", target: { kind: "workspaces", key: dialog.reference.key, name } })
            }
            onArchived={() => {
              const cleaned = withoutDecorations([["workspaces", [dialog.reference.key]]]);
              if (cleaned) void saveDecorations(cleaned);
            }}
            onClose={closeDialog}
          />
        ) : null}
        {dialog?.kind === "decorate" ? (
          <DecorateDialog
            target={dialog.target}
            initial={decorations.get(dialog.target.kind, dialog.target.key)}
            theme={view.theme}
            onSave={(decoration) => {
              const target = dialog.target;
              setDialog(null);
              const next = withDecoration(target.kind, target.key, decoration);
              if (next) void saveDecorations(next);
            }}
            onClose={closeDialog}
          />
        ) : null}
        {dialog?.kind === "delete-group" ? (
          <DeleteGroupDialog
            group={dialog.group}
            count={dialog.group.projects.filter((key) => byKey.has(key)).length}
            theme={view.theme}
            onConfirm={() => {
              const id = dialog.group.id;
              setDialog(null);
              void saveGroups(removeGroup(groups, id));
              const cleaned = withDecoration("groups", id, null);
              if (cleaned) void saveDecorations(cleaned);
            }}
            onClose={closeDialog}
          />
        ) : null}
      </DragProvider>
    </DecorationsContext.Provider>
  );
}
