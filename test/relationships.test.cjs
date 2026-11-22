const assert = require("node:assert/strict");
const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const React = require("react");
const { act, create } = require("react-test-renderer");
const ts = require("typescript");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = path.join(__dirname, "..");

const theme = {
  colors: {
    surface0: "#ffffff",
    surface1: "#f3f5f8",
    surface2: "#e6eaf0",
    border: "#d0d7de",
    foreground: "#1c2128",
    foregroundMuted: "#57606a",
    accent: "#2563eb",
    accentForeground: "#ffffff",
    statusSuccess: "#1a7f37",
    statusWarning: "#bf8700",
    statusDanger: "#cf222e",
  },
};

function resolveTs(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`Cannot resolve ${specifier} from ${fromFile}`);
}

/**
 * Loads real plugin TypeScript modules in an isolated VM graph, substituting only
 * React Native primitives and the Paseo SDK hooks/UI.
 */
function createLoader(overrides = {}, globals = {}) {
  const cache = new Map();
  const load = (relPath) => {
    const abs = path.resolve(ROOT, relPath);
    if (cache.has(abs)) return cache.get(abs);
    const source = readFileSync(abs, "utf8");
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        jsx: ts.JsxEmit.ReactJSX,
      },
    });
    const module = { exports: {} };
    cache.set(abs, module.exports);
    const context = {
      exports: module.exports,
      module,
      console,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      ...globals,
      require(name) {
        if (name in overrides) return overrides[name];
        if (name === "react") return React;
        if (name === "react/jsx-runtime") return require("react/jsx-runtime");
        if (name === "zod") return require("zod");
        if (name.startsWith(".")) return load(resolveTs(abs, name));
        throw new Error(`Unexpected import: ${name} (from ${relPath})`);
      },
    };
    vm.runInNewContext(outputText, context);
    cache.set(abs, module.exports);
    return module.exports;
  };
  return load;
}

const ref = (kind, hostId, id) => ({ kind, hostId, id, key: `${hostId}:${id}` });
const plain = (value) => JSON.parse(JSON.stringify(value));

function textOf(node) {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  return (node.children ?? []).map(textOf).join("");
}

function flattenStyle(style) {
  if (!style) return {};
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flattenStyle));
  return style;
}

function makeHarness({
  platform = "web",
  compact = false,
  locale = "zh-CN",
  projects = [],
  workspaces = [],
  agents = [],
  groups = [],
  parents = {},
  collapsed = [],
  activeAgent = null,
  activeWorkspace = null,
} = {}) {
  const workspaceRefCalls = [];
  const openedAgents = [];
  const openedWorkspaces = [];
  const savedLayouts = [];
  const scrollCalls = [];
  const keyListeners = [];

  let currentCollapsed = [...collapsed];
  let layoutRevision = 1;
  let listener = null;

  const projectMap = new Map(projects.map((p) => [p.ref.key, p]));
  const workspaceMap = new Map(workspaces.map((w) => [w.ref.key, w]));
  const agentMap = new Map(agents.map((a) => [a.ref.key, a]));

  function queryItems(list, query = {}) {
    let filtered = query.where ? list.filter(query.where) : [...list];
    if (query.orderBy) {
      if (typeof query.orderBy === "function") {
        filtered.sort(query.orderBy);
      } else if (Array.isArray(query.orderBy)) {
        const [field, dir] = query.orderBy;
        filtered.sort((a, b) => {
          const cmp = String(a[field] ?? "").localeCompare(String(b[field] ?? ""));
          return dir === "desc" ? -cmp : cmp;
        });
      } else {
        const field = query.orderBy;
        filtered.sort((a, b) => String(a[field] ?? "").localeCompare(String(b[field] ?? "")));
      }
    }
    if (!query.groupBy) return filtered.map((item) => item.ref);
    const grouped = new Map();
    for (const item of filtered) {
      const raw = query.groupBy(item);
      const keys = Array.isArray(raw) ? raw : [raw];
      for (const entry of keys) {
        const key = typeof entry === "string" ? entry : entry.key;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(item.ref);
      }
    }
    return [...grouped.entries()].map(([key, items]) => ({ key, title: null, color: null, items }));
  }

  const rn = {
    Platform: { OS: platform },
    View: "View",
    Text: "Text",
    Pressable: "Pressable",
    TextInput: "TextInput",
    Image: "Image",
    ScrollView: "ScrollView",
    Easing: { linear: (v) => v },
    Animated: {
      View: "AnimatedView",
      Value: class {
        constructor(v) { this.value = v; }
        interpolate() { return "0deg"; }
        setValue(v) { this.value = v; }
      },
      timing: () => ({ start() {}, stop() {} }),
      loop: () => ({ start() {}, stop() {} }),
    },
    PanResponder: { create: () => ({ panHandlers: {} }) },
  };

  const sdkClient = {
    defineTranslations: (config) => ({
      ...config,
      message: (key) => ({ key }),
    }),
    useTranslation: () => ({ locale }),
    useSettings: (doc) => {
      if (doc.id === "groups") {
        return {
          status: "ready",
          revision: "g1",
          values: { groups, parents },
          saving: false,
          saveError: null,
          save: async () => true,
          reset: async () => true,
          reload: async () => {},
        };
      }
      if (doc.id === "layout") {
        return {
          status: "ready",
          revision: `l${layoutRevision}`,
          values: { collapsed: currentCollapsed },
          saving: false,
          saveError: null,
          save: async (next) => {
            savedLayouts.push(next.collapsed);
            currentCollapsed = [...next.collapsed];
            layoutRevision += 1;
            listener?.();
            return true;
          },
          reset: async () => true,
          reload: async () => {},
        };
      }
      if (doc.id === "decorations") {
        return {
          status: "ready",
          revision: "d1",
          values: { groups: {}, projects: {}, workspaces: {} },
          saving: false,
          saveError: null,
          save: async () => true,
          reset: async () => true,
          reload: async () => {},
        };
      }
      return {
        status: "ready",
        revision: "a1",
        values: doc.schema.parse({}),
        saving: false,
        saveError: null,
        save: async () => true,
        reset: async () => true,
        reload: async () => {},
      };
    },
    useHosts: () => [
      { serverId: "host-a", label: "MacBook", status: "online" },
      { serverId: "host-b", label: "Linux Box", status: "online" },
    ],
    useProjects: (query) => queryItems(projects, query),
    useWorkspaces: (query) => queryItems(workspaces, query),
    useAgents: (query) => queryItems(agents, query),
    useProject: (projectRef, selector) => {
      const snap = projectMap.get(projectRef.key) ?? null;
      return snap && selector ? selector(snap) : snap;
    },
    useWorkspace: (wsRef, selector) => {
      workspaceRefCalls.push(wsRef);
      const key = typeof wsRef === "string" ? wsRef : wsRef.key;
      const snap = workspaceMap.get(key) ?? null;
      return snap && selector ? selector(snap) : snap;
    },
    useAgent: (agentRef, selector) => {
      const key = typeof agentRef === "string" ? agentRef : agentRef.key;
      const snap = agentMap.get(key) ?? null;
      return snap && selector ? selector(snap) : snap;
    },
    useRpc: () => async () => ({ serverId: "host-a", projectIds: [] }),
    usePaseo: () => ({}),
  };

  const sdkUi = {
    Icon: "Icon",
    ScrollView: "ScrollView",
    TextInput: "TextInput",
    Modal: Object.assign(({ children }) => React.createElement("Modal", null, children), {
      Content: ({ children }) => React.createElement("ModalContent", null, children),
    }),
    SettingsAction: "SettingsAction",
    SettingsCard: "SettingsCard",
    SettingsSection: "SettingsSection",
    SettingsSelect: "SettingsSelect",
    SettingsSwitch: "SettingsSwitch",
    useToast: () => ({ show() {}, error() {} }),
  };

  const load = createLoader({
    "react-native": rn,
    "@getpaseo/plugin": {
      defineSettings: (config) => config,
      defineRpc: (config) => config,
    },
    "@getpaseo/plugin/client": sdkClient,
    "@getpaseo/plugin/client/ui": sdkUi,
    "@tanstack/react-query": {
      useQuery: () => ({ data: undefined, isLoading: false, refetch: async () => {} }),
    },
  });

  const entry = load("index.client.tsx").default;
  let SidebarComponent = null;
  entry({
    openSettings() {},
    addSettingsScreen() { return () => {}; },
    addSidebarView(contribution) {
      SidebarComponent = contribution.Component;
      return () => {};
    },
  });
  assert.ok(SidebarComponent, "index.client.tsx should register the sidebar view");

  let viewProps = {
    theme,
    layout: { compact, platform },
    active: { workspace: activeWorkspace, agent: activeAgent },
    navigation: {
      openWorkspace: (r) => openedWorkspaces.push(r),
      openAgent: (r) => openedAgents.push(r),
      openTerminal: () => {},
      openProject: () => {},
    },
    dismiss: () => {},
  };

  let renderer;
  let viewCounter = 0;
  const createNodeMock = (element) => {
    if (element.type === "ScrollView") {
      return { scrollTo: (opts) => scrollCalls.push(opts) };
    }
    if (element.type === "View") {
      const y = (viewCounter++) * 32;
      return {
        measureLayout: (_relative, onSuccess) => onSuccess(0, y, 280, 28),
        addEventListener: (_type, fn) => keyListeners.push(fn),
        removeEventListener: (_type, fn) => {
          const idx = keyListeners.indexOf(fn);
          if (idx >= 0) keyListeners.splice(idx, 1);
        },
        querySelectorAll: () => [],
      };
    }
    return {};
  };

  const renderTree = () => React.createElement(SidebarComponent, viewProps);
  listener = () => {
    if (renderer) renderer.update(renderTree());
  };

  return {
    load,
    mount() {
      act(() => {
        renderer = create(renderTree(), { createNodeMock });
      });
      return renderer;
    },
    fireKeyOnAgent(agentKey, key) {
      const row = {
        getAttribute: (attr) => (attr === "data-pg-agent" ? agentKey : null),
        closest: (sel) => (sel === "[data-pg-nav]" ? row : null),
      };
      let prevented = false;
      for (const fn of [...keyListeners]) {
        fn({
          target: row,
          key,
          isComposing: false,
          defaultPrevented: false,
          altKey: false,
          ctrlKey: false,
          metaKey: false,
          shiftKey: false,
          preventDefault: () => { prevented = true; },
          stopPropagation: () => {},
        });
      }
      return prevented;
    },
    unmount() {
      act(() => renderer.unmount());
    },
    workspaceRefCalls,
    openedAgents,
    openedWorkspaces,
    savedLayouts,
    scrollCalls,
  };
}

