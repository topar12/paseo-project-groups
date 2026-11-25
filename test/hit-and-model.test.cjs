const assert = require("node:assert/strict");
const { test } = require("node:test");
const React = require("react");
const { act, create } = require("react-test-renderer");
const { createLoader, makeHarness, noopDrag, plain, ref, textOf, theme } = require("./helpers/loader.cjs");

const load = createLoader();
const hit = load("client/hit.ts");
const model = load("client/model.ts");

// --- client/hit.ts ---

const projectSlots = [
  { slot: { kind: "group", groupId: "g1" }, y: 0, height: 30 },
  { slot: { kind: "project", projectKey: '["host-a","p1"]', groupId: "g1" }, y: 30, height: 40 },
  { slot: { kind: "project", projectKey: '["host-a","p2"]', groupId: "g1" }, y: 70, height: 40 },
  { slot: { kind: "group", groupId: "g2" }, y: 120, height: 30 },
  { slot: { kind: "empty", groupId: "g2" }, y: 150, height: 28 },
  { slot: { kind: "ungrouped", hostId: "host-a" }, y: 190, height: 30 },
  { slot: { kind: "project", projectKey: '["host-a","p3"]', groupId: null }, y: 220, height: 40 },
  { slot: { kind: "ungrouped", hostId: "host-b" }, y: 270, height: 30 },
  { slot: { kind: "project", projectKey: '["host-b","p4"]', groupId: null }, y: 300, height: 40 },
];

test("hitTest for projects handles before/after midpoint and ignores drops on itself", () => {
  const dragged = { kind: "project", key: '["host-a","p1"]', label: "P1" };
  // Empty slot list yields null.
  assert.equal(hit.hitTest(dragged, [], 50), null);
  // Drop on itself yields null.
  assert.equal(hit.hitTest(dragged, projectSlots, 45), null);
  // Unsorted slot order still resolves before/after midpoint on p2 (y: 70..110, midpoint 90).
  const reversed = [...projectSlots].reverse();
  assert.deepEqual(plain(hit.hitTest(dragged, reversed, 80)), {
    target: { kind: "project-before", groupId: "g1", projectKey: '["host-a","p2"]' },
    indicator: { kind: "line", y: 70 },
  });
  assert.deepEqual(plain(hit.hitTest(dragged, reversed, 90)), {
    target: { kind: "project-after", groupId: "g1", projectKey: '["host-a","p2"]' },
    indicator: { kind: "line", y: 110 },
  });
  assert.deepEqual(plain(hit.hitTest(dragged, reversed, 105)), {
    target: { kind: "project-after", groupId: "g1", projectKey: '["host-a","p2"]' },
    indicator: { kind: "line", y: 110 },
  });
});

test("hitTest for projects targets group headers, empty groups, and Ungrouped", () => {
  const dragged = { kind: "project", key: '["host-a","p1"]', label: "P1" };
  assert.deepEqual(plain(hit.hitTest(dragged, projectSlots, 125)), {
    target: { kind: "into-group", groupId: "g2" },
    indicator: { kind: "box", y: 120, height: 30 },
  });
  assert.deepEqual(plain(hit.hitTest(dragged, projectSlots, 160)), {
    target: { kind: "into-group", groupId: "g2" },
    indicator: { kind: "box", y: 150, height: 28 },
  });
  assert.deepEqual(plain(hit.hitTest(dragged, projectSlots, 200)), {
    target: { kind: "ungroup" },
    indicator: { kind: "box", y: 190, height: 30 },
  });
});

test("hitTest highlights a project's own host Ungrouped header across multiple hosts", () => {
  // Dragging a host-b project onto host-a's Ungrouped header or an ungrouped project boxes host-b's header.
  const hostBProject = { kind: "project", key: '["host-b","p9"]', label: "P9" };
  assert.deepEqual(plain(hit.hitTest(hostBProject, projectSlots, 200)), {
    target: { kind: "ungroup" },
    indicator: { kind: "box", y: 270, height: 30 },
  });
  assert.deepEqual(plain(hit.hitTest(hostBProject, projectSlots, 235)), {
    target: { kind: "ungroup" },
    indicator: { kind: "box", y: 270, height: 30 },
  });
  // A project from an unlisted host falls back to the first Ungrouped header.
  const otherHost = { kind: "project", key: '["host-c","p0"]', label: "P0" };
  assert.deepEqual(plain(hit.hitTest(otherHost, projectSlots, 280)), {
    target: { kind: "ungroup" },
    indicator: { kind: "box", y: 190, height: 30 },
  });
});

