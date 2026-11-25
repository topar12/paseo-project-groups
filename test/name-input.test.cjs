const assert = require("node:assert/strict");
const { test } = require("node:test");
const React = require("react");
const { act, create } = require("react-test-renderer");
const { createLoader, noopDrag, theme } = require("./helpers/loader.cjs");

const view = { theme, layout: { compact: true, platform: "web" }, active: { workspace: null } };
const noop = () => {};

function makeClientLoader(host = {}) {
  return createLoader({
    "react-native": { TextInput: "NativeInput" },
    "@getpaseo/plugin/client": host,
    "@getpaseo/plugin/client/ui": { TextInput: "SheetAwareInput" },
    // Return message keys directly so existing button label assertions stay locale-independent.
    "client/i18n.ts": { useT: () => (key) => key },
  });
}

const inputOf = (renderer) =>
  renderer.root.find((node) => ["NativeInput", "SheetAwareInput"].includes(node.type));
const button = (renderer, label) =>
  renderer.root.findByProps({ accessibilityLabel: label, accessibilityRole: "button" });

async function workspaceEditor(onRender = noop, overrides = {}) {
  const titles = [];
  let closed = 0;
  const workspace = {
    title: "Original",
    customTitle: "Original",
    directory: "/project",
    pinned: false,
    worktree: false,
    ...overrides,
  };
  const load = makeClientLoader({
    useWorkspace: (_reference, _selector) => workspace,
    useRpc: () => async () => ({ done: true }),
    usePaseo: () => ({
      workspaces: {
        ref: () => ({
          setTitle: async (title) => {
            titles.push(title);
          },
        }),
      },
    }),
  });
  const { WorkspaceMenuDialog } = load("client/dialogs.tsx");
  const props = {
    reference: { id: "workspace", key: "workspace" },
    theme,
    onClose: () => closed++,
    onDecorate: noop,
    onArchived: noop,
  };
  const element = (nextProps = props) =>
    React.createElement(
      React.Profiler,
      { id: "rename", onRender },
      React.createElement(WorkspaceMenuDialog, nextProps),
    );
  let renderer;
  await act(() => {
    renderer = create(element());
  });
  await act(() => button(renderer, "workspace.rename").props.onPress());
  return { renderer, props, element, titles, closed: () => closed };
}

test("workspace IME edits stay native across typing and unrelated renders", async (t) => {
  let renders = 0;
  const { renderer, props, element } = await workspaceEditor(() => renders++);
  t.after(async () => act(() => renderer.unmount()));
  const input = inputOf(renderer);
  assert.equal(input.props.value, undefined, "Composing text must not be controlled by React");
  assert.equal(input.type, "SheetAwareInput");
  assert.equal(input.props.defaultValue, "Original");
  assert.equal(input.props.autoCorrect, false);
  const beforeTyping = renders;
  for (const text of ["z", "zh", "zhong", "中", "中文 项目🚀"]) {
    await act(() => inputOf(renderer).props.onChangeText(text));
    assert.equal(inputOf(renderer).props.defaultValue, "Original");
    assert.equal(inputOf(renderer).props.value, undefined);
  }
  assert.equal(renders, beforeTyping, "Typing must not re-render the dialog");
  await act(() => renderer.update(element({ ...props, theme: { ...theme } })));
  assert.equal(inputOf(renderer).props.defaultValue, "Original");
  assert.equal(inputOf(renderer).props.value, undefined);
});

test("workspace save reads the latest committed Chinese text", async (t) => {
  const { renderer, titles, closed } = await workspaceEditor();
  t.after(async () => act(() => renderer.unmount()));
  for (const text of ["zhong", "中文", " 中文 项目🚀 "]) {
    await act(() => inputOf(renderer).props.onChangeText(text));
  }
  await act(() => button(renderer, "common.save").props.onPress());
  assert.deepEqual(titles, ["中文 项目🚀"]);
  assert.equal(closed(), 1);
});

test("workspace Return saves and an empty name restores the default", async (t) => {
  const { renderer, titles } = await workspaceEditor();
  t.after(async () => act(() => renderer.unmount()));
  await act(() => inputOf(renderer).props.onChangeText("   "));
  await act(() => inputOf(renderer).props.onSubmitEditing());
  assert.deepEqual(titles, [null]);
});

