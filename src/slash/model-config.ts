import {
    discoverAgentsAll,
    saveBuiltinAgentOverride,
    removeBuiltinAgentOverride,
    type AgentConfig,
    type BuiltinAgentOverrideConfig,
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
    if (agentChoice === undefined) return; // user cancelled

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
    if (modelChoice === undefined) return; // user cancelled

    // 4. Save
    try {
        if (modelChoice === USE_DEFAULT) {
            // Remove override
            const savedPath = removeBuiltinAgentOverride(ctx.cwd, agent.name, "user");
            ctx.ui.notify(
                `✓ Reset ${agent.name} to inherit default model\n  Removed override from ${savedPath}\n  Note: /reload may be needed for this change to take effect.`,
                "info",
            );
        } else {
            // modelChoice is "provider/id" from formatModelChoice
            const override: BuiltinAgentOverrideConfig = { model: modelChoice };
            const savedPath = saveBuiltinAgentOverride(ctx.cwd, agent.name, "user", override);
            ctx.ui.notify(
                `✓ Set ${agent.name} model to ${modelChoice}\n  Saved to ${savedPath}\n  Note: /reload may be needed for this change to take effect.`,
                "info",
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