function sampleCrossProjectData() {
  const pCli = ref("project", "host-a", "mom_cli");
  const pRep = ref("project", "host-a", "mom-reports");
  const pPerm = ref("project", "host-b", "mom-permission-workbench");
  const pGroups = ref("project", "host-a", "paseo-project-groups");

  const wCli = ref("workspace", "host-a", "ws-cli");
  const wRep = ref("workspace", "host-a", "ws-rep");
  const wPerm = ref("workspace", "host-b", "ws-perm");
  const wGroups = ref("workspace", "host-a", "ws-groups");

  const aCli = ref("agent", "host-a", "ag-cli");
  const aRep = ref("agent", "host-a", "ag-rep");
  const aPerm = ref("agent", "host-b", "ag-perm");
  const aGroups = ref("agent", "host-a", "ag-groups");

  const projects = [
    { ref: pCli, hostId: "host-a", displayName: "mom_cli", iconRevision: null },
    { ref: pRep, hostId: "host-a", displayName: "mom-reports", iconRevision: null },
    { ref: pPerm, hostId: "host-b", displayName: "mom-permission-workbench", iconRevision: null },
    { ref: pGroups, hostId: "host-a", displayName: "paseo-project-groups", iconRevision: null },
  ];

  const workspaces = [
    {
      ref: wCli, hostId: "host-a", project: pCli, pinnedAt: null, labels: [], background: false,
      branch: "main", createdAt: "2026-01-01T00:00:00Z", lastPromptAt: null, parentAgent: null,
      indicator: "done", indicatorLabel: null, id: "ws-cli", projectId: "mom_cli",
      projectDisplayName: "mom_cli", name: "MOM CLI", title: "MOM CLI", status: "done",
      statusEnteredAt: null, archivingAt: null, diffStat: null,
    },
    {
      ref: wRep, hostId: "host-a", project: pRep, pinnedAt: null, labels: [], background: false,
      branch: "feat/reports", createdAt: "2026-01-02T00:00:00Z", lastPromptAt: null, parentAgent: aCli,
      indicator: "done", indicatorLabel: null, id: "ws-rep", projectId: "mom-reports",
      projectDisplayName: "mom-reports", name: "MOM报表", title: "MOM报表", status: "done",
      statusEnteredAt: null, archivingAt: null, diffStat: { additions: 33537, deletions: 3767 },
    },
    {
      ref: wPerm, hostId: "host-b", project: pPerm, pinnedAt: null, labels: [], background: false,
      branch: "feat/perm", createdAt: "2026-01-03T00:00:00Z", lastPromptAt: null, parentAgent: aCli,
      indicator: "running", indicatorLabel: "运行中", id: "ws-perm", projectId: "mom-permission-workbench",
      projectDisplayName: "mom-permission-workbench", name: "MOM 权限工作台", title: "MOM 权限工作台",
      status: "running", statusEnteredAt: null, archivingAt: null, diffStat: null,
    },
    {
      ref: wGroups, hostId: "host-a", project: pGroups, pinnedAt: null, labels: [], background: false,
      branch: "main", createdAt: "2026-01-04T00:00:00Z", lastPromptAt: null, parentAgent: null,
      indicator: "done", indicatorLabel: null, id: "ws-groups", projectId: "paseo-project-groups",
      projectDisplayName: "paseo-project-groups", name: "项目分组插件", title: "项目分组插件",
      status: "done", statusEnteredAt: null, archivingAt: null, diffStat: { additions: 961, deletions: 63 },
    },
  ];

  const agents = [
    {
      ref: aCli, hostId: "host-a", workspace: wCli, parentAgent: null, id: "ag-cli", workspaceId: "ws-cli",
      status: "idle", background: false, createdAt: "2026-01-01T00:00:00Z", title: "MOM CLI",
      requiresAttention: false,
    },
    {
      ref: aRep, hostId: "host-a", workspace: wRep, parentAgent: aCli, id: "ag-rep", workspaceId: "ws-rep",
      status: "idle", background: false, createdAt: "2026-01-02T00:00:00Z", title: "MOM报表",
      requiresAttention: false,
    },
    {
      ref: aPerm, hostId: "host-b", workspace: wPerm, parentAgent: aCli, id: "ag-perm", workspaceId: "ws-perm",
      status: "running", background: false, createdAt: "2026-01-03T00:00:00Z", title: "MOM 权限工作台",
      requiresAttention: false,
    },
    {
      ref: aGroups, hostId: "host-a", workspace: wGroups, parentAgent: null, id: "ag-groups", workspaceId: "ws-groups",
      status: "idle", background: false, createdAt: "2026-01-04T00:00:00Z", title: "项目分组插件",
      requiresAttention: false,
    },
  ];

  const groups = [
    { id: "mom", name: "MOM", projects: [pCli.key, pRep.key, pPerm.key] },
    { id: "paseo", name: "paseo插件", projects: [pGroups.key] },
  ];

  return {
    refs: { pCli, pRep, pPerm, pGroups, wCli, wRep, wPerm, wGroups, aCli, aRep, aPerm, aGroups },
    projects, workspaces, agents, groups,
  };
}

