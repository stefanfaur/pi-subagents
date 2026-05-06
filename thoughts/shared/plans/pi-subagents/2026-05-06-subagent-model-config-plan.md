# /subagents-model Slash Command Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Add an interactive `/subagents-model` slash command that lets users pick a builtin subagent and assign it a specific model, saved to `~/.pi/agent/settings.json`.

**Architecture:** New file `src/slash/model-config.ts` contains the dialog logic. Modified `src/slash/slash-commands.ts` imports and registers the command. Uses existing `saveBuiltinAgentOverride`/`removeBuiltinAgentOverride` from agents.ts and `ctx.modelRegistry` for model discovery.

**Tech Stack:** TypeScript (pi extension), No new dependencies

---

### Task 1: Create model-config.ts with the dialog logic

**Files:**
- Create: `src/slash/model-config.ts`

**Step 1: Write the function**

The function `configureSubagentModel(ctx)` is the entry point called from the command handler. It handles the full interactive flow.

**Signatures used from existing code:**

```typescript
// From ../agents/agents.ts
saveBuiltinAgentOverride(cwd: string, name: string, scope: "user" | "project", override: BuiltinAgentOverrideConfig): string
removeBuiltinAgentOverride(cwd: string, name: string, scope: "user" | "project"): string
discoverAgentsAll(cwd: string): { builtin: AgentConfig[]; ... }

// From context
ctx.modelRegistry.getAvailable(): Array<{ provider: string; id: string }>
ctx.ui.select(title: string, choices: string[]): Promise<string | undefined>
ctx.ui.notify(message: string, level: "info" | "success" | "warning" | "error"): void
ctx.cwd: string

// AgentConfig fields used
agent.name: string
agent.description: string
agent.model?: string
```

**Implementation:**

```typescript
import * as path from "node:path";
import {
    discoverAgentsAll,
    saveBuiltinAgentOverride,
    removeBuiltinAgentOverride,
    type AgentConfig,
} from "../agents/agents.ts";
import type {
    BuiltinAgentOverrideConfig,
} from "../agents/agents.ts";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

function formatAgentChoice(agent: AgentConfig): string {
    const modelInfo = agent.model
        ? `model: ${agent.model}`
        : "model: inherits default";
    return `${agent.name} (${agent.source}) — ${modelInfo}\n  ${agent.description}`;
}

function formatModelChoice(entry: { provider: string; id: string }): string {
    return `${entry.provider}/${entry.id}`;
}

const USE_DEFAULT = "__use_default__";

export async function configureSubagentModel(
    ctx: ExtensionContext,
): Promise<void> {
    // 1. Get builtin agents
    const { builtin } = discoverAgentsAll(ctx.cwd);
    const enabledBuiltins = builtin.filter((a) => !a.disabled);

    if (enabledBuiltins.length === 0) {
        ctx.ui.notify("No builtin agents found.", "warning");
        return;
    }

    // 2. Agent selection
    const agentChoices = enabledBuiltins.map(formatAgentChoice);
    const agentChoice = await ctx.ui.select(
        "Select agent to configure model for:",
        agentChoices,
    );
    if (!agentChoice) return; // user cancelled

    const agentIndex = agentChoices.indexOf(agentChoice);
    const agent = enabledBuiltins[agentIndex]!;

    // 3. Model selection
    const models = ctx.modelRegistry.getAvailable();
    if (models.length === 0) {
        ctx.ui.notify(
            "No models available in the model registry. Configure models first via /model or models.json.",
            "error",
        );
        return;
    }

    const modelChoices = [USE_DEFAULT, ...models.map(formatModelChoice)];
    let defaultIndex = 0;
    if (agent.model) {
        const currentModelIdx = models.findIndex(
            (m) => `${m.provider}/${m.id}` === agent.model,
        );
        if (currentModelIdx >= 0) defaultIndex = currentModelIdx + 1;
    }

    const modelChoice = await ctx.ui.select(
        `Model for ${agent.name} (current: ${agent.model ?? "inherits default"}):`,
        modelChoices,
    );
    if (!modelChoice) return; // user cancelled

    // 4. Save
    const settingsPath = path.join(
        process.env.HOME || process.env.USERPROFILE || "~",
        ".pi",
        "agent",
        "settings.json",
    );

    try {
        if (modelChoice === USE_DEFAULT) {
            // Remove override
            removeBuiltinAgentOverride(ctx.cwd, agent.name, "user");
            ctx.ui.notify(
                `✓ Reset ${agent.name} to inherit default model\n  Removed override from ${settingsPath}\n  Note: /reload may be needed for this change to take effect.`,
                "success",
            );
        } else {
            // Strip the "Use default model" prefix from modelChoice
            const [provider, ...idParts] = modelChoice.split("/");
            const modelId = `${provider}/${idParts.join("/")}`;
            const override: BuiltinAgentOverrideConfig = { model: modelId };
            saveBuiltinAgentOverride(ctx.cwd, agent.name, "user", override);
            ctx.ui.notify(
                `✓ Set ${agent.name} model to ${modelId}\n  Saved to ${settingsPath}\n  Note: /reload may be needed for this change to take effect.`,
                "success",
            );
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(
            `Failed to save model override: ${message}`,
            "error",
        );
    }
}
```

