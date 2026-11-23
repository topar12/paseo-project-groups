const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const React = require("react");
const { act, create } = require("react-test-renderer");
const ts = require("typescript");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const theme = {
  colors: {
    surface0: "#ffffff",
    foregroundMuted: "#666666",
    accent: "#008800",
    statusWarning: "#cc8800",
    statusDanger: "#cc0000",
    statusSuccess: "#00aa00",
    border: "#cccccc",
  },
};
const noop = () => {};

function load(file, modules) {
  const source = readFileSync(path.join(__dirname, "..", "client", file), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  const exports = {};
  vm.runInNewContext(outputText, {
    exports,
    require(name) {
      assert.ok(name in modules, `Unexpected import: ${name}`);
      return modules[name];
    },
  });
  return exports;
}

const model = load("model.ts", {});

test("mostUrgent follows Paseo's order and ignores unknown values", () => {
  assert.equal(model.mostUrgent([]), "done");
  assert.equal(model.mostUrgent(["attention", "running"]), "running");
  assert.equal(model.mostUrgent(["running", "failed", "attention"]), "failed");
  assert.equal(model.mostUrgent(["done", "needs_input", "failed"]), "needs_input");
  assert.equal(model.mostUrgent(["something-new", "attention"]), "attention");
});

test("a later running indicator joins the current rotation and the last one stops it", () => {
  let starts = 0;
  let stops = 0;
  const { RunningSpinner } = load("running-spinner.tsx", {
    react: React,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "react-native": {
      View: "View",
      Easing: { linear: (value) => value },
      Platform: { OS: "ios" },
      Animated: {
        View: "AnimatedView",
        Value: class {
          interpolate() { return { progress: this }; }
          setValue() {}
        },
        timing: (value) => ({ value }),
        loop: () => ({ start() { starts++; }, stop() { stops++; } }),
      },
    },
    "./web": { animateSpinnerOnWeb: () => assert.fail("Native rings should not use browser animations") },
  });
  const list = (ids) => ids.map((id) => React.createElement(RunningSpinner, {
    key: id,
    size: id === "badge" ? 10 : 12,
    color: theme.colors.accent,
  }));
  let renderer;
  act(() => { renderer = create(list(["row"])); });
  try {
    const currentRotation = () => renderer.root.findAllByType("AnimatedView")
      .map((node) => node.props.style[1].transform[0].rotate);
    const [initialRotation] = currentRotation();
    act(() => renderer.update(list(["row", "badge"])));
    const rotations = currentRotation();
    assert.equal(rotations.length, 2);
    assert.equal(rotations[0], initialRotation);
    assert.equal(rotations[1], initialRotation);
    assert.equal(starts, 1);

    act(() => renderer.update(list(["badge"])));
    assert.equal(stops, 0);
    act(() => renderer.update(list([])));
    assert.equal(stops, 1);
    act(() => renderer.update(list(["row"])));
    assert.equal(starts, 2);
  } finally {
    act(() => renderer.unmount());
  }
  assert.equal(stops, 2);
});

test("web rings share the document timeline without starting the native loop", () => {
  const platform = { OS: "web" };
  const web = load("web.ts", { "react-native": { Platform: platform } });
  const { RunningSpinner } = load("running-spinner.tsx", {
    react: React,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "react-native": {
      View: "View",
      Platform: platform,
      Animated: {
        Value: class { interpolate() {} },
        loop: () => assert.fail("Web rings should not start an Animated loop"),
      },
    },
    "./web": web,
  });
  const animations = [];
  const createNodeMock = () => ({
    animate(_keyframes, options) {
      const animation = {
        startTime: null,
        duration: options.duration,
        cancelled: false,
        cancel() { this.cancelled = true; },
      };
      animations.push(animation);
      return animation;
    },
  });
  const list = (ids) => ids.map((id) => React.createElement(RunningSpinner, {
    key: id,
    size: 12,
    color: theme.colors.accent,
  }));
  let renderer;
  act(() => { renderer = create(list(["first"]), { createNodeMock }); });
  try {
    act(() => renderer.update(list(["first", "later"])));
    assert.equal(animations.length, 2);
    assert.equal(animations[0].startTime, 0);
    assert.equal(animations[1].startTime, animations[0].startTime);
    assert.equal(animations[1].duration, animations[0].duration);
    act(() => renderer.update(list(["later"])));
    assert.equal(animations[0].cancelled, true);
    assert.equal(animations[1].cancelled, false);
  } finally {
    act(() => renderer.unmount());
  }
  assert.equal(animations[1].cancelled, true);
});

function render(name, props, { showFoldedStatus, statuses, workspaces = [] }) {
  const queries = [];
  const rows = load("rows.tsx", {
    react: React,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "react-native": { View: "View", Text: "Text", Pressable: "Pressable" },
    "@getpaseo/plugin/client": {
      useProject: (_ref, selector) => selector({ displayName: "Project" }),
      useWorkspaces: (query) => {
        queries.push(query);
        if (!query.groupBy) return workspaces.filter(query.where).map((item) => item.ref);
        return statuses.map((key) => ({ key, title: null, color: null, items: [] }));
      },
    },
    "@getpaseo/plugin/client/ui": { Icon: "Icon", TextInput: "Input" },
    "./i18n": { useT: () => (key) => key },
    "./model": model,
    "./project-icon": { ProjectIcon: "ProjectIcon" },
    "./running-spinner": { RunningSpinner: "RunningSpinner" },
    "./labels": { LabelChip: "LabelChip", labelKey: (name) => name.toLowerCase(), useLabelCatalog: () => ({ labels: null, refresh() {} }) },
    "./look": { useLook: () => ({ icon: 13, showFoldedStatus, showPinned: true }) },
    "./drag": {
      useDrag: () => ({ recentlyDropped: () => false }),
      useDragSlot: () => null,
      useDragHandle: () => ({}),
    },
    "./decor": {
      DecorIcon: "DecorIcon",
      useDecorations: () => ({ get: () => ({ color: null, icon: null }) }),
    },
    "./web": { sidebarNavProps: () => ({}) },
  });
  let renderer;
  act(() => {
    renderer = create(React.createElement(rows[name], props));
  });
  const badges = renderer.root.findAll((node) =>
    String(node.props.accessibilityLabel ?? "").startsWith("status."),
  );
  const slots = renderer.root.findAll(
    (node) =>
      node.type === "View" &&
      !node.props.accessibilityLabel &&
      node.props.style?.width === 12 &&
      node.props.style?.height === 12,
  );
  const fills = renderer.root.findAll(
    (node) => node.type === "View" && node.props.pointerEvents === "none" && node.props.style?.opacity === 0.5,
  );
  return { badges, slots, fills, queries, renderer };
}

function groupHeader({ collapsed, showFoldedStatus, statuses, active = null, workspaces }) {
  const props = {
    group: { id: "group", name: "Work", projects: ["p1"] },
    statusKeys: ["p1", "p1-sub"],
    count: 1,
    collapsed,
    renaming: false,
    dragging: false,
    view: { theme, layout: { compact: true }, active: { workspace: active } },
    onToggle: noop,
    onStartRename: noop,
    onRename: noop,
    onCancelRename: noop,
    onDelete: noop,
  };
  return render("GroupHeader", props, { showFoldedStatus, statuses, workspaces });
}

test("a folded group shows its most urgent status", () => {
  const { badges, queries, renderer } = groupHeader({
    collapsed: true,
    showFoldedStatus: true,
    statuses: ["running", "needs_input"],
  });
  assert.equal(badges.length, 1);
  assert.equal(badges[0].props.accessibilityLabel, "status.needs_input");
  const where = queries[0].where;
  const workspace = { project: { key: "p1" }, pinnedAt: null, background: false, archivingAt: null };
  assert.equal(where(workspace), true);
  assert.equal(where({ ...workspace, project: { key: "other" } }), false);
  assert.equal(where({ ...workspace, project: { key: "p1-sub" } }), true, "sub-projects roll up");
  assert.equal(where({ ...workspace, background: true }), false);
  act(() => renderer.unmount());
});

test("an open group, or the setting off, shows no badge", () => {
  for (const options of [
    { collapsed: false, showFoldedStatus: true },
    { collapsed: true, showFoldedStatus: false },
  ]) {
    const { badges, queries, renderer } = groupHeader({ ...options, statuses: [] });
    assert.equal(badges.length, 0);
    assert.equal(queries[0].where({ project: { key: "p1" } }), false);
    act(() => renderer.unmount());
  }
});

test("all done shows no badge", () => {
  const { badges, renderer } = groupHeader({ collapsed: true, showFoldedStatus: true, statuses: ["done"] });
  assert.equal(badges.length, 0);
  act(() => renderer.unmount());
});

test("a row without an icon keeps the badge slot while the setting is on", () => {
  for (const collapsed of [false, true]) {
    const { slots, renderer } = groupHeader({ collapsed, showFoldedStatus: true, statuses: [] });
    assert.equal(slots.length, 1, "the name must not move when an agent starts or stops");
    act(() => renderer.unmount());
  }
  const { slots, renderer } = groupHeader({ collapsed: true, showFoldedStatus: false, statuses: [] });
  assert.equal(slots.length, 0);
  act(() => renderer.unmount());
});

test("the folded Ungrouped section shows the status of projects in no group", () => {
  const props = {
    projects: ["p1"],
    count: 1,
    collapsed: true,
    view: { theme, layout: { compact: true }, active: { workspace: null } },
    onToggle: noop,
  };
  const { badges, slots, queries, renderer } = render("UngroupedHeader", props, {
    showFoldedStatus: true,
    statuses: ["attention", "failed"],
  });
  assert.equal(badges.length, 1);
  assert.equal(badges[0].props.accessibilityLabel, "status.failed");
  assert.equal(slots.length, 1);
  const workspace = { project: { key: "p1" }, pinnedAt: null, background: false, archivingAt: null };
  assert.equal(queries[0].where(workspace), true);
  assert.equal(queries[0].where({ ...workspace, project: { key: "p2" } }), false);
  act(() => renderer.unmount());
});

test("a folded project rolls up the status of its sub-projects", () => {
  const props = {
    reference: { key: "p1", id: "one", hostId: "host" },
    groupId: null,
    nested: false,
    subProjects: ["p1-sub"],
    collapsed: true,
    dragging: false,
    view: { theme, layout: { compact: true }, active: { workspace: null }, navigation: {} },
    onToggle: noop,
    onMenu: noop,
    renderWorkspace: noop,
  };
  const { badges, queries, renderer } = render("ProjectBlock", props, {
    showFoldedStatus: true,
    statuses: ["needs_input"],
  });
  assert.equal(badges.length, 1);
  const workspace = { project: { key: "p1-sub" }, pinnedAt: null, background: false, archivingAt: null };
  const folded = queries[1].where;
  assert.equal(folded(workspace), true);
  assert.equal(folded({ ...workspace, project: { key: "p2" } }), false);
  assert.equal(queries[0].where(workspace), false, "the workspace list stays the project's own");
  act(() => renderer.unmount());
});

const listed = { pinnedAt: null, background: false, archivingAt: null };
const openSub = { ...listed, ref: { key: "w1" }, project: { key: "p1-sub" } };

test("a folded group holding the open workspace gets a soft fill, setting on or off", () => {
  for (const showFoldedStatus of [true, false]) {
    const { fills, renderer } = groupHeader({
      collapsed: true,
      showFoldedStatus,
      statuses: [],
      active: { key: "w1" },
      workspaces: [openSub],
    });
    assert.equal(fills.length, 1);
    act(() => renderer.unmount());
  }
});

test("no fill when the group is open or the open workspace is elsewhere", () => {
  for (const options of [
    { collapsed: false, active: { key: "w1" } },
    { collapsed: true, active: { key: "other" } },
    { collapsed: true, active: null },
  ]) {
    const { fills, renderer } = groupHeader({
      ...options,
      showFoldedStatus: true,
      statuses: [],
      workspaces: [openSub, { ...openSub, ref: { key: "w2" }, project: { key: "p9" } }],
    });
    assert.equal(fills.length, 0, JSON.stringify(options));
    act(() => renderer.unmount());
  }
});

test("a folded project holding the open workspace in a sub-project gets the fill", () => {
  const props = {
    reference: { key: "p1", id: "one", hostId: "host" },
    groupId: null,
    nested: false,
    subProjects: ["p1-sub"],
    collapsed: true,
    dragging: false,
    view: { theme, layout: { compact: true }, active: { workspace: { key: "w1" } }, navigation: {} },
    onToggle: noop,
    onMenu: noop,
    renderWorkspace: noop,
  };
  const { fills, renderer } = render("ProjectBlock", props, {
    showFoldedStatus: true,
    statuses: [],
    workspaces: [openSub],
  });
  assert.equal(fills.length, 1);
  act(() => renderer.unmount());
});

// The model runs in its own VM context; compare plain copies of its objects.
const plain = (value) => JSON.parse(JSON.stringify(value));

test("subProjects keeps one level and ignores links to missing projects", () => {
  const order = ["a", "b", "c", "d", "e"];
  const tree = model.subProjects(order, { b: "a", c: "a", d: "b", e: "gone" });
  assert.deepEqual(plain([...tree.entries()]), [["a", ["b", "c"]]]);
});

test("nestProject takes the project out of its group and refuses deeper nesting", () => {
  const groups = [{ id: "g", name: "G", projects: ["a", "b"] }];
  const placed = model.nestProject(groups, {}, "b", "a");
  assert.deepEqual(plain(placed), { groups: [{ id: "g", name: "G", projects: ["a"] }], parents: { b: "a" } });
  assert.equal(model.nestProject(placed.groups, placed.parents, "b", "a"), null, "already there");
  assert.equal(model.nestProject(groups, {}, "a", "a"), null, "not under itself");
  assert.equal(model.nestProject(groups, { b: "a" }, "c", "b"), null, "parent is a sub-project");
  assert.equal(model.nestProject(groups, { b: "a" }, "a", "c"), null, "project has sub-projects");
});

test("placeProject pulls a sub-project out to a group or Ungrouped", () => {
  const groups = [{ id: "g", name: "G", projects: ["a"] }];
  assert.deepEqual(plain(model.placeProject(groups, { b: "a" }, "b", { kind: "into-group", groupId: "g" })), {
    groups: [{ id: "g", name: "G", projects: ["a", "b"] }],
    parents: {},
  });
  assert.deepEqual(plain(model.placeProject(groups, { b: "a" }, "b", { kind: "ungroup" })), { groups, parents: {} });
  assert.equal(model.placeProject(groups, {}, "b", { kind: "ungroup" }), null);
  const after = model.placeProject([{ id: "g", name: "G", projects: ["a", "c"] }], { b: "a" }, "b", {
    kind: "project-after",
    groupId: "g",
    projectKey: "a",
  });
  assert.deepEqual(plain(after), { groups: [{ id: "g", name: "G", projects: ["a", "b", "c"] }], parents: {} });
});

const layoutOf = (groups, parents, order) => {
  const layout = model.sidebarLayout(groups, parents, order);
  return plain({
    groups: Object.fromEntries(layout.groups),
    ungrouped: layout.ungrouped,
    children: Object.fromEntries(layout.children),
    missingParents: layout.missingParents,
  });
};

test("a sub-project shows under its parent and nowhere else", () => {
  const groups = [{ id: "g", name: "G", projects: ["a", "c"] }];
  assert.deepEqual(layoutOf(groups, { b: "a" }, ["a", "b", "c", "d"]), {
    groups: { g: ["a", "c"] },
    ungrouped: ["d"],
    children: { a: ["b"] },
    missingParents: [],
  });
});

test("while the parent is missing, the sub-project shows where the parent was and keeps its link", () => {
  const groups = [{ id: "g", name: "G", projects: ["a", "c"] }];
  // "a" is still loading: its sub-project stands in its place in the group, not in Ungrouped.
  assert.deepEqual(layoutOf(groups, { b: "a" }, ["b", "c"]), {
    groups: { g: ["b", "c"] },
    ungrouped: [],
    children: {},
    missingParents: ["a"],
  });
  // "a" loads again: "b" is back under it, nothing was saved in between.
  assert.deepEqual(layoutOf(groups, { b: "a" }, ["a", "b", "c"]).children, { a: ["b"] });
  // A missing parent that was in no group leaves its sub-project in Ungrouped.
  assert.deepEqual(layoutOf([], { b: "a" }, ["b"]).ungrouped, ["b"]);
});

test("saving a group change while a parent is missing keeps the link and the parent's place", () => {
  const groups = [{ id: "g", name: "G", projects: ["a", "c"] }];
  const moved = model.placeProject(groups, { b: "a" }, "c", { kind: "project-before", groupId: "g", projectKey: "a" });
  assert.deepEqual(plain(moved), { groups: [{ id: "g", name: "G", projects: ["c", "a"] }], parents: { b: "a" } });
});

test("removing a parent puts its sub-projects in its place and deletes the links", () => {
  const groups = [{ id: "g", name: "G", projects: ["x", "a", "y"] }];
  const order = ["a", "b", "c", "x", "y"];
  assert.deepEqual(plain(model.dropProjects(groups, { c: "a", b: "a", z: "q" }, ["a"], order)), {
    groups: [{ id: "g", name: "G", projects: ["x", "b", "c", "y"] }],
    parents: { z: "q" },
  });
  // A parent in no group: its sub-projects go to Ungrouped.
  assert.deepEqual(plain(model.dropProjects([], { b: "a" }, ["a"], order)), { groups: [], parents: {} });
  // Removing a sub-project only drops its own link.
  assert.deepEqual(plain(model.dropProjects(groups, { b: "a" }, ["b"], order)), { groups, parents: {} });
  assert.equal(model.dropProjects(groups, { b: "a" }, ["nothing"], order), null);
});

test("project keys split into host and project ids", () => {
  assert.deepEqual(plain(model.parseProjectKey('["srv_1","prj_2"]')), { hostId: "srv_1", projectId: "prj_2" });
  assert.equal(model.parseProjectKey("prj_2"), null);
  assert.equal(model.parseProjectKey('["srv_1"]'), null);
});

test("sectionOf finds a sub-project's section through its parent", () => {
  const layout = model.sidebarLayout([{ id: "g", name: "G", projects: ["a"] }], { b: "a" }, ["a", "b", "d"]);
  assert.equal(model.sectionOf(layout, "b"), "g");
  assert.equal(model.sectionOf(layout, "d"), null);
  assert.equal(model.sectionOf(layout, "zzz"), undefined);
});


test("project settings path matches the app's route", () => {
  assert.equal(
    model.projectSettingsPath({ hostId: "srv_a b", id: "prj/1" }),
    "/settings/hosts/srv_a%20b/projects/prj%2F1",
  );
});

test("time sorts put the newest workspace first", () => {
  const item = (key, createdAt, lastPromptAt = null) => ({ ref: { key }, createdAt, lastPromptAt });
  const a = item("a", "2026-11-01T00:00:00Z", "2026-11-10T00:00:00Z");
  const b = item("b", "2026-11-05T00:00:00Z");
  const c = item("c", null);
  const keys = (sort) => [c, a, b].sort(model.compareWorkspaceTimes(sort)).map((w) => w.ref.key);
  assert.deepEqual(keys("created"), ["b", "a", "c"]);
  // Last prompt falls back to creation time.
  assert.deepEqual(keys("lastPrompt"), ["a", "b", "c"]);
});

test("compact ages match the app's", () => {
  const now = Date.parse("2026-11-19T12:00:00Z");
  const ago = (ms) => model.compactTimeAgo(new Date(now - ms).toISOString(), now);
  assert.equal(ago(20_000), "now");
  assert.equal(ago(5 * 60_000), "5m");
  assert.equal(ago(2 * 3_600_000), "2h");
  assert.equal(ago(3 * 86_400_000), "3d");
  assert.equal(model.compactTimeAgo("not a date", now), "");
});

test("workspace title drops vertical flex and keeps status dot and running ring centered across text sizes", () => {
  const flatten = (style) => (Array.isArray(style) ? Object.assign({}, ...style.map(flatten)) : (style ?? {}));
  const lookModule = load("look.tsx", {
    react: React,
    "../shared/settings": {
      appearanceDocument: { schema: { parse: () => ({ textSize: 12, density: "comfortable", indent: "normal", groupSpacing: "small", boldGroupNames: true, showProjectIcons: true, showHostTags: true, showStatusDots: true, showFoldedStatus: true, showDiffStats: true, showBranch: false, showLabels: true, showPinned: true, workspaceSort: "name", workspaceTitle: "title", showBackground: false, language: "auto" }) } },
    },
  });
  for (const textSize of [11, 12, 15]) {
    const look = lookModule.lookFrom({
      textSize, density: "comfortable", indent: "normal", groupSpacing: "small",
      boldGroupNames: true, showProjectIcons: true, showHostTags: true, showStatusDots: true,
      showFoldedStatus: true, showDiffStats: true, showBranch: false, showLabels: true,
      showPinned: true, workspaceSort: "name", workspaceTitle: "title", showBackground: false, language: "auto",
    });
    for (const indicator of ["running", "attention"]) {
      const rows = load("rows.tsx", {
        react: React,
        "react/jsx-runtime": require("react/jsx-runtime"),
        "react-native": { View: "View", Text: "Text", Pressable: "Pressable" },
        "@getpaseo/plugin/client": {
          useWorkspace: (_ref, selector) => selector({
            title: "Codeg 内存修复", name: "Codeg 内存修复", branch: null, indicator,
            indicatorLabel: null, diffStat: null, labels: [], statusEnteredAt: null,
          }),
        },
        "@getpaseo/plugin/client/ui": { Icon: "Icon", TextInput: "Input" },
        "./i18n": { useT: () => (key) => key },
        "./model": model,
        "./project-icon": { ProjectIcon: "ProjectIcon" },
        "./running-spinner": { RunningSpinner: "RunningSpinner" },
        "./web": { sidebarNavProps: () => ({}) },
        "./labels": { LabelChip: "LabelChip", labelKey: (name) => name.toLowerCase(), useLabelCatalog: () => ({ labels: null, refresh() {} }) },
        "./look": { useLook: () => look },
        "./drag": { useDrag: () => ({ recentlyDropped: () => false }), useDragSlot: () => null, useDragHandle: () => ({}) },
        "./decor": { DecorIcon: "DecorIcon", useDecorations: () => ({ get: () => ({ color: null, icon: null }) }) },
      });
      let renderer;
      act(() => {
        renderer = create(React.createElement(rows.WorkspaceRow, {
          reference: { key: "h:w1", id: "w1", hostId: "h" },
          indent: 36,
          view: { theme, layout: { compact: true, platform: "ios" }, active: { workspace: null }, navigation: { openWorkspace: noop } },
          onMenu: noop,
        }));
      });
      const titleNode = renderer.root.find((n) => n.type === "Text" && n.props.children === "Codeg 内存修复");
      const titleStyle = flatten(titleNode.props.style);
      assert.equal(titleStyle.flex, undefined, `title at ${textSize}pt must not set vertical flex inside column View`);
      assert.equal(titleStyle.lineHeight, look.line);
      const dotSlot = renderer.root.find((n) =>
        n.type === "View" && n.props.pointerEvents === "none" && n.props.style?.width === 12 && n.props.style?.height === 12,
      );
      assert.equal(dotSlot.props.style.transform, undefined, "running ring and static dot share centered slot with no fixed translateY");
      act(() => renderer.unmount());
    }
  }
});

test("relationship lines are on by default, and old saved settings keep them on", () => {
  const settings = load("../shared/settings.ts", {
    "@getpaseo/plugin": { defineSettings: (definition) => definition },
    zod: require("zod"),
  });
  const look = load("look.tsx", { react: React, "../shared/settings": settings });
  // A device that saved its appearance before this setting existed has no `showRelations` key.
  const saved = settings.appearanceDocument.schema.parse({ textSize: 13, showPinned: false });
  assert.equal(saved.showRelations, true);
  assert.equal(look.lookFrom(saved).showRelations, true);
  const off = settings.appearanceDocument.schema.parse({ showRelations: false });
  assert.equal(look.lookFrom(off).showRelations, false);
});
