import { useSettings, type PluginSidebarViewProps } from "@getpaseo/plugin/client";
import { Icon, Modal } from "@getpaseo/plugin/client/ui";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Modal as NativeModal, Pressable, Text, View, useWindowDimensions } from "react-native";
import {
  appearanceDocument,
  WORKSPACE_SORTS,
  WORKSPACE_TITLES,
  type AppearanceValues,
  type RowTrailing,
} from "../shared/settings";
import { useT } from "./i18n";
import { useLook, useViewActions } from "./look";
import { useSettingsSaver } from "./save";

type Theme = PluginSidebarViewProps["theme"];
type Page = "root" | "sort" | "title" | "show";
type Anchor = { x: number; y: number; width: number; height: number };

/** The app's display menu width. */
const MENU_WIDTH = 232;
const SCREEN_EDGE = 8;

/**
 * The app's display preferences menu: a dropdown under the button on wide layouts, a sheet on
 * compact ones. Settings… opens the full appearance screen.
 */
export function DisplayMenuButton({ view }: { view: PluginSidebarViewProps }) {
  const t = useT();
  const look = useLook();
  const triggerRef = useRef<View>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [open, setOpen] = useState(false);
  const compact = view.layout.compact;
  const close = useCallback(() => setOpen(false), []);
  const show = () => {
    if (compact) {
      setOpen(true);
      return;
    }
    triggerRef.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ x, y, width, height });
      setOpen(true);
    });
  };

  return (
    <>
      <Pressable
        ref={triggerRef}
        accessibilityRole="button"
        accessibilityLabel={t("display.trigger")}
        hitSlop={4}
        onPress={show}
        style={{ padding: 6, marginRight: 6, borderRadius: 6 }}
      >
        <Icon name="Settings2" size={look.icon} color={view.theme.colors.foregroundMuted} />
      </Pressable>
      {open && compact ? (
        <Modal title={t("display.heading")} open onOpenChange={(next) => (next ? undefined : close())}>
          <Modal.Content contentContainerStyle={{ padding: 8, gap: 0 }}>
            <DisplayMenu theme={view.theme} compact onClose={close} />
          </Modal.Content>
        </Modal>
      ) : null}
      {open && !compact && anchor ? (
        <Dropdown anchor={anchor} theme={view.theme} onClose={close}>
          <DisplayMenu theme={view.theme} compact={false} onClose={close} />
        </Dropdown>
      ) : null}
    </>
  );
}

function Dropdown({
  anchor,
  theme,
  onClose,
  children,
}: {
  anchor: Anchor;
  theme: Theme;
  onClose: () => void;
  children: ReactNode;
}) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  // Right edges line up, like the app's menu under its button at the sidebar's right edge.
  const left = Math.max(
    SCREEN_EDGE,
    Math.min(anchor.x + anchor.width - MENU_WIDTH, screenWidth - MENU_WIDTH - SCREEN_EDGE),
  );
  const top = anchor.y + anchor.height + 4;
  return (
    <NativeModal transparent visible animationType="none" onRequestClose={onClose}>
      <Pressable
        accessible={false}
        onPress={onClose}
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
      />
      <View
        style={{
          position: "absolute",
          top,
          left,
          width: MENU_WIDTH,
          maxHeight: screenHeight - top - SCREEN_EDGE,
          padding: 4,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface1,
          shadowColor: "#000",
          shadowOpacity: 0.25,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 8,
        }}
      >
        {children}
      </View>
    </NativeModal>
  );
}