test("relationship-model orders connected families before standalone agents and tracks multi-level guides", () => {
  const load = createLoader();
  const model = load("client/relationship-model.ts");
  const solo = ref("agent", "h1", "solo");
  const root = ref("agent", "h1", "root");
  const c1 = ref("agent", "h1", "c1");
  const c2 = ref("agent", "h1", "c2");
  const g1 = ref("agent", "h2", "g1");

  const rel = model.agentRelationships([
    { key: "w:h1:w-solo", items: [solo] },
    { key: "w:h1:w-root", items: [root] },
    { key: "w:h1:w-c1", items: [c1] },
    { key: "w:h1:w-c2", items: [c2] },
    { key: "w:h2:w-g1", items: [g1] },
    { key: `a:${root.key}`, items: [c1, c2] },
    { key: `a:${c1.key}`, items: [g1] },
  ]);

  const rows = plain(model.relationshipRows(rel));
  assert.deepEqual(rows.map((r) => r.agent.id), ["root", "c1", "g1", "c2", "solo"]);
  assert.deepEqual(rows.map((r) => r.depth), [0, 1, 2, 1, 0]);
  assert.deepEqual(rows.map((r) => r.last), [true, false, true, true, true]);
  assert.deepEqual(rows[2].guides, [true], "grandchild under non-last child keeps ancestor vertical guide");
  assert.equal(model.activeFamily(rel, c1.key).parent.key, root.key);
  assert.equal(model.activeFamily(rel, solo.key), null);
});

test("project view keeps workspace rows as the single entry without duplicate drawers/chips and never scrolls on click", async (t) => {
  const data = sampleCrossProjectData();
  const harness = makeHarness({
    projects: data.projects,
    workspaces: data.workspaces,
    agents: data.agents,
    groups: data.groups,
    activeAgent: data.refs.aRep,
    activeWorkspace: data.refs.wRep,
  });
  const renderer = harness.mount();
  t.after(() => harness.unmount());

  // Every useWorkspace call receives a real host-scoped WorkspaceRef object.
  assert.ok(harness.workspaceRefCalls.length > 0);
  for (const call of harness.workspaceRefCalls) {
    assert.equal(typeof call, "object", `useWorkspace received string instead of WorkspaceRef: ${String(call)}`);
    assert.equal(call.kind, "workspace");
    assert.ok(call.hostId && call.id && call.key);
  }
  assert.ok(
    harness.workspaceRefCalls.some((r) => r.hostId === "host-b" && r.id === "ws-perm"),
    "cross-host child workspace subscribed via host-b WorkspaceRef",
  );

  // No duplicate parent/child jump pills or expandable drawer buttons exist in project view.
  const allButtons = renderer.root.findAllByProps({ accessibilityRole: "button" });
  const duplicateJumpButtons = allButtons.filter((btn) =>
    /^(父|子|同父)\s/.test(String(btn.props.accessibilityLabel ?? "")),
  );
  assert.equal(duplicateJumpButtons.length, 0, "no inline quick-jump pills or duplicate entry buttons");
  assert.equal(
    renderer.root.findAllByProps({ accessibilityLabel: "2 个子 Agent", accessibilityRole: "button" }).length,
    0,
    "parent count badge must not be an expandable drawer toggle",
  );

  // Parent row still shows a quiet non-interactive count badge and related rows get surface1 highlight.
  const countBadge = renderer.root.findByProps({ accessibilityLabel: "2 个子 Agent", accessibilityRole: "text" });
  assert.equal(textOf(countBadge), "2 子");
  const parentRow = renderer.root.findByProps({ accessibilityLabel: "打开MOM CLI", accessibilityRole: "button" });
  assert.equal(flattenStyle(parentRow.props.style).backgroundColor, theme.colors.surface1);

  // Clicking an already-visible workspace row opens the agent WITHOUT calling scrollTo or changing folds.
  await act(async () => {
    parentRow.props.onPress();
    await new Promise((r) => setTimeout(r, 15));
  });
  assert.deepEqual(harness.openedAgents, [data.refs.aCli]);
  assert.equal(harness.scrollCalls.length, 0, "clicking an existing row must not scroll the sidebar");
  assert.equal(harness.savedLayouts.length, 0, "clicking an existing row must not alter fold state");
});

