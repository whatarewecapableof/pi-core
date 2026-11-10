import { getCurrentSystemMessage } from "@earendil-works/pi-ai";
import { getDocsPath, getExamplesPath, getReadmePath, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";

const PREAMBLE = "You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.";

function selectedNativeClaude(ctx: ExtensionContext): boolean {
  return ctx.model?.provider === "anthropic" && ctx.model.id.startsWith("claude-") && ctx.modelRegistry.isUsingOAuth(ctx.model);
}

/** Exact default matching preserves custom docs and fails unchanged on upstream drift. */
function defaultDocs(): string {
  return `<docs>\nPi documentation (read only when the user asks about pi itself, its SDK, extensions, themes, skills, or TUI):
- Main documentation: ${getReadmePath()}
- Additional docs: ${getDocsPath()}
- Examples: ${getExamplesPath()} (extensions, custom tools, SDK)
- When reading pi docs or examples, resolve docs/... under Additional docs and examples/... under Examples, not the current working directory
- When asked about: extensions (docs/extensions.md, examples/extensions/), themes (docs/themes.md), skills (docs/skills.md), prompt templates (docs/prompt-templates.md), TUI components (docs/tui.md), keybindings (docs/keybindings.md), SDK integrations (docs/sdk.md), custom providers (docs/custom-provider.md), adding models (docs/models.md), pi packages (docs/packages.md), environment variables (docs/environment-variables.md), MCP servers (docs/mcp.md), codemode scripts and non-LLM models such as classifiers and image models (docs/codemode.md)
- When working on pi topics, read the docs and examples, and follow .md cross-references before implementing
- Always read pi .md files completely and follow links to related docs (e.g., tui.md for TUI API details)\n</docs>`;
}

/** Keep Pi docs discoverable for typed and native callback turns without transport or identity changes. */
export default function nativeClaudeDocs(pi: ExtensionAPI): void {
  const pointer = `Pi documentation: begin with ${getReadmePath()}. For Pi-specific work, read the relevant docs/ and examples/ inside that installed package; resolve references there, read the referenced Markdown files completely and follow cross-references before implementing. Otherwise do not load these manuals.`;
  const originalDocs = defaultDocs();
  const pointerDocs = `<docs>\n${pointer}\n</docs>`;
  pi.on("before_agent_start", (event, ctx) => {
    if (!selectedNativeClaude(ctx)) return;
    const options = event.systemPromptOptions;
    if (options.customPrompt || options.forceSystemPrompt !== undefined || options.sections.docs !== undefined) return;
    options.sections.docs = pointer;
  });
  pi.on("context_with_system", (event, ctx) => {
    if (!selectedNativeClaude(ctx) || event.messages[0]?.role !== "system") return;
    const current = getCurrentSystemMessage(event.messages);
    if (current?.content !== "" || current.sections?.preamble !== PREAMBLE || (current.sections.docs !== originalDocs && current.sections.docs !== pointerDocs) || !Array.isArray(current.toolsAdded)) return;
    return {
      messages: event.messages.map((message) => message.role === "system" && message.sections?.docs === originalDocs
        ? { ...message, sections: { ...message.sections, docs: pointerDocs } }
        : message),
    };
  });
}
