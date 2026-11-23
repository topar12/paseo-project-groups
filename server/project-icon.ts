/// <reference types="node" />
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { findSvgIconProblem, type RpcInput, type RpcOutput } from "@getpaseo/plugin";
import type { projectIconRpc, ProjectIcon } from "../shared/rpc";

export interface IconDaemon {
  connect(): Promise<void>;
  close(): Promise<void>;
  getLastServerInfoMessage(): { serverId: string } | null;
  listProjects(): Promise<unknown>;
  getProjectIcon(projectId: string): Promise<{
    icon: { mimeType: string; data: string } | null;
    error?: string | null;
  }>;
}

/** Calls the public PaseoApi lacks: label colors, read state and project removal. */
export interface LocalDaemon extends IconDaemon {
  listProjects(): Promise<{ projects?: readonly { projectId?: unknown }[] }>;
  removeProject(projectId: string): Promise<{ removedWorkspaceIds?: readonly string[] }>;
  listWorkspaceLabels(): Promise<{ labels: readonly { name: string; color: string }[] }>;
  clearWorkspaceAttention(workspaceId: string): Promise<void>;
  markWorkspaceUnread(workspaceId: string): Promise<void>;
}

/** The public PaseoApi has no icon read yet. Isolate the host-version adapter here. */
export async function connectLocalDaemon(clientId = "cid_project_groups_icons"): Promise<LocalDaemon> {
  const entry = process.argv[1];
  if (!entry) throw new Error("Paseo host modules are unavailable");
  const require = createRequire(entry);
  const load = (name: string) => import(pathToFileURL(require.resolve(name)).href);
  const [client, control, ws] = await Promise.all([
    load("@getpaseo/client/internal/daemon-client"),
    load("@getpaseo/server/daemon-control"),
    load("ws"),
  ]);
  const home = process.env.PASEO_HOME || control.resolvePaseoHome(process.env);
  const listen = (await control.readDaemonInstance(home))?.listen?.trim();
  if (!listen) throw new Error("Paseo daemon address is unavailable");
  const socketPath = listen.startsWith("unix://") || listen.startsWith("/")
    ? listen.replace(/^unix:\/\//, "")
    : undefined;
  const url = socketPath ? `ws+unix://${socketPath}:/ws` : `ws://${listen}/ws`;
  const WebSocket = ws.default ?? ws.WebSocket;
  const daemon: LocalDaemon = new client.DaemonClient({
    url,
    clientId,
    clientType: "cli",
    localCredential: () => control.readLocalCredentialForTarget(home, listen) ?? undefined,
    connectTimeoutMs: 10_000,
    reconnect: { enabled: false },
    webSocketFactory: (target: string, config?: { headers?: Record<string, string>; protocols?: string[] }) =>
      new WebSocket(target, config?.protocols, { headers: config?.headers, ...(socketPath ? { socketPath } : {}) }),
  });
  try {
    await daemon.connect();
    return daemon;
  } catch (error) {
    await daemon.close().catch(() => {});
    throw error;
  }
}

export function renderableIcon(icon: { mimeType: string; data: string } | null): ProjectIcon | null {
  if (!icon) return null;
  if (icon.mimeType === "image/svg+xml") {
    const svg = Buffer.from(icon.data, "base64").toString("utf8")
      .replace(/^\s*<\?xml[^>]*\?>\s*/i, "");
    return findSvgIconProblem(svg) ? null : { kind: "svg", svg };
  }
  if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(icon.mimeType)) return null;
  return { kind: "image", uri: `data:${icon.mimeType};base64,${icon.data}` };
}

/** Share one local connection across rows; release it when the plugin unloads. */
export function createProjectIconReader(connect: () => Promise<IconDaemon> = connectLocalDaemon) {
  let connection: Promise<IconDaemon> | null = null;
  let stopped = false;
  const refreshes = new WeakMap<IconDaemon, Promise<unknown>>();
  const drop = async (pending: Promise<IconDaemon>) => {
    if (connection === pending) connection = null;
    await pending.then((daemon) => daemon.close()).catch(() => {});
  };
  return {
    async read({ hostId, projectId }: RpcInput<typeof projectIconRpc>): Promise<RpcOutput<typeof projectIconRpc>> {
      if (stopped) return { icon: null };
      const pending = connection ??= connect();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const icon = await Promise.race([
          pending.then(async (daemon) => {
            // Never interpret another host's project ID on this daemon.
            if (stopped || daemon.getLastServerInfoMessage()?.serverId !== hostId) return null;
            // Icon bytes belong to the daemon session's last project snapshot.
            // Coalesce concurrent rows, then refresh again for a new icon query.
            let refresh = refreshes.get(daemon);
            if (!refresh) {
              refresh = daemon.listProjects().finally(() => refreshes.delete(daemon));
              refreshes.set(daemon, refresh);
            }
            await refresh;
            if (stopped) return null;
            const result = await daemon.getProjectIcon(projectId);
            if (result.error) throw new Error(result.error);
            return renderableIcon(result.icon);
          }),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new Error("Project icon request timed out")), 10_000);
          }),
        ]);
        return { icon };
      } catch (error) {
        await drop(pending);
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    },
    async close() {
      stopped = true;
      if (connection) await drop(connection);
    },
  };
}
