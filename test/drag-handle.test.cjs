const assert = require("node:assert/strict");
const { test } = require("node:test");
const React = require("react");
const { act, create } = require("react-test-renderer");
const { createLoader } = require("./helpers/loader.cjs");

const drag = createLoader()("client/drag.tsx");

/** Renders a row's drag handle with a fake controller. Returns the handle and the press count. */
function mount({ mouse, dragging = () => false }) {
  const controller = { armTouch: () => !mouse, release: () => {}, isDragging: dragging };
  const pressed = { count: 0 };
  let handle;
  function Row() {
    handle = drag.useDragHandle({ kind: "group", id: "g1", label: "Group" }, () => {
      pressed.count += 1;
    });
    return null;
  }
  act(() => {
    create(React.createElement(drag.DragProvider, { value: controller }, React.createElement(Row)));
  });
  return { handle, pressed };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

test("a still mouse long press runs the row's press on release", async () => {
  const { handle, pressed } = mount({ mouse: true });
  handle.onLongPress();
  handle.onPressOut();
  await settle();
  assert.equal(pressed.count, 1);
});

test("a mouse long press that turns into a drag does not press the row", async () => {
  const { handle, pressed } = mount({ mouse: true, dragging: () => true });
  handle.onLongPress();
  handle.onPressOut();
  await settle();
  assert.equal(pressed.count, 0);
});

test("a touch long press only arms the drag", async () => {
  const { handle, pressed } = mount({ mouse: false });
  handle.onLongPress();
  handle.onPressOut();
  await settle();
  assert.equal(pressed.count, 0);
});

test("a short press leaves the press to the row", async () => {
  const { handle, pressed } = mount({ mouse: true });
  handle.onPressOut();
  await settle();
  assert.equal(pressed.count, 0);
});
