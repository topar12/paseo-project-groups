const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createLoader } = require("./helpers/loader.cjs");

const load = createLoader();
const { RESOURCES } = load("client/messages.ts");
const { translator } = load("client/i18n.ts");

function flatten(tree, prefix = "", out = new Map()) {
  for (const [key, value] of Object.entries(tree)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      out.set(full, value);
    } else if (value && typeof value === "object") {
      flatten(value, full, out);
    } else {
      assert.fail(`Unexpected resource value at ${full}: ${typeof value}`);
    }
  }
  return out;
}

function placeholders(text) {
  return [...new Set([...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((match) => match[1]))].sort();
}

const en = flatten(RESOURCES.en);
const locales = ["ko", "zh-CN"];

for (const locale of locales) {
  test(`i18n parity: ${locale} matches every en key and {{placeholder}} set`, () => {
    const target = flatten(RESOURCES[locale]);
    const missing = [];
    const mismatched = [];
    const missingOther = [];

    for (const [key, enText] of en) {
      if (key.endsWith("_one")) {
        const otherKey = `${key.slice(0, -4)}_other`;
        if (!en.has(otherKey)) missingOther.push(`en:${otherKey}`);
        if (!target.has(otherKey)) missingOther.push(`${locale}:${otherKey}`);
        // ko and zh-CN omit *_one intentionally (pluralSuffix always selects *_other),
        // but if a *_one entry is present its placeholders must still match en.
        if (target.has(key)) {
          const expected = placeholders(enText);
          const actual = placeholders(target.get(key));
          if (JSON.stringify(actual) !== JSON.stringify(expected)) {
            mismatched.push(`${key}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
          }
        }
        continue;
      }

      if (!target.has(key)) {
        missing.push(key);
        continue;
      }
      const targetText = target.get(key);
      assert.ok(targetText.length > 0, `${locale}.${key} must not be empty`);
      const expected = placeholders(enText);
      const actual = placeholders(targetText);
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        mismatched.push(`${key}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    }

    const orphans = [...target.keys()].filter((key) => !en.has(key));

    assert.deepEqual(missingOther, [], `${locale} missing *_other for en *_one keys`);
    assert.deepEqual(missing, [], `${locale} missing keys from en`);
    assert.deepEqual(mismatched, [], `${locale} placeholder mismatches`);
    assert.deepEqual(orphans, [], `${locale} has orphan keys not in en`);
  });
}

test("translator resolves _one/_other plurals per language and interpolates placeholders", () => {
  const tEn = translator("en");
  const tKo = translator("ko");
  const tZh = translator("zh-CN");
  assert.equal(tEn("relation.children", { count: 1 }), "1 child agent");
  assert.equal(tEn("relation.children", { count: 3 }), "3 child agents");
  assert.equal(tKo("relation.children", { count: 1 }), "하위 에이전트 1개");
  assert.equal(tZh("relation.children", { count: 1 }), "1 个子 Agent");
});