test("hitTest for groups reorders across spans and returns null on no-op adjacent slots", () => {
  const slots = [
    { slot: { kind: "group", groupId: "g1" }, y: 0, height: 30 },
    { slot: { kind: "project", projectKey: "p1", groupId: "g1" }, y: 30, height: 70 },
    { slot: { kind: "group", groupId: "g2" }, y: 100, height: 30 },
    { slot: { kind: "project", projectKey: "p2", groupId: "g2" }, y: 130, height: 70 },
    { slot: { kind: "group", groupId: "g3" }, y: 200, height: 30 },
    { slot: { kind: "ungrouped" }, y: 300, height: 30 },
  ];
  // Group spans: g1=[0..100] mid 50, g2=[100..200] mid 150, g3=[200..300] mid 250.
  const g1 = { kind: "group", id: "g1", label: "G1" };
  const g3 = { kind: "group", id: "g3", label: "G3" };
  // Dropping g1 at index 0 (y=20) or index 1 (y=120) is a no-op.
  assert.equal(hit.hitTest(g1, slots, 20), null);
  assert.equal(hit.hitTest(g1, slots, 120), null);
  // Past g2's midpoint -> before g3 (index 2, line at 200).
  assert.deepEqual(plain(hit.hitTest(g1, slots, 180)), {
    target: { kind: "group-at", index: 2 },
    indicator: { kind: "line", y: 200 },
  });
  // Past g3's midpoint -> at end (index 3, line at ungrouped.y = 300).
  assert.deepEqual(plain(hit.hitTest(g1, slots, 280)), {
    target: { kind: "group-at", index: 3 },
    indicator: { kind: "line", y: 300 },
  });
  // Dragging g3 above g1's midpoint -> index 0 (line at 0).
  assert.deepEqual(plain(hit.hitTest(g3, slots, 10)), {
    target: { kind: "group-at", index: 0 },
    indicator: { kind: "line", y: 0 },
  });
  // Unknown group id returns null.
  assert.equal(hit.hitTest({ kind: "group", id: "missing", label: "?" }, slots, 10), null);
});

test("sameHit compares hits by target and indicator value", () => {
  const a = { target: { kind: "into-group", groupId: "g1" }, indicator: { kind: "box", y: 10, height: 30 } };
  const b = { target: { kind: "into-group", groupId: "g1" }, indicator: { kind: "box", y: 10, height: 30 } };
  const c = { target: { kind: "into-group", groupId: "g2" }, indicator: { kind: "box", y: 10, height: 30 } };
  const d = { target: { kind: "into-group", groupId: "g1" }, indicator: { kind: "box", y: 20, height: 30 } };
  assert.equal(hit.sameHit(null, null), true);
  assert.equal(hit.sameHit(a, null), false);
  assert.equal(hit.sameHit(null, a), false);
  assert.equal(hit.sameHit(a, a), true);
  assert.equal(hit.sameHit(a, b), true);
  assert.equal(hit.sameHit(a, c), false);
  assert.equal(hit.sameHit(a, d), false);
});

// --- client/model.ts ---

test("addGroup prepends a new empty group without mutating the input", () => {
  const existing = [{ id: "g1", name: "Work", projects: ["p1"] }];
  const added = model.addGroup(existing, "Personal");
  assert.equal(existing.length, 1);
  assert.equal(added.groups.length, 2);
  assert.equal(added.groups[0].id, added.id);
  assert.equal(added.groups[0].name, "Personal");
  assert.deepEqual(plain(added.groups[0].projects), []);
  assert.equal(added.groups[1].id, "g1");
});

test("renameGroup trims names, rejects empty or unchanged names, and allows duplicates across groups", () => {
  const groups = [
    { id: "g1", name: "Work", projects: ["p1"] },
    { id: "g2", name: "Side", projects: [] },
  ];
  assert.deepEqual(plain(model.renameGroup(groups, "g1", "  Core  ")), [
    { id: "g1", name: "Core", projects: ["p1"] },
    { id: "g2", name: "Side", projects: [] },
  ]);
  assert.equal(model.renameGroup(groups, "g1", "   "), null, "empty after trim");
  assert.equal(model.renameGroup(groups, "g1", " Work "), null, "unchanged after trim");
  assert.equal(model.renameGroup(groups, "missing", "New"), null, "unknown id");
  // Renaming another group to an existing group's name is allowed because groups are keyed by id.
  assert.deepEqual(plain(model.renameGroup(groups, "g2", "Work")), [
    { id: "g1", name: "Work", projects: ["p1"] },
    { id: "g2", name: "Work", projects: [] },
  ]);
});

