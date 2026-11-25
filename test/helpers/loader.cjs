const assert = require("node:assert/strict");
const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const React = require("react");
const { act, create } = require("react-test-renderer");
const ts = require("typescript");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = path.resolve(__dirname, "..", "..");

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

const scriptCache = new Map();

function compileTs(absPath) {
  let script = scriptCache.get(absPath);
  if (!script) {
    const source = readFileSync(absPath, "utf8");
    const { outputText } = ts.transpileModule(source, {
      fileName: absPath,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        jsx: ts.JsxEmit.ReactJSX,
      },
    });
    script = new vm.Script(outputText, { filename: absPath });
    scriptCache.set(absPath, script);
  }
  return script;
}

function resolveTs(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`Cannot resolve ${specifier} from ${fromFile}`);
}

/**
 * The Paseo app mounts ui.Modal content outside the plugin's React tree, so every plugin
 * context read inside a Modal falls back to its default value. Resetting every context
 * created inside the loader reproduces that behaviour in react-test-renderer.
 */
function createDetachedModal(trackedContexts) {
  const Modal = ({ children }) => {
    let tree = children;
    for (const { ctx, defaultValue } of trackedContexts) {
      tree = React.createElement(ctx.Provider, { value: defaultValue }, tree);
    }
    return React.createElement("Modal", null, tree);
  };
  Modal.Content = ({ children }) => React.createElement("ModalContent", null, children);
  return Modal;
}

function createDefaultRn() {
  return {
    Platform: { OS: "web" },
    View: "View",
    Text: "Text",
    Pressable: "Pressable",
    TextInput: "TextInput",
    Image: "Image",
    ScrollView: "ScrollView",
    Modal: "NativeModal",
    useWindowDimensions: () => ({ width: 1400, height: 900 }),
    Easing: { linear: (v) => v },
    Animated: {
      View: "AnimatedView",
      Value: class {
        constructor(v) {
          this.value = v;
        }
        interpolate() {
          return "0deg";
        }
        setValue(v) {
          this.value = v;
        }
      },
      timing: () => ({ start() {}, stop() {} }),
      loop: () => ({ start() {}, stop() {} }),
    },
    PanResponder: { create: () => ({ panHandlers: {} }) },
  };
}

function readySettings(revision, values, save = async () => true) {
  return {
    status: "ready",
    revision,
    values,
    saving: false,
    saveError: null,
    save,
    reset: async () => true,
    reload: async () => {},
  };
}

function createDefaultSdkClient() {
  return {
    defineTranslations: (config) => ({
      ...config,
      message: (key) => ({ key }),
    }),
    useTranslation: () => ({ locale: "en" }),
    useSettings: (doc) => readySettings("r1", doc.schema.parse({})),
    useHosts: () => [],
    useProjects: () => [],
    useWorkspaces: () => [],
    useAgents: () => [],
    useProject: () => null,
    useWorkspace: () => null,
    useAgent: () => null,
    useRpc: () => async () => ({}),
    usePaseo: () => ({}),
  };
}

function createDefaultSdkUi(trackedContexts) {
  return {
    Icon: "Icon",
    ScrollView: "ScrollView",
    TextInput: "TextInput",
    Modal: createDetachedModal(trackedContexts),
    SettingsAction: "SettingsAction",
    SettingsCard: "SettingsCard",
    SettingsSection: "SettingsSection",
    SettingsSelect: "SettingsSelect",
    SettingsSwitch: "SettingsSwitch",
    copyText: async () => {},
    useToast: () => ({ show() {}, error() {} }),
  };
}

function createDefaultReactQuery() {
  return {
    useQuery: () => ({ data: undefined, isLoading: false, refetch: async () => {} }),
    useQueryClient: () => ({ invalidateQueries: async () => {} }),
  };
}

/**
 * Loads real plugin TypeScript modules recursively in an isolated VM graph.
 * Only outside packages that cannot run in Node (react-native, @getpaseo/plugin/client*,
 * @tanstack/react-query by default) are faked; per-test overrides merge onto those defaults
 * or replace a specific module by specifier or repo-relative path (e.g. "client/i18n.ts").
 */
