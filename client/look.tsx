import { createContext, useContext } from "react";
import { appearanceDocument, type AppearanceValues, type RowTrailing, type WorkspaceSort, type WorkspaceTitle } from "../shared/settings";

/** Concrete sizes derived from the appearance settings. Every row reads these. */
export interface Look {
  text: number;
  line: number;
  small: number;
  smallLine: number;
  icon: number;
  row: number;
  header: number;
  groupGap: number;
  projectIndent: number;
  workspaceIndent: number;
  emptyIndent: number;
  boldGroupNames: boolean;
  showProjectIcons: boolean;
  showHostTags: boolean;
  showStatusDots: boolean;
  showFoldedStatus: boolean;
  trailing: RowTrailing;
  showBranch: boolean;
  showLabels: boolean;
  showPinned: boolean;
  showRelations: boolean;
  workspaceSort: WorkspaceSort;
  workspaceTitle: WorkspaceTitle;
  showBackground: boolean;
}

const ROW = { compact: 24, comfortable: 28, spacious: 34 } as const;
/** Space between groups. "small" matches the spacing before this setting existed. */
export const GROUP_GAP = { none: 0, small: 6, medium: 14, large: 24, xlarge: 36 } as const;
const INDENT = {
  narrow: { project: 10, workspace: 26 },
  normal: { project: 16, workspace: 36 },
  wide: { project: 22, workspace: 46 },
} as const;

export const DEFAULT_APPEARANCE: AppearanceValues = appearanceDocument.schema.parse({});

export function lookFrom(values: AppearanceValues): Look {
  const text = values.textSize;
  const small = Math.max(9, text - 1);
  // Rows grow with large text so two-line Korean glyphs never clip.
  const row = Math.max(ROW[values.density], Math.round(text * 1.34) + 8);
  const indent = INDENT[values.indent];
  return {
    text,
    line: Math.round(text * 1.34),
    small,
    smallLine: Math.round(small * 1.4),
    icon: text + 1,
    row,
    header: row + 2,
    groupGap: GROUP_GAP[values.groupSpacing],
    projectIndent: indent.project,
    workspaceIndent: indent.workspace,
    emptyIndent: indent.project + 12,
    boldGroupNames: values.boldGroupNames,
    showProjectIcons: values.showProjectIcons,
    showHostTags: values.showHostTags,
    showStatusDots: values.showStatusDots,
    showFoldedStatus: values.showFoldedStatus,
    trailing: values.rowTrailing ?? (values.showDiffStats ? "diff" : "none"),
    showBranch: values.showBranch,
    showLabels: values.showLabels,
    showPinned: values.showPinned,
    showRelations: values.showRelations,
    workspaceSort: values.workspaceSort,
    workspaceTitle: values.workspaceTitle,
    showBackground: values.showBackground,
  };
}

export const LookContext = createContext<Look>(lookFrom(DEFAULT_APPEARANCE));
export const useLook = () => useContext(LookContext);

/** Actions the sidebar needs from the client context, which the view props do not carry. */
export interface ViewActions {
  openAppearanceSettings(): void;
}
export const ViewActionsContext = createContext<ViewActions>({ openAppearanceSettings: () => {} });
export const useViewActions = () => useContext(ViewActionsContext);