test("removeGroup removes only the named group", () => {
  const groups = [
    { id: "g1", name: "Work", projects: ["p1"] },
    { id: "g2", name: "Side", projects: ["p2"] },
  ];
  assert.deepEqual(plain(model.removeGroup(groups, "g1")), [{ id: "g2", name: "Side", projects: ["p2"] }]);
  assert.deepEqual(plain(model.removeGroup(groups, "missing")), groups);
});

test("nextGroupName picks the first unused numbered name", () => {
  const fmt = (n) => `Group ${n}`;
  assert.equal(model.nextGroupName([], fmt), "Group 1");
  assert.equal(model.nextGroupName([{ id: "g1", name: "Work", projects: [] }], fmt), "Group 2");
  assert.equal(
    model.nextGroupName(
      [
        { id: "g1", name: "Group 2", projects: [] },
        { id: "g2", name: "Group 3", projects: [] },
      ],
      fmt,
    ),
    "Group 4",
  );
});

test("moveProject reorders within a group, moves across groups, ungroups, and returns null on no-ops", () => {
  const groups = [
    { id: "g1", name: "Work", projects: ["a", "b", "c"] },
    { id: "g2", name: "Side", projects: ["d"] },
  ];
  assert.deepEqual(
    plain(model.moveProject(groups, "c", { kind: "project-before", groupId: "g1", projectKey: "a" })),
    [
      { id: "g1", name: "Work", projects: ["c", "a", "b"] },
      { id: "g2", name: "Side", projects: ["d"] },
    ],
  );
  assert.deepEqual(
    plain(model.moveProject(groups, "a", { kind: "project-after", groupId: "g2", projectKey: "d" })),
    [
      { id: "g1", name: "Work", projects: ["b", "c"] },
      { id: "g2", name: "Side", projects: ["d", "a"] },
    ],
  );
  assert.deepEqual(plain(model.moveProject(groups, "u1", { kind: "into-group", groupId: "g2" })), [
    { id: "g1", name: "Work", projects: ["a", "b", "c"] },
    { id: "g2", name: "Side", projects: ["d", "u1"] },
  ]);
  assert.deepEqual(plain(model.moveProject(groups, "b", { kind: "ungroup" })), [
    { id: "g1", name: "Work", projects: ["a", "c"] },
    { id: "g2", name: "Side", projects: ["d"] },
  ]);
  // No-ops return null.
  assert.equal(model.moveProject(groups, "u1", { kind: "ungroup" }), null, "already ungrouped");
  assert.equal(model.moveProject(groups, "a", { kind: "project-before", groupId: "g1", projectKey: "b" }), null);
  assert.equal(model.moveProject(groups, "a", { kind: "project-before", groupId: "g1", projectKey: "a" }), null);
  assert.equal(model.moveProject(groups, "c", { kind: "into-group", groupId: "g1" }), null, "already last");
  assert.equal(model.moveProject(groups, "a", { kind: "into-group", groupId: "missing" }), null);
  assert.equal(model.moveProject(groups, "a", { kind: "group-at", index: 0 }), null);
});

test("moveGroup reorders forward and backward and ignores adjacent no-op slots", () => {
  const groups = [
    { id: "g1", name: "One", projects: [] },
    { id: "g2", name: "Two", projects: [] },
    { id: "g3", name: "Three", projects: [] },
  ];
  assert.deepEqual(
    plain(model.moveGroup(groups, "g1", 3).map((g) => g.id)),
    ["g2", "g3", "g1"],
  );
  assert.deepEqual(
    plain(model.moveGroup(groups, "g3", 0).map((g) => g.id)),
    ["g3", "g1", "g2"],
  );
  assert.equal(model.moveGroup(groups, "g2", 1), null, "same index");
  assert.equal(model.moveGroup(groups, "g2", 2), null, "immediately after self");
  assert.equal(model.moveGroup(groups, "missing", 0), null, "unknown id");
});

// --- Regressions R8 & R19 ---