test("saving an unchanged name does not pin the automatic name", async (t) => {
  const { renderer, titles, closed } = await workspaceEditor(noop, { title: "feature-x", customTitle: null });
  t.after(async () => act(() => renderer.unmount()));
  assert.equal(inputOf(renderer).props.defaultValue, "feature-x");
  await act(() => button(renderer, "common.save").props.onPress());
  assert.deepEqual(titles, []);
  assert.equal(closed(), 1);
});

test("saving an unchanged custom name sends nothing", async (t) => {
  const { renderer, titles, closed } = await workspaceEditor();
  t.after(async () => act(() => renderer.unmount()));
  await act(() => inputOf(renderer).props.onChangeText(" Original "));
  await act(() => inputOf(renderer).props.onSubmitEditing());
  assert.deepEqual(titles, []);
  assert.equal(closed(), 1);
});

test("workspace cancel does not save the draft", async (t) => {
  const { renderer, titles, closed } = await workspaceEditor();
  t.after(async () => act(() => renderer.unmount()));
  await act(() => inputOf(renderer).props.onChangeText("不保存"));
  await act(() => button(renderer, "common.cancel").props.onPress());
  assert.deepEqual(titles, []);
  assert.equal(closed(), 1);
});

test("group rename preserves composition and saves the latest text on blur", async (t) => {
  const load = makeClientLoader({ useWorkspaces: () => [] });
  const { GroupHeader } = load("client/rows.tsx");
  const { DragProvider } = load("client/drag.tsx");
  const renamed = [];
  const props = {
    group: { id: "group", name: "Original", projects: [] },
    statusKeys: [],
    count: 0,
    collapsed: false,
    renaming: true,
    dragging: false,
    view,
    onToggle: noop,
    onStartRename: noop,
    onRename: (id, name) => renamed.push([id, name]),
    onCancelRename: noop,
    onDelete: noop,
  };
  const render = (p) => React.createElement(DragProvider, { value: noopDrag }, React.createElement(GroupHeader, p));
  let renderer;
  await act(() => {
    renderer = create(render(props));
  });
  t.after(async () => act(() => renderer.unmount()));
  const input = inputOf(renderer);
  assert.equal(input.props.value, undefined, "Composing text must not be controlled by React");
  assert.equal(input.type, "SheetAwareInput");
  for (const text of ["gong", "工作", "工作 项目🚀"]) {
    await act(() => input.props.onChangeText(text));
    await act(() => renderer.update(render({ ...props, count: 1 })));
    assert.equal(inputOf(renderer), input, "The editing input must stay mounted");
    assert.equal(input.props.defaultValue, "Original");
    assert.equal(input.props.value, undefined);
  }
  await act(() => input.props.onBlur());
  assert.deepEqual(renamed, [["group", "工作 项目🚀"]]);
});

test("group rename starts with the current name and Return saves the new draft", async (t) => {
  const load = makeClientLoader({ useWorkspaces: () => [] });
  const { GroupHeader } = load("client/rows.tsx");
  const { DragProvider } = load("client/drag.tsx");
  const render = (p) => React.createElement(DragProvider, { value: noopDrag }, React.createElement(GroupHeader, p));
  let props;
  let renderer;
  const renamed = [];
  props = {
    group: { id: "group", name: "Original", projects: [] },
    statusKeys: [],
    count: 0,
    collapsed: false,
    renaming: false,
    dragging: false,
    view,
    onToggle: noop,
    onStartRename: () => {
      props = { ...props, renaming: true };
      renderer.update(render(props));
    },
    onRename: (id, name) => renamed.push([id, name]),
    onCancelRename: noop,
    onDelete: noop,
  };
  await act(() => {
    renderer = create(render(props));
  });
  t.after(async () => act(() => renderer.unmount()));
  // A remote rename before editing must seed both the display and the saved draft.
  props = { ...props, group: { ...props.group, name: "新名称" } };
  await act(() => renderer.update(render(props)));
  await act(() => button(renderer, "group.rename").props.onPress());
  assert.equal(inputOf(renderer).props.defaultValue, "新名称");
  await act(() => inputOf(renderer).props.onChangeText("新的分组"));
  await act(() => inputOf(renderer).props.onSubmitEditing());
  assert.deepEqual(renamed, [["group", "新的分组"]]);
});
