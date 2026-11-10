import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import core, { applyCore, CORE_FILE, disabledBy, localFileFrom, readOverlay } from "./index.ts";

const CORE = "# Core\n\nCore body.\n";
const OVERLAY = "# Local\n\nOverlay body.\n";
const options = (over: Partial<Record<string, unknown>> = {}) => ({
  customPrompt: undefined as string | undefined,
  appendSystemPrompt: "",
  contextFiles: [
    { path: "/home/u/.pi/agent/AGENTS.md", content: "user global" },
    { path: "/home/u/Projects/demo/AGENTS.md", content: "project rules" },
  ],
  skills: [{ name: "jit-design", description: "Use explicitly for JIT.", disableModelInvocation: true }],
  ...over,
});

test("plain session: CORE then overlay appended; nothing else touched", () => {
  const o = options();
  const before = { contextFiles: JSON.stringify(o.contextFiles), skills: JSON.stringify(o.skills) };
  assert.deepEqual(applyCore(o, CORE, OVERLAY), { core: true, overlay: true });
  assert.equal(o.appendSystemPrompt, "# Core\n\nCore body.\n\n# Local\n\nOverlay body.");
  assert.equal(o.customPrompt, undefined);
  assert.equal(JSON.stringify(o.contextFiles), before.contextFiles);
  assert.equal(JSON.stringify(o.skills), before.skills);
});

test("no overlay: CORE only", () => {
  const o = options();
  assert.deepEqual(applyCore(o, CORE, undefined), { core: true, overlay: false });
  assert.equal(o.appendSystemPrompt, "# Core\n\nCore body.");
});

test("replace-mode child (--system-prompt): its prompt is kept verbatim, CORE still appended", () => {
  const o = options({ customPrompt: "You are the researcher agent." });
  applyCore(o, CORE, undefined);
  assert.equal(o.customPrompt, "You are the researcher agent.");
  assert.equal(o.appendSystemPrompt, "# Core\n\nCore body.");
});

test("append-mode child (--append-system-prompt): its text stays first, CORE after", () => {
  const o = options({ appendSystemPrompt: "You are the delegate agent.\n" });
  applyCore(o, CORE, OVERLAY);
  assert.equal(o.appendSystemPrompt, "You are the delegate agent.\n\n# Core\n\nCore body.\n\n# Local\n\nOverlay body.");
});

test("host that already composed CORE (generated baseline = CORE + overlay): nothing added", () => {
  const o = options({ appendSystemPrompt: `${CORE}\n${OVERLAY}` });
  const before = o.appendSystemPrompt;
  assert.deepEqual(applyCore(o, CORE, OVERLAY), { core: false, overlay: false });
  assert.equal(o.appendSystemPrompt, before);
});

test("host that delivers CORE as a context file (AGENTS.md generated from CORE + overlay): nothing added", () => {
  const o = options({ contextFiles: [{ path: "/home/u/Projects/demo/AGENTS.md", content: `${CORE}\n${OVERLAY}` }] });
  assert.deepEqual(applyCore(o, CORE, OVERLAY), { core: false, overlay: false });
  assert.equal(o.appendSystemPrompt, "");
});

test("context file with only CORE: overlay still appended", () => {
  const o = options({ contextFiles: [{ path: "/home/u/Projects/demo/AGENTS.md", content: CORE }] });
  assert.deepEqual(applyCore(o, CORE, OVERLAY), { core: false, overlay: true });
  assert.equal(o.appendSystemPrompt, "# Local\n\nOverlay body.");
});

test("idempotent: second application changes nothing", () => {
  const o = options({ appendSystemPrompt: "role append" });
  applyCore(o, CORE, OVERLAY);
  const before = o.appendSystemPrompt;
  assert.deepEqual(applyCore(o, CORE, OVERLAY), { core: false, overlay: false });
  assert.equal(o.appendSystemPrompt, before);
});

test("empty CORE refuses; empty overlay is ignored", () => {
  assert.throws(() => applyCore(options(), "  \n", OVERLAY), /empty/);
  const o = options();
  assert.deepEqual(applyCore(o, CORE, "  \n"), { core: true, overlay: false });
});