test("R8: picking a project's current group in its menu does not move it to the end", async (t) => {
  const p1 = ref("project", "host-a", "p1");
  const p2 = ref("project", "host-a", "p2");
  const pSub = ref("project", "host-a", "p-sub");
  const harness = makeHarness({
    locale: "en",
    projects: [
      { ref: p1, hostId: "host-a", displayName: "Alpha", rootPath: "/alpha", iconRevision: null },
      { ref: p2, hostId: "host-a", displayName: "Beta", rootPath: "/beta", iconRevision: null },
      { ref: pSub, hostId: "host-a", displayName: "Sub", rootPath: "/sub", iconRevision: null },
    ],
    groups: [
      { id: "g1", name: "Work", projects: [p1.key, p2.key] },
      { id: "g2", name: "Side", projects: [] },
    ],
    parents: { [pSub.key]: p1.key },
  });
  const renderer = harness.mount();
  t.after(() => harness.unmount());

  // Open Alpha's project menu and pick its current group ("Work") — must be a no-op, not move Alpha after Beta.
  const openMenu = (name) =>
    renderer.root.findByProps({ accessibilityLabel: `Actions for ${name}`, accessibilityRole: "button" });
  const press = (node) =>
    act(async () => {
      node.props.onPress();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  await press(openMenu("Alpha"));
  const workOption = renderer.root.findByProps({ accessibilityLabel: "Work", accessibilityRole: "button" });
  assert.equal(workOption.props.accessibilityState.selected, true);
  await press(workOption);
  assert.equal(harness.savedGroups.length, 0, "picking the current group must not save or reorder");

  // Picking a different group ("Side") moves Alpha there.
  await press(openMenu("Alpha"));
  await press(renderer.root.findByProps({ accessibilityLabel: "Side", accessibilityRole: "button" }));
  assert.equal(harness.savedGroups.length, 1);
  assert.deepEqual(harness.savedGroups[0].groups.find((g) => g.id === "g2").projects, [p1.key]);

  // Picking a group for a sub-project ("Sub") unnests it into that group even though its parent was there.
  await press(openMenu("Sub"));
  await press(renderer.root.findByProps({ accessibilityLabel: "Work", accessibilityRole: "button" }));
  assert.equal(harness.savedGroups.length, 2);
  assert.equal(harness.savedGroups[1].parents[pSub.key], undefined);
  assert.ok(harness.savedGroups[1].groups.find((g) => g.id === "g1").projects.includes(pSub.key));
});

test("R19: a folded project's count includes its sub-projects", (t) => {
  const noop = () => {};
  const listed = { pinnedAt: null, background: false, archivingAt: null };
  const makeProjectBlock = ({ workspaces, subProjects, collapsed }) => {
    const loader = createLoader({
      "@getpaseo/plugin/client": {
        useProject: (_ref, selector) => selector({ displayName: "Parent", iconRevision: null }),
        useWorkspaces: (query) => {
          if (query.groupBy) return [];
          return workspaces.filter(query.where).map((item) => item.ref);
        },
      },
    });
    const { ProjectBlock } = loader("client/rows.tsx");
    const { DragProvider } = loader("client/drag.tsx");
    let renderer;
    act(() => {
      renderer = create(
        React.createElement(
          DragProvider,
          { value: noopDrag },
          React.createElement(ProjectBlock, {
            reference: { key: "host:p1", id: "p1", hostId: "host" },
            groupId: "g1",
            nested: false,
            subProjects,
            collapsed,
            dragging: false,
            view: {
              theme,
              layout: { compact: false, platform: "web" },
              active: { workspace: null },
              navigation: { openProject: noop },
            },
            onToggle: noop,
            onMenu: noop,
            renderWorkspace: () => null,
          }),
        ),
      );
    });
    t.after(() => act(() => renderer.unmount()));
    return renderer;
  };

  // 3 workspaces + 2 sub-projects folded -> count shows "5".
  const folded = makeProjectBlock({
    workspaces: [
      { ...listed, ref: { key: "w1" }, project: { key: "host:p1" } },
      { ...listed, ref: { key: "w2" }, project: { key: "host:p1" } },
      { ...listed, ref: { key: "w3" }, project: { key: "host:p1" } },
    ],
    subProjects: ["host:sub1", "host:sub2"],
    collapsed: true,
  });
  assert.ok(
    folded.root.findAllByType("Text").some((node) => textOf(node) === "5"),
    "folded project count must equal workspaces (3) + sub-projects (2) = 5",
  );

  // 0 workspaces + 2 sub-projects folded -> still shows "2".
  const subsOnly = makeProjectBlock({
    workspaces: [],
    subProjects: ["host:sub1", "host:sub2"],
    collapsed: true,
  });
  assert.ok(
    subsOnly.root.findAllByType("Text").some((node) => textOf(node) === "2"),
    "folded project with only sub-projects still shows their count",
  );

  // Open project hides the folded count.
  const open = makeProjectBlock({
    workspaces: [{ ...listed, ref: { key: "w1" }, project: { key: "host:p1" } }],
    subProjects: ["host:sub1"],
    collapsed: false,
  });
  assert.equal(
    open.root.findAllByType("Text").some((node) => textOf(node) === "2"),
    false,
    "expanded project hides the folded count",
  );
});
