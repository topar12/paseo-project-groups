import {
  usePaseo,
  useProject,
  useWorkspace,
  useWorkspaces,
  type PluginSidebarViewProps,
  type ProjectRef,
  type WorkspaceRef,
} from "@getpaseo/plugin/client";
import { Icon, Modal, TextInput, copyText, useToast } from "@getpaseo/plugin/client/ui";
import { useRef, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useT } from "./i18n";
import { groupOfProject } from "./model";
import type { ProjectGroup } from "../shared/settings";

type Theme = PluginSidebarViewProps["theme"];

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function MenuRow({
  label,
  icon,
  theme,
  onPress,
  checked = false,
  danger = false,
  disabled = false,
}: {
  label: string;
  icon: string;
  theme: Theme;
  onPress: () => void;
  checked?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  const color = danger ? theme.colors.statusDanger : theme.colors.foreground;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: checked, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        minHeight: 36,
        paddingHorizontal: 10,
        borderRadius: 6,
        opacity: disabled ? 0.5 : 1,
        backgroundColor: checked ? theme.colors.surface2 : undefined,
      }}
    >
      <Icon name={icon} size={15} color={danger ? color : theme.colors.foregroundMuted} />
      <Text numberOfLines={1} style={{ flex: 1, color, fontSize: 13 }}>
        {label}
      </Text>
      {checked ? <Icon name="Check" size={15} color={theme.colors.accent} /> : null}
    </Pressable>
  );
}

function MenuSection({ title, theme, children }: { title: string; theme: Theme; children: ReactNode }) {
  return (
    <View style={{ gap: 2 }}>
      <Text
        style={{ color: theme.colors.foregroundMuted, fontSize: 11, paddingHorizontal: 10, paddingTop: 6 }}
      >
        {title}
      </Text>
      {children}
    </View>
  );
}

