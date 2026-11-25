const assert = require("node:assert/strict");
const { test } = require("node:test");
const { act } = require("react-test-renderer");
const { makeHarness, ref, textOf, theme } = require("./helpers/loader.cjs");

/**
 * One shared fixture mounted in both By project and By relation modes:
 * - Two projects ("Alpha" and "Beta") in one group.
 * - Four workspaces with distinct name / createdAt / lastPromptAt orders so every sort mode
 *   produces a different ordering, plus a parent/child family spanning both projects,
 *   mixed statuses (done, attention/finished-unread, running), labels, and branches.
 */
function parityFixture() {
  const pAlpha = ref("project", "host-a", "prj-alpha");
  const pBeta = ref("project", "host-a", "prj-beta");

  const wZeta = ref("workspace", "host-a", "w-zeta");
  const wAlpha = ref("workspace", "host-a", "w-alpha");
  const wMid = ref("workspace", "host-a", "w-mid");
  const wBeta = ref("workspace", "host-a", "w-beta");

  const aZeta = ref("agent", "host-a", "a-zeta");
  const aAlpha = ref("agent", "host-a", "a-alpha");
  const aMid = ref("agent", "host-a", "a-mid");
  const aBeta = ref("agent", "host-a", "a-beta");

  const projects = [
    { ref: pAlpha, hostId: "host-a", displayName: "Alpha", rootPath: "/alpha", iconRevision: null },
    { ref: pBeta, hostId: "host-a", displayName: "Beta", rootPath: "/beta", iconRevision: null },
  ];

  // Orders inside Alpha:
  //   name:       Alpha task, Mid task, Zeta task
  //   created:    Mid task (Jan 4), Alpha task (Jan 3), Zeta task (Jan 1)
  //   lastPrompt: Zeta task (Jan 5), Mid task (Jan 3), Alpha task (Jan 2)
  // Orders across By relation roots (Zeta, Mid) and Zeta's children (Alpha, Beta):
  //   name:       roots [Mid, Zeta], children [Alpha, Beta]
  //   created:    roots [Mid (Jan 4), Zeta (Jan 1)], children [Alpha (Jan 3), Beta (Jan 2)]
  //   lastPrompt: roots [Zeta (Jan 5), Mid (Jan 3)], children [Beta (Jan 4), Alpha (Jan 2)]
  const workspaces = [
    {
      ref: wZeta, hostId: "host-a", project: pAlpha, pinnedAt: null, labels: ["urgent"], background: false,
      branch: "feat/zeta-branch", createdAt: "2026-01-01T10:00:00Z", lastPromptAt: "2026-01-05T10:00:00Z",
      parentAgent: null, indicator: "done", indicatorLabel: null, id: "w-zeta", projectId: "prj-alpha",
      projectDisplayName: "Alpha", name: "Zeta task", title: "Zeta task", status: "done",
      statusEnteredAt: null, archivingAt: null, diffStat: null,
    },
    {
      ref: wAlpha, hostId: "host-a", project: pAlpha, pinnedAt: null, labels: ["backend"], background: false,
      branch: "fix/alpha-branch", createdAt: "2026-01-03T10:00:00Z", lastPromptAt: "2026-01-02T10:00:00Z",
      parentAgent: aZeta, indicator: "attention", indicatorLabel: null, id: "w-alpha", projectId: "prj-alpha",
      projectDisplayName: "Alpha", name: "Alpha task", title: "Alpha task", status: "attention",
      statusEnteredAt: null, archivingAt: null, diffStat: null,
    },
    {
      ref: wMid, hostId: "host-a", project: pAlpha, pinnedAt: null, labels: ["frontend"], background: false,
      branch: "chore/mid-branch", createdAt: "2026-01-04T10:00:00Z", lastPromptAt: "2026-01-03T10:00:00Z",
      parentAgent: null, indicator: "running", indicatorLabel: null, id: "w-mid", projectId: "prj-alpha",
      projectDisplayName: "Alpha", name: "Mid task", title: "Mid task", status: "running",
      statusEnteredAt: null, archivingAt: null, diffStat: null,
    },
    {
      ref: wBeta, hostId: "host-a", project: pBeta, pinnedAt: null, labels: ["docs"], background: false,
      branch: "feat/beta-branch", createdAt: "2026-01-02T10:00:00Z", lastPromptAt: "2026-01-04T10:00:00Z",
      parentAgent: aZeta, indicator: "done", indicatorLabel: null, id: "w-beta", projectId: "prj-beta",
      projectDisplayName: "Beta", name: "Beta task", title: "Beta task", status: "done",
      statusEnteredAt: null, archivingAt: null, diffStat: null,
    },
  ];

  const agents = [
    {
      ref: aZeta, hostId: "host-a", workspace: wZeta, parentAgent: null, id: "a-zeta", workspaceId: "w-zeta",
      status: "idle", background: false, createdAt: "2026-01-01T10:00:00Z", title: "Zeta task",
      requiresAttention: false,
    },
    {
      ref: aBeta, hostId: "host-a", workspace: wBeta, parentAgent: aZeta, id: "a-beta", workspaceId: "w-beta",
      status: "idle", background: false, createdAt: "2026-01-02T10:00:00Z", title: "Beta task",
      requiresAttention: false,
    },
    {
      ref: aAlpha, hostId: "host-a", workspace: wAlpha, parentAgent: aZeta, id: "a-alpha", workspaceId: "w-alpha",
      status: "idle", background: false, createdAt: "2026-01-03T10:00:00Z", title: "Alpha task",
      requiresAttention: true,
    },
    {
      ref: aMid, hostId: "host-a", workspace: wMid, parentAgent: null, id: "a-mid", workspaceId: "w-mid",
      status: "running", background: false, createdAt: "2026-01-04T10:00:00Z", title: "Mid task",
      requiresAttention: false,
    },
  ];

  const groups = [{ id: "g1", name: "Work", projects: [pAlpha.key, pBeta.key] }];
  return { projects, workspaces, agents, groups };
}

