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
    foreground: "#111111",
    foregroundMuted: "#666666",
    border: "#cccccc",
    surface1: "#eeeeee",
    surface2: "#dddddd",
  },
};
const Modal = ({ children }) => React.createElement("Modal", null, children);
Modal.Content = ({ children }) => React.createElement("ModalContent", null, children);

const DEFAULTS = {
  workspaceSort: "name",
  workspaceTitle: "title",
  showBranch: false,
  showLabels: true,
  showDiffStats: true,
  rowTrailing: undefined,
  showBackground: false,
};

// Render the real menu; only platform UI and host services are substituted.
function loadMenu(values) {
  const saved = [];
  const opened = [];
  const settings = { status: "ready", revision: 1, values: { ...DEFAULTS, ...values } };
  const modules = {
    react: React,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "react-native": {
      Modal: "NativeModal",
      View: "View",
      Text: "Text",
      Pressable: "Pressable",
      useWindowDimensions: () => ({ width: 1400, height: 900 }),
    },
    "@getpaseo/plugin/client": { useSettings: () => settings },
    "@getpaseo/plugin/client/ui": { Icon: "Icon", Modal },
    "../shared/settings": {
      appearanceDocument: {},
      WORKSPACE_SORTS: ["name", "created", "lastPrompt"],
      WORKSPACE_TITLES: ["title", "branch"],
    },
    "./i18n": { useT: () => (key) => key },
    "./look": {
      useLook: () => ({ icon: 13 }),
      useViewActions: () => ({ openAppearanceSettings: () => opened.push("appearance") }),
    },
    "./save": {
      useSettingsSaver: () => ({
        busy: () => true,
        save: async (next) => {
          saved.push(next);
          return true;
        },
      }),
    },
  };
  const source = readFileSync(path.join(__dirname, "..", "client", "display-menu.tsx"), "utf8");
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
  return { DisplayMenuButton: exports.DisplayMenuButton, saved, opened };
}

async function openMenu({ compact = true, values = {} } = {}) {
  const menu = loadMenu(values);
  const view = { theme, layout: { compact, platform: "web" } };
  let renderer;
  await act(() => {
    renderer = create(React.createElement(menu.DisplayMenuButton, { view }), {
      createNodeMock: () => ({ measureInWindow: (callback) => callback(400, 100, 24, 24) }),
    });
  });
  const press = (label) => act(() => item(renderer, label).props.onPress());
  await press("display.trigger");
  return { ...menu, renderer, press };
}

const item = (renderer, label) =>
  renderer.root.find((node) => node.type === "Pressable" && node.props.accessibilityLabel === label);
const labels = (renderer) =>
  renderer.root
    .findAll((node) => node.type === "Pressable" && node.props.accessibilityLabel)
    .map((node) => node.props.accessibilityLabel);
const isOpen = (renderer) =>
  renderer.root.findAll((node) => node.type === "Modal" || node.type === "NativeModal").length > 0;

test("the root lists the app's display choices, then Settings…", async (t) => {
  const { renderer } = await openMenu();
  t.after(() => act(() => renderer.unmount()));
  assert.deepEqual(labels(renderer).slice(1), [
    "display.sort",
    "display.title",
    "display.show",
    "display.showBackground",
    "display.settings",
  ]);
  assert.equal(item(renderer, "display.showBackground").props["aria-checked"], false);
});

test("a sort choice saves and closes the menu", async (t) => {
  const { renderer, press, saved } = await openMenu();
  t.after(() => act(() => renderer.unmount()));
  await press("display.sort");
  await press("settings.workspaceSorts.lastPrompt");
  assert.equal(saved.at(-1).workspaceSort, "lastPrompt");
  assert.equal(isOpen(renderer), false);
});

test("Show toggles stay open and build on each other", async (t) => {
  const { renderer, press, saved } = await openMenu();
  t.after(() => act(() => renderer.unmount()));
  await press("display.show");
  await press("display.branch");
  await press("display.labels");
  assert.equal(saved.at(-1).showBranch, true);
  assert.equal(saved.at(-1).showLabels, false);
  assert.equal(item(renderer, "display.branch").props["aria-checked"], true);
  assert.equal(isOpen(renderer), true);
});

test("picking the trailing choice already showing empties the slot", async (t) => {
  const { renderer, press, saved } = await openMenu();
  t.after(() => act(() => renderer.unmount()));
  await press("display.show");
  await press("display.diff");
  assert.equal(saved.at(-1).rowTrailing, "none");
  await press("display.timestamp");
  assert.equal(saved.at(-1).rowTrailing, "timestamp");
});

test("Settings… closes the menu and opens the appearance settings", async (t) => {
  const { renderer, press, opened } = await openMenu();
  t.after(() => act(() => renderer.unmount()));
  await press("display.settings");
  assert.deepEqual(opened, ["appearance"]);
  assert.equal(isOpen(renderer), false);
});

test("compact layouts get a sheet, wide ones a dropdown under the button", async (t) => {
  const compact = await openMenu({ compact: true });
  const wide = await openMenu({ compact: false });
  t.after(() => act(() => (compact.renderer.unmount(), wide.renderer.unmount())));
  assert.equal(compact.renderer.root.findAllByType("Modal").length, 1);
  assert.equal(wide.renderer.root.findAllByType("NativeModal").length, 1);
  const surface = wide.renderer.root
    .findAllByType("View")
    .find((node) => node.props.style?.width === 232);
  // Right edges line up: 400 + 24 - 232. Just under the button: 100 + 24 + 4.
  assert.equal(surface.props.style.left, 192);
  assert.equal(surface.props.style.top, 128);
});