function DialogButton({
  label,
  theme,
  onPress,
  kind = "plain",
  disabled = false,
}: {
  label: string;
  theme: Theme;
  onPress: () => void;
  kind?: "plain" | "danger" | "primary";
  disabled?: boolean;
}) {
  const background =
    kind === "danger"
      ? theme.colors.statusDanger
      : kind === "primary"
        ? theme.colors.accent
        : theme.colors.surface2;
  const color = kind === "plain" ? theme.colors.foreground : theme.colors.accentForeground;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 6,
        backgroundColor: background,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <Text style={{ color, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

function Body({
  theme,
  children,
  tone = "plain",
}: {
  theme: Theme;
  children: ReactNode;
  tone?: "plain" | "warning";
}) {
  return (
    <Text
      style={{
        color: tone === "warning" ? theme.colors.statusDanger : theme.colors.foreground,
        fontSize: 13,
        lineHeight: 19,
      }}
    >
      {children}
    </Text>
  );
}

function Buttons({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>{children}</View>;
}

const closeOnDismiss = (onClose: () => void) => (open: boolean) => (open ? undefined : onClose());

export function ProjectMenuDialog({
  reference,
  groups,
  theme,
  onChooseGroup,
  onNewWorkspace,
  onDecorate,
  onRemove,
  onClose,
}: {
  reference: ProjectRef;
  groups: readonly ProjectGroup[];
  theme: Theme;
  onChooseGroup: (groupId: string | null) => void;
  onNewWorkspace: () => void;
  onDecorate: (name: string) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const project = useProject(reference, (item) => ({ name: item.displayName, path: item.rootPath }));
  const name = project?.name ?? reference.id;
  const current = groupOfProject(groups, reference.key);
  const copyPath = () => {
    if (!project) return;
    onClose();
    copyText(project.path).then(
      () => toast.show(t("toast.pathCopied")),
      (error: unknown) => toast.error(t("toast.copyFailed", { reason: errorText(error) })),
    );
  };
  return (
    <Modal title={name} open onOpenChange={closeOnDismiss(onClose)}>
      <Modal.Content contentContainerStyle={{ padding: 8, gap: 8 }}>
        <MenuSection title={t("project.moveToGroup")} theme={theme}>
          {groups.map((group) => (
            <MenuRow
              key={group.id}
              label={group.name}
              icon="Layers"
              checked={current === group.id}
              theme={theme}
              onPress={() => onChooseGroup(group.id)}
            />
          ))}
          <MenuRow
            label={t("sidebar.ungrouped")}
            icon="CircleDashed"
            checked={current === null}
            theme={theme}
            onPress={() => onChooseGroup(null)}
          />
        </MenuSection>
        <MenuSection title={t("project.actionsSection")} theme={theme}>
          <MenuRow label={t("project.newWorkspaceItem")} icon="Plus" theme={theme} onPress={onNewWorkspace} />
          <MenuRow
            label={t("project.decorateItem")}
            icon="Palette"
            theme={theme}
            onPress={() => onDecorate(name)}
          />
          <MenuRow
            label={t("project.copyPath")}
            icon="Copy"
            theme={theme}
            onPress={copyPath}
            disabled={!project}
          />
          <MenuRow label={t("project.remove")} icon="Trash2" theme={theme} onPress={onRemove} danger />
        </MenuSection>
      </Modal.Content>
    </Modal>
  );
}

export function RemoveProjectDialog({
  reference,
  theme,
  busy,
  onConfirm,
  onClose,
}: {
  reference: ProjectRef;
  theme: Theme;
  busy: boolean;
  /** Receives the keys of the workspaces Paseo will archive with the project. */
  onConfirm: (workspaceKeys: string[]) => void;
  onClose: () => void;
}) {
  const t = useT();
  const name = useProject(reference, (item) => ({ name: item.displayName }))?.name ?? reference.id;
  const kinds = useWorkspaces({
    where: (item) => item.project.key === reference.key && !item.archivingAt,
    groupBy: (item) => item.kind,
  });
  const total = kinds.reduce((sum, group) => sum + group.items.length, 0);
  const worktrees = kinds.find((group) => group.key === "worktree")?.items.length ?? 0;
  return (
    <Modal
      title={t("project.removeTitle", { name })}
      open
      onOpenChange={closeOnDismiss(busy ? () => {} : onClose)}
    >
      <Modal.Content>
        {worktrees > 0 ? (
          <Body theme={theme} tone="warning">
            {t("project.removeWorktreeWarning", { count: worktrees })}
          </Body>
        ) : null}
        <Body theme={theme}>{t("project.removeBody", { count: total })}</Body>
        <Buttons>
          <DialogButton label={t("common.cancel")} theme={theme} onPress={onClose} disabled={busy} />
          <DialogButton
            label={busy ? t("project.removing") : t("project.removeConfirm")}
            theme={theme}
            kind="danger"
            onPress={() => onConfirm(kinds.flatMap((group) => group.items.map((item) => item.key)))}
            disabled={busy}
          />
        </Buttons>
      </Modal.Content>
    </Modal>
  );
}

export function WorkspaceMenuDialog({
  reference,
  theme,
  onDecorate,
  onArchived,
  onClose,
}: {
  reference: WorkspaceRef;
  theme: Theme;
  onDecorate: (name: string) => void;
  onArchived: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const paseo = usePaseo();
  const toast = useToast();
  const workspace = useWorkspace(reference, (item) => ({
    title: item.title ?? item.name,
    customTitle: item.title,
    pinned: !!item.pinnedAt,
    directory: item.directory,
    branch: item.branch,
    worktree: item.kind === "worktree",
  }));
  const [step, setStep] = useState<"menu" | "rename" | "archive">("menu");
  const [initialName, setInitialName] = useState("");
  const draftName = useRef("");
  const [busy, setBusy] = useState(false);

  if (!workspace) return null;
  const handle = () => paseo.workspaces.ref(reference);
  const run = async (action: () => Promise<unknown>, done: string, failed: string) => {
    setBusy(true);
    try {
      await action();
      onClose();
      toast.show(done);
    } catch (error) {
      setBusy(false);
      toast.error(`${failed} ${errorText(error)}`);
    }
  };
  const copy = (text: string, done: string) => {
    onClose();
    copyText(text).then(
      () => toast.show(done),
      (error: unknown) => toast.error(t("toast.copyFailed", { reason: errorText(error) })),
    );
  };

  if (step === "rename") {
    const submit = () =>
      void run(
        () => handle().setTitle(draftName.current.trim() || null),
        t("workspace.renamed"),
        t("workspace.renameFailed"),
      );
    return (
      <Modal title={t("workspace.renameTitle")} open onOpenChange={closeOnDismiss(onClose)}>
        <Modal.Content>
          <TextInput
            accessibilityLabel={t("workspace.nameLabel")}
            autoFocus
            selectTextOnFocus
            autoCapitalize="none"
            autoCorrect={false}
            // Keep the native IME in charge of composing text; only seed the input on mount.
            defaultValue={initialName}
            onChangeText={(text) => {
              draftName.current = text;
            }}
            onSubmitEditing={submit}
            editable={!busy}
            placeholder={t("workspace.namePlaceholder")}
            placeholderTextColor={theme.colors.foregroundMuted}
            style={{
              color: theme.colors.foreground,
              fontSize: 13,
              paddingVertical: 8,
              paddingHorizontal: 10,
              borderRadius: 6,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface1,
            }}
          />
          <Buttons>
            <DialogButton label={t("common.cancel")} theme={theme} onPress={onClose} disabled={busy} />
            <DialogButton
              label={t("common.save")}
              theme={theme}
              kind="primary"
              onPress={submit}
              disabled={busy}
            />
          </Buttons>
        </Modal.Content>
      </Modal>
    );
  }

  if (step === "archive") {
    return (
      <Modal
        title={t("workspace.archiveTitle", { name: workspace.title })}
        open
        onOpenChange={closeOnDismiss(onClose)}
      >
        <Modal.Content>
          {workspace.worktree ? (
            <Body theme={theme} tone="warning">
              {t("workspace.archiveWorktreeWarning")}
            </Body>
          ) : null}
          <Body theme={theme}>{t("workspace.archiveBody")}</Body>
          <Buttons>
            <DialogButton label={t("common.cancel")} theme={theme} onPress={onClose} disabled={busy} />
            <DialogButton
              label={busy ? t("workspace.archiving") : t("workspace.archive")}
              theme={theme}
              kind="danger"
              disabled={busy}
              onPress={() =>
                void run(
                  async () => {
                    await handle().archive();
                    onArchived();
                  },
                  t("workspace.archived"),
                  t("workspace.archiveFailed"),
                )
              }
            />
          </Buttons>
        </Modal.Content>
      </Modal>
    );
  }

  return (
    <Modal title={workspace.title} open onOpenChange={closeOnDismiss(onClose)}>
      <Modal.Content contentContainerStyle={{ padding: 8, gap: 2 }}>
        <MenuRow
          label={t("workspace.rename")}
          icon="Pencil"
          theme={theme}
          onPress={() => {
            const name = workspace.customTitle ?? workspace.title;
            draftName.current = name;
            setInitialName(name);
            setStep("rename");
          }}
        />
        <MenuRow
          label={t("workspace.color")}
          icon="Palette"
          theme={theme}
          onPress={() => onDecorate(workspace.title)}
        />
        <MenuRow
          label={workspace.pinned ? t("workspace.unpin") : t("workspace.pin")}
          icon={workspace.pinned ? "PinOff" : "Pin"}
          theme={theme}
          disabled={busy}
          onPress={() =>
            void run(
              () => handle().setPinned(!workspace.pinned),
              workspace.pinned ? t("workspace.unpinned") : t("workspace.pinned"),
              t("workspace.pinFailed"),
            )
          }
        />
        <MenuRow
          label={t("workspace.copyPath")}
          icon="Copy"
          theme={theme}
          onPress={() => copy(workspace.directory, t("toast.pathCopied"))}
        />
        {workspace.branch ? (
          <MenuRow
            label={t("workspace.copyBranch")}
            icon="GitBranch"
            theme={theme}
            onPress={() => copy(workspace.branch ?? "", t("toast.branchCopied"))}
          />
        ) : null}
        <MenuRow
          label={t("workspace.archive")}
          icon="Archive"
          theme={theme}
          danger
          onPress={() => setStep("archive")}
        />
      </Modal.Content>
    </Modal>
  );
}

export function DeleteGroupDialog({
  group,
  count,
  theme,
  onConfirm,
  onClose,
}: {
  group: ProjectGroup;
  count: number;
  theme: Theme;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <Modal title={t("group.deleteTitle", { name: group.name })} open onOpenChange={closeOnDismiss(onClose)}>
      <Modal.Content>
        <Body theme={theme}>{t("group.deleteBody", { count })}</Body>
        <Buttons>
          <DialogButton label={t("common.cancel")} theme={theme} onPress={onClose} />
          <DialogButton label={t("group.deleteConfirm")} theme={theme} kind="danger" onPress={onConfirm} />
        </Buttons>
      </Modal.Content>
    </Modal>
  );
}
