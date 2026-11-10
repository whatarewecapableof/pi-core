// pi-core: one shared instruction set for every Pi session, plus an optional local overlay.
//
// At before_agent_start the bundled CORE.md is appended to the system prompt, then the overlay
// (~/.pi/agent/core.local.md, or PI_CORE_LOCAL_FILE) if present. Both are read fresh on every run.
// Additive only: the caller's own prompts (--system-prompt, --append-system-prompt), project
// AGENTS files, the user's global ~/.pi/agent/AGENTS.md and skills are left exactly as Pi loaded
// them. CORE goes after any existing append text so a child's role prompt stays first.
// Idempotent: text already present in the append is not added again, so a host that composes
// CORE itself (a Web daemon reading a generated baseline) gets it once.
// Writes nothing to stdout: headless callers relay stdout. Warnings go to the UI when there is one.
// PI_CORE_DISABLE=1 turns it off for isolated workers. Older SDKs without systemPromptOptions are
// left alone rather than crashed.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type Env = Record<string, string | undefined>;
export interface PromptOptions {
  customPrompt?: string;
  appendSystemPrompt: string;
  [key: string]: unknown;
}
export interface Applied { core: boolean; overlay: boolean }

export const CORE_FILE = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), "CORE.md");

export function localFileFrom(env: Env): string {
  return env.PI_CORE_LOCAL_FILE || join(env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"), "core.local.md");
}

export function disabledBy(env: Env): boolean {
  const v = env.PI_CORE_DISABLE;
  return v !== undefined && v !== "" && v !== "0" && v.toLowerCase() !== "false";
}

function appendOnce(options: PromptOptions, text: string): boolean {
  const body = text.trim();
  if (!body || options.appendSystemPrompt.includes(body)) return false;
  const current = options.appendSystemPrompt.trimEnd();
  options.appendSystemPrompt = current ? `${current}\n\n${body}` : body;
  return true;
}

/** Mutates options in place. Returns what was added, for tests. */
export function applyCore(options: PromptOptions, core: string, overlay: string | undefined): Applied {
  if (!core.trim()) throw new Error("pi-core: CORE.md is empty");
  return { core: appendOnce(options, core), overlay: overlay === undefined ? false : appendOnce(options, overlay) };
}

export function readOverlay(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export default function core(pi: ExtensionAPI) {
  const env = process.env as Env;
  const warned = new Set<string>();
  const warn = (ctx: { hasUI?: boolean; ui?: { notify?: (m: string, k: string) => void } }, key: string, message: string) => {
    if (warned.has(key)) return;
    warned.add(key);
    if (ctx.hasUI && ctx.ui?.notify) ctx.ui.notify(`pi-core: ${message}`, "warning");
  };

  pi.on("before_agent_start", async (event, ctx) => {
    if (disabledBy(env)) return;
    const options = (event as { systemPromptOptions?: PromptOptions }).systemPromptOptions;
    if (!options || typeof options.appendSystemPrompt !== "string") return;

    let coreText: string;
    try {
      coreText = readFileSync(CORE_FILE, "utf8");
    } catch {
      warn(ctx, "core", `cannot read ${CORE_FILE}; using stock instructions`);
      return;
    }
    const localFile = localFileFrom(env);
    let overlay: string | undefined;
    try {
      overlay = readOverlay(localFile);
    } catch {
      warn(ctx, "overlay", `cannot read ${localFile}; continuing without the local overlay`);
      overlay = undefined;
    }
    try {
      applyCore(options, coreText, overlay);
    } catch (error) {
      warn(ctx, "apply", (error as Error).message);
    }
  });
}
