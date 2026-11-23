import {
  useAgent,
  useWorkspace,
  type AgentRef,
  type PluginSidebarViewProps,
  type WorkspaceRef,
} from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useCallback, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useT } from "./i18n";
import { useLook } from "./look";
import { relationshipRows, type AgentRelationships } from "./relationship-model";
import { familyColor, withAlpha } from "./relationship-rail";
import { StatusDot, WorkspaceRow, useRowStyles } from "./rows";
import { sidebarNavProps } from "./web";

export interface RelationshipActions {
  view: PluginSidebarViewProps;
  model: AgentRelationships;
  highlighted: ReadonlySet<string>;
  open(agent: AgentRef): void;
  hover(key: string | null): void;
  register(key: string, node: View | null): void;
  refresh(): void;
}

function isAgentSelected(sidebar: RelationshipActions, agent: AgentRef, singleWorkspace?: WorkspaceRef): boolean {
  const activeAgent = sidebar.view.active.agent;
  if (activeAgent && sidebar.model.agents.has(activeAgent.key)) {
    return activeAgent.key === agent.key;
  }
  return !!singleWorkspace && sidebar.view.active.workspace?.key === singleWorkspace.key;
}

/** Quiet, non-expanding badge on parent rows echoing the family rail color. */
function ChildBadge({
  count,
  familyHex,
  highlighted,
  theme,
}: {
  count: number;
  familyHex: string;
  highlighted: boolean;
  theme: PluginSidebarViewProps["theme"];
}) {
  const t = useT();
  const look = useLook();
  const styles = useRowStyles(theme);
  const iconColor = highlighted ? familyHex : withAlpha(familyHex, 0.85);
  return (
    <View
      pointerEvents="none"
      accessible
      accessibilityRole="text"
      accessibilityLabel={t("relation.children", { count })}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 3,
        flexShrink: 0,
        paddingHorizontal: 5,
        paddingVertical: 1,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: highlighted ? withAlpha(familyHex, 0.55) : withAlpha(familyHex, 0.3),
        backgroundColor: highlighted ? withAlpha(familyHex, 0.12) : undefined,
      }}
    >
      <Icon name="GitFork" size={Math.max(9, look.small - 1)} color={iconColor} />
      <Text selectable={false} numberOfLines={1} style={[styles.detail, highlighted ? { color: familyHex } : null]}>
        {t("relation.count", { count })}
      </Text>
    </View>
  );
}

function RelationAnchor({
  agent,
  sidebar,
  children,
}: {
  agent: AgentRef;
  sidebar: RelationshipActions;
  children: ReactNode;
}) {
  const register = sidebar.register;
  const ref = useCallback((node: View | null) => register(agent.key, node), [agent.key, register]);
  return (
    <View ref={ref} collapsable={false} onLayout={sidebar.refresh}>
      {children}
    </View>
  );
}

function TreeGuides({
  depth,
  last,
  guides,
  step,
  baseIndent,
  color,
}: {
  depth: number;
  last: boolean;
  guides: readonly boolean[];
  step: number;
  baseIndent: number;
  color: string;
}) {
  if (depth <= 0) return null;
  const visibleDepth = Math.min(4, depth);
  const elbowX = baseIndent + (visibleDepth - 1) * step + 3;
  return (
    <>
      {guides.slice(0, visibleDepth - 1).map((active, level) =>
        active ? (
          <View
            key={level}
            pointerEvents="none"
            style={{
              position: "absolute",
              left: baseIndent + level * step + 3,
              top: 0,
              bottom: 0,
              width: 1,
              backgroundColor: color,
            }}
          />
        ) : null,
      )}
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: elbowX,
          top: 0,
          height: last ? "50%" : "100%",
          width: 1,
          backgroundColor: color,
        }}
      />
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: elbowX,
          top: "50%",
          width: Math.max(6, step - 5),
          height: 1,
          backgroundColor: color,
        }}
      />
    </>
  );
}

