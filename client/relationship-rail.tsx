import type { AgentRef, PluginSidebarViewProps } from "@getpaseo/plugin/client";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Platform, View, type ScrollView } from "react-native";
import type { RelationshipFamily } from "./relationship-model";

type Anchor = { center: number; top: number; bottom: number };

export interface RailChildPoint {
  readonly key: string;
  readonly y: number;
}

export interface RailSegment {
  readonly parentKey: string;
  readonly parent: number;
  readonly children: readonly RailChildPoint[];
  readonly lane: number;
  readonly top: number;
  readonly bottom: number;
}

export interface RailLayout {
  readonly rails: readonly RailSegment[];
  readonly laneCount: number;
}

interface MeasurableNode {
  measureLayout?: (
    relativeTo: unknown,
    onSuccess: (x: number, y: number, width: number, height: number) => void,
    onFail?: () => void,
  ) => void;
  measureInWindow?: (callback: (x: number, y: number, width: number, height: number) => void) => void;
  getBoundingClientRect?: () => { top: number; height: number };
  querySelector?: (selector: string) => { focus?: (options?: { preventScroll?: boolean }) => void } | null;
  focus?: (options?: { preventScroll?: boolean }) => void;
}

/**
 * Refined metro-map rail geometry.
 * - `RAIL_BASE_X = 6`, `LANE_STEP = 8`, `RAIL_RADIUS = 4` (2x pitch-to-radius ratio leaves 4px
 *   of straight horizontal run between an outer curve and the adjacent lane).
 * - `gutterExtra = laneCount * LANE_STEP` puts every vertical lane and opaque `surface0` crossing
 *   bridge strictly inside the pure `surface0` left gutter before the row capsule (`gutterExtra + 4`).
 * - `elbowEndX = gutterExtra + RAIL_ELBOW_INSET` (`armEnd = gutterExtra + 16`) keeps the parent
 *   halo right edge (`gutterExtra + 20.75`) safely clear of both `pinned` (`gutterExtra + 22`)
 *   and `narrow` (`gutterExtra + 30`) workspace rows.
 */
export const RAIL_BASE_X = 6;
export const LANE_STEP = 8;
export const MAX_LANES = 3;
export const RAIL_RADIUS = 4;
export const RAIL_ELBOW_INSET = 17;

const LANE_GAP = 6;
const EPSILON = 0.5;
const SCROLL_MARGIN = 8;
const CROSSING_HALO_PAD = 2;
const EMPTY_LAYOUT: RailLayout = { rails: [], laneCount: 0 };

/**
 * Mid-tone family palette readable on both light and dark sidebars, intentionally avoiding
 * alert red (`#E5484D`) so relationship rails are never mistaken for error indicators.
 */
export const FAMILY_PALETTE = [
  "#0090FF", // blue
  "#12A594", // teal
  "#8E4EC6", // purple
  "#D6A100", // amber
  "#30A46C", // green
  "#3E63DD", // indigo
  "#D6409F", // rose
  "#E07A2F", // copper
] as const;

/** Deterministic family accent color derived from the parent agent key. */
export function familyColor(parentKey: string): string {
  let hash = 2166136261;
  for (let index = 0; index < parentKey.length; index++) {
    hash ^= parentKey.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return FAMILY_PALETTE[(hash >>> 0) % FAMILY_PALETTE.length];
}

/** Convert `#RRGGBB` to `rgba(r, g, b, alpha)` so translucent strokes never dilute opaque halos. */
export function withAlpha(hex: string, alpha: number): string {
  const clean = hex.startsWith("#") ? hex.slice(1) : hex;
  if (clean.length !== 6) return hex;
  const r = Number.parseInt(clean.slice(0, 2), 16);
  const g = Number.parseInt(clean.slice(2, 4), 16);
  const b = Number.parseInt(clean.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return hex;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

type FrameHandle = { kind: "raf"; id: number } | { kind: "timer"; id: ReturnType<typeof setTimeout> };

function scheduleFrame(callback: () => void): FrameHandle {
  if (typeof requestAnimationFrame === "function") {
    return { kind: "raf", id: requestAnimationFrame(callback) };
  }
  return { kind: "timer", id: setTimeout(callback, 0) };
}

function cancelFrame(handle: FrameHandle) {
  if (handle.kind === "raf" && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(handle.id);
  } else if (handle.kind === "timer") {
    clearTimeout(handle.id);
  }
}

function measureInWindowOf(node: MeasurableNode): Promise<{ y: number; height: number } | null> {
  if (typeof node.measureInWindow !== "function") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      node.measureInWindow!((_x, y, _width, height) => resolve({ y, height }));
    } catch {
      resolve(null);
    }
  });
}

