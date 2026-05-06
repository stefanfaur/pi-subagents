# Design: Subagent Model Configuration Command

**Date**: 2026-05-06  
**Status**: Design approved, pending implementation plan

## Problem

The `pi-subagents` extension reads model overrides from `subagents.agentOverrides.<agentName>.model` in settings.json, but users must hand-edit this JSON. There is no interactive way to assign a specific model to a builtin subagent (e.g., "make reviewer use Claude Opus").

The extension already has all the internal plumbing:
- `saveBuiltinAgentOverride(cwd, name, scope, override)` writes to settings.json
- `removeBuiltinAgentOverride(cwd, name, scope)` clears an override
- `discoverAgentsAll(cwd)` lists agents with their current model
- `ctx.modelRegistry.getAvailable()` enumerates available models
- `ctx.ui.select()` provides TUI dialogs

## Design

### Command: `/subagents-model`

**Invocation**: `/subagents-model` (no arguments)

**Scope**: User scope only (`~/.pi/agent/settings.json`)

### Flow

#### Step 1: Agent Selection

`ctx.ui.select()` shows all builtin agents (from `discoverAgentsAll(cwd).builtin`) with:

```
reviewer (builtin) — model: anthropic/claude-sonnet-4
  Versatile review specialist for code diffs, plans, proposed solutions, codebase health, and PR/issue validation
scout (builtin) — model: inherits default
  Fast codebase recon that returns compressed context for handoff
planner (builtin) — model: inherits default
  Creates implementation plans from context and requirements
...
```

Each entry shows: agent name, source, current model assignment (or "inherits default" if no override), and description.

#### Step 2: Model Selection

After selecting an agent, `ctx.ui.select()` shows:

```
Use default model (inherit from pi's current default)
──────────────────────────────
anthropic/claude-opus-4-20250514
anthropic/claude-sonnet-4-20250514
openai/gpt-5.2
google/gemini-3-pro-preview
...
```

The list comes from `ctx.modelRegistry.getAvailable()`, same as pi's `/model` command. Format: `provider/id`.

The agent's currently assigned model (if any) is pre-selected in the dialog.

#### Step 3: Save

- **"Use default model"** selected → calls `removeBuiltinAgentOverride(cwd, agentName, "user")`
- **Specific model** selected → calls `saveBuiltinAgentOverride(cwd, agentName, "user", { model: "provider/id" })`

Both write to `~/.pi/agent/settings.json` under `subagents.agentOverrides`.

#### Step 4: Confirmation

On success, shows via `ctx.ui.notify()`:

```
✓ Set reviewer model to anthropic/claude-sonnet-4
  Saved to ~/.pi/agent/settings.json
  Note: /reload may be needed for this change to take effect in the current session
```

### Edge Cases

- **No models in registry**: Show error notification "No models available in the model registry. Configure models first via /model or models.json."
- **Agent already has override**: Pre-select the current model in the picker; changing it overwrites the existing override.
- **All agents inherit default**: All entries show "inherits default" — user can still pick one and assign a model.
- **Unknown agent name** (shouldn't happen with builtins, but defensive): Notify error, list available agents.

### What This Does NOT Do

- No project-scope overrides (out of scope per requirement)
- No batch assignment for multiple agents at once
- No inline argument mode (interactive only)
- No integration with pi's built-in `/settings` TUI

### Implementation Location

All changes within the `pi-subagents` npm package at `/opt/homebrew/lib/node_modules/pi-subagents/`:

1. **New file**: `src/slash/model-config.ts` — contains the interactive dialog function
2. **Modified file**: `src/slash/slash-commands.ts` — registers the `/subagents-model` command

### Dependencies on Existing APIs

| API | Purpose |
|-----|---------|
| `discoverAgentsAll(cwd)` | List builtin agents with their configs |
| `saveBuiltinAgentOverride(cwd, name, "user", override)` | Write model override |
| `removeBuiltinAgentOverride(cwd, name, "user")` | Clear model override |
| `ctx.modelRegistry.getAvailable()` | Get available models |
| `ctx.ui.select(title, choices)` | Interactive list picker |
| `ctx.ui.notify(msg, level)` | Toast notifications |