function AgentRowContent({
  agent,
  workspaceRef,
  title: agentTitle,
  status,
  requiresAttention,
  indent,
  sidebar,
  last,
  branchDepth,
  guides,
  treeStep,
  treeBase,
}: {
  agent: AgentRef;
  workspaceRef: WorkspaceRef;
  title: string | null;
  status: "initializing" | "idle" | "running" | "error" | "closed";
  requiresAttention: boolean;
  indent: number;
  sidebar: RelationshipActions;
  last: boolean;
  branchDepth: number;
  guides: readonly boolean[];
  treeStep: number;
  treeBase: number;
}) {
  const look = useLook();
  const workspace = useWorkspace(workspaceRef, (item) => ({
    title: (look.workspaceTitle === "branch" ? item.branch : null) ?? item.title ?? item.name,
    project: item.projectDisplayName,
    additions: item.diffStat?.additions ?? 0,
    deletions: item.diffStat?.deletions ?? 0,
  }));
  const [hovered, setHovered] = useState(false);
  const { view, model } = sidebar;
  const theme = view.theme;
  const t = useT();
  const styles = useRowStyles(theme);

  const singleRoot = (model.byWorkspace.get(workspaceRef.key)?.length ?? 0) === 1;
  const title = agentTitle ?? workspace?.title ?? agent.id;
  const active = isAgentSelected(sidebar, agent, singleRoot ? workspaceRef : undefined);
  const running = status === "running";
  const indicator = running
    ? theme.colors.accent
    : status === "error"
      ? theme.colors.statusDanger
      : requiresAttention
        ? theme.colors.statusWarning
        : "transparent";
  const showDiff = look.trailing === "diff" && ((workspace?.additions ?? 0) > 0 || (workspace?.deletions ?? 0) > 0);
  const lineColor = sidebar.highlighted.has(agent.key) ? theme.colors.accent : theme.colors.border;

  return (
    <RelationAnchor agent={agent} sidebar={sidebar}>
      <View
        style={[
          styles.rounded,
          active
            ? styles.selected
            : sidebar.highlighted.has(agent.key)
              ? { backgroundColor: theme.colors.surface1 }
              : null,
          {
            flexDirection: "row",
            alignItems: "center",
            paddingLeft: indent,
            paddingRight: 8,
            gap: 5,
          },
        ]}
      >
        <TreeGuides
          depth={branchDepth}
          last={last}
          guides={guides}
          step={treeStep}
          baseIndent={treeBase}
          color={lineColor}
        />
        <Pressable
          {...sidebarNavProps({ pgNav: "", pgAgent: agent.key })}
          accessibilityRole="button"
          accessibilityState={{ selected: active }}
          accessibilityLabel={t("workspace.open", { name: title })}
          onPress={() => sidebar.open(agent)}
          onHoverIn={() => {
            setHovered(true);
            sidebar.hover(agent.key);
          }}
          onHoverOut={() => {
            setHovered(false);
            sidebar.hover(null);
          }}
          style={{
            flex: 1,
            flexDirection: "row",
            minWidth: 0,
            alignItems: "center",
            minHeight: look.row,
            paddingVertical: workspace?.project ? 3 : 0,
            gap: 5,
          }}
        >
          {look.showStatusDots ? <StatusDot color={indicator} running={running} /> : null}
          <View style={{ flex: 1, minWidth: 0, gap: workspace?.project ? 1 : 0 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 }}>
              <Text
                selectable={false}
                numberOfLines={1}
                style={[
                  styles.workspaceName,
                  active ? { opacity: 1, fontWeight: "600" } : hovered ? { opacity: 1 } : null,
                ]}
              >
                {title}
              </Text>
              {showDiff && workspace ? (
                <Text selectable={false} numberOfLines={1} style={[styles.detail, { flexShrink: 0 }]}>
                  <Text style={{ color: theme.colors.statusSuccess }}>+{workspace.additions}</Text>{" "}
                  <Text style={{ color: theme.colors.statusDanger }}>−{workspace.deletions}</Text>
                </Text>
              ) : null}
            </View>
            {workspace?.project ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4, minWidth: 0 }}>
                <Icon name="Folder" size={Math.max(9, look.small - 1)} color={theme.colors.foregroundMuted} />
                <Text selectable={false} numberOfLines={2} style={[styles.detail, { flex: 1, minWidth: 0 }]}>
                  {workspace.project}
                </Text>
              </View>
            ) : null}
          </View>
        </Pressable>
      </View>
    </RelationAnchor>
  );
}