test("keyboard jump unfolds a collapsed group and project and minimally scrolls to reveal it", async (t) => {
  const data = sampleCrossProjectData();
  const harness = makeHarness({
    projects: data.projects,
    workspaces: data.workspaces,
    agents: data.agents,
    groups: [
      { id: "parent-grp", name: "Parent Group", projects: [data.refs.pCli.key] },
      { id: "child-grp", name: "Child Group", projects: [data.refs.pRep.key, data.refs.pPerm.key] },
    ],
    collapsed: ["g:parent-grp", `p:${data.refs.pCli.key}`, `p:${data.refs.pPerm.key}`],
    activeAgent: data.refs.aRep,
    activeWorkspace: data.refs.wRep,
  });
  const renderer = harness.mount();
  t.after(() => harness.unmount());

  await act(async () => {
    assert.equal(harness.fireKeyOnAgent(data.refs.aRep.key, "p"), true);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 15));
  });

  assert.deepEqual(harness.openedAgents, [data.refs.aCli]);
  assert.equal(harness.savedLayouts.length, 1);
  assert.deepEqual(harness.savedLayouts[0], [`p:${data.refs.pPerm.key}`], "both parent group and parent project unfolded");
  assert.ok(
    renderer.root.findByProps({ accessibilityLabel: "打开MOM CLI", accessibilityRole: "button" }),
    "unfolded parent workspace row is now mounted",
  );
  assert.ok(harness.scrollCalls.length >= 1, "jumping to a collapsed target scrolls to reveal it");
});

test("same-workspace subagent tabs are hidden from both views, counts, rail, and keyboard nav", (t) => {
  const pGroups = ref("project", "host-a", "paseo-project-groups");
  const pCross = ref("project", "host-b", "cross-project");
  const wMain = ref("workspace", "host-a", "ws-1");
  // Same opaque workspace ID ("ws-1") on a different host must stay distinct!
  const wOtherHost = ref("workspace", "host-b", "ws-1");

  const aRoot = ref("agent", "host-a", "ag-root");
  const aTabChild = ref("agent", "host-a", "ag-tab-child");
  const aTabGrandchild = ref("agent", "host-a", "ag-tab-grandchild");
  const aCrossHostChild = ref("agent", "host-b", "ag-cross-host-child");

  const harness = makeHarness({
    projects: [
      { ref: pGroups, hostId: "host-a", displayName: "paseo-project-groups", iconRevision: null },
      { ref: pCross, hostId: "host-b", displayName: "cross-project", iconRevision: null },
    ],
    workspaces: [
      {
        ref: wMain, hostId: "host-a", project: pGroups, pinnedAt: null, labels: [], background: false,
        branch: "main", createdAt: "2026-01-01T00:00:00Z", lastPromptAt: null, parentAgent: null,
        indicator: "done", indicatorLabel: null, id: "ws-1", projectId: "paseo-project-groups",
        projectDisplayName: "paseo-project-groups", name: "项目分组插件", title: "项目分组插件",
        status: "done", statusEnteredAt: null, archivingAt: null, diffStat: { additions: 961, deletions: 63 },
      },
      {
        ref: wOtherHost, hostId: "host-b", project: pCross, pinnedAt: null, labels: [], background: false,
        branch: "main", createdAt: "2026-01-02T00:00:00Z", lastPromptAt: null, parentAgent: aRoot,
        indicator: "running", indicatorLabel: "运行中", id: "ws-1", projectId: "cross-project",
        projectDisplayName: "cross-project", name: "远端跨工作区子 Agent", title: "远端跨工作区子 Agent",
        status: "running", statusEnteredAt: null, archivingAt: null, diffStat: null,
      },
    ],
    agents: [
      { ref: aRoot, hostId: "host-a", workspace: wMain, parentAgent: null, id: "ag-root", workspaceId: "ws-1", status: "idle", background: false, createdAt: "2026-01-01T00:00:00Z", title: "项目分组插件", requiresAttention: false },
      { ref: aTabChild, hostId: "host-a", workspace: wMain, parentAgent: aRoot, id: "ag-tab-child", workspaceId: "ws-1", status: "running", background: false, createdAt: "2026-01-02T00:00:00Z", title: "同窗口子标签", requiresAttention: false },
      { ref: aTabGrandchild, hostId: "host-a", workspace: wMain, parentAgent: aTabChild, id: "ag-tab-grandchild", workspaceId: "ws-1", status: "idle", background: false, createdAt: "2026-01-03T00:00:00Z", title: "同窗口孙标签", requiresAttention: false },
      { ref: aCrossHostChild, hostId: "host-b", workspace: wOtherHost, parentAgent: aRoot, id: "ag-cross-host-child", workspaceId: "ws-1", status: "running", background: false, createdAt: "2026-01-04T00:00:00Z", title: "远端跨工作区子 Agent", requiresAttention: false },
    ],
    groups: [{ id: "g1", name: "paseo插件", projects: [pGroups.key, pCross.key] }],
    activeAgent: aRoot,
    activeWorkspace: wMain,
  });
  const renderer = harness.mount();
  t.after(() => harness.unmount());

  // Project view: no duplicate parent row, same-workspace subagent tabs never appear,
  // and child count only counts the cross-host/cross-workspace child (1, not 3).
  const projectText = textOf(renderer.toJSON());
  assert.ok(!projectText.includes("同窗口子标签"), "same-workspace subagent tab must not appear in project view");
  assert.ok(!projectText.includes("同窗口孙标签"), "same-workspace grandchild tab must not appear in project view");
  assert.equal(
    renderer.root.findAllByProps({ accessibilityLabel: "打开项目分组插件", accessibilityRole: "button" }).length,
    1,
    "workspace row must not duplicate its parent agent underneath",
  );
  const countBadge = renderer.root.findByProps({ accessibilityLabel: "1 个子 Agent", accessibilityRole: "text" });
  assert.equal(textOf(countBadge), "1 子");

  // Keyboard `]` from parent jumps directly to the cross-host child, skipping same-workspace tabs.
  act(() => {
    assert.equal(harness.fireKeyOnAgent(aRoot.key, "]"), true);
  });
  assert.deepEqual(harness.openedAgents, [aCrossHostChild]);

  // Switch to "按关系" view: same-workspace subagent tabs remain absent; cross-host child stays linked.
  const relToggle = renderer.root.findByProps({ accessibilityLabel: "按关系", accessibilityRole: "button" });
  act(() => relToggle.props.onPress());
  const relText = textOf(renderer.toJSON());
  assert.ok(!relText.includes("同窗口子标签"), "same-workspace subagent tab must not appear in relation view");
  assert.ok(!relText.includes("同窗口孙标签"));
  assert.ok(relText.includes("项目分组插件"));
  assert.ok(relText.includes("远端跨工作区子 Agent"));
});