/**
 * Measure a row anchor relative to the scroll content container. Prefers `measureLayout`, then
 * falls back to `measureInWindow` deltas (native & web) and DOM rects (web) so measurement stays
 * reliable across React Native Paper/Fabric and react-native-web.
 */
async function measureRelative(node: MeasurableNode, container: MeasurableNode): Promise<Anchor | null> {
  if (typeof node.measureLayout === "function") {
    const layout = await new Promise<Anchor | null>((resolve) => {
      try {
        node.measureLayout!(
          container,
          (_x, y, _width, height) => {
            resolve(height > 0 ? { center: y + height / 2, top: y, bottom: y + height } : null);
          },
          () => resolve(null),
        );
      } catch {
        resolve(null);
      }
    });
    if (layout) return layout;
  }

  if (typeof node.measureInWindow === "function" && typeof container.measureInWindow === "function") {
    const [childRect, hostRect] = await Promise.all([measureInWindowOf(node), measureInWindowOf(container)]);
    if (childRect && hostRect && childRect.height > 0) {
      const top = childRect.y - hostRect.y;
      return { center: top + childRect.height / 2, top, bottom: top + childRect.height };
    }
  }

  if (typeof node.getBoundingClientRect === "function" && typeof container.getBoundingClientRect === "function") {
    const childRect = node.getBoundingClientRect();
    const hostRect = container.getBoundingClientRect();
    if (childRect.height > 0) {
      const top = childRect.top - hostRect.top;
      return { center: top + childRect.height / 2, top, bottom: top + childRect.height };
    }
  }

  return null;
}

type Span = { top: number; bottom: number };

function overlapsSpan(a: Span, b: Span): boolean {
  return !(a.bottom + LANE_GAP < b.top || a.top > b.bottom + LANE_GAP);
}

function overlapAmount(a: Span, b: Span): number {
  const start = Math.max(a.top, b.top);
  const end = Math.min(a.bottom, b.bottom);
  return Math.max(0, end - start + LANE_GAP);
}

/**
 * Assign vertical lanes (capped at MAX_LANES to protect narrow mobile widths).
 * Places longer/enclosing spans on outer (smaller/left) lanes and shorter/nested spans on inner
 * (larger/right) lanes while reusing lanes whenever vertical intervals do not conflict, which
 * eliminates crossings for nested families and minimizes unavoidable bridge crossings.
 */
export function assignLanes(
  candidates: readonly {
    parentKey: string;
    parent: number;
    children: readonly RailChildPoint[];
    top: number;
    bottom: number;
  }[],
): RailLayout {
  if (!candidates.length) return EMPTY_LAYOUT;
  const sorted = [...candidates].sort(
    (a, b) =>
      (b.bottom - b.top) - (a.bottom - a.top) ||
      a.top - b.top ||
      a.parentKey.localeCompare(b.parentKey),
  );
  const laneSpans: Span[][] = [];
  const rails: RailSegment[] = [];
  for (const item of sorted) {
    const span: Span = { top: item.top, bottom: item.bottom };
    let lane = laneSpans.findIndex((existing) => existing.every((other) => !overlapsSpan(span, other)));
    if (lane === -1) {
      if (laneSpans.length < MAX_LANES) {
        lane = laneSpans.length;
        laneSpans.push([span]);
      } else {
        lane = 0;
        let bestOverlap = Infinity;
        for (let index = 0; index < laneSpans.length; index++) {
          const total = laneSpans[index].reduce((sum, other) => sum + overlapAmount(span, other), 0);
          if (total < bestOverlap) {
            bestOverlap = total;
            lane = index;
          }
        }
        laneSpans[lane].push(span);
      }
    } else {
      laneSpans[lane].push(span);
    }
    rails.push({
      parentKey: item.parentKey,
      parent: item.parent,
      children: item.children,
      lane,
      top: item.top,
      bottom: item.bottom,
    });
  }
  return { rails, laneCount: laneSpans.length };
}

