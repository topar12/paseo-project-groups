import type { WorkspaceIndicator } from "@getpaseo/plugin";
import type { ProjectGroup } from "../shared/settings";

/** Paseo's order for a folded project's status: the first one present wins. */
const URGENCY: readonly WorkspaceIndicator[] = ["needs_input", "failed", "running", "attention", "done"];

/** The most urgent of the given workspace statuses. Unknown values are ignored. */
export function mostUrgent(statuses: Iterable<string>): WorkspaceIndicator {
  let best = URGENCY.length - 1;
  for (const status of statuses) {
    const rank = URGENCY.indexOf(status as WorkspaceIndicator);
    if (rank !== -1 && rank < best) best = rank;
  }
  return URGENCY[best];
}

/** Newest first by the chosen time, like the app; "last prompt" falls back to creation. */
export function compareWorkspaceTimes(
  sort: "created" | "lastPrompt",
): (
  a: { createdAt: string | null; lastPromptAt: string | null; ref: { key: string } },
  b: { createdAt: string | null; lastPromptAt: string | null; ref: { key: string } },
) => number {
  const time = (item: { createdAt: string | null; lastPromptAt: string | null }) => {
    const value = sort === "lastPrompt" ? (item.lastPromptAt ?? item.createdAt) : item.createdAt;
    return value ? Date.parse(value) || 0 : 0;
  };
  return (a, b) => time(b) - time(a) || a.ref.key.localeCompare(b.ref.key);
}