test("same workspace with multiple true root agents keeps a single workspace row and missing parents fabricate no link", (t) => {
  const p1 = ref("project", "host-a", "monorepo");
  const w1 = ref("workspace", "host-a", "ws-multi-root");
  const wOrphan = ref("workspace", "host-a", "ws-orphan");

  const aRoot1 = ref("agent", "host-a", "ag-root-1");
  const aRoot2 = ref("agent", "host-a", "ag-root-2");
  const aTabOfRoot1 = ref("agent", "host-a", "ag-tab-1");
  const aMissingParent = ref("agent", "host-a", "ag-archived-parent");
  const aOrphan = ref("agent", "host-a", "ag-orphan");

  const harness = makeHarness({
    projects: [{ ref: p1, hostId: "host-a", displayName: "monorepo", iconRevision: null }],
    workspaces: [
      {
        ref: w1, hostId: "host-a", project: p1, pinnedAt: null, labels: [], background: false,
        branch: "main", createdAt: "2026-01-01T00:00:00Z", lastPromptAt: null, parentAgent: null,
        indicator: "done", indicatorLabel: null, id: "ws-multi-root", projectId: "monorepo",
        projectDisplayName: "monorepo", name: "Multi Root WS", title: "Multi Root WS",
        status: "done", statusEnteredAt: null, archivingAt: null, diffStat: null,
      },
      {
        ref: wOrphan, hostId: "host-a", project: p1, pinnedAt: null, labels: [], background: false,
        branch: "fix/orphan", createdAt: "2026-01-02T00:00:00Z", lastPromptAt: null, parentAgent: aMissingParent,
        indicator: "done", indicatorLabel: null, id: "ws-orphan", projectId: "monorepo",
        projectDisplayName: "monorepo", name: "Orphan WS", title: "Orphan WS",
        status: "done", statusEnteredAt: null, archivingAt: null, diffStat: null,
      },
    ],
    agents: [
      { ref: aRoot1, hostId: "host-a", workspace: w1, parentAgent: null, id: "ag-root-1", workspaceId: "ws-multi-root", status: "idle", background: false, createdAt: "2026-01-01T00:00:00Z", title: "Root One", requiresAttention: false },
      { ref: aRoot2, hostId: "host-a", workspace: w1, parentAgent: null, id: "ag-root-2", workspaceId: "ws-multi-root", status: "idle", background: false, createdAt: "2026-01-02T00:00:00Z", title: "Root Two", requiresAttention: false },
      { ref: aTabOfRoot1, hostId: "host-a", workspace: w1, parentAgent: aRoot1, id: "ag-tab-1", workspaceId: "ws-multi-root", status: "running", background: false, createdAt: "2026-01-03T00:00:00Z", title: "Inner Tab", requiresAttention: false },
      { ref: aOrphan, hostId: "host-a", workspace: wOrphan, parentAgent: aMissingParent, id: "ag-orphan", workspaceId: "ws-orphan", status: "idle", background: false, createdAt: "2026-01-04T00:00:00Z", title: "Orphan Agent", requiresAttention: false },
    ],
    groups: [{ id: "g1", name: "Work", projects: [p1.key] }],
    activeAgent: aOrphan,
    activeWorkspace: wOrphan,
  });
  const renderer = harness.mount();
  t.after(() => harness.unmount());

  // Multi-root workspace renders exactly one WorkspaceRow with default workspace navigation.
  const multiWsBtn = renderer.root.findByProps({ accessibilityLabel: "打开Multi Root WS", accessibilityRole: "button" });
  assert.equal(renderer.root.findAllByProps({ accessibilityLabel: "打开Root One", accessibilityRole: "button" }).length, 0);
  assert.equal(renderer.root.findAllByProps({ accessibilityLabel: "打开Root Two", accessibilityRole: "button" }).length, 0);
  assert.ok(!textOf(renderer.toJSON()).includes("Inner Tab"));
  act(() => multiWsBtn.props.onPress());
  assert.deepEqual(harness.openedWorkspaces, [w1]);

  // Missing parent keeps normal WorkspaceRow & default navigation without fabricating a relationship.
  const orphanWsBtn = renderer.root.findByProps({ accessibilityLabel: "打开Orphan WS", accessibilityRole: "button" });
  assert.equal(harness.fireKeyOnAgent(aOrphan.key, "p"), false, "missing parent must not navigate");
  act(() => orphanWsBtn.props.onPress());
  assert.deepEqual(harness.openedWorkspaces, [w1, wOrphan]);
  assert.deepEqual(harness.openedAgents, []);
  assert.equal(harness.scrollCalls.length, 0);
});

test("By relation view displays clickable tree rows with full project names, no duplicate jump strip, and no scroll on click", async (t) => {
  const data = sampleCrossProjectData();
  const harness = makeHarness({
    projects: data.projects,
    workspaces: data.workspaces,
    agents: data.agents,
    groups: data.groups,
    activeAgent: null,
    activeWorkspace: data.refs.wRep,
  });
  const renderer = harness.mount();
  t.after(() => harness.unmount());

  const relToggle = renderer.root.findByProps({ accessibilityLabel: "按关系", accessibilityRole: "button" });
  act(() => relToggle.props.onPress());
  harness.scrollCalls.length = 0;

  const treeText = textOf(renderer.toJSON());
  assert.ok(treeText.includes("MOM CLI"));
  assert.ok(treeText.includes("MOM报表"));
  assert.ok(treeText.includes("MOM 权限工作台"));
  assert.ok(treeText.includes("mom-permission-workbench"), "full project name visible in relation tree");
  assert.ok(treeText.includes("+33537"), "diff stats visible in relation tree");

  // Single-agent workspace fallback still highlights MOM报表 as selected in relation tree.
  const repRow = renderer.root.findByProps({ accessibilityLabel: "打开MOM报表", accessibilityRole: "button" });
  assert.equal(repRow.props.accessibilityState.selected, true);

  // Clicking a tree row opens the agent directly without scrolling.
  const permRow = renderer.root.findByProps({ accessibilityLabel: "打开MOM 权限工作台", accessibilityRole: "button" });
  await act(async () => {
    permRow.props.onPress();
    await new Promise((r) => setTimeout(r, 15));
  });
  assert.deepEqual(harness.openedAgents, [data.refs.aPerm]);
  assert.equal(harness.scrollCalls.length, 0, "clicking a tree row must not call scrollTo");
});