function sameLayout(left: RailLayout, right: RailLayout): boolean {
  if (left === right) return true;
  if (left.laneCount !== right.laneCount || left.rails.length !== right.rails.length) return false;
  for (let i = 0; i < left.rails.length; i++) {
    const a = left.rails[i];
    const b = right.rails[i];
    if (
      a.parentKey !== b.parentKey ||
      a.lane !== b.lane ||
      Math.abs(a.parent - b.parent) >= EPSILON ||
      a.children.length !== b.children.length
    ) {
      return false;
    }
    for (let j = 0; j < a.children.length; j++) {
      if (a.children[j].key !== b.children[j].key || Math.abs(a.children[j].y - b.children[j].y) >= EPSILON) {
        return false;
      }
    }
  }
  return true;
}

function focusAnchorOnWeb(node: MeasurableNode) {
  if (Platform.OS !== "web") return;
  const focusable = node.querySelector?.("[data-pg-nav]") ?? node;
  focusable.focus?.({ preventScroll: true });
}

/**
 * Compute the minimal scroll offset to bring `point` into `[scrollY, scrollY + viewportHeight]`,
 * or `null` when it is already visible inside the viewport.
 */
function minimalScrollTarget(point: Anchor, scrollY: number, viewportHeight: number, wasCollapsed: boolean): number | null {
  if (viewportHeight > 0) {
    if (point.top >= scrollY && point.bottom <= scrollY + viewportHeight) return null;
    if (point.top < scrollY) return Math.max(0, point.top - SCROLL_MARGIN);
    return Math.max(0, point.bottom - viewportHeight + SCROLL_MARGIN);
  }
  return wasCollapsed ? Math.max(0, point.top - SCROLL_MARGIN) : null;
}

export function useRelationshipRail(
  families: readonly RelationshipFamily[],
  content: RefObject<View | null>,
  scroll: RefObject<ScrollView | null>,
) {
  const nodes = useRef(new Map<string, View>());
  const focusTarget = useRef<{ key: string; focus: boolean; wasCollapsed: boolean; id: number } | null>(null);
  const frame = useRef<FrameHandle | null>(null);
  const request = useRef(0);
  const revealId = useRef(0);
  const mounted = useRef(true);
  const scrollYRef = useRef(0);
  const viewportHeightRef = useRef(0);
  const familiesRef = useRef<readonly RelationshipFamily[]>(families);
  familiesRef.current = families;
  const trackedKeysRef = useRef<Set<string>>(new Set());
  const layoutRef = useRef<RailLayout>(EMPTY_LAYOUT);
  const [layout, setLayout] = useState<RailLayout>(EMPTY_LAYOUT);

  const tracked = new Set<string>();
  for (const family of families) {
    tracked.add(family.parent.key);
    for (const child of family.children) tracked.add(child.key);
  }
  trackedKeysRef.current = tracked;

  const updateLayout = useCallback((next: RailLayout) => {
    if (sameLayout(layoutRef.current, next)) return;
    layoutRef.current = next;
    setLayout(next);
  }, []);

  const measure = useCallback((agent: AgentRef | string): Promise<Anchor | null> => {
    const key = typeof agent === "string" ? agent : agent.key;
    const node = nodes.current.get(key) as MeasurableNode | undefined;
    const container = content.current as MeasurableNode | null;
    if (!node || !container) return Promise.resolve(null);
    return measureRelative(node, container);
  }, [content]);

  const refresh = useCallback(() => {
    if (frame.current !== null) cancelFrame(frame.current);
    const revision = ++request.current;
    frame.current = scheduleFrame(() => {
      frame.current = null;
      if (!mounted.current) return;
      const target = focusTarget.current;
      if (target) {
        void measure(target.key).then((point) => {
          if (!mounted.current || !point || focusTarget.current?.id !== target.id) return;
          focusTarget.current = null;
          const nextY = minimalScrollTarget(point, scrollYRef.current, viewportHeightRef.current, target.wasCollapsed);
          if (nextY !== null) {
            scroll.current?.scrollTo({ y: nextY, animated: false });
          }
          if (target.focus) {
            const node = nodes.current.get(target.key) as MeasurableNode | undefined;
            if (node) focusAnchorOnWeb(node);
          }
        });
      }
      const activeFamilies = familiesRef.current;
      if (!activeFamilies.length) {
        updateLayout(EMPTY_LAYOUT);
        return;
      }
      // Measure every referenced row anchor once per batched frame.
      const keys = new Set<string>();
      for (const family of activeFamilies) {
        keys.add(family.parent.key);
        for (const child of family.children) keys.add(child.key);
      }
      const keyList = [...keys];
      void Promise.all(keyList.map((key) => measure(key))).then((anchors) => {
        if (!mounted.current || request.current !== revision) return;
        const byKey = new Map<string, Anchor>();
        keyList.forEach((key, index) => {
          const anchor = anchors[index];
          if (anchor) byKey.set(key, anchor);
        });
        const candidates: {
          parentKey: string;
          parent: number;
          children: readonly RailChildPoint[];
          top: number;
          bottom: number;
        }[] = [];
        for (const family of activeFamilies) {
          const parentAnchor = byKey.get(family.parent.key);
          if (!parentAnchor) continue;
          const children = family.children.flatMap((child) => {
            const point = byKey.get(child.key);
            return point ? [{ key: child.key, y: point.center }] : [];
          });
          if (!children.length) continue;
          const ys = children.map((child) => child.y);
          candidates.push({
            parentKey: family.parent.key,
            parent: parentAnchor.center,
            children,
            top: Math.min(parentAnchor.center, ...ys),
            bottom: Math.max(parentAnchor.center, ...ys),
          });
        }
        updateLayout(assignLanes(candidates));
      });
    });
  }, [measure, scroll, updateLayout]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current++;
      if (frame.current !== null) cancelFrame(frame.current);
      frame.current = null;
    };
  }, []);

  useEffect(() => {
    refresh();
  }, [families, refresh]);

  const register = useCallback((key: string, node: View | null) => {
    const had = nodes.current.has(key);
    if (node) nodes.current.set(key, node);
    else nodes.current.delete(key);
    const relevant = focusTarget.current?.key === key || trackedKeysRef.current.has(key);
    if (relevant && (node !== null || had)) refresh();
  }, [refresh]);

  const revealAgent = useCallback((key: string, options?: { focus?: boolean; wasCollapsed?: boolean }) => {
    focusTarget.current = {
      key,
      focus: options?.focus ?? false,
      wasCollapsed: options?.wasCollapsed ?? false,
      id: ++revealId.current,
    };
    refresh();
  }, [refresh]);

  const onScroll = useCallback((y: number) => {
    scrollYRef.current = y;
  }, []);

  const onViewportHeight = useCallback((height: number) => {
    viewportHeightRef.current = height;
  }, []);

  const gutterExtra = layout.laneCount > 0 ? layout.laneCount * LANE_STEP : 0;

  return {
    register,
    refresh,
    revealAgent,
    onScroll,
    onViewportHeight,
    rails: families.length ? layout.rails : EMPTY_LAYOUT.rails,
    laneCount: families.length ? layout.laneCount : 0,
    gutterExtra: families.length ? gutterExtra : 0,
  };
}

