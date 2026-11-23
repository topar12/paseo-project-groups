import { Platform } from "react-native";

interface AnimatableView {
  animate(
    keyframes: { transform: string }[],
    options: { duration: number; iterations: number },
  ): { startTime: number | null; cancel(): void };
}

export function animateSpinnerOnWeb(view: unknown, duration: number): (() => void) | undefined {
  if (Platform.OS !== "web") return;
  const element = view as Partial<AnimatableView> | null;
  if (typeof element?.animate !== "function") return;

  const animation = element.animate(
    [{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }],
    { duration, iterations: Infinity },
  );
  // Anchor every ring to the document timeline, including rings mounted later.
  animation.startTime = 0;
  return () => animation.cancel();
}

/** Native pressables retain their normal focus and accessibility behavior. */
export function sidebarNavProps(dataSet: Record<string, string>) {
  return Platform.OS === "web" ? { dataSet } : {};
}

interface SidebarElement {
  addEventListener(type: string, listener: (event: SidebarKeyEvent) => void): void;
  removeEventListener(type: string, listener: (event: SidebarKeyEvent) => void): void;
  closest(selector: string): SidebarElement | null;
  querySelector(selector: string): SidebarElement | null;
  querySelectorAll(selector: string): ArrayLike<SidebarElement>;
  getAttribute(name: string): string | null;
  getClientRects(): ArrayLike<unknown>;
  focus(): void;
  click(): void;
}

interface SidebarKeyEvent {
  target: { closest?: SidebarElement["closest"] } | null;
  key: string;
  keyCode?: number;
  isComposing: boolean;
  defaultPrevented: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

export function bindSidebarKeys(
  view: unknown,
  jump: (agent: string, direction: "parent" | "previous" | "next") => boolean,
) {
  if (Platform.OS !== "web" || !view) return;
  const root = view as SidebarElement;
  if (typeof root.addEventListener !== "function") return;
  const onKey = (event: SidebarKeyEvent) => {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.key === "Process" ||
      event.keyCode === 229 ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    ) {
      return;
    }
    const target = event.target;
    if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    const row = target?.closest?.("[data-pg-nav]");
    if (!row) return;
    const key = event.key;
    const agent = row.getAttribute("data-pg-agent");
    let action: (() => void) | undefined;
    if (key === "ArrowUp" || key === "ArrowDown") {
      const items = Array.from(root.querySelectorAll("[data-pg-nav]")).filter((item) => item.getClientRects().length);
      const next = items[items.indexOf(row) + (key === "ArrowUp" ? -1 : 1)];
      if (next) action = () => next.focus();
    } else if (key === "ArrowLeft" || key === "ArrowRight") {
      if (row.getAttribute("aria-expanded") === (key === "ArrowLeft" ? "true" : "false")) {
        action = () => row.click();
      }
    } else if (agent) {
      const direction = key.toLowerCase() === "p" ? "parent" : key === "[" ? "previous" : key === "]" ? "next" : null;
      if (direction && jump(agent, direction)) action = () => {};
    }
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    action();
  };
  root.addEventListener("keydown", onKey);
  return () => root.removeEventListener("keydown", onKey);
}
