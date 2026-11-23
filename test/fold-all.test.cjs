const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

const source = readFileSync(path.join(__dirname, "..", "client", "model.ts"), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});
const model = {};
vm.runInNewContext(outputText, { exports: model, require: () => ({}) });

const keys = ["g:work", "u", "p:host/app", "p:host/app-api"];

test("collapse all folds every group, section, project and sub-project", () => {
  assert.deepEqual([...model.foldAllKeys([], keys)], keys);
});

test("collapse all keeps folds that are already there, once each", () => {
  assert.deepEqual([...model.foldAllKeys(["p:host/app", "p:other/gone"], keys)], [
    "p:host/app",
    "p:other/gone",
    "g:work",
    "u",
    "p:host/app-api",
  ]);
});

test("expand all once everything shown is folded", () => {
  assert.deepEqual([...model.foldAllKeys(keys, keys)], []);
});

test("expand all keeps the folds of projects not shown right now", () => {
  // A project on a host that is offline is not shown, so it must come back folded.
  assert.deepEqual([...model.foldAllKeys([...keys, "p:other/gone"], keys)], ["p:other/gone"]);
});
