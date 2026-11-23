import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/**
 * Removes a project from Paseo through the plugin's local daemon connection, because the plugin
 * SDK has no project removal call. Paseo archives the project's workspaces; files on disk stay.
 * `hostId` makes the server refuse a project that belongs to another host.
 */
export const removeProjectRpc = defineRpc({
  name: "project.remove",
  input: z.object({ projectId: z.string().min(1), hostId: z.string().min(1).optional() }),
  output: z.object({ removedWorkspaceIds: z.array(z.string()) }),
});

/**
 * The daemon's own server id and project ids, read over the local daemon connection. Unlike the
 * client's project list, this answer is never partial: it fails instead.
 */
export const projectIdsRpc = defineRpc({
  name: "project.ids",
  input: z.object({}),
  output: z.object({ serverId: z.string(), projectIds: z.array(z.string()) }),
});

/** Paseo's uploaded or discovered icon. SVGs use the host renderer on native clients too. */
export const projectIconSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("image"), uri: z.string() }),
  z.object({ kind: z.literal("svg"), svg: z.string() }),
]);

export type ProjectIcon = z.infer<typeof projectIconSchema>;

export const projectIconRpc = defineRpc({
  name: "project.icon",
  input: z.object({ hostId: z.string().min(1), projectId: z.string().min(1) }),
  output: z.object({ icon: projectIconSchema.nullable() }),
});

/**
 * A host's workspace labels with their colors, which the plugin SDK does not expose. `labels` is
 * null when the call reached another host's daemon.
 */
export const labelCatalogRpc = defineRpc({
  name: "labels.list",
  input: z.object({ hostId: z.string().min(1) }),
  output: z.object({ labels: z.array(z.object({ name: z.string(), color: z.string() })).nullable() }),
});

/** Mark as read clears a workspace's attention; mark as unread sets it again. */
export const markWorkspaceRpc = defineRpc({
  name: "workspace.mark",
  input: z.object({ hostId: z.string().min(1), workspaceId: z.string().min(1), read: z.boolean() }),
  output: z.object({ done: z.boolean() }),
});
