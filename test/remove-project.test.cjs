const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

// Values made inside the vm context have their own Array prototype, so compare plain copies.
const plain = (value) => JSON.parse(JSON.stringify(value));

function load(file, modules) {
  const { outputText } = ts.transpileModule(readFileSync(path.join(__dirname, "..", file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const exports = {};
  vm.runInNewContext(outputText, {
    exports,
    console: { log() {} },
    require: (name) => {
      assert.ok(name in modules, `Unexpected import: ${name}`);
      return modules[name];
    },
  });
  return exports;
}

const { createProjectActions, NOT_ON_THIS_DAEMON } = load("server/remove-project.ts", {
  "./project-icon": { connectLocalDaemon: () => assert.fail("tests pass their own daemon") },
});

function fakeDaemon({ serverId = "srv_local", projects = ["prj_a", "prj_b"], removed = ["wks_1"] } = {}) {
  const calls = { removed: [], closed: 0 };
  return {
    calls,
    daemon: {
      getLastServerInfoMessage: () => ({ serverId }),
      listProjects: async () => ({ requestId: "r", projects: projects.map((projectId) => ({ projectId })) }),
      removeProject: async (projectId) => {
        calls.removed.push(projectId);
        return { removedWorkspaceIds: removed };
      },
      close: async () => {
        calls.closed++;
      },
    },
  };
}

test("removal goes through the daemon connection, not a CLI process", async () => {
  const { daemon, calls } = fakeDaemon();
  const actions = createProjectActions(async () => daemon);
  const result = await actions.removeProject({ projectId: "prj_a", hostId: "srv_local" });
  assert.deepEqual(plain(result), { removedWorkspaceIds: ["wks_1"] });
  assert.deepEqual(calls.removed, ["prj_a"]);
  assert.equal(calls.closed, 1);
});

test("a project of another host or one the daemon does not list is never removed", async () => {
  const { daemon, calls } = fakeDaemon();
  const actions = createProjectActions(async () => daemon);
  await assert.rejects(actions.removeProject({ projectId: "prj_a", hostId: "srv_other" }), { message: NOT_ON_THIS_DAEMON });
  await assert.rejects(actions.removeProject({ projectId: "prj_gone", hostId: "srv_local" }), { message: NOT_ON_THIS_DAEMON });
  assert.deepEqual(calls.removed, []);
  assert.equal(calls.closed, 2);
});

test("project ids come from the daemon itself and fail on an unexpected answer", async () => {
  const { daemon } = fakeDaemon({ projects: ["prj_a"] });
  assert.deepEqual(plain(await createProjectActions(async () => daemon).projectIds()), {
    serverId: "srv_local",
    projectIds: ["prj_a"],
  });
  const broken = { ...daemon, listProjects: async () => ({ error: "nope" }) };
  await assert.rejects(createProjectActions(async () => broken).projectIds(), /Unexpected answer/);
});
