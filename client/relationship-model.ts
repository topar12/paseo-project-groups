import type { AgentRef, WorkspaceRef } from "@getpaseo/plugin/client";

interface AgentGroup {
  readonly key: string;
  readonly items: readonly AgentRef[];
}

/** Compare two host-scoped workspace refs or keys so same-ID workspaces on different hosts stay distinct. */
export function sameWorkspaceRef(
  left: Pick<WorkspaceRef, "hostId" | "id" | "key"> | string | undefined,
  right: Pick<WorkspaceRef, "hostId" | "id" | "key"> | string | undefined,
): boolean {
  if (!left || !right) return false;
  if (typeof left === "string" || typeof right === "string") return left === right;
  if (left.key && right.key) return left.key === right.key;
  return left.hostId === right.hostId && left.id === right.id;
}

/**
 * Build sidebar agent relationships from host-scoped workspace (`w:<workspaceRef.key>`) and
 * parent (`a:<agentRef.key>`) groups.
 *
 * Follows Paseo's workspace-root policy: a child whose visible parent lives in the same
 * host-scoped workspace is an in-workspace tab and is excluded from sidebar lists, counts,
 * rails, and navigation. Cross-workspace children (including same workspace ID on another host)
 * remain visible roots linked to their parent. If a parent is not in the visible set, no link
 * is fabricated.
 */
export function agentRelationships(groups: readonly AgentGroup[]) {
  const rawAgents = new Map<string, AgentRef>();
  const rawWorkspaces = new Map<string, string>();
  const rawByWorkspace = new Map<string, readonly AgentRef[]>();
  for (const group of groups) {
    if (!group.key.startsWith("w:")) continue;
    const key = group.key.slice(2);
    rawByWorkspace.set(key, group.items);
    for (const agent of group.items) {
      rawAgents.set(agent.key, agent);
      rawWorkspaces.set(agent.key, key);
    }
  }

  const rawParents = new Map<string, AgentRef>();
  for (const group of groups) {
    if (!group.key.startsWith("a:")) continue;
    const parent = rawAgents.get(group.key.slice(2));
    if (!parent) continue;
    for (const child of group.items) {
      if (child.key === parent.key || !rawAgents.has(child.key)) continue;
      rawParents.set(child.key, parent);
    }
  }

  const excluded = new Set<string>();
  for (const [childKey, parent] of rawParents) {
    if (sameWorkspaceRef(rawWorkspaces.get(childKey), rawWorkspaces.get(parent.key))) {
      excluded.add(childKey);
    }
  }

  const agents = new Map<string, AgentRef>();
  const workspaces = new Map<string, string>();
  const byWorkspace = new Map<string, readonly AgentRef[]>();
  for (const [workspaceKey, items] of rawByWorkspace) {
    const roots = items.filter((agent) => !excluded.has(agent.key));
    if (roots.length) byWorkspace.set(workspaceKey, roots);
    for (const agent of roots) {
      agents.set(agent.key, agent);
      workspaces.set(agent.key, workspaceKey);
    }
  }

  const parents = new Map<string, AgentRef>();
  const children = new Map<string, AgentRef[]>();
  for (const [childKey, parent] of rawParents) {
    if (excluded.has(childKey) || excluded.has(parent.key)) continue;
    const child = agents.get(childKey);
    if (!child || !agents.has(parent.key)) continue;
    parents.set(childKey, parent);
    const siblings = children.get(parent.key);
    if (siblings) siblings.push(child);
    else children.set(parent.key, [child]);
  }

  return { agents, workspaces, byWorkspace, parents, children };
}

export type AgentRelationships = ReturnType<typeof agentRelationships>;

export interface RelationshipFamily {
  readonly parent: AgentRef;
  readonly children: readonly AgentRef[];
}

/** All visible cross-workspace parent-child families in deterministic order. */
export function relationshipFamilies(relationships: AgentRelationships): RelationshipFamily[] {
  const families: RelationshipFamily[] = [];
  for (const [parentKey, children] of relationships.children) {
    if (!children.length) continue;
    const parent = relationships.agents.get(parentKey);
    if (parent) families.push({ parent, children });
  }
  return families;
}

/** Show the selected agent's parent and siblings, or its own children if it is a root. */
export function activeFamily(relationships: AgentRelationships, key: string | null): RelationshipFamily | null {
  if (!key || !relationships.agents.has(key)) return null;
  const parent = relationships.parents.get(key) ?? relationships.agents.get(key);
  const children = parent && relationships.children.get(parent.key);
  return parent && children?.length ? { parent, children } : null;
}

export interface RelationshipRow {
  readonly agent: AgentRef;
  readonly depth: number;
  readonly last: boolean;
  /** For each ancestor depth < `depth`, true when that ancestor has later siblings needing a vertical guide. */
  readonly guides: readonly boolean[];
}

/** Flatten the tree for rendering, putting connected families first and surviving stale links. */
export function relationshipRows(relationships: AgentRelationships): RelationshipRow[] {
  const rows: RelationshipRow[] = [];
  const seen = new Set<string>();
  const visit = (agent: AgentRef, depth: number, last: boolean, guides: readonly boolean[]) => {
    if (seen.has(agent.key)) return;
    seen.add(agent.key);
    rows.push({ agent, depth, last, guides });
    const children = relationships.children.get(agent.key) ?? [];
    const nextGuides = depth === 0 ? guides : [...guides, !last];
    children.forEach((child, index) => visit(child, depth + 1, index === children.length - 1, nextGuides));
  };
  const roots: AgentRef[] = [];
  for (const agent of relationships.agents.values()) {
    if (!relationships.parents.has(agent.key)) roots.push(agent);
  }
  for (const agent of roots) {
    if ((relationships.children.get(agent.key)?.length ?? 0) > 0) visit(agent, 0, true, []);
  }
  for (const agent of roots) visit(agent, 0, true, []);
  // Stale or inconsistent parent links must not hide an agent or recurse forever.
  for (const agent of relationships.agents.values()) visit(agent, 0, true, []);
  return rows;
}
