import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/** One user-defined group. `projects` holds project ref keys in display order. */
export const groupSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  projects: z.array(z.string()).default([]),
});

export type ProjectGroup = z.infer<typeof groupSchema>;

/**
 * Groups, their project membership and sub-projects. Host scope so every client of this daemon
 * sees the same grouping.
 */
export const groupsDocument = defineSettings({
  id: "groups",
  scope: "host",
  version: 1,
  schema: z.object({
    groups: z.array(groupSchema).default([]),
    /** Sub-project ref key -> parent project ref key. A sub-project is in no group. One level deep. */
    parents: z.record(z.string(), z.string()).default({}),
  }),
});

export type GroupsValues = z.infer<typeof groupsDocument.schema>;

/** Folded groups and projects. Device scope because folding is a per-screen preference. */
export const layoutDocument = defineSettings({
  id: "layout",
  scope: "device",
  version: 1,
  schema: z.object({
    collapsed: z.array(z.string()).default([]),
  }),
});

export const TEXT_SIZES = [11, 12, 13, 14, 15] as const;
export const DENSITIES = ["compact", "comfortable", "spacious"] as const;
export const INDENTS = ["narrow", "normal", "wide"] as const;
export const GROUP_SPACINGS = ["none", "small", "medium", "large", "xlarge"] as const;
export const LANGUAGES = ["auto", "en", "ko", "zh-CN"] as const;
export const WORKSPACE_SORTS = ["name", "created", "lastPrompt"] as const;
export const WORKSPACE_TITLES = ["title", "branch"] as const;
export const ROW_TRAILINGS = ["diff", "timestamp", "none"] as const;

/** Sidebar look. Device scope because text size and spacing depend on the screen. */
export const appearanceDocument = defineSettings({
  id: "appearance",
  scope: "device",
  version: 1,
  schema: z.object({
    textSize: z.number().int().min(10).max(18).default(12),
    density: z.enum(DENSITIES).default("comfortable"),
    indent: z.enum(INDENTS).default("normal"),
    /** Extra space between groups, separate from row height. */
    groupSpacing: z.enum(GROUP_SPACINGS).default("small"),
    boldGroupNames: z.boolean().default(true),
    showProjectIcons: z.boolean().default(true),
    /** With several hosts connected, a host name tag after each project in a group. */
    showHostTags: z.boolean().default(true),
    showStatusDots: z.boolean().default(true),
    /** A folded project or group shows its most urgent workspace status on its icon. */
    showFoldedStatus: z.boolean().default(true),
    /** Replaced by `rowTrailing`; read only when that is unset. */
    showDiffStats: z.boolean().default(true),
    /** What sits right of a workspace name: changed lines, last activity, or nothing. */
    rowTrailing: z.enum(ROW_TRAILINGS).optional(),
    /** A line under the workspace name with its branch, like the app's "Show branch". */
    showBranch: z.boolean().default(false),
    showLabels: z.boolean().default(true),
    showPinned: z.boolean().default(true),
    /**
     * In the project view, lines between parent and child agents in other workspaces, the child
     * count and the family highlight. The "By relation" view does not depend on it.
     */
    showRelations: z.boolean().default(true),
    /** Order of workspaces inside a project. Times sort newest first, like the app. */
    workspaceSort: z.enum(WORKSPACE_SORTS).default("name"),
    /** `branch` shows the branch name where the workspace has one. */
    workspaceTitle: z.enum(WORKSPACE_TITLES).default("title"),
    /** Helper workspaces agents create in the background. */
    showBackground: z.boolean().default(false),
    /** Plugin text language. `auto` follows the app language. */
    language: z.enum(LANGUAGES).default("auto"),
  }),
});

export type AppearanceValues = z.infer<typeof appearanceDocument.schema>;
export type WorkspaceSort = (typeof WORKSPACE_SORTS)[number];
export type WorkspaceTitle = (typeof WORKSPACE_TITLES)[number];
export type RowTrailing = (typeof ROW_TRAILINGS)[number];

/** A color and/or icon the user chose for one sidebar item. Null means "use the default". */
export const decorationSchema = z.object({
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .default(null),
  /** `lucide:<IconName>` or `emoji:<text>`. Projects and groups only. */
  icon: z.string().max(64).nullable().default(null),
});

export type Decoration = z.infer<typeof decorationSchema>;

/**
 * Colors and icons keyed by group id, project ref key and workspace ref key. Host scope so every
 * client of this daemon sees the same look. Paseo's own project icons are not changed.
 */
export const decorationsDocument = defineSettings({
  id: "decorations",
  scope: "host",
  version: 1,
  schema: z.object({
    groups: z.record(z.string(), decorationSchema).default({}),
    projects: z.record(z.string(), decorationSchema).default({}),
    workspaces: z.record(z.string(), decorationSchema).default({}),
  }),
});

export type DecorationsValues = z.infer<typeof decorationsDocument.schema>;
export type DecorationKind = keyof DecorationsValues;