test("always-visible rail uses deterministic family color, promotes active/hovered family, echoes ChildBadge color, and respects collapsed folds", async (t) => {
  const data = sampleCrossProjectData();
  const railMod = createLoader({ "react-native": { Platform: { OS: "web" }, View: "View" } })("client/relationship-rail.tsx");
  const expectedHex = railMod.familyColor(data.refs.aCli.key);
  assert.notEqual(expectedHex, "#E5484D", "family palette must avoid alert red");

  // Select an unrelated workspace (paseo-project-groups) with no hover.
  const harness = makeHarness({
    projects: data.projects,
    workspaces: data.workspaces,
    agents: data.agents,
    groups: data.groups,
    activeAgent: data.refs.aGroups,
    activeWorkspace: data.refs.wGroups,
  });
  const renderer = harness.mount();
  t.after(() => harness.unmount());

  await act(async () => {
    await new Promise((r) => setTimeout(r, 15));
  });

  // Rail overlay is mounted with calm default rgba family color (no container/view opacity < 1 stacking).
  const railOverlay = renderer.root.findByProps({ accessibilityElementsHidden: true, pointerEvents: "none" });
  const railViews = railOverlay.findAllByType("View");
  assert.ok(
    railViews.some((v) => v.props.style?.backgroundColor === railMod.withAlpha(expectedHex, 0.62) && v.props.style?.width === 1.5),
    "unrelated selection draws calm 1.5px rgba family rail",
  );
  assert.equal(
    railViews.some((v) => typeof v.props.style?.opacity === "number" && v.props.style.opacity < 1),
    false,
    "rail views must use rgba colors instead of view opacity < 1 to prevent dark joint overlap dots",
  );
  // Parent origin node (soft family-color translucent halo + solid dot) and child terminal dots both render.
  const parentHalo = railOverlay.findByProps({ testID: "rail-parent-halo" });
  const parentNode = railOverlay.findByProps({ testID: "rail-parent-node" });
  const childNodes = railOverlay.findAllByProps({ testID: "rail-child-node" });
  assert.equal(parentHalo.props.style.backgroundColor, railMod.withAlpha(expectedHex, 0.16));
  assert.notEqual(parentHalo.props.style.backgroundColor, theme.colors.surface0, "parent halo must not punch a surface0 hole on selected/highlighted rows");
  assert.equal(childNodes.length, 2);
  assert.ok(parentNode.props.style.width > childNodes[0].props.style.width, "parent node is more prominent than child dots");

  // Right-side ChildBadge echoes the same family color.
  const badge = renderer.root.findByProps({ accessibilityLabel: "2 个子 Agent", accessibilityRole: "text" });
  const forkIcon = badge.findByType("Icon");
  assert.equal(forkIcon.props.color, railMod.withAlpha(expectedHex, 0.85));

  // Hovering a member of the MOM family promotes its rail to solid 2px family color and brightens ChildBadge.
  const parentRow = renderer.root.findByProps({ accessibilityLabel: "打开MOM CLI", accessibilityRole: "button" });
  act(() => parentRow.props.onHoverIn());
  const hoveredOverlay = renderer.root.findByProps({ accessibilityElementsHidden: true, pointerEvents: "none" });
  const hoveredViews = hoveredOverlay.findAllByType("View");
  assert.ok(
    hoveredViews.some((v) => v.props.style?.backgroundColor === expectedHex && v.props.style?.width === 2),
    "hovered family rail switches to solid 2px family color",
  );
  const hoveredBadge = renderer.root.findByProps({ accessibilityLabel: "2 个子 Agent", accessibilityRole: "text" });
  assert.equal(hoveredBadge.findByType("Icon").props.color, expectedHex);
  assert.equal(hoveredBadge.props.style.backgroundColor, railMod.withAlpha(expectedHex, 0.12));
  assert.equal(harness.scrollCalls.length, 0);
  assert.equal(harness.savedLayouts.length, 0);

  // When parent project is collapsed, no rail is drawn and nothing auto-expands.
  const collapsedHarness = makeHarness({
    projects: data.projects,
    workspaces: data.workspaces,
    agents: data.agents,
    groups: data.groups,
    collapsed: [`p:${data.refs.pCli.key}`],
    activeAgent: null,
    activeWorkspace: null,
  });
  const collapsedRenderer = collapsedHarness.mount();
  t.after(() => collapsedHarness.unmount());
  await act(async () => {
    await new Promise((r) => setTimeout(r, 15));
  });
  assert.equal(
    collapsedRenderer.root.findAllByProps({ accessibilityElementsHidden: true, pointerEvents: "none" }).length,
    0,
    "collapsed parent hides rail without auto-expanding",
  );
  assert.equal(collapsedHarness.savedLayouts.length, 0);
});