function createLoader(overrides = {}, globals = {}) {
  const cache = new Map();
  const trackedContexts = [];
  const trackedReact = {
    ...React,
    createContext(defaultValue) {
      const ctx = React.createContext(defaultValue);
      trackedContexts.push({ ctx, defaultValue });
      return ctx;
    },
  };

  const externals = {
    "react-native": { ...createDefaultRn(), ...(overrides["react-native"] ?? {}) },
    "@getpaseo/plugin": overrides["@getpaseo/plugin"] ?? require("@getpaseo/plugin"),
    "@getpaseo/plugin/client": { ...createDefaultSdkClient(), ...(overrides["@getpaseo/plugin/client"] ?? {}) },
    "@getpaseo/plugin/client/ui": {
      ...createDefaultSdkUi(trackedContexts),
      ...(overrides["@getpaseo/plugin/client/ui"] ?? {}),
    },
    "@tanstack/react-query": overrides["@tanstack/react-query"] ?? createDefaultReactQuery(),
  };

  const load = (relPath) => {
    const abs = path.resolve(ROOT, relPath);
    const repoRel = path.relative(ROOT, abs).split(path.sep).join("/");
    if (repoRel in overrides) return overrides[repoRel];
    if (cache.has(abs)) return cache.get(abs);

    const script = compileTs(abs);
    const module = { exports: {} };
    cache.set(abs, module.exports);
    const context = {
      exports: module.exports,
      module,
      console,
      Buffer,
      Intl,
      process,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      ...globals,
      require(name) {
        if (name === "react") return "react" in overrides ? overrides.react : trackedReact;
        if (name === "react/jsx-runtime") return require("react/jsx-runtime");
        if (name === "zod") return require("zod");
        if (name.startsWith("node:")) return require(name);
        if (name in externals) return externals[name];
        if (name in overrides) return overrides[name];
        if (name.startsWith(".")) return load(resolveTs(abs, name));
        throw new Error(`Unexpected import: ${name} (from ${repoRel})`);
      },
    };
    script.runInNewContext(context);
    cache.set(abs, module.exports);
    return module.exports;
  };
  return load;
}

const ref = (kind, hostId, id) => ({ kind, hostId, id, key: `${hostId}:${id}` });
const plain = (value) => JSON.parse(JSON.stringify(value));
const noop = () => {};
const noopDrag = {
  register: noop,
  press: noop,
  armTouch: () => false,
  release: noop,
  isDragging: () => false,
  recentlyDropped: () => false,
  onScroll: noop,
  onContentHeight: noop,
};

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
  locale = "zh-CN",
  projects = [],
  workspaces = [],
  agents = [],
  groups = [],
  parents = {},
  collapsed = [],
  appearance = {},
  activeAgent = null,
  activeWorkspace = null,
} = {}) {
  const workspaceRefCalls = [];
  const openedAgents = [];
  const openedWorkspaces = [];
  const savedLayouts = [];
  const savedGroups = [];
  const scrollCalls = [];
  const keyListeners = [];

  let currentGroups = [...groups];
  let currentParents = { ...parents };
  let groupsRevision = 1;
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

  const sdkClient = {
    useTranslation: () => ({ locale }),
    useSettings: (doc) => {
      if (doc.id === "groups") {
        return readySettings(`g${groupsRevision}`, { groups: currentGroups, parents: currentParents }, async (next) => {
          savedGroups.push(plain(next));
          currentGroups = [...next.groups];
          currentParents = { ...next.parents };
          groupsRevision += 1;
          listener?.();
          return true;
        });
      }
      if (doc.id === "layout") {
        return readySettings(`l${layoutRevision}`, { collapsed: currentCollapsed }, async (next) => {
          savedLayouts.push(next.collapsed);
          currentCollapsed = [...next.collapsed];
          layoutRevision += 1;
          listener?.();
          return true;
        });
      }
      if (doc.id === "decorations") {
        return readySettings("d1", { groups: {}, projects: {}, workspaces: {} });
      }
      return readySettings("a1", doc.schema.parse(appearance));
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

  const load = createLoader({
    "@getpaseo/plugin/client": sdkClient,
  });

  const entry = load("index.client.tsx").default;
  let SidebarComponent = null;
  entry({
    openSettings() {},
    addSettingsScreen() {
      return () => {};
    },
    addSidebarView(contribution) {
      SidebarComponent = contribution.Component;
      return () => {};
    },
  });
  assert.ok(SidebarComponent, "index.client.tsx should register the sidebar view");

  const viewProps = {
    theme,
    layout: { compact: false, platform: "web" },
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
      const y = viewCounter++ * 32;
      return {
        measureLayout: (_relative, onSuccess) => onSuccess(0, y, 280, 28),
        measureInWindow: (cb) => cb(0, y, 280, 28),
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
          preventDefault: () => {
            prevented = true;
          },
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
    savedGroups,
    scrollCalls,
  };
}

module.exports = {
  theme,
  ref,
  plain,
  noopDrag,
  textOf,
  flattenStyle,
  createLoader,
  makeHarness,
};