function AgentRow({
  agent,
  indent,
  sidebar,
  last,
  branchDepth,
  guides,
  treeStep,
  treeBase,
}: {
  agent: AgentRef;
  indent: number;
  sidebar: RelationshipActions;
  last: boolean;
  branchDepth: number;
  guides: readonly boolean[];
  treeStep: number;
  treeBase: number;
}) {
  const info = useAgent(agent, (item) => ({
    title: item.title,
    workspace: item.workspace,
    status: item.status,
    requiresAttention: item.requiresAttention,
  }));
  if (!info) return null;
  return (
    <AgentRowContent
      agent={agent}
      workspaceRef={info.workspace}
      title={info.title}
      status={info.status}
      requiresAttention={info.requiresAttention}
      indent={indent}
      sidebar={sidebar}
      last={last}
      branchDepth={branchDepth}
      guides={guides}
      treeStep={treeStep}
      treeBase={treeBase}
    />
  );
}

export function RelationshipWorkspace({
  reference,
  indent,
  sidebar,
  onMenu,
}: {
  reference: WorkspaceRef;
  indent: number;
  sidebar: RelationshipActions;
  onMenu: (ref: WorkspaceRef) => void;
}) {
  const { model, view } = sidebar;
  const agents = model.byWorkspace.get(reference.key) ?? [];
  const related = agents.filter((agent) => model.parents.has(agent.key) || model.children.has(agent.key));
  if (!related.length) {
    return <WorkspaceRow reference={reference} indent={indent} view={view} onMenu={onMenu} />;
  }
  const singleRoot = agents.length === 1;
  const agent = related.find((item) => view.active.agent?.key === item.key) ?? related[0];
  const count = model.children.get(agent.key)?.length ?? 0;
  const highlighted = sidebar.highlighted.has(agent.key);

  return (
    <RelationAnchor agent={agent} sidebar={sidebar}>
      <WorkspaceRow
        reference={reference}
        indent={indent}
        view={view}
        onMenu={onMenu}
        relation={{
          key: agent.key,
          highlighted,
          open: singleRoot ? () => sidebar.open(agent) : () => view.navigation.openWorkspace(reference),
          onHover: (hover) => sidebar.hover(hover ? agent.key : null),
          trailing:
            count > 0 ? (
              <ChildBadge
                count={count}
                familyHex={familyColor(agent.key)}
                highlighted={highlighted}
                theme={view.theme}
              />
            ) : null,
        }}
      />
    </RelationAnchor>
  );
}

export function RelationshipsList({ sidebar }: { sidebar: RelationshipActions }) {
  const { theme, layout } = sidebar.view;
  const styles = useRowStyles(theme);
  const t = useT();
  const nodes = relationshipRows(sidebar.model);
  if (!nodes.length) return <Text style={[styles.detail, { padding: 12 }]}>{t("relation.empty")}</Text>;
  const base = layout.compact ? 10 : 12;
  const step = layout.compact ? 12 : 14;
  return (
    <View style={{ paddingTop: 4, gap: 2 }}>
      {nodes.map(({ agent, depth, last, guides }) => (
        <AgentRow
          key={agent.key}
          agent={agent}
          sidebar={sidebar}
          indent={base + Math.min(4, depth) * step}
          last={last}
          branchDepth={depth}
          guides={guides}
          treeStep={step}
          treeBase={base}
        />
      ))}
    </View>
  );
}
