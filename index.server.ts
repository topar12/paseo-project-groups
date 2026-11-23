import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createProjectActions } from "./server/remove-project";
import { createProjectIconReader } from "./server/project-icon";
import { createWorkspaceActions } from "./server/workspace-actions";
import { labelCatalogRpc, markWorkspaceRpc, projectIconRpc, projectIdsRpc, removeProjectRpc } from "./shared/rpc";
import { decorationsDocument, groupsDocument } from "./shared/settings";

export default function contribute(server: PluginServerContext) {
  // Host-scoped documents are stored by the daemon, so the server entry registers them.
  server.registerSettings(groupsDocument);
  server.registerSettings(decorationsDocument);
  const projects = createProjectActions();
  server.handle(removeProjectRpc, projects.removeProject);
  server.handle(projectIdsRpc, projects.projectIds);
  const icons = createProjectIconReader();
  server.handle(projectIconRpc, icons.read);
  const workspaces = createWorkspaceActions();
  server.handle(labelCatalogRpc, workspaces.labels);
  server.handle(markWorkspaceRpc, workspaces.mark);
  return async () => {
    await Promise.all([icons.close(), workspaces.close()]);
  };
}
