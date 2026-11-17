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
    accent: "#008800",
    accentForeground: "#ffffff",
    border: "#cccccc",
    surface1: "#eeeeee",
    surface2: "#dddddd",
  },
};
const view = { theme, layout: { compact: true } };
const noop = () => {};
const Modal = ({ children }) => React.createElement("Modal", null, children);
Modal.Content = ({ children }) => React.createElement("ModalContent", null, children);

// Render the real plugin components; only platform UI and host services are substituted.
function loadClient(file, host = {}) {
  const modules = {
    react: React,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "react-native": {
      View: "View",
      Text: "Text",
      Pressable: "Pressable",
      TextInput: "NativeInput",
    },
    "@getpaseo/plugin/client": host,
    "@getpaseo/plugin/client/ui": {
      Icon: "Icon",
      TextInput: "SheetAwareInput",
      Modal,
      useToast: () => ({ show: noop, error: noop }),
    },
    "./i18n": { useT: () => (key) => key },
    "./model": {},
    "./look": { useLook: () => ({ icon: 13, text: 12, line: 16, small: 11 }) },
    "./drag": {
      useDrag: () => ({ recentlyDropped: () => false }),
      useDragSlot: () => null,
      useDragHandle: () => ({}),
    },
    "./decor": {
      useDecorations: () => ({ get: () => ({ color: null, icon: null }) }),
    },
  };
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

const inputOf = (renderer) =>
  renderer.root.find((node) => ["NativeInput", "SheetAwareInput"].includes(node.type));
const button = (renderer, label) =>
  renderer.root.findByProps({ accessibilityLabel: label, accessibilityRole: "button" });

async function workspaceEditor(onRender = noop) {
  const titles = [];
  let closed = 0;
  const workspace = {
    title: "Original",
    customTitle: "Original",
    directory: "/project",
    pinned: false,
    worktree: false,
  };
  const { WorkspaceMenuDialog } = loadClient("dialogs.tsx", {
    useWorkspace: (_reference, _selector) => workspace,
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
  const props = {
    reference: { id: "workspace", key: "workspace" },
    theme,
    onClose: () => closed++,
    onDecorate: noop,
    onArchived: noop,
  };
  const element = (nextProps = props) =>
    React.createElement(React.Profiler, { id: "rename", onRender },
      React.createElement(WorkspaceMenuDialog, nextProps));
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

test("workspace cancel does not save the draft", async (t) => {
  const { renderer, titles, closed } = await workspaceEditor();
  t.after(async () => act(() => renderer.unmount()));
  await act(() => inputOf(renderer).props.onChangeText("不保存"));
  await act(() => button(renderer, "common.cancel").props.onPress());
  assert.deepEqual(titles, []);
  assert.equal(closed(), 1);
});

test("group rename preserves composition and saves the latest text on blur", async (t) => {
  const { GroupHeader } = loadClient("rows.tsx");
  const renamed = [];
  const props = {
    group: { id: "group", name: "Original", projects: [] },
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
  let renderer;
  await act(() => {
    renderer = create(React.createElement(GroupHeader, props));
  });
  t.after(async () => act(() => renderer.unmount()));
  const input = inputOf(renderer);
  assert.equal(input.props.value, undefined, "Composing text must not be controlled by React");
  assert.equal(input.type, "SheetAwareInput");
  for (const text of ["gong", "工作", "工作 项目🚀"]) {
    await act(() => input.props.onChangeText(text));
    await act(() => renderer.update(React.createElement(GroupHeader, { ...props, count: 1 })));
    assert.equal(inputOf(renderer), input, "The editing input must stay mounted");
    assert.equal(input.props.defaultValue, "Original");
    assert.equal(input.props.value, undefined);
  }
  await act(() => input.props.onBlur());
  assert.deepEqual(renamed, [["group", "工作 项目🚀"]]);
});

test("group rename starts with the current name and Return saves the new draft", async (t) => {
  const { GroupHeader } = loadClient("rows.tsx");
  let props;
  let renderer;
  const renamed = [];
  props = {
    group: { id: "group", name: "Original", projects: [] },
    count: 0,
    collapsed: false,
    renaming: false,
    dragging: false,
    view,
    onToggle: noop,
    onStartRename: () => {
      props = { ...props, renaming: true };
      renderer.update(React.createElement(GroupHeader, props));
    },
    onRename: (id, name) => renamed.push([id, name]),
    onCancelRename: noop,
    onDelete: noop,
  };
  await act(() => {
    renderer = create(React.createElement(GroupHeader, props));
  });
  t.after(async () => act(() => renderer.unmount()));
  // A remote rename before editing must seed both the display and the saved draft.
  props = { ...props, group: { ...props.group, name: "新名称" } };
  await act(() => renderer.update(React.createElement(GroupHeader, props)));
  await act(() => button(renderer, "group.rename").props.onPress());
  assert.equal(inputOf(renderer).props.defaultValue, "新名称");
  await act(() => inputOf(renderer).props.onChangeText("新的分组"));
  await act(() => inputOf(renderer).props.onSubmitEditing());
  assert.deepEqual(renamed, [["group", "新的分组"]]);
});