function mountFixture(t, appearance = {}, { byRelation = false } = {}) {
  const data = parityFixture();
  const harness = makeHarness({
    locale: "en",
    projects: data.projects,
    workspaces: data.workspaces,
    agents: data.agents,
    groups: data.groups,
    appearance,
  });
  const renderer = harness.mount();
  t.after(() => harness.unmount());
  if (byRelation) {
    const toggle = renderer.root.findByProps({ accessibilityLabel: "By relation", accessibilityRole: "button" });
    act(() => toggle.props.onPress());
  }
  return { harness, renderer };
}

function workspaceRowTitles(renderer) {
  return renderer.root
    .findAll((node) => node.type === "Pressable" && String(node.props.accessibilityLabel ?? "").startsWith("Open "))
    .map((node) => node.props.accessibilityLabel.slice("Open ".length));
}

function statusOfRow(renderer, load, title) {
  const { StatusDot } = load("client/rows.tsx");
  const row = renderer.root.findByProps({ accessibilityLabel: `Open ${title}`, accessibilityRole: "button" });
  const dot = row.findByType(StatusDot);
  return { color: dot.props.color, running: Boolean(dot.props.running) };
}

// --- Sort (name, created, lastPrompt) ---

test("By project honours workspaceSort: name, created, and lastPrompt", (t) => {
  const byName = mountFixture(t, { workspaceSort: "name" });
  assert.deepEqual(workspaceRowTitles(byName.renderer), ["Alpha task", "Mid task", "Zeta task", "Beta task"]);

  const byCreated = mountFixture(t, { workspaceSort: "created" });
  assert.deepEqual(workspaceRowTitles(byCreated.renderer), ["Mid task", "Alpha task", "Zeta task", "Beta task"]);

  const byLastPrompt = mountFixture(t, { workspaceSort: "lastPrompt" });
  assert.deepEqual(workspaceRowTitles(byLastPrompt.renderer), ["Zeta task", "Mid task", "Alpha task", "Beta task"]);
});

test(
  "By relation honours workspaceSort: name, created, and lastPrompt",
  { todo: "By relation ignores workspaceSort (#41)" },
  (t) => {
    const byName = mountFixture(t, { workspaceSort: "name" }, { byRelation: true });
    assert.deepEqual(workspaceRowTitles(byName.renderer), ["Mid task", "Zeta task", "Alpha task", "Beta task"]);

    const byCreated = mountFixture(t, { workspaceSort: "created" }, { byRelation: true });
    assert.deepEqual(workspaceRowTitles(byCreated.renderer), ["Mid task", "Zeta task", "Alpha task", "Beta task"]);

    const byLastPrompt = mountFixture(t, { workspaceSort: "lastPrompt" }, { byRelation: true });
    assert.deepEqual(workspaceRowTitles(byLastPrompt.renderer), ["Zeta task", "Beta task", "Alpha task", "Mid task"]);
  },
);

// --- Workspace title (title vs branch) ---

test("both modes show workspace titles when workspaceTitle is title", (t) => {
  const expected = ["Alpha task", "Beta task", "Mid task", "Zeta task"];
  const byProject = mountFixture(t, { workspaceTitle: "title" });
  const byRelation = mountFixture(t, { workspaceTitle: "title" }, { byRelation: true });
  assert.deepEqual([...workspaceRowTitles(byProject.renderer)].sort(), expected);
  assert.deepEqual([...workspaceRowTitles(byRelation.renderer)].sort(), expected);
});

test("By project shows branch names when workspaceTitle is branch", (t) => {
  const { renderer } = mountFixture(t, { workspaceTitle: "branch" });
  assert.deepEqual([...workspaceRowTitles(renderer)].sort(), [
    "chore/mid-branch",
    "feat/beta-branch",
    "feat/zeta-branch",
    "fix/alpha-branch",
  ]);
});

test(
  "By relation shows branch names when workspaceTitle is branch",
  { todo: "By relation prefers agent title over workspace branch title" },
  (t) => {
    const { renderer } = mountFixture(t, { workspaceTitle: "branch" }, { byRelation: true });
    assert.deepEqual([...workspaceRowTitles(renderer)].sort(), [
      "chore/mid-branch",
      "feat/beta-branch",
      "feat/zeta-branch",
      "fix/alpha-branch",
    ]);
  },
);