test("rail geometry keeps lanes/bridges in pure surface0 gutter outside row capsules, clears pinned/narrow rows, uses non-surface0 parent halo, and protects 3-level relay corners", async (t) => {
  const load = createLoader({
    "react-native": { Platform: { OS: "web" }, View: "View" },
  });
  const {
    RAIL_BASE_X,
    LANE_STEP,
    RAIL_RADIUS,
    RAIL_ELBOW_INSET,
    MAX_LANES,
    assignLanes,
    familyColor,
    withAlpha,
    RelationshipRail,
  } = load("client/relationship-rail.tsx");

  // Geometry invariants across 1..MAX_LANES:
  // 1) radius strictly smaller than lane pitch (2x ratio -> 4px straight segment)
  // 2) every vertical lane and crossing bridge halo stays strictly left of the row highlight capsule (extra + 4)
  // 3) parent halo right edge stays strictly left of both pinned (extra + 22) and narrow (extra + 30) workspaces
  assert.ok(RAIL_RADIUS < LANE_STEP, `RAIL_RADIUS (${RAIL_RADIUS}) must be strictly smaller than LANE_STEP (${LANE_STEP})`);
  assert.ok(LANE_STEP - RAIL_RADIUS >= 4, "sufficient straight horizontal run between curve and adjacent lane");
  for (let lanes = 1; lanes <= MAX_LANES; lanes++) {
    const extra = lanes * LANE_STEP;
    const rowCapsuleLeft = extra + 4;
    const innermostLaneX = RAIL_BASE_X + (lanes - 1) * LANE_STEP;
    const maxBridgeRightEdge = innermostLaneX - 2 + (2 + 4); // stroke(2) + 2*pad(2)
    assert.ok(
      maxBridgeRightEdge <= rowCapsuleLeft,
      `lane ${lanes - 1} bridge right edge (${maxBridgeRightEdge}) must stay outside row capsule (${rowCapsuleLeft})`,
    );
    const armEnd = extra + RAIL_ELBOW_INSET - 1;
    const parentHaloRightEdge = armEnd + 9.5 / 2;
    const pinnedStart = extra + 4 + 18;
    const narrowStart = extra + 4 + 26;
    assert.ok(parentHaloRightEdge < pinnedStart, `parent halo (${parentHaloRightEdge}) must clear pinned row (${pinnedStart})`);
    assert.ok(parentHaloRightEdge < narrowStart, `parent halo (${parentHaloRightEdge}) must clear narrow row (${narrowStart})`);
  }

  // Outer-long / inner-short lane packing eliminates crossings for nested spans.
  const nested = plain(assignLanes([
    { parentKey: "short-inner", parent: 100, children: [{ key: "sc1", y: 180 }], top: 100, bottom: 180 },
    { parentKey: "long-outer", parent: 20, children: [{ key: "lc1", y: 280 }], top: 20, bottom: 280 },
  ]));
  const longLane = nested.rails.find((r) => r.parentKey === "long-outer").lane;
  const shortLane = nested.rails.find((r) => r.parentKey === "short-inner").lane;
  assert.equal(longLane, 0, "enclosing long span takes outer lane 0");
  assert.equal(shortLane, 1, "nested short span takes inner lane 1");

  // 3-level chain (A -> B -> C) sharing relay row B (y=120): neither side emits a false crossing bridge on B!
  const chainLayout = assignLanes([
    { parentKey: "chain-a", parent: 20, children: [{ key: "chain-b", y: 120 }], top: 20, bottom: 120 },
    { parentKey: "chain-b", parent: 120, children: [{ key: "chain-c", y: 220 }], top: 120, bottom: 220 },
  ]);
  assert.equal(chainLayout.laneCount, 2);
  let chainRenderer;
  act(() => {
    chainRenderer = create(React.createElement(RelationshipRail, {
      rails: chainLayout.rails,
      laneCount: chainLayout.laneCount,
      activeParentKey: "chain-b",
      theme,
    }));
  });
  t.after(() => act(() => chainRenderer.unmount()));
  assert.equal(
    chainRenderer.root.findAllByProps({ testID: "rail-bridge-halo" }).length,
    0,
    "3-level chain sharing relay row B must not emit crossing bridge halos at the shared endpoint",
  );

  // Partial overlap creates a real interior crossing: outer lane 0 arm at y=160 crosses inner lane 1 trunk [100..240].
  const crossingLayout = assignLanes([
    { parentKey: "fam-a", parent: 20, children: [{ key: "a1", y: 160 }], top: 20, bottom: 160 },
    { parentKey: "fam-b", parent: 100, children: [{ key: "b1", y: 240 }], top: 100, bottom: 240 },
  ]);
  assert.equal(crossingLayout.laneCount, 2);

  // Render with NO active family: outer arm emits an opaque `surface0` crossing bridge halo strictly outside row capsule.
  let renderer;
  act(() => {
    renderer = create(React.createElement(RelationshipRail, {
      rails: crossingLayout.rails,
      laneCount: crossingLayout.laneCount,
      activeParentKey: null,
      theme,
    }));
  });
  t.after(() => act(() => renderer.unmount()));

  const bridges = renderer.root.findAllByProps({ testID: "rail-bridge-halo" });
  assert.ok(bridges.length >= 1, "crossing arm renders opaque surface0 bridge halo over crossed vertical trunk");
  const capsuleLeft = crossingLayout.laneCount * LANE_STEP + 4;
  for (const bridge of bridges) {
    assert.equal(bridge.props.style.backgroundColor, theme.colors.surface0);
    assert.equal(bridge.props.style.opacity, undefined, "bridge halo must remain 100% opaque");
    assert.ok(
      bridge.props.style.left + bridge.props.style.width <= capsuleLeft,
      "crossing bridge halo must stay strictly inside the pure surface0 left gutter",
    );
  }

  // Render with inner family (`fam-b`) active: active family gets solid 2px on top, outer `fam-a` dims to 0.28 alpha & 1.25px.
  act(() => {
    renderer.update(React.createElement(RelationshipRail, {
      rails: crossingLayout.rails,
      laneCount: crossingLayout.laneCount,
      activeParentKey: "fam-b",
      theme,
    }));
  });
  const allViews = renderer.root.findAllByType("View");
  const colorA = familyColor("fam-a");
  const colorB = familyColor("fam-b");
  assert.ok(
    allViews.some((v) => v.props.style?.backgroundColor === colorB && v.props.style?.width === 2),
    "active family renders solid 2px trunk",
  );
  assert.ok(
    allViews.some((v) => v.props.style?.backgroundColor === withAlpha(colorA, 0.28) && v.props.style?.width === 1.25),
    "non-active family recedes to dimmed 0.28 alpha & 1.25px stroke",
  );
  assert.ok(
    renderer.root.findAllByProps({ testID: "rail-bridge-halo" }).length >= 1,
    "active inner trunk renders opaque vertical bridge halo over dimmed outer arm",
  );
  // Active family's parent halo uses soft family tint (0.22 alpha), never surface0, and renders last on top.
  const parentHalos = renderer.root.findAllByProps({ testID: "rail-parent-halo" });
  assert.equal(parentHalos.at(-1).props.style.backgroundColor, withAlpha(colorB, 0.22));
  assert.equal(parentHalos[0].props.style.backgroundColor, withAlpha(colorA, 0.1));
  const parentNodes = renderer.root.findAllByProps({ testID: "rail-parent-node" });
  assert.equal(parentNodes.at(-1).props.style.backgroundColor, colorB, "active family renders last on top");
});

