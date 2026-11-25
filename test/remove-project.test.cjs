const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createLoader, plain } = require("./helpers/loader.cjs");

const { createProjectActions, NOT_ON_THIS_DAEMON } = createLoader({}, { console: { log() {} } })(
  "server/remove-project.ts",
);

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
  await assert.rejects(actions.removeProject({ projectId: "prj_a", hostId: "srv_other" }), {
    message: NOT_ON_THIS_DAEMON,
  });
  await assert.rejects(actions.removeProject({ projectId: "prj_gone", hostId: "srv_local" }), {
    message: NOT_ON_THIS_DAEMON,
  });
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
