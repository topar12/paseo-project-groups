import { useSettings, useTranslation } from "@getpaseo/plugin/client";
import { useMemo } from "react";
import { appearanceDocument } from "../shared/settings";
import { messages, RESOURCES, type Language } from "./messages";

type Resource = typeof RESOURCES.en;
type Tree = { readonly [key: string]: string | Tree };

/** Dotted keys of the English resource; plural keys are named without their suffix. */
type Key<Node> = {
  [Name in keyof Node & string]: Node[Name] extends string
    ? Name extends `${infer Base}_${"one" | "other"}`
      ? Base
      : Name
    : `${Name}.${Key<Node[Name]>}`;
}[keyof Node & string];

export type MessageKey = Key<Resource>;
export type Translate = (key: MessageKey, options?: Record<string, string | number>) => string;

function lookup(resource: Tree, path: string): string | undefined {
  let node: string | Tree | undefined = resource;
  for (const part of path.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = node[part];
  }
  return typeof node === "string" ? node : undefined;
}

/** English uses `_one` for exactly one; Korean and Chinese always use `_other`. */
function pluralSuffix(language: Language, count: number): "one" | "other" {
  return language === "en" && count === 1 ? "one" : "other";
}

export function translator(language: Language): Translate {
  const resources: Tree[] = [RESOURCES[language], RESOURCES.en];
  return (key, options) => {
    const count = typeof options?.count === "number" ? options.count : undefined;
    let text: string | undefined;
    for (const resource of resources) {
      text =
        count === undefined
          ? lookup(resource, key)
          : (lookup(resource, `${key}_${pluralSuffix(language, count)}`) ?? lookup(resource, `${key}_other`));
      if (text !== undefined) break;
    }
    if (text === undefined) return key;
    return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) =>
      options && name in options ? String(options[name]) : match,
    );
  };
}

/** The language chosen in the plugin settings, else a supported app language. */
export function useLanguage(): Language {
  const { locale } = useTranslation(messages);
  const appearance = useSettings(appearanceDocument);
  const choice = appearance.status === "ready" ? appearance.values.language : "auto";
  if (choice !== "auto") return choice;
  const appLanguage = locale.toLowerCase();
  if (appLanguage.startsWith("zh")) return "zh-CN";
  return appLanguage.startsWith("ko") ? "ko" : "en";
}

export function useT(): Translate {
  const language = useLanguage();
  return useMemo(() => translator(language), [language]);
}