type RailTone = "default" | "active" | "dimmed";

function railStyleTokens(baseHex: string, tone: RailTone) {
  if (tone === "active") {
    return {
      stroke: 2,
      lineColor: baseHex,
      parentDotColor: baseHex,
      parentHaloColor: withAlpha(baseHex, 0.22),
      parentDotSize: 6.5,
      parentHaloSize: 9.5,
      childDotColor: baseHex,
      childDotSize: 4.5,
    };
  }
  if (tone === "dimmed") {
    return {
      stroke: 1.25,
      lineColor: withAlpha(baseHex, 0.28),
      parentDotColor: withAlpha(baseHex, 0.36),
      parentHaloColor: withAlpha(baseHex, 0.1),
      parentDotSize: 5.5,
      parentHaloSize: 8.5,
      childDotColor: withAlpha(baseHex, 0.34),
      childDotSize: 3.5,
    };
  }
  return {
    stroke: 1.5,
    lineColor: withAlpha(baseHex, 0.62),
    parentDotColor: withAlpha(baseHex, 0.85),
    parentHaloColor: withAlpha(baseHex, 0.16),
    parentDotSize: 6,
    parentHaloSize: 9,
    childDotColor: withAlpha(baseHex, 0.78),
    childDotSize: 4,
  };
}