test("useRelationshipRail batches multiple families, assigns separate lanes for overlapping spans, keeps stability, and minimally scrolls", async (t) => {
  const load = createLoader({
    "react-native": { Platform: { OS: "web" }, View: "View" },
  });
  const { useRelationshipRail, RelationshipRail, LANE_STEP } = load("client/relationship-rail.tsx");

  const p1 = ref("agent", "h1", "p1");
  const c1Above = ref("agent", "h1", "c1-above");
  const c1Below = ref("agent", "h1", "c1-below");
  const p2 = ref("agent", "h1", "p2");
  const c2 = ref("agent", "h1", "c2");
  const families = [
    { parent: p1, children: [c1Above, c1Below] },
    { parent: p2, children: [c2] },
  ];

  let renders = 0;
  let hookApi;
  let useFallback = false;
  const focusCalls = [];
  const scrolled = [];

  const contentRef = {
    current: {
      measureInWindow: (cb) => cb(0, 100, 280, 600),
    },
  };
  const scrollRef = {
    current: {
      scrollTo: (opts) => scrolled.push(opts),
    },
  };

  function Harness({ activeFamilies, activeParentKey = null }) {
    renders += 1;
    hookApi = useRelationshipRail(activeFamilies, contentRef, scrollRef);
    return React.createElement(RelationshipRail, {
      rails: hookApi.rails,
      laneCount: hookApi.laneCount,
      activeParentKey,
      theme,
    });
  }

  let renderer;
  await act(async () => {
    renderer = create(React.createElement(Harness, { activeFamilies: families, activeParentKey: p2.key }));
  });
  t.after(() => act(() => renderer.unmount()));

  const makeNode = (relY, height = 28) => ({
    measureLayout: (_container, onOk, onFail) => {
      if (useFallback) return onFail();
      onOk(0, relY, 260, height);
    },
    measureInWindow: (cb) => cb(0, 100 + relY, 260, height),
    querySelector: () => ({ focus: (opts) => focusCalls.push(opts) }),
  });

  // Family 1 spans [20..188], Family 2 spans [100..228] -> overlapping spans get separate lanes (0 & 1).
  await act(async () => {
    hookApi.onViewportHeight(300);
    hookApi.onScroll(0);
    hookApi.register(p1.key, makeNode(80));
    hookApi.register(c1Above.key, makeNode(20));
    hookApi.register(c1Below.key, makeNode(160));
    hookApi.register(p2.key, makeNode(100));
    hookApi.register(c2.key, makeNode(200));
    await new Promise((r) => setTimeout(r, 15));
  });

  assert.equal(hookApi.rails.length, 2);
  assert.equal(hookApi.laneCount, 2, "overlapping families get separate vertical lanes");
  assert.equal(hookApi.gutterExtra, 2 * LANE_STEP);
  assert.notEqual(hookApi.rails[0].lane, hookApi.rails[1].lane);

  // Stability check: repeated refreshes with identical layout produce ZERO extra renders.
  const settledRenders = renders;
  await act(async () => {
    hookApi.refresh();
    await new Promise((r) => setTimeout(r, 15));
    hookApi.refresh();
    await new Promise((r) => setTimeout(r, 15));
  });
  assert.equal(renders, settledRenders, "identical measurements must not trigger re-renders");

  // Non-overlapping families share lane 0 with 1 dedicated lane gutter (keeps lane outside row capsules).
  await act(async () => {
    hookApi.register(p2.key, makeNode(240));
    hookApi.register(c2.key, makeNode(300));
    await new Promise((r) => setTimeout(r, 15));
  });
  assert.equal(hookApi.laneCount, 1, "non-overlapping families share a single lane");
  assert.equal(hookApi.gutterExtra, LANE_STEP);

  // Already-visible target in viewport [0, 300]: focus with preventScroll, NO scrollTo!
  await act(async () => {
    hookApi.revealAgent(c1Below.key, { focus: true });
    await new Promise((r) => setTimeout(r, 15));
  });
  assert.equal(scrolled.length, 0, "target already inside viewport must not scroll");
  assert.equal(focusCalls.length, 1);
  assert.equal(focusCalls[0].preventScroll, true);

  // Target below viewport [0, 300] (y=420, bottom=448): minimal scroll via measureInWindow fallback to 156.
  useFallback = true;
  await act(async () => {
    hookApi.register(c1Below.key, makeNode(420));
    hookApi.revealAgent(c1Below.key, { focus: true });
    await new Promise((r) => setTimeout(r, 15));
  });
  assert.equal(scrolled.length, 1);
  assert.equal(scrolled[0].y, 156);
  assert.equal(scrolled[0].animated, false);

  // Target above viewport [200, 500] (y=20): minimal scroll to 20 - 8 = 12.
  await act(async () => {
    hookApi.onScroll(200);
    hookApi.revealAgent(c1Above.key, { focus: true });
    await new Promise((r) => setTimeout(r, 15));
  });
  assert.equal(scrolled.length, 2);
  assert.equal(scrolled[1].y, 12);

  // Zero-height (hidden/collapsed) children exclude that family while keeping the visible family.
  await act(async () => {
    hookApi.register(c1Above.key, makeNode(20, 0));
    hookApi.register(c1Below.key, makeNode(420, 0));
    await new Promise((r) => setTimeout(r, 15));
  });
  assert.equal(hookApi.rails.length, 1);
  assert.equal(hookApi.rails[0].parentKey, p2.key);
});

test("bindSidebarKeys handles Arrow nav, group/project fold, P/[/], and ignores IME & text inputs", () => {
  const load = createLoader({ "react-native": { Platform: { OS: "web" } } });
  const { bindSidebarKeys } = load("client/web.ts");

  let handler = null;
  let focusedItem = null;
  let foldClicks = 0;
  const jumps = [];

  const groupRow = {
    getAttribute: (attr) => (attr === "aria-expanded" ? "false" : null),
    getClientRects: () => [{}],
    focus: () => { focusedItem = "group"; },
    click: () => { foldClicks += 1; },
    closest: (sel) => (sel === "[data-pg-nav]" ? groupRow : null),
  };
  const agentRow = {
    getAttribute: (attr) => (attr === "data-pg-agent" ? "h1:a1" : null),
    getClientRects: () => [{}],
    focus: () => { focusedItem = "agent"; },
    closest: (sel) => (sel === "[data-pg-nav]" ? agentRow : null),
  };
  const root = {
    addEventListener: (_type, fn) => { handler = fn; },
    removeEventListener: () => { handler = null; },
    querySelectorAll: () => [groupRow, agentRow],
  };

  const cleanup = bindSidebarKeys(root, (agent, direction) => {
    jumps.push([agent, direction]);
    return true;
  });

  const fire = (target, overrides) => {
    let prevented = false;
    handler({
      target,
      key: "",
      isComposing: false,
      defaultPrevented: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      preventDefault: () => { prevented = true; },
      stopPropagation: () => {},
      ...overrides,
    });
    return prevented;
  };

  assert.equal(fire(groupRow, { key: "ArrowDown" }), true);
  assert.equal(focusedItem, "agent");

  assert.equal(fire(groupRow, { key: "ArrowRight" }), true);
  assert.equal(foldClicks, 1);

  assert.equal(fire(agentRow, { key: "p" }), true);
  assert.equal(fire(agentRow, { key: "]" }), true);
  assert.equal(fire(agentRow, { key: "[" }), true);
  assert.deepEqual(jumps, [["h1:a1", "parent"], ["h1:a1", "next"], ["h1:a1", "previous"]]);

  // IME composition events and input fields are never intercepted.
  assert.equal(fire(agentRow, { key: "p", isComposing: true }), false);
  assert.equal(fire(agentRow, { key: "Process" }), false);
  assert.equal(fire(agentRow, { key: "p", keyCode: 229 }), false);
  const inputTarget = { closest: (sel) => (sel.includes("input") ? {} : agentRow) };
  assert.equal(fire(inputTarget, { key: "ArrowDown" }), false);
  assert.equal(jumps.length, 3);

  cleanup();
  assert.equal(handler, null);
});
