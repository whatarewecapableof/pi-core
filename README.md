# pi-core

One shared instruction set for every Pi session, plus an optional local overlay.

## What it does

A Pi package with one extension and one skill.

- `CORE.md`: general operating instructions. Nothing about any particular person, company, account or tool.
- `extensions/core`: at every agent start, appends `CORE.md` to the system prompt, then `~/.pi/agent/core.local.md` if it exists. Both are read fresh each run.
- `skills/browser-etiquette`: how to share the user's browser with them while automating it.

The extension is additive. It leaves alone: Pi's own prompt, `--system-prompt` and `--append-system-prompt` from callers (subagent role prompts stay first), project `AGENTS.md` files, your global `~/.pi/agent/AGENTS.md`, and skills. If the text is already in the prompt (a host that composes it itself), it is not added again. It writes nothing to stdout, so `pi -p` callers that relay stdout are safe.

## Install

```sh
pi install git:github.com/whatarewecapableof/pi-core          # tracks main
pi install git:github.com/whatarewecapableof/pi-core@stable   # tracks the promoted branch
pi update --extensions                                        # later
```

Public repository; no GitHub account needed to install.

## Local overlay

Put your own standing context in `~/.pi/agent/core.local.md`: your name, timezone, how to reach your mail, your tools, your company's naming rules. It is appended after CORE on every run. It is yours; it is never in this repo.

`PI_CORE_LOCAL_FILE=/path` overrides the location. `PI_CODING_AGENT_DIR` is respected.

## Turn it off

`PI_CORE_DISABLE=1` in the environment of a Pi process skips the extension, for isolated workers that must get only their own prompt.

## Compatibility

Tested with Pi 1.5.2. Needs `before_agent_start` with a mutable `systemPromptOptions` (Pi 1.1+). On an older SDK that lacks it, the extension does nothing rather than failing.

## Test

```sh
npm test
```

## Retired

`retired/native-claude-docs.ts` replaced Pi's default docs block with a shorter pointer for native Claude OAuth sessions on Pi 1.4, after the verbose block was one trigger of a false "extra usage" error. Its exact-text matchers do not match Pi 1.5's prompt. Kept in case the error returns; re-ship with updated matchers if it does.
