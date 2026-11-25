const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createLoader } = require("./helpers/loader.cjs");

const load = createLoader();
const text = load("client/text.ts");
const cases = [
  ["👨‍👩‍👧‍👦", 2, "👨‍👩‍👧‍👦"],
  ["🏴󠁧󠁢󠁥󠁮󠁧󠁿x", 1, "🏴󠁧󠁢󠁥󠁮󠁧󠁿"],
  ["🇰🇷🇯🇵🇺🇸", 2, "🇰🇷🇯🇵"],
  ["👍🏽👍🏽👍🏽", 2, "👍🏽👍🏽"],
  ["❤️🚀", 1, "❤️"],
  ["1️⃣2️⃣3️⃣", 2, "1️⃣2️⃣"],
  ["a🚀🚀🚀🚀", 2, "a🚀"],
  ["가나다", 2, "가나"],
  ["", 2, ""],
];

test("emoji input keeps whole emoji", () => {
  for (const [input, count, expected] of cases) {
    assert.equal(text.firstGraphemes(input, count), expected, input);
  }
});

test("the fallback for engines without Intl.Segmenter splits the same way", () => {
  for (const [input, count, expected] of cases) {
    assert.equal(text.graphemesWithoutSegmenter(input).slice(0, count).join(""), expected, input);
  }
});

const { createSettingsSaver, stableJson } = load("client/save.ts");

/**
 * A settings document that behaves like Paseo's: a save against an old revision fails, and the
 * new revision reaches the reader a little after the save resolves, as a React render would.
 */
function documentStore(values, { afterWrite } = {}) {
  let stored = { revision: "r0", values };
  let shown = stored;
  let count = 0;
  const commit = (next) => {
    count += 1;
    stored = { revision: `r${count}`, values: next };
    const rendered = stored;
    setTimeout(() => {
      shown = rendered;
    }, 15);
  };
  return {
    read: () => ({
      status: "ready",
      revision: shown.revision,
      values: shown.values,
      async save(next, revision) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        if (revision !== stored.revision) return false;
        commit(next);
        afterWrite?.();
        return true;
      },
    }),
    stored: () => stored.values,
    /** Another client, such as the phone, saves the document. */
    remote: commit,
  };
}

test("two quick saves both land, in order", async () => {
  const store = documentStore({ collapsed: [] });
  const saver = createSettingsSaver(store.read);
  const first = saver.save({ collapsed: ["g:a"] });
  const second = saver.save({ collapsed: ["g:a", "g:b"] });
  assert.equal(saver.busy(), true);
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.deepEqual(store.stored(), { collapsed: ["g:a", "g:b"] });
  assert.equal(saver.busy(), false);
});

test("a change from another client is never overwritten", async () => {
  let phoneWrote = false;
  const store = documentStore(
    { collapsed: [] },
    {
      afterWrite() {
        if (phoneWrote) return;
        phoneWrote = true;
        store.remote({ collapsed: ["from-phone"] });
      },
    },
  );
  const saver = createSettingsSaver(store.read);
  const first = saver.save({ collapsed: ["mine"] });
  const second = saver.save({ collapsed: ["mine", "next"] });
  assert.deepEqual(await Promise.all([first, second]), [true, false]);
  assert.deepEqual(store.stored(), { collapsed: ["from-phone"] });
});

test("documents compare equal whatever their key order", () => {
  assert.equal(stableJson({ b: 1, a: [{ y: 2, x: null }] }), stableJson({ a: [{ x: null, y: 2 }], b: 1 }));
  assert.notEqual(stableJson({ a: 1 }), stableJson({ a: 2 }));
});
