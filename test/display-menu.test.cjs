const assert = require("node:assert/strict");
const { test } = require("node:test");
const React = require("react");
const { act, create } = require("react-test-renderer");
const { createLoader, theme } = require("./helpers/loader.cjs");

const DEFAULTS = {
  workspaceSort: "name",
  workspaceTitle: "title",
  showBranch: false,
  showLabels: true,
  showDiffStats: true,
  rowTrailing: undefined,
  showBackground: false,
};

function loadMenu(values) {
  const saved = [];
  const opened = [];
  const load = createLoader({
    "@getpaseo/plugin/client": {
      useSettings: (doc) => ({
        status: "ready",
        revision: "r1",
        values: { ...doc.schema.parse({}), ...DEFAULTS, ...values },
        saving: false,
        saveError: null,
        save: async (next) => {
          saved.push(next);
          return true;
        },
        reset: async () => true,
        reload: async () => {},
      }),
    },
    // Return message keys directly so existing label assertions stay locale-independent.
    "client/i18n.ts": { useT: () => (key) => key },
  });
  const { DisplayMenuButton } = load("client/display-menu.tsx");
  const { ViewActionsContext } = load("client/look.tsx");
  return { DisplayMenuButton, ViewActionsContext, saved, opened };
}

async function openMenu({ compact = true, values = {} } = {}) {
  const menu = loadMenu(values);
  const view = { theme, layout: { compact, platform: "web" } };
  const actions = { openAppearanceSettings: () => menu.opened.push("appearance") };
  let renderer;
  await act(() => {
    renderer = create(
      React.createElement(
        menu.ViewActionsContext.Provider,
        { value: actions },
        React.createElement(menu.DisplayMenuButton, { view }),
      ),
      {
        createNodeMock: () => ({ measureInWindow: (callback) => callback(400, 100, 24, 24) }),
      },
    );
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

test(
  "Settings… closes the menu and opens the appearance settings",
  { todo: "Settings… does nothing on compact layouts (#35)" },
  async (t) => {
    const { renderer, press, opened } = await openMenu({ compact: true });
    t.after(() => act(() => renderer.unmount()));
    await press("display.settings");
    assert.deepEqual(opened, ["appearance"]);
    assert.equal(isOpen(renderer), false);
  },
);

test("Settings… closes the wide dropdown and opens the appearance settings", async (t) => {
  const { renderer, press, opened } = await openMenu({ compact: false });
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