**Important notes on the `ctx.ui.select()` API:**

The standard `ctx.ui.select(title, choices)` returns `Promise<string | undefined>` — the title string selected by the user, or `undefined` on cancel.

For `ctx.ui.notify()`, the signature is `notify(message: string, level: "info" | "success" | "warning" | "error")`.

The `modelChoice` from select will be either `USE_DEFAULT` (the literal string `"__use_default__"`) or the exact string from `formatModelChoice()` which is `"provider/id"`.

**Edge case:** When `removeBuiltinAgentOverride` is called but no override existed, it still succeeds without error (the function handles this gracefully by checking if the file exists and the key exists before modifying).

**Step 2: No separate test file required** — this is an interactive TUI command tested manually. The existing test infrastructure in pi-subagents is for unit/integration tests of pure logic, not TUI dialogs.

**Step 3: Commit**

```bash
git add src/slash/model-config.ts
git commit -m "feat: add configureSubagentModel dialog logic"
```

---

### Task 2: Register /subagents-model command in slash-commands.ts

**Files:**
- Modify: `src/slash/slash-commands.ts`

**Step 1: Add import**

Add to the existing imports section — merge the `discoverAgentsAll` import to also keep it working for existing code:

```typescript
// Add this import near the other local imports
import { configureSubagentModel } from "./model-config.ts";
```

`discoverAgentsAll` is already imported in slash-commands.ts, no change needed there.

**Step 2: Register the command**

Add inside `registerSlashCommands()`, after the existing `subagents-doctor` command:

```typescript
pi.registerCommand("subagents-model", {
    description: "Configure default models for builtin subagents",
    handler: async (_args, ctx) => {
        await configureSubagentModel(ctx);
    },
});
```

**Step 3: Commit**

```bash
git add src/slash/slash-commands.ts
git commit -m "feat: register /subagents-model slash command"
```

---

### Task 3: Build and verify

**Files:**
- Verify: `src/slash/model-config.ts` compiles without errors
- Verify: `src/slash/slash-commands.ts` compiles without errors

**Step 1: Type-check**

```bash
npx tsc --noEmit --pretty 2>&1 || true
```

Expected: No errors in the two changed files. Pre-existing errors in other files are acceptable.

**Step 2: Manual verification checklist**

After installing the modified package:
1. Run pi, type `/subagents-model`
2. Verify agent list shows all builtins with current model info
3. Select an agent, verify model list shows all available models
4. Pick "Use default model" → verify notification, check `~/.pi/agent/settings.json`
5. Pick a specific model → verify notification, check `~/.pi/agent/settings.json`
6. Run `/subagents-model` again, verify the selected agent now shows the assigned model
7. Test with agent that already has override — verify current model is shown
8. Test cancelling at agent step (Esc) — verify no changes made
9. Test cancelling at model step (Esc) — verify no changes made

**Step 3: Commit and open PR**

```bash
git add -A
git commit -m "feat: add /subagents-model command for interactive subagent model configuration"
```
