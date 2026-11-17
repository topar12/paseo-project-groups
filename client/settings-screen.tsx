import { useSettings, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import {
  Icon,
  SettingsAction,
  SettingsCard,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { useMemo } from "react";
import { Text, View } from "react-native";
import {
  appearanceDocument,
  DENSITIES,
  GROUP_SPACINGS,
  INDENTS,
  LANGUAGES,
  TEXT_SIZES,
  type AppearanceValues,
} from "../shared/settings";
import { useT } from "./i18n";
import { DEFAULT_APPEARANCE, lookFrom } from "./look";
import { rowStyles, StatusDot } from "./rows";

/** Each language is named in its own language so it can be found in any locale. */
const LANGUAGE_NAMES = { en: "English", ko: "한국어", "zh-CN": "简体中文" } as const;

/** A sample of the sidebar drawn with the chosen values. */
function Preview({ values, theme }: { values: AppearanceValues; theme: PluginSurfaceProps["theme"] }) {
  const t = useT();
  const look = useMemo(() => lookFrom(values), [values]);
  const styles = useMemo(() => rowStyles(theme, look), [theme, look]);
  const muted = theme.colors.foregroundMuted;
  const dot = (color: string, running = false) =>
    look.showStatusDots ? <StatusDot color={color} running={running} /> : null;
  return (
    <View
      style={{
        paddingVertical: 6,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      }}
    >
      <View style={styles.header}>
        <Icon name="ChevronDown" size={look.icon - 1} color={muted} />
        <Text style={styles.groupName}>{t("settings.sampleGroup")}</Text>
        <Text style={styles.detail}>2</Text>
      </View>
      <View style={[styles.row, { paddingLeft: look.projectIndent }]}>
        <Icon name="ChevronDown" size={look.icon - 1} color={muted} />
        {look.showProjectIcons ? <Icon name="Folder" size={look.icon} color={muted} /> : null}
        <Text style={styles.projectName}>my-app</Text>
      </View>
      <View style={[styles.row, styles.rounded, styles.selected, { paddingLeft: look.workspaceIndent - 4 }]}>
        {dot(theme.colors.accent, true)}
        <Text numberOfLines={1} style={styles.workspaceName}>
          {t("settings.sampleWorkspace")}
        </Text>
        {look.showDiffStats ? (
          <Text style={styles.detail}>
            <Text style={{ color: theme.colors.statusSuccess }}>+42</Text>{" "}
            <Text style={{ color: theme.colors.statusDanger }}>−7</Text>
          </Text>
        ) : null}
      </View>
      <View style={[styles.row, { paddingLeft: look.workspaceIndent }]}>
        {dot(theme.colors.statusSuccess)}
        <Text numberOfLines={1} style={styles.workspaceName}>
          main
        </Text>
      </View>
      <View style={[styles.row, { paddingLeft: look.projectIndent }]}>
        <Icon name="ChevronRight" size={look.icon - 1} color={muted} />
        {look.showProjectIcons ? <Icon name="Folder" size={look.icon} color={muted} /> : null}
        <Text style={styles.projectName}>api-server</Text>
        <Text style={styles.detail}>3</Text>
      </View>
      <View style={{ height: look.groupGap }} />
      <View style={styles.header}>
        <Icon name="ChevronRight" size={look.icon - 1} color={muted} />
        <Text style={styles.groupName}>{t("settings.sampleGroup2")}</Text>
        <Text style={styles.detail}>4</Text>
      </View>
    </View>
  );
}

export function AppearanceSettings({ theme }: PluginSurfaceProps) {
  const settings = useSettings(appearanceDocument);
  const t = useT();

  if (settings.status === "loading") {
    return <Text style={{ color: theme.colors.foregroundMuted }}>{t("settings.loading")}</Text>;
  }
  if (settings.status !== "ready") {
    return (
      <SettingsSection title={t("plugin.settingsTitle")}>
        <SettingsCard>
          <SettingsAction
            label={t("settings.readFailed")}
            hint={settings.error}
            actionLabel={t("settings.resetDefaults")}
            onPress={() => void settings.reset()}
          />
        </SettingsCard>
      </SettingsSection>
    );
  }

  const values = settings.values;
  const update = (patch: Partial<AppearanceValues>) =>
    void settings.save({ ...values, ...patch }, settings.revision);

  return (
    <View style={{ gap: 24 }}>
      <SettingsSection title={t("settings.language")}>
        <SettingsCard>
          <SettingsSelect
            label={t("settings.language")}
            hint={t("settings.languageHint")}
            value={values.language}
            options={LANGUAGES.map((language) => ({
              value: language,
              label: language === "auto" ? t("settings.languageAuto") : LANGUAGE_NAMES[language],
            }))}
            onValueChange={(language) => update({ language })}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t("settings.preview")}>
        <Preview values={values} theme={theme} />
      </SettingsSection>

      <SettingsSection title={t("settings.textAndSpacing")}>
        <SettingsCard>
          <SettingsSelect
            label={t("settings.textSize")}
            hint={t("settings.textSizeHint")}
            value={String(values.textSize)}
            options={TEXT_SIZES.map((size) => ({
              value: String(size),
              label:
                size === 12
                  ? t("settings.textSizeDefault", { size })
                  : t("settings.textSizeOption", { size }),
            }))}
            onValueChange={(value) => update({ textSize: Number(value) })}
          />
          <SettingsSelect
            label={t("settings.density")}
            hint={t("settings.densityHint")}
            value={values.density}
            options={DENSITIES.map((density) => ({
              value: density,
              label: t(`settings.densities.${density}`),
            }))}
            onValueChange={(density) => update({ density })}
          />
          <SettingsSelect
            label={t("settings.groupSpacing")}
            hint={t("settings.groupSpacingHint")}
            value={values.groupSpacing}
            options={GROUP_SPACINGS.map((spacing) => ({
              value: spacing,
              label: t(`settings.groupSpacings.${spacing}`),
            }))}
            onValueChange={(groupSpacing) => update({ groupSpacing })}
          />
          <SettingsSelect
            label={t("settings.indent")}
            hint={t("settings.indentHint")}
            value={values.indent}
            options={INDENTS.map((indent) => ({ value: indent, label: t(`settings.indents.${indent}`) }))}
            onValueChange={(indent) => update({ indent })}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t("settings.elements")}>
        <SettingsCard>
          <SettingsSwitch
            label={t("settings.boldGroupNames")}
            value={values.boldGroupNames}
            onValueChange={(boldGroupNames) => update({ boldGroupNames })}
          />
          <SettingsSwitch
            label={t("settings.projectIcons")}
            value={values.showProjectIcons}
            onValueChange={(showProjectIcons) => update({ showProjectIcons })}
          />
          <SettingsSwitch
            label={t("settings.statusDots")}
            hint={t("settings.statusDotsHint")}
            value={values.showStatusDots}
            onValueChange={(showStatusDots) => update({ showStatusDots })}
          />
          <SettingsSwitch
            label={t("settings.diffStats")}
            value={values.showDiffStats}
            onValueChange={(showDiffStats) => update({ showDiffStats })}
          />
          <SettingsSwitch
            label={t("settings.pinnedSection")}
            hint={t("settings.pinnedSectionHint")}
            value={values.showPinned}
            onValueChange={(showPinned) => update({ showPinned })}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t("settings.reset")}>
        <SettingsCard>
          <SettingsAction
            label={t("settings.resetLabel")}
            actionLabel={t("settings.resetAction")}
            // Keep the chosen language; reset only covers the look.
            onPress={() =>
              void settings.save({ ...DEFAULT_APPEARANCE, language: values.language }, settings.revision)
            }
          />
        </SettingsCard>
      </SettingsSection>
    </View>
  );
}