/** The app's compact age: "now", "5m", "2h", "3d", then a short date. */
export function compactTimeAgo(iso: string, now: number = Date.now()): string {
  const time = Date.parse(iso);
  if (!time) return "";
  const minutes = Math.floor((now - time) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(time).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * The fold list after Collapse all / Expand all: the shown keys all open once every one is folded,
 * else all folded. Either way, keys not shown right now (a project on a host that is offline, for
 * example) keep their fold, so they come back the way they were.
 */
export function foldAllKeys(collapsed: readonly string[], keys: readonly string[]): string[] {
  const folded = new Set(collapsed);
  if (keys.every((key) => folded.has(key))) {
    const shown = new Set(keys);
    return collapsed.filter((key) => !shown.has(key));
  }
  return [...new Set([...collapsed, ...keys])];
}

/** The app's route for a project's settings page. */
export function projectSettingsPath(project: { hostId: string; id: string }): string {
  return `/settings/hosts/${encodeURIComponent(project.hostId)}/projects/${encodeURIComponent(project.id)}`;
}

/** What the user is dragging. */
export type DragSubject =
  { kind: "project"; key: string; label: string } | { kind: "group"; id: string; label: string };

/** Where a drop lands. Project targets and group targets never mix. */
export type DropTarget =
  | { kind: "project-before"; groupId: string; projectKey: string }
  | { kind: "project-after"; groupId: string; projectKey: string }
  | { kind: "into-group"; groupId: string }
  | { kind: "ungroup" }
  | { kind: "group-at"; index: number };

export function groupOfProject(groups: readonly ProjectGroup[], key: string): string | null {
  for (const group of groups) if (group.projects.includes(key)) return group.id;
  return null;
}

function sameGroups(a: readonly ProjectGroup[], b: readonly ProjectGroup[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((group, index) => {
    const other = b[index];
    return (
      other !== undefined &&
      group.id === other.id &&
      group.name === other.name &&
      group.projects.length === other.projects.length &&
      group.projects.every((key, position) => other.projects[position] === key)
    );
  });
}

/** Returns the new group list, or null when the drop changes nothing. */
export function moveProject(
  groups: readonly ProjectGroup[],
  key: string,
  target: DropTarget,
): ProjectGroup[] | null {
  if (target.kind === "group-at") return null;
  const without = groups.map((group) =>
    group.projects.includes(key)
      ? { ...group, projects: group.projects.filter((item) => item !== key) }
      : group,
  );
  let next: ProjectGroup[];
  if (target.kind === "ungroup") {
    next = without;
  } else {
    const destination = without.find((group) => group.id === target.groupId);
    if (!destination) return null;
    const projects = [...destination.projects];
    if (target.kind === "into-group") {
      projects.push(key);
    } else {
      if (target.projectKey === key) return null;
      const anchor = projects.indexOf(target.projectKey);
      const index = anchor < 0 ? projects.length : target.kind === "project-before" ? anchor : anchor + 1;
      projects.splice(index, 0, key);
    }
    next = without.map((group) => (group.id === destination.id ? { ...group, projects } : group));
  }
  return sameGroups(groups, next) ? null : next;
}

/** Moves a group so it sits before `index` in the current order. Null when nothing moves. */
export function moveGroup(groups: readonly ProjectGroup[], id: string, index: number): ProjectGroup[] | null {
  const from = groups.findIndex((group) => group.id === id);
  if (from < 0 || index === from || index === from + 1) return null;
  const next = [...groups];
  const [moved] = next.splice(from, 1);
  if (!moved) return null;
  next.splice(index > from ? index - 1 : index, 0, moved);
  return next;
}

export function addGroup(
  groups: readonly ProjectGroup[],
  name: string,
): {
  groups: ProjectGroup[];
  id: string;
} {
  const id = `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  // New groups go first, next to the New group button at the top of the sidebar.
  return { groups: [{ id, name, projects: [] }, ...groups], id };
}

export function renameGroup(
  groups: readonly ProjectGroup[],
  id: string,
  name: string,
): ProjectGroup[] | null {
  const trimmed = name.trim();
  const current = groups.find((group) => group.id === id);
  if (!current || !trimmed || current.name === trimmed) return null;
  return groups.map((group) => (group.id === id ? { ...group, name: trimmed } : group));
}

/** Deleting a group keeps its projects; they fall back to the ungrouped section. */
export function removeGroup(groups: readonly ProjectGroup[], id: string): ProjectGroup[] {
  return groups.filter((group) => group.id !== id);
}

/** First unused default name, such as "Group 3". `format` supplies the localized pattern. */
export function nextGroupName(groups: readonly ProjectGroup[], format: (number: number) => string): string {
  const names = new Set(groups.map((group) => group.name));
  for (let number = groups.length + 1; ; number += 1) {
    const name = format(number);
    if (!names.has(name)) return name;
  }
}

/** Sub-project ref key -> parent project ref key, as stored in the groups document. */
export type Parents = Readonly<Record<string, string>>;

export interface Placement {
  groups: ProjectGroup[];
  parents: Record<string, string>;
}

/**
 * Parent key -> its sub-project keys, in `order`. Only one level counts: a link whose parent is
 * gone, or is itself a sub-project, is ignored and that project shows at the top level again.
 */
export function subProjects(order: readonly string[], parents: Parents): Map<string, string[]> {
  const present = new Set(order);
  const nestedLink = (key: string) => {
    const parent = parents[key];
    return parent !== undefined && parent !== key && present.has(parent);
  };
  const tree = new Map<string, string[]>();
  for (const key of order) {
    const parent = parents[key];
    if (!nestedLink(key) || nestedLink(parent!)) continue;
    const children = tree.get(parent!);
    if (children) children.push(key);
    else tree.set(parent!, [key]);
  }
  return tree;
}

/** Can `key` go under `parent`? Keeps nesting one level deep. */
export function canNest(parents: Parents, key: string, parent: string): boolean {
  if (key === parent || parent in parents) return false;
  return !Object.values(parents).includes(key);
}

/** Puts `key` under `parent` and out of its group. Null when it is already there or not allowed. */
export function nestProject(
  groups: readonly ProjectGroup[],
  parents: Parents,
  key: string,
  parent: string,
): Placement | null {
  if (parents[key] === parent || !canNest(parents, key, parent)) return null;
  return {
    groups: groups.map((group) =>
      group.projects.includes(key) ? { ...group, projects: group.projects.filter((item) => item !== key) } : group,
    ),
    parents: { ...parents, [key]: parent },
  };
}

/** Moves a project to a group or Ungrouped, taking it out from under its parent. Null when nothing changes. */
export function placeProject(
  groups: readonly ProjectGroup[],
  parents: Parents,
  key: string,
  target: DropTarget,
): Placement | null {
  const nextGroups = moveProject(groups, key, target);
  const nested = key in parents;
  if (!nextGroups && !nested) return null;
  const nextParents = { ...parents };
  delete nextParents[key];
  return { groups: nextGroups ?? [...groups], parents: nextParents };
}

/** Where every shown project goes. Keys are project ref keys. */
export interface SidebarLayout {
  /** Top-level projects of each group, by group id, in order. */
  groups: Map<string, string[]>;
  /** Top-level projects in no group, in `order`. */
  ungrouped: string[];
  /** Parent key -> sub-project keys, see `subProjects`. */
  children: Map<string, string[]>;
  /** Parents that are linked to but not shown: still loading, on a disconnected host, or gone. */
  missingParents: string[];
}

/**
 * Builds the sidebar from the saved placement and the projects shown (`order`). A sub-project
 * whose parent is missing shows at the top level right where the parent's group entry is (or in
 * Ungrouped), and keeps its link, so it returns under the parent when the parent loads.
 */
export function sidebarLayout(
  groups: readonly ProjectGroup[],
  parents: Parents,
  order: readonly string[],
): SidebarLayout {
  const shown = new Set(order);
  const children = subProjects(order, parents);
  const nested = new Set([...children.values()].flat());
  const waiting = new Map<string, string[]>();
  for (const key of order) {
    const parent = parents[key];
    if (parent === undefined || nested.has(key)) continue;
    const list = waiting.get(parent);
    if (list) list.push(key);
    else waiting.set(parent, [key]);
  }
  const placed = new Set<string>();
  const place = (list: string[], key: string) => {
    if (placed.has(key)) return;
    placed.add(key);
    list.push(key);
  };
  const layoutGroups = new Map<string, string[]>();
  for (const group of groups) {
    const list: string[] = [];
    for (const key of group.projects) {
      if (shown.has(key) && !nested.has(key)) place(list, key);
      for (const orphan of waiting.get(key) ?? []) place(list, orphan);
    }
    layoutGroups.set(group.id, list);
  }
  const ungrouped: string[] = [];
  for (const key of order) if (!nested.has(key)) place(ungrouped, key);
  return {
    groups: layoutGroups,
    ungrouped,
    children,
    missingParents: [...waiting.keys()].filter((key) => !shown.has(key)),
  };
}

/** The section a project shows in: a group id, null for Ungrouped, undefined when not shown. */
export function sectionOf(layout: SidebarLayout, key: string): string | null | undefined {
  for (const [parent, children] of layout.children) {
    if (children.includes(key)) return sectionOf(layout, parent);
  }
  for (const [id, keys] of layout.groups) if (keys.includes(key)) return id;
  return layout.ungrouped.includes(key) ? null : undefined;
}

/**
 * Removes projects that no longer exist. Each one's sub-projects take its place in its group, in
 * `order` (Ungrouped when it was in no group), and every link to or from it is deleted. Only call
 * this for a confirmed removal: a project that is merely not loaded yet must keep its links.
 */
export function dropProjects(
  groups: readonly ProjectGroup[],
  parents: Parents,
  removed: readonly string[],
  order: readonly string[],
): Placement | null {
  const gone = new Set(removed);
  const rank = (key: string) => {
    const index = order.indexOf(key);
    return index < 0 ? order.length : index;
  };
  const childrenOf = (key: string) =>
    Object.keys(parents)
      .filter((child) => parents[child] === key && !gone.has(child))
      .sort((a, b) => rank(a) - rank(b));
  const nextGroups = groups.map((group) => ({
    ...group,
    projects: group.projects.flatMap((key) => (gone.has(key) ? childrenOf(key) : [key])),
  }));
  const nextParents = Object.fromEntries(
    Object.entries(parents).filter(([child, parent]) => !gone.has(child) && !gone.has(parent)),
  );
  const changed =
    Object.keys(nextParents).length !== Object.keys(parents).length ||
    nextGroups.some((group, index) => group.projects.length !== groups[index]!.projects.length ||
      group.projects.some((key, position) => key !== groups[index]!.projects[position]));
  return changed ? { groups: nextGroups, parents: nextParents } : null;
}

/** Splits a project ref key (`["<hostId>","<projectId>"]`). Null when it has another shape. */
export function parseProjectKey(key: string): { hostId: string; projectId: string } | null {
  try {
    const value: unknown = JSON.parse(key);
    if (Array.isArray(value) && value.length === 2 && value.every((part) => typeof part === "string")) {
      return { hostId: value[0] as string, projectId: value[1] as string };
    }
  } catch {
    // Not a ref key.
  }
  return null;
}
