import {
    discoverAgentsAll,
    saveBuiltinAgentOverride,
    removeBuiltinAgentOverride,
    type AgentConfig,
    type BuiltinAgentOverrideConfig,
} from "../agents/agents.ts";
import type { ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import {
    SelectList,
    matchesKey,
    Key,
    visibleWidth,
    truncateToWidth,
    type SelectItem,
    type SelectListTheme,
    type TUI,
} from "@mariozechner/pi-tui";

const USE_DEFAULT = "__use_default__";

function formatModelId(entry: { provider: string; id: string }): string {
    return `${entry.provider}/${entry.id}`;
}

/**
 * Build agent SelectItems with styled labels.
 * Each item shows name, model info, and description.
 */
function buildAgentItems(
    agents: AgentConfig[],
    theme: Theme,
): SelectItem[] {
    return agents.map((agent) => {
        const modelLabel = agent.model
            ? theme.fg("dim", agent.model)
            : theme.fg("dim", "inherits default");
        return {
            value: agent.name,
            label: theme.fg("accent", agent.name) + "  " + modelLabel,
            description: agent.description
                ? theme.fg("muted", `  ${agent.description}`)
                : undefined,
        };
    });
}

/**
 * Build model SelectItems with styled labels.
 */
function buildModelItems(
    models: { provider: string; id: string }[],
    theme: Theme,
): SelectItem[] {
    const items: SelectItem[] = [
        {
            value: USE_DEFAULT,
            label: theme.fg("success", "Use default model"),
            description: theme.fg("dim", "  Inherit from pi's current default"),
        },
    ];
    for (const model of models) {
        items.push({
            value: formatModelId(model),
            label: theme.fg("text", formatModelId(model)),
        });
    }
    return items;
}

/**
 * Get the index to pre-select in the model list based on the agent's current model.
 */
function getDefaultModelIndex(
    models: { provider: string; id: string }[],
    agent: AgentConfig,
): number {
    if (!agent.model) return 0; // "Use default"
    const idx = models.findIndex((m) => formatModelId(m) === agent.model);
    return idx >= 0 ? idx + 1 : 0;
}

/**
 * Create a themed SelectListTheme for the agent list.
 */
function agentListTheme(theme: Theme): SelectListTheme {
    return {
        selectedPrefix: (t: string) => theme.fg("accent", t),
        selectedText: (t: string) => t, // Pre-styled from buildAgentItems
        description: (t: string) => t, // Pre-styled
        scrollInfo: (t: string) => theme.fg("dim", t),
        noMatch: (t: string) => theme.fg("warning", t),
    };
}

/**
 * Create a themed SelectListTheme for the model list.
 */
function modelListTheme(theme: Theme): SelectListTheme {
    return {
        selectedPrefix: (t: string) => theme.fg("accent", t),
        selectedText: (t: string) => t, // Pre-styled
        description: (t: string) => t,
        scrollInfo: (t: string) => theme.fg("dim", t),
        noMatch: (t: string) => theme.fg("warning", t),
    };
}

/**
 * Width-aware text truncation helper that preserves ANSI.
 */
function fitLine(text: string, width: number): string {
    if (visibleWidth(text) <= width) return text;
    return truncateToWidth(text, width);
}

/**
 * The two-step TUI wizard component for configuring subagent models.
 *
 * Step 1: Select an agent from a styled list
 * Step 2: Select a model for that agent from a styled list
 */
class ModelConfigWizard {
    private step: "agent" | "model" = "agent";
    private modelSelect: SelectList | null = null;
    private agentList: SelectList;
    private modelItems: SelectItem[] = [];
    private selectedAgent: AgentConfig | null = null;
    private agents: AgentConfig[];
    private models: { provider: string; id: string }[];
    private theme: Theme;
    private tui: TUI;
    private done: (result: { agent: AgentConfig; modelChoice: string } | null) => void;
    private cachedWidth?: number;
    private cachedLines?: string[];

    constructor(
        agents: AgentConfig[],
        models: { provider: string; id: string }[],
        theme: Theme,
        tui: TUI,
        done: (result: { agent: AgentConfig; modelChoice: string } | null) => void,
    ) {
        this.agents = agents;
        this.models = models;
        this.theme = theme;
        this.tui = tui;
        this.done = done;

        // Build agent list
        const agentItems = buildAgentItems(agents, theme);
        this.agentList = new SelectList(agentItems, Math.min(agentItems.length, 12), agentListTheme(theme));
        this.agentList.onSelect = (item) => this.onAgentSelected(item);
        this.agentList.onCancel = () => done(null);
    }

    private onAgentSelected(item: SelectItem): void {
        const agent = this.agents.find((a) => a.name === item.value);
        if (!agent) return;

        this.selectedAgent = agent;
        this.modelItems = buildModelItems(this.models, this.theme);
        this.modelSelect = new SelectList(
            this.modelItems,
            Math.min(this.modelItems.length, 14),
            modelListTheme(this.theme),
        );
        const defaultModelIdx = getDefaultModelIndex(this.models, agent);
        this.modelSelect.setSelectedIndex(defaultModelIdx);
        this.modelSelect.onSelect = (modelItem) => this.onModelSelected(modelItem);
        this.modelSelect.onCancel = () => {
            // Go back to agent selection
            this.step = "agent";
            this.selectedAgent = null;
            this.modelSelect = null;
            this.invalidate();
            this.tui.requestRender();
        };

        this.step = "model";
        this.invalidate();
        this.tui.requestRender();
    }

    private onModelSelected(item: SelectItem): void {
        if (!this.selectedAgent) return;
        this.done({ agent: this.selectedAgent, modelChoice: item.value });
    }

    handleInput(data: string): void {
        // Global escape cancels everything (from any step)
        if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
            this.done(null);
            return;
        }

        if (this.step === "agent") {
            this.agentList.handleInput(data);
        } else if (this.step === "model" && this.modelSelect) {
            this.modelSelect.handleInput(data);
        }
        this.tui.requestRender();
    }

    render(width: number): string[] {
        if (this.cachedLines && this.cachedWidth === width) {
            return this.cachedLines;
        }

        const t = this.theme;
        const w = Math.max(width - 2, 60);
        const lines: string[] = [];

        // --- Header ---
        lines.push(fitLine(t.fg("borderAccent", "─".repeat(w)), w));
        lines.push(fitLine("  " + t.fg("accent", t.bold("Subagent Model Configuration")), w));
        lines.push(fitLine(t.fg("borderAccent", "─".repeat(w)), w));

        // --- Agent Section ---
        lines.push("");

        if (this.step === "agent") {
            // Active agent selection
            lines.push(fitLine("  " + t.fg("accent", t.bold("AGENTS")) + t.fg("dim", " — select an agent to configure"), w));
            lines.push("");

            // Render agent list
            const agentLines = this.agentList.render(w - 4);
            for (const line of agentLines) {
                lines.push("  " + line);
            }

            lines.push("");
            lines.push(fitLine("  " + t.fg("dim", "↑↓ navigate · enter select · esc cancel"), w));
        } else {
            // Agent section when model is being selected (show selected agent info)
            lines.push(fitLine("  " + t.fg("dim", "AGENT"), w));
            const agentName = this.selectedAgent?.name ?? "";
            const agentSource = this.selectedAgent?.source ?? "";
            lines.push(fitLine(
                "  " + t.fg("accent", t.bold(agentName)) + "  " + t.fg("dim", agentSource),
                w,
            ));
            if (this.selectedAgent?.description) {
                lines.push(fitLine("  " + t.fg("muted", this.selectedAgent.description), w));
            }
        }

        // --- Divider ---
        lines.push("");
        lines.push(fitLine(t.fg("border", "─".repeat(w)), w));
        lines.push("");

        // --- Model Section ---
        if (this.step === "model" && this.selectedAgent && this.modelSelect) {
            const currentModel = this.selectedAgent.model
                ? t.fg("accent", this.selectedAgent.model)
                : t.fg("dim", "inheriting default");
            lines.push(fitLine(
                "  " + t.fg("accent", t.bold("MODEL"))
                + t.fg("dim", ` for "${this.selectedAgent.name}"`)
                + t.fg("dim", " — current: ") + currentModel,
                w,
            ));
            lines.push("");

            // Render model list
            const modelLines = this.modelSelect.render(w - 4);
            for (const line of modelLines) {
                lines.push("  " + line);
            }

            lines.push("");
            lines.push(fitLine(
                "  " + t.fg("dim", "↑↓ navigate · enter select · esc back to agents"),
                w,
            ));
        } else {
            lines.push(fitLine("  " + t.fg("dim", "MODEL — select an agent first"), w));
        }

        // --- Footer border ---
        lines.push("");
        lines.push(fitLine(t.fg("borderAccent", "─".repeat(w)), w));

        this.cachedWidth = width;
        this.cachedLines = lines;
        return lines;
    }

    wantsKeyRelease = false;

    invalidate(): void {
        this.cachedWidth = undefined;
        this.cachedLines = undefined;
    }
}

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

    // 2. Get models
    const models = ctx.modelRegistry.getAvailable();
    if (models.length === 0) {
        ctx.ui.notify(
            "No models available in the model registry. Configure models first via /model or models.json.",
            "error",
        );
        return;
    }

    // 3. Show the wizard TUI
    const result = await ctx.ui.custom<{ agent: AgentConfig; modelChoice: string } | null>(
        (tui: TUI, theme: Theme, _keybindings, done) => {
            const wizard = new ModelConfigWizard(enabledBuiltins, models, theme, tui, done);
            return wizard;
        },
        { overlay: true },
    );

    if (!result) return; // user cancelled

    const { agent, modelChoice } = result;

    // 4. Save
    try {
        if (modelChoice === USE_DEFAULT) {
            const savedPath = removeBuiltinAgentOverride(ctx.cwd, agent.name, "user");
            ctx.ui.notify(
                `✓ Reset ${agent.name} to inherit default model\n  Removed override from ${savedPath}\n  Note: /reload may be needed for this change to take effect.`,
                "info",
            );
        } else {
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