function RailItem({
  rail,
  allRails,
  tone,
  activeParentKey,
  elbowEndX,
  theme,
}: {
  rail: RailSegment;
  allRails: readonly RailSegment[];
  tone: RailTone;
  activeParentKey: string | null;
  elbowEndX: number;
  theme: PluginSidebarViewProps["theme"];
}) {
  const x = RAIL_BASE_X + rail.lane * LANE_STEP;
  const armEnd = elbowEndX - 1;
  const baseHex = familyColor(rail.parentKey);
  const {
    stroke,
    lineColor,
    parentDotColor,
    parentHaloColor,
    parentDotSize,
    parentHaloSize,
    childDotColor,
    childDotSize,
  } = railStyleTokens(baseHex, tone);
  const surface = theme.colors.surface0;
  const { parent, children, top, bottom } = rail;
  const span = bottom - top;
  const radius = Math.min(RAIL_RADIUS, Math.max(0, span / 2));

  // All arms (parent guide arm + child branch arms) share identical seam-free geometry.
  const arms: { key: string; y: number; kind: "parent" | "child" }[] = [
    { key: `parent:${rail.parentKey}`, y: parent, kind: "parent" },
    ...children.map((child) => ({ key: `child:${child.key}`, y: child.y, kind: "child" as const })),
  ];

  // Vertical trunk strictly spans between the top and bottom corner curves with 0px overlap.
  const trunkTop = top + radius;
  const trunkBottom = bottom - radius;
  const trunkHeight = Math.max(0, trunkBottom - trunkTop);

  // Horizontal bridge halos: only for strict interior crossings so 3-level chains (A -> B -> C)
  // sharing a relay row never erase the other family's endpoint corner on B.
  const horizontalCrossings: { key: string; x: number; y: number; width: number; height: number }[] = [];
  for (const arm of arms) {
    for (const other of allRails) {
      if (other.parentKey === rail.parentKey || other.lane <= rail.lane) continue;
      // If the crossed inner rail is the active highlighted rail, let the active rail ride on top.
      if (activeParentKey && other.parentKey === activeParentKey) continue;
      if (arm.y > other.top + EPSILON && arm.y < other.bottom - EPSILON) {
        const otherX = RAIL_BASE_X + other.lane * LANE_STEP;
        const otherStroke = activeParentKey ? 1.25 : 1.5;
        horizontalCrossings.push({
          key: `hbridge:${arm.key}:${other.parentKey}`,
          x: otherX - CROSSING_HALO_PAD,
          y: arm.y - stroke / 2 - CROSSING_HALO_PAD,
          width: otherStroke + CROSSING_HALO_PAD * 2,
          height: stroke + CROSSING_HALO_PAD * 2,
        });
      }
    }
  }

  // Vertical bridge halos: when THIS rail is active on an inner lane and its vertical trunk
  // strictly crosses a dimmed outer rail's horizontal arm, paint a crisp `surface0` vertical gap.
  const verticalCrossings: { key: string; x: number; y: number; width: number; height: number }[] = [];
  if (tone === "active") {
    for (const other of allRails) {
      if (other.parentKey === rail.parentKey || other.lane >= rail.lane) continue;
      const otherArmYs = [other.parent, ...other.children.map((child) => child.y)];
      for (const armY of otherArmYs) {
        if (armY > top + EPSILON && armY < bottom - EPSILON) {
          verticalCrossings.push({
            key: `vbridge:${other.parentKey}:${armY}`,
            x: x - CROSSING_HALO_PAD,
            y: armY - 1.25 / 2 - CROSSING_HALO_PAD,
            width: stroke + CROSSING_HALO_PAD * 2,
            height: 1.25 + CROSSING_HALO_PAD * 2,
          });
        }
      }
    }
  }

  return (
    <>
      {verticalCrossings.map((bridge) => (
        <View
          key={bridge.key}
          testID="rail-bridge-halo"
          style={{
            position: "absolute",
            left: bridge.x,
            top: bridge.y,
            width: bridge.width,
            height: bridge.height,
            backgroundColor: surface,
          }}
        />
      ))}

      {trunkHeight > 0 ? (
        <View
          style={{
            position: "absolute",
            left: x,
            top: trunkTop,
            height: trunkHeight,
            width: stroke,
            backgroundColor: lineColor,
          }}
        />
      ) : null}

      {horizontalCrossings.map((bridge) => (
        <View
          key={bridge.key}
          testID="rail-bridge-halo"
          style={{
            position: "absolute",
            left: bridge.x,
            top: bridge.y,
            width: bridge.width,
            height: bridge.height,
            backgroundColor: surface,
          }}
        />
      ))}

      {arms.map((arm) => {
        // Both parent and child arms stop flush at the left rim of their solid dots so translucent
        // colors never double-stack and soft halos stay clean on selected/highlighted rows.
        const stopX = arm.kind === "child" ? armEnd - childDotSize / 2 : armEnd - parentDotSize / 2;
        const isTop = span > EPSILON && Math.abs(arm.y - top) < EPSILON;
        const isBottom = span > EPSILON && Math.abs(arm.y - bottom) < EPSILON;

        if (isTop) {
          return (
            <View
              key={arm.key}
              style={{
                position: "absolute",
                left: x,
                top: arm.y - stroke / 2,
                width: Math.max(radius + stroke, stopX - x),
                height: radius + stroke / 2,
                borderLeftWidth: stroke,
                borderTopWidth: stroke,
                borderRightWidth: 0,
                borderBottomWidth: 0,
                borderTopLeftRadius: radius,
                borderColor: lineColor,
              }}
            />
          );
        }

        if (isBottom) {
          return (
            <View
              key={arm.key}
              style={{
                position: "absolute",
                left: x,
                top: arm.y - radius,
                width: Math.max(radius + stroke, stopX - x),
                height: radius + stroke / 2,
                borderLeftWidth: stroke,
                borderBottomWidth: stroke,
                borderRightWidth: 0,
                borderTopWidth: 0,
                borderBottomLeftRadius: radius,
                borderColor: lineColor,
              }}
            />
          );
        }

        const startX = span > EPSILON ? x + stroke : x;
        return (
          <View
            key={arm.key}
            style={{
              position: "absolute",
              left: startX,
              top: arm.y - stroke / 2,
              width: Math.max(0, stopX - startX),
              height: stroke,
              backgroundColor: lineColor,
            }}
          />
        );
      })}

      {/* Parent origin node: soft translucent family-color glow ring around a solid core dot. */}
      <View
        testID="rail-parent-halo"
        style={{
          position: "absolute",
          left: armEnd - parentHaloSize / 2,
          top: parent - parentHaloSize / 2,
          width: parentHaloSize,
          height: parentHaloSize,
          borderRadius: parentHaloSize / 2,
          backgroundColor: parentHaloColor,
        }}
      />
      <View
        testID="rail-parent-node"
        style={{
          position: "absolute",
          left: armEnd - parentDotSize / 2,
          top: parent - parentDotSize / 2,
          width: parentDotSize,
          height: parentDotSize,
          borderRadius: parentDotSize / 2,
          backgroundColor: parentDotColor,
        }}
      />

      {/* Child terminal dots: smaller solid dots finishing each child arm cleanly. */}
      {children.map((child) => (
        <View
          key={`dot:${child.key}`}
          testID="rail-child-node"
          style={{
            position: "absolute",
            left: armEnd - childDotSize / 2,
            top: child.y - childDotSize / 2,
            width: childDotSize,
            height: childDotSize,
            borderRadius: childDotSize / 2,
            backgroundColor: childDotColor,
          }}
        />
      ))}
    </>
  );
}

