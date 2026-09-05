import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

interface StoredConnection {
  agent: string;
  operator?: string | null;
  projects: Array<{ id: number; name: string }>;
  repos?: string[];
  trust?: {
    mode: "operator" | "allowlist" | "project" | "domain";
    allow?: string[];
    allow_domain?: string[];
    allow_assignments?: boolean;
  };
  types?: string;
  chat_poll?: number;
  boost_poll?: number | null;
}

interface ConnectorEvent {
  event_id?: number;
  kind?: string;
  creator?: { id?: number; name?: string };
  recording?: { url?: string };
  trigger?: { subscribed?: boolean };
  [key: string]: unknown;
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const skill = join(root, "skills/basecamp-connect/SKILL.md");
const store = join(homedir(), ".config/basecamp-connect/last.json");

export default function (pi: ExtensionAPI) {
  let connector: ChildProcessWithoutNullStreams | undefined;
  let agentId: number | undefined;

  function status(ctx: ExtensionContext, text?: string): void {
    ctx.ui.setStatus("basecamp", text ? `basecamp ${text}` : undefined);
  }

  async function loadConnection(): Promise<StoredConnection> {
    return JSON.parse(await readFile(store, "utf8")) as StoredConnection;
  }

  function connectorArgs(config: StoredConnection): string[] {
    const args = [`@${config.agent}`];
    for (const project of config.projects) args.push("--project", String(project.id));
    for (const repo of config.repos ?? []) args.push("--repo", repo);
    if (config.operator) args.push("--operator", config.operator);
    if (config.trust) {
      args.push("--trust", config.trust.mode);
      for (const email of config.trust.allow ?? []) args.push("--allow", email);
      for (const domain of config.trust.allow_domain ?? []) args.push("--allow-domain", domain);
      if (config.trust.allow_assignments) args.push("--allow-assignments-from-authorized");
    }
    if (config.types) args.push("--types", config.types);
    if (config.chat_poll) args.push("--chat-poll", String(config.chat_poll));
    if (config.boost_poll === null) args.push("--no-boosts");
    else if (config.boost_poll) args.push("--boost-poll", String(config.boost_poll));
    return args;
  }

  async function resolveAgentId(agent: string): Promise<number> {
    const result = await pi.exec("basecamp", ["people", "show", "me", "--profile", agent, "-j"]);
    if (result.code !== 0) throw new Error(result.stderr || "Could not resolve Basecamp agent profile");
    const parsed = JSON.parse(result.stdout) as { data?: { id?: number }; id?: number };
    const id = parsed.data?.id ?? parsed.id;
    if (!id) throw new Error("Basecamp agent profile returned no Person ID");
    return id;
  }

  function needsAck(event: ConnectorEvent): boolean {
    return Boolean(event.recording?.url) && event.kind !== "boost_created" && !event.trigger?.subscribed;
  }

  async function subagentRequest(method: "ping" | "spawn", params: Record<string, unknown> = {}): Promise<void> {
    const requestId = randomUUID();
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        reject(new Error("pi-subagents did not answer within 10 seconds"));
      }, 10_000);
      const unsubscribe = pi.events.on(`subagents:rpc:v1:reply:${requestId}`, (raw) => {
        clearTimeout(timeout);
        unsubscribe();
        const reply = raw as { success?: boolean; error?: { message?: string } };
        if (reply.success) resolve();
        else reject(new Error(reply.error?.message ?? `pi-subagents rejected ${method}`));
      });
      pi.events.emit("subagents:rpc:v1:request", { version: 1, requestId, method, params });
    });
  }

  function spawnWorker(task: string, cwd: string): Promise<void> {
    return subagentRequest("spawn", { agent: "worker", task, cwd, context: "fresh", async: true });
  }

  async function handleEvent(event: ConnectorEvent, config: StoredConnection, ctx: ExtensionContext): Promise<void> {
    if (event.creator?.id === agentId) return;

    let ackOwed = false;
    if (needsAck(event)) {
      const ack = await pi.exec("basecamp", [
        "boost", "create", event.recording!.url!, "Taking a look", "--profile", config.agent,
      ]);
      ackOwed = ack.code !== 0;
    }

    const task = `You own one trusted Basecamp connector event. Read ${skill} in full and follow its dispatched-worker rules.\n\nWork repo: ${ctx.cwd}\nAgent profile: ${config.agent}\nAgent Basecamp Person ID: ${agentId}\nAck still owed: ${ackOwed}\nFull trusted event: ${JSON.stringify(event)}\n\nGather context, do and check the work, then reply on the source recording as ${config.agent}. Do not start or stop the connector.`;
    await spawnWorker(task, ctx.cwd);
    ctx.ui.notify("Basecamp subagent started", "info");
  }

  async function connect(ctx: ExtensionContext): Promise<void> {
    if (connector) return void ctx.ui.notify("Basecamp connector is already running in this session", "info");

    const config = await loadConnection();
    await subagentRequest("ping");
    agentId = await resolveAgentId(config.agent);
    connector = spawn(join(root, "bin/connect"), connectorArgs(config), {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    status(ctx, "connecting");

    createInterface({ input: connector.stdout }).on("line", (line) => {
      if (!line.startsWith("{")) return;
      try {
        void handleEvent(JSON.parse(line) as ConnectorEvent, config, ctx).catch((error) => {
          ctx.ui.notify(`Basecamp event failed: ${String(error)}`, "error");
        });
      } catch (error) {
        ctx.ui.notify(`Invalid Basecamp event: ${String(error)}`, "error");
      }
    });
    connector.stderr.on("data", (data) => {
      const line = String(data).trim();
      if (line.includes("Listening for") || line.includes("Polling")) status(ctx, "connected");
    });
    connector.on("exit", (code) => {
      connector = undefined;
      status(ctx);
      if (code) ctx.ui.notify(`Basecamp connector exited (${code})`, "error");
    });
  }

  async function disconnect(ctx: ExtensionContext): Promise<void> {
    if (!connector) return;
    connector.kill("SIGTERM");
    connector = undefined;
    status(ctx);
  }

  pi.registerCommand("basecamp-connect", {
    description: "Start the stored Basecamp connection in this Pi session",
    handler: async (_args, ctx) => connect(ctx),
  });
  pi.registerCommand("basecamp-disconnect", {
    description: "Stop this Pi session's Basecamp connection",
    handler: async (_args, ctx) => disconnect(ctx),
  });
  pi.registerCommand("basecamp-status", {
    description: "Show this Pi session's Basecamp connection status",
    handler: async (_args, ctx) => ctx.ui.notify(connector ? "Basecamp connected" : "Basecamp disconnected", "info"),
  });
  pi.on("session_shutdown", async (_event, ctx) => disconnect(ctx));
}
