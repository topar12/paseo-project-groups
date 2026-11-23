/// <reference types="node" />
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { projectIdsRpc, removeProjectRpc } from "../shared/rpc";
import { connectLocalDaemon } from "./project-icon";

/**
 * The daemon calls these handlers need. They go over the same local connection as icons and
 * labels, because the plugin API has no project removal. Running the `paseo` CLI instead failed
 * on some installs with `spawn EINVAL`, so nothing here starts a process.
 */
export interface ProjectDaemon {
  close(): Promise<void>;
  getLastServerInfoMessage(): { serverId: string } | null;
  listProjects(): Promise<{ projects?: readonly { projectId?: unknown }[] }>;
  removeProject(projectId: string): Promise<{ removedWorkspaceIds?: readonly string[] }>;
}

export const NOT_ON_THIS_DAEMON =
  "This project is not on the daemon running the plugin. Remove it from the default sidebar view.";

export function createProjectActions(
  connect: () => Promise<ProjectDaemon> = () => connectLocalDaemon("cid_project_groups_projects"),
) {
  /** One short connection per call: removal and the parent check are rare. */
  async function withDaemon<T>(call: (daemon: ProjectDaemon) => Promise<T>): Promise<T> {
    const daemon = await connect();
    try {
      return await call(daemon);
    } finally {
      await daemon.close().catch(() => {});
    }
  }

  /** The daemon's own answer, never a partial client list: it fails instead. */
  async function ownProjects(daemon: ProjectDaemon): Promise<RpcOutput<typeof projectIdsRpc>> {
    const serverId = daemon.getLastServerInfoMessage()?.serverId;
    const listed = (await daemon.listProjects())?.projects;
    if (typeof serverId !== "string" || !Array.isArray(listed)) {
      throw new Error("Unexpected answer from the Paseo daemon.");
    }
    return {
      serverId,
      projectIds: listed.flatMap((project) => (typeof project.projectId === "string" ? [project.projectId] : [])),
    };
  }

  return {
    projectIds: (): Promise<RpcOutput<typeof projectIdsRpc>> => withDaemon(ownProjects),

    removeProject: ({
      projectId,
      hostId,
    }: RpcInput<typeof removeProjectRpc>): Promise<RpcOutput<typeof removeProjectRpc>> =>
      withDaemon(async (daemon) => {
        // A project shown from another host must never be removed here by mistake.
        const own = await ownProjects(daemon);
        if ((hostId !== undefined && hostId !== own.serverId) || !own.projectIds.includes(projectId)) {
          throw new Error(NOT_ON_THIS_DAEMON);
        }
        console.log(`[project-groups] removing project ${projectId}`);
        const result = await daemon.removeProject(projectId);
        return { removedWorkspaceIds: [...(result?.removedWorkspaceIds ?? [])] };
      }),
  };
}