function DisplayMenu({ theme, compact, onClose }: { theme: Theme; compact: boolean; onClose: () => void }) {
  const t = useT();
  const actions = useViewActions();
  const settings = useSettings(appearanceDocument);
  const saver = useSettingsSaver(settings);
  const [page, setPage] = useState<Page>("root");
  // Shows each change at once and lets a second quick change build on the first one.
  const [pending, setPending] = useState<AppearanceValues | null>(null);
  const revision = settings.status === "ready" ? settings.revision : null;
  useEffect(() => {
    if (!saver.busy()) setPending(null);
  }, [revision, saver]);

  const row = { theme, compact };
  const openSettings = (
    <Item
      {...row}
      label={t("display.settings")}
      onPress={() => {
        onClose();
        actions.openAppearanceSettings();
      }}
    />
  );
  if (settings.status !== "ready") return openSettings;

  const values = pending ?? settings.values;
  const update = (patch: Partial<AppearanceValues>) => {
    const next = { ...values, ...patch };
    setPending(next);
    void saver.save(next).then((saved) => {
      if (!saved) setPending(null);
    });
  };
  const trailing: RowTrailing = values.rowTrailing ?? (values.showDiffStats ? "diff" : "none");
  /** Picking the choice already showing empties the slot, like the app. */
  const toggleTrailing = (choice: RowTrailing) =>
    update({ rowTrailing: trailing === choice ? "none" : choice });
  // A page is titled with its name and goes back to the root, like the app's.
  const back = (
    <Item
      {...row}
      label={page === "root" ? "" : t(`display.${page}`)}
      icon="ChevronLeft"
      onPress={() => setPage("root")}
    />
  );

  if (page === "sort") {
    return (
      <>
        {back}
        {WORKSPACE_SORTS.map((sort) => (
          <Item
            key={sort}
            {...row}
            label={t(`settings.workspaceSorts.${sort}`)}
            checked={values.workspaceSort === sort}
            onPress={() => {
              update({ workspaceSort: sort });
              onClose();
            }}
          />
        ))}
      </>
    );
  }
  if (page === "title") {
    return (
      <>
        {back}
        {WORKSPACE_TITLES.map((title) => (
          <Item
            key={title}
            {...row}
            label={t(`settings.workspaceTitles.${title}`)}
            checked={values.workspaceTitle === title}
            onPress={() => {
              update({ workspaceTitle: title });
              onClose();
            }}
          />
        ))}
      </>
    );
  }
  if (page === "show") {
    return (
      <>
        {back}
        <Item
          {...row}
          label={t("display.branch")}
          icon="GitBranch"
          checked={values.showBranch}
          onPress={() => update({ showBranch: !values.showBranch })}
        />
        <Item
          {...row}
          label={t("display.labels")}
          icon="Tag"
          checked={values.showLabels}
          onPress={() => update({ showLabels: !values.showLabels })}
        />
        <Separator theme={theme} />
        <Item
          {...row}
          label={t("display.diff")}
          icon="Diff"
          checked={trailing === "diff"}
          onPress={() => toggleTrailing("diff")}
        />
        <Item
          {...row}
          label={t("display.timestamp")}
          icon="Clock"
          checked={trailing === "timestamp"}
          onPress={() => toggleTrailing("timestamp")}
        />
      </>
    );
  }
  return (
    <>
      <Item
        {...row}
        label={t("display.sort")}
        value={t(`settings.workspaceSorts.${values.workspaceSort}`)}
        onPress={() => setPage("sort")}
      />
      <Item
        {...row}
        label={t("display.title")}
        value={t(`settings.workspaceTitles.${values.workspaceTitle}`)}
        onPress={() => setPage("title")}
      />
      <Item {...row} label={t("display.show")} value="" onPress={() => setPage("show")} />
      <Separator theme={theme} />
      <Item
        {...row}
        label={t("display.showBackground")}
        checked={values.showBackground}
        onPress={() => update({ showBackground: !values.showBackground })}
      />
      <Separator theme={theme} />
      {openSettings}
    </>
  );
}

/**
 * One menu row. `value` makes it open a page: the current value sits left of a chevron.
 * `checked` draws the app's trailing check.
 */
function Item({
  label,
  theme,
  compact,
  onPress,
  icon,
  value,
  checked,
}: {
  label: string;
  theme: Theme;
  compact: boolean;
  onPress: () => void;
  icon?: string;
  value?: string;
  checked?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const muted = theme.colors.foregroundMuted;
  return (
    <Pressable
      accessibilityRole={checked === undefined ? "button" : "checkbox"}
      accessibilityLabel={label}
      aria-checked={checked}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        minHeight: compact ? 40 : 28,
        paddingHorizontal: 8,
        borderRadius: 6,
        backgroundColor: hovered ? theme.colors.surface2 : undefined,
      }}
    >
      {icon ? <Icon name={icon} size={14} color={muted} /> : null}
      <Text numberOfLines={1} style={{ flex: 1, color: theme.colors.foreground, fontSize: 13 }}>
        {label}
      </Text>
      {value ? (
        <Text numberOfLines={1} style={{ color: muted, fontSize: 13, flexShrink: 1 }}>
          {value}
        </Text>
      ) : null}
      {value !== undefined ? <Icon name="ChevronRight" size={14} color={muted} /> : null}
      {checked ? <Icon name="Check" size={16} color={muted} /> : null}
    </Pressable>
  );
}

function Separator({ theme }: { theme: Theme }) {
  return <View style={{ height: 1, marginVertical: 4, marginHorizontal: 4, backgroundColor: theme.colors.border }} />;
}