export function RelationshipRail({
  rails,
  laneCount = 1,
  activeParentKey = null,
  theme,
}: {
  rails: readonly RailSegment[];
  laneCount?: number;
  activeParentKey?: string | null;
  theme: PluginSidebarViewProps["theme"];
}) {
  if (!rails.length) return null;
  const extra = laneCount * LANE_STEP;
  const elbowEndX = extra + RAIL_ELBOW_INSET;
  // Draw inner (larger lane) non-active rails first so outer arms bridge cleanly over inner trunks,
  // and always draw the active/hovered family last on top.
  const inactive = rails
    .filter((item) => item.parentKey !== activeParentKey)
    .sort((a, b) => b.lane - a.lane || a.parentKey.localeCompare(b.parentKey));
  const active = activeParentKey ? rails.filter((item) => item.parentKey === activeParentKey) : [];
  const ordered = [...inactive, ...active];

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: elbowEndX + 5 }}
    >
      {ordered.map((rail) => {
        const tone: RailTone =
          activeParentKey === null ? "default" : rail.parentKey === activeParentKey ? "active" : "dimmed";
        return (
          <RailItem
            key={rail.parentKey}
            rail={rail}
            allRails={rails}
            tone={tone}
            activeParentKey={activeParentKey}
            elbowEndX={elbowEndX}
            theme={theme}
          />
        );
      })}
    </View>
  );
}