test("bundled CORE.md exists, is non-empty and is the one the extension reads", () => {
  assert.match(CORE_FILE, /\/CORE\.md$/);
  const text = readFileSync(CORE_FILE, "utf8");
  assert.match(text, /^# Core\n/);
  assert.ok(text.split(/\s+/).length > 800, "CORE.md unexpectedly short");
});

test("overlay path: agent dir default, PI_CODING_AGENT_DIR, PI_CORE_LOCAL_FILE", () => {
  assert.match(localFileFrom({}), /\/\.pi\/agent\/core\.local\.md$/);
  assert.equal(localFileFrom({ PI_CODING_AGENT_DIR: "/x/agent" }), "/x/agent/core.local.md");
  assert.equal(localFileFrom({ PI_CODING_AGENT_DIR: "/x/agent", PI_CORE_LOCAL_FILE: "/y/local.md" }), "/y/local.md");
});

test("readOverlay: missing is undefined, unreadable throws", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-core-"));
  try {
    assert.equal(readOverlay(join(dir, "none.md")), undefined);
    const f = join(dir, "local.md");
    writeFileSync(f, OVERLAY);
    assert.equal(readOverlay(f), OVERLAY);
    chmodSync(f, 0o000);
    if (process.getuid?.() !== 0) assert.throws(() => readOverlay(f));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("opt-out env", () => {
  assert.equal(disabledBy({}), false);
  assert.equal(disabledBy({ PI_CORE_DISABLE: "0" }), false);
  assert.equal(disabledBy({ PI_CORE_DISABLE: "false" }), false);
  assert.equal(disabledBy({ PI_CORE_DISABLE: "1" }), true);
  assert.equal(disabledBy({ PI_CORE_DISABLE: "yes" }), true);
});

async function runExtension(env: Record<string, string | undefined>, event: Record<string, unknown>, ctx: Record<string, unknown> = { hasUI: false }) {
  const saved: Record<string, string | undefined> = {};
  for (const k of ["PI_CORE_DISABLE", "PI_CORE_LOCAL_FILE", "PI_CODING_AGENT_DIR"]) { saved[k] = process.env[k]; delete process.env[k]; }
  for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
  try {
    const handlers: Record<string, (e: unknown, c: unknown) => unknown> = {};
    core({ on: (name: string, fn: (e: unknown, c: unknown) => unknown) => { handlers[name] = fn; } } as never);
    assert.deepEqual(Object.keys(handlers), ["before_agent_start"]);
    await handlers.before_agent_start(event, ctx);
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

test("live event shape: bundled CORE and a real overlay file are appended after the role append", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-core-"));
  try {
    writeFileSync(join(dir, "core.local.md"), OVERLAY);
    const event = { systemPromptOptions: options({ customPrompt: "role", appendSystemPrompt: "role append" }) };
    await runExtension({ PI_CODING_AGENT_DIR: dir }, event);
    const a = event.systemPromptOptions.appendSystemPrompt;
    assert.equal(event.systemPromptOptions.customPrompt, "role");
    assert.ok(a.startsWith("role append\n\n# Core\n"));
    assert.ok(a.endsWith("# Local\n\nOverlay body."));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("PI_CORE_DISABLE=1: event untouched", async () => {
  const event = { systemPromptOptions: options({ appendSystemPrompt: "x" }) };
  await runExtension({ PI_CORE_DISABLE: "1" }, event);
  assert.equal(event.systemPromptOptions.appendSystemPrompt, "x");
});

test("older SDK without systemPromptOptions: no throw, event untouched", async () => {
  const event: Record<string, unknown> = { prompt: "hi" };
  await runExtension({}, event);
  assert.deepEqual(event, { prompt: "hi" });
});

test("unreadable overlay: warns once through the UI, CORE still applied, no stdout", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-core-"));
  const out: string[] = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  (process.stdout as { write: unknown }).write = (chunk: unknown) => { out.push(String(chunk)); return true; };
  try {
    const f = join(dir, "core.local.md");
    writeFileSync(f, OVERLAY);
    chmodSync(f, 0o000);
    if (process.getuid?.() === 0) return;
    const notices: string[] = [];
    const ctx = { hasUI: true, ui: { notify: (m: string) => notices.push(m) } };
    const event = { systemPromptOptions: options() };
    await runExtension({ PI_CODING_AGENT_DIR: dir }, event, ctx);
    assert.ok(event.systemPromptOptions.appendSystemPrompt.startsWith("# Core\n"));
    assert.ok(!event.systemPromptOptions.appendSystemPrompt.includes("Overlay body"));
    assert.equal(notices.length, 1);
    assert.match(notices[0], /cannot read .*core\.local\.md/);
    assert.deepEqual(out, []);
  } finally {
    (process.stdout as { write: unknown }).write = origWrite;
    rmSync(dir, { recursive: true, force: true });
  }
});