// --- Show labels ---

test("By project honours showLabels on and off", (t) => {
  const shown = mountFixture(t, { showLabels: true });
  const shownText = textOf(shown.renderer.toJSON());
  for (const label of ["urgent", "backend", "frontend", "docs"]) {
    assert.ok(shownText.includes(label), `expected label "${label}" when showLabels is true`);
  }

  const hidden = mountFixture(t, { showLabels: false });
  const hiddenText = textOf(hidden.renderer.toJSON());
  for (const label of ["urgent", "backend", "frontend", "docs"]) {
    assert.ok(!hiddenText.includes(label), `expected label "${label}" hidden when showLabels is false`);
  }
});

test("By relation hides labels when showLabels is false", (t) => {
  const hidden = mountFixture(t, { showLabels: false }, { byRelation: true });
  const hiddenText = textOf(hidden.renderer.toJSON());
  for (const label of ["urgent", "backend", "frontend", "docs"]) {
    assert.ok(!hiddenText.includes(label));
  }
});

test(
  "By relation shows labels when showLabels is true",
  { todo: "By relation does not render workspace labels" },
  (t) => {
    const shown = mountFixture(t, { showLabels: true }, { byRelation: true });
    const shownText = textOf(shown.renderer.toJSON());
    for (const label of ["urgent", "backend", "frontend", "docs"]) {
      assert.ok(shownText.includes(label), `expected label "${label}" in By relation when showLabels is true`);
    }
  },
);

// --- Show branch ---

test("By project honours showBranch on and off", (t) => {
  const shown = mountFixture(t, { workspaceTitle: "title", showBranch: true });
  const shownText = textOf(shown.renderer.toJSON());
  for (const branch of ["feat/zeta-branch", "fix/alpha-branch", "chore/mid-branch", "feat/beta-branch"]) {
    assert.ok(shownText.includes(branch), `expected branch "${branch}" when showBranch is true`);
  }

  const hidden = mountFixture(t, { workspaceTitle: "title", showBranch: false });
  const hiddenText = textOf(hidden.renderer.toJSON());
  for (const branch of ["feat/zeta-branch", "fix/alpha-branch", "chore/mid-branch", "feat/beta-branch"]) {
    assert.ok(!hiddenText.includes(branch), `expected branch "${branch}" hidden when showBranch is false`);
  }
});

test("By relation hides branch subtitles when showBranch is false", (t) => {
  const hidden = mountFixture(t, { workspaceTitle: "title", showBranch: false }, { byRelation: true });
  const hiddenText = textOf(hidden.renderer.toJSON());
  for (const branch of ["feat/zeta-branch", "fix/alpha-branch", "chore/mid-branch", "feat/beta-branch"]) {
    assert.ok(!hiddenText.includes(branch));
  }
});

test(
  "By relation shows branch subtitles when showBranch is true",
  { todo: "By relation does not render workspace branch subtitles" },
  (t) => {
    const shown = mountFixture(t, { workspaceTitle: "title", showBranch: true }, { byRelation: true });
    const shownText = textOf(shown.renderer.toJSON());
    for (const branch of ["feat/zeta-branch", "fix/alpha-branch", "chore/mid-branch", "feat/beta-branch"]) {
      assert.ok(shownText.includes(branch), `expected branch "${branch}" in By relation when showBranch is true`);
    }
  },
);

// --- Status icons per workspace ---

test("both modes render matching running and done status indicators", (t) => {
  const byProject = mountFixture(t);
  const byRelation = mountFixture(t, {}, { byRelation: true });

  assert.deepEqual(statusOfRow(byProject.renderer, byProject.harness.load, "Mid task"), {
    color: theme.colors.accent,
    running: true,
  });
  assert.deepEqual(statusOfRow(byRelation.renderer, byRelation.harness.load, "Mid task"), {
    color: theme.colors.accent,
    running: true,
  });

  assert.deepEqual(statusOfRow(byProject.renderer, byProject.harness.load, "Zeta task"), {
    color: "transparent",
    running: false,
  });
  assert.deepEqual(statusOfRow(byRelation.renderer, byRelation.harness.load, "Zeta task"), {
    color: "transparent",
    running: false,
  });
});

test("By project renders green statusSuccess dot for finished-unread (attention) workspace", (t) => {
  const byProject = mountFixture(t);
  assert.deepEqual(statusOfRow(byProject.renderer, byProject.harness.load, "Alpha task"), {
    color: theme.colors.statusSuccess,
    running: false,
  });
});

test(
  "By relation renders green statusSuccess dot for finished-unread (attention) workspace",
  { todo: "By relation colors the dot from agent status, not the workspace indicator (#42)" },
  (t) => {
    const byRelation = mountFixture(t, {}, { byRelation: true });
    assert.deepEqual(statusOfRow(byRelation.renderer, byRelation.harness.load, "Alpha task"), {
      color: theme.colors.statusSuccess,
      running: false,
    });
  },
);
