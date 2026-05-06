import {
    discoverAgentsAll,
    saveBuiltinAgentOverride,
    removeBuiltinAgentOverride,
    type AgentConfig,
    type BuiltinAgentOverrideConfig,
} from "../agents/agents.ts";
import type { ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import {
    matchesKey,
    Key,
    visibleWidth,
    wrapTextWithAnsi,
    type TUI,
} from "@mariozechner/pi-tui";

const USE_DEFAULT = "__use_default__";

function formatModelId(entry: { provider: string; id: string }): string {
    return `${entry.provider}/${entry.id}`;
}

// ─── Multi-line list item ────────────────────────────────────────────

interface ListItem {
    value: string;
    lines: string[]; // Pre-wrapped, pre-styled display lines (no prefix)
}

// ─── Multi-line selectable list (zero truncation) ────────────────────

/**
 * A scrollable selection list where each item can span multiple wrapped
 * lines. Unlike SelectList, ALL text is fully visible — nothing is ever
 * truncated. Items are pre-wrapped before construction.
 */
class MultiLineList {
    private items: ListItem[];
    selectedIndex = 0;
    private scrollOffset = 0;
    private lineBudget: number;

    onSelect?: (value: string) => void;
    onCancel?: () => void;

    private theme: Theme;

    constructor(items: ListItem[], lineBudget: number, theme: Theme) {
        this.items = items;
        this.lineBudget = Math.max(1, lineBudget);
        this.theme = theme;
    }

    get itemCount(): number {
        return this.items.length;
    }

    setSelectedIndex(index: number): void {
        if (index >= 0 && index < this.items.length) {
            this.selectedIndex = index;
            this.ensureVisible();
        }
    }

    /** Replace all items while preserving selection as closely as possible. */
    replaceItems(newItems: ListItem[]): void {
        this.items = newItems;
        if (this.selectedIndex >= newItems.length) {
            this.selectedIndex = Math.max(0, newItems.length - 1);
        }
        this.ensureVisible();
    }

    getSelectedValue(): string | undefined {
        return this.items[this.selectedIndex]?.value;
    }

    // ── navigation ─────────────────────────────────────────────────

    handleInput(data: string): void {
        if (matchesKey(data, Key.up)) {
            if (this.selectedIndex > 0) {
                this.selectedIndex--;
                this.ensureVisible();
            }
        } else if (matchesKey(data, Key.down)) {
            if (this.selectedIndex < this.items.length - 1) {
                this.selectedIndex++;
                this.ensureVisible();
            }
        } else if (matchesKey(data, Key.enter)) {
            const item = this.items[this.selectedIndex];
            if (item) this.onSelect?.(item.value);
        } else if (matchesKey(data, Key.escape)) {
            this.onCancel?.();
        }
    }

    // ── scrolling ──────────────────────────────────────────────────

    private itemLines(index: number): number {
        return this.items[index]?.lines.length ?? 0;
    }

    /** Total lines from scrollOffset up to (but not including) index. */
    private linesBefore(index: number): number {
        let total = 0;
        for (let i = this.scrollOffset; i < index && i < this.items.length; i++) {
            total += this.itemLines(i);
        }
        return total;
    }

    /** Total lines from index 0 up to (but not including) `upto`. */
    private cumulativeLines(upto: number): number {
        let total = 0;
        for (let i = 0; i < upto && i < this.items.length; i++) {
            total += this.itemLines(i);
        }
        return total;
    }

    /** Adjust scrollOffset so the selected item is inside the visible
     *  line budget. */
    private ensureVisible(): void {
        // Selected above viewport
        if (this.selectedIndex < this.scrollOffset) {
            this.scrollOffset = this.selectedIndex;
            return;
        }

        // Selected below viewport — walk forward from scrollOffset to
        // see if the selected item fits within the line budget.
        let used = 0;
        for (let i = this.scrollOffset; i < this.items.length; i++) {
            used += this.itemLines(i);
            if (i === this.selectedIndex) {
                if (used <= this.lineBudget) return; // fully visible
                // Selected item overflows — find a new scrollOffset
                // such that it (and as many preceding items as fit) are
                // visible.
                let newOffset = this.selectedIndex;
                let back = this.itemLines(newOffset);
                while (newOffset > 0 && back + this.itemLines(newOffset - 1) <= this.lineBudget) {
                    back += this.itemLines(newOffset - 1);
                    newOffset--;
                }
                this.scrollOffset = newOffset;
                return;
            }
            if (used >= this.lineBudget) {
                // We ran out of lines before reaching the selected item.
                // Simply start at the selected item.
                this.scrollOffset = this.selectedIndex;
                return;
            }
        }
    }

    // ── render ─────────────────────────────────────────────────────

    render(_width: number): string[] {
        this.ensureVisible();
        const lines: string[] = [];
        let used = 0;
        for (let i = this.scrollOffset; i < this.items.length && used < this.lineBudget; i++) {
            const item = this.items[i]!;
            const isSelected = i === this.selectedIndex;
            const selMarker = this.theme.fg("accent", ">");
            const prefix = isSelected ? selMarker + " " : "  ";
            for (const itemLine of item.lines) {
                if (used >= this.lineBudget) break;
                lines.push(
                    isSelected
                        ? this.theme.bg("selectedBg", prefix + itemLine)
                        : prefix + itemLine,
                );
                used++;
            }
        }
        return lines;
    }

    invalidate(): void {}
}

// ─── Item builders (pre-wrap everything) ─────────────────────────────

function buildAgentItems(
    agents: AgentConfig[],
    theme: Theme,
    width: number,
): ListItem[] {
    return agents.map((agent) => {
        const modelLabel = agent.model
            ? theme.fg("dim", agent.model)
            : theme.fg("dim", "inherits default");
        const header =
            theme.fg("accent", theme.bold(agent.name)) +
            theme.fg("dim", "  ") +
            modelLabel;
        const lines: string[] = [header];
        if (agent.description) {
            const descIndent = "  "; // align with name column
            const descWidth = width - visibleWidth(descIndent);
            if (descWidth > 0) {
                for (const wline of wrapTextWithAnsi(
                    theme.fg("muted", agent.description),
                    descWidth,
                )) {
                    lines.push(theme.fg("muted", descIndent + wline));
                }
            }
        }
        return { value: agent.name, lines };
    });
}

function buildModelItems(
    models: { provider: string; id: string }[],
    theme: Theme,
    width: number,
): ListItem[] {
    const items: ListItem[] = [];
    // "Use default"
    {
        const header = theme.fg("success", "Use default model");
        const lines: string[] = [header];
        const desc = theme.fg("dim", "Inherit from pi's current default");
        const descWidth = width - 2;
        if (descWidth > 0) {
            for (const wline of wrapTextWithAnsi(desc, descWidth)) {
                lines.push(theme.fg("dim", "  " + wline));
            }
        }
        items.push({ value: USE_DEFAULT, lines });
    }
    for (const model of models) {
        items.push({
            value: formatModelId(model),
            lines: [theme.fg("text", formatModelId(model))],
        });
    }
    return items;
}

function getDefaultModelIndex(
    models: { provider: string; id: string }[],
    agent: AgentConfig,
): number {
    if (!agent.model) return 0;
    const idx = models.findIndex((m) => formatModelId(m) === agent.model);
    return idx >= 0 ? idx + 1 : 0;
}

// ─── Two-step wizard component ───────────────────────────────────────

class ModelConfigWizard {
    private step: "agent" | "model" = "agent";
    private agentList: MultiLineList;
    private modelList: MultiLineList;
    private modelItems: ListItem[] = [];
    private selectedAgent: AgentConfig | null = null;
    private agents: AgentConfig[];
    private models: { provider: string; id: string }[];
    private theme: Theme;
    private tui: TUI;
    private done: (
        result: { agent: AgentConfig; modelChoice: string } | null,
    ) => void;
    private cachedWidth?: number;
    private cachedLines?: string[];

    constructor(
        agents: AgentConfig[],
        models: { provider: string; id: string }[],
        theme: Theme,
        tui: TUI,
        done: (
            result: { agent: AgentConfig; modelChoice: string } | null,
        ) => void,
    ) {
        this.agents = agents;
        this.models = models;
        this.theme = theme;
        this.tui = tui;
        this.done = done;

        // Build items at a conservative width first; they will be
        // rebuilt inside render() if width changes.
        const itemW = Math.max(60, (process.stdout.columns ?? 120) - 6);

        this.agentList = new MultiLineList(
            buildAgentItems(agents, theme, itemW),
            14,
            theme,
        );
        this.agentList.onSelect = (value) => this.onAgentSelected(value);
        this.agentList.onCancel = () => done(null);

        // Pre-build model items for the first render
        this.modelItems = buildModelItems(models, theme, itemW);
        this.modelList = new MultiLineList(this.modelItems, 16, theme);
        this.modelList.onSelect = (value) => this.onModelSelected(value);
        this.modelList.onCancel = () => {
            this.step = "agent";
            this.selectedAgent = null;
            this.invalidate();
            this.tui.requestRender();
        };
    }

    private onAgentSelected(value: string): void {
        const agent = this.agents.find((a) => a.name === value);
        if (!agent) return;
        this.selectedAgent = agent;
        const w = Math.max(20, (process.stdout.columns ?? 120) - 6);
        this.modelItems = buildModelItems(this.models, this.theme, w);
        this.modelList.replaceItems(this.modelItems);
        this.modelList.setSelectedIndex(getDefaultModelIndex(this.models, agent));
        this.step = "model";
        this.invalidate();
        this.tui.requestRender();
    }

    private onModelSelected(value: string): void {
        if (!this.selectedAgent) return;
        this.done({ agent: this.selectedAgent, modelChoice: value });
    }

    handleInput(data: string): void {
        if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
            this.done(null);
            return;
        }
        if (this.step === "agent") {
            this.agentList.handleInput(data);
        } else if (this.step === "model") {
            this.modelList.handleInput(data);
        }
        this.invalidate();
        this.tui.requestRender();
    }

    render(width: number): string[] {
        if (this.cachedLines && this.cachedWidth === width) {
            return this.cachedLines;
        }

        const t = this.theme;
        // Leave 2 cols for left padding so text doesn't kiss the edge
        const w = Math.max(20, width - 2);

        // ── Rebuild items when width changes ──────────────────────
        if (this.cachedWidth !== width) {
            this.rebuildAgentItems(w - 4);
            this.modelItems = buildModelItems(this.models, this.theme, w - 4);
            this.modelList.replaceItems(this.modelItems);
        }

        const lines: string[] = [];

        // ── Header ────────────────────────────────────────────────
        lines.push(t.fg("borderAccent", "─".repeat(w)));
        lines.push(" " + t.fg("accent", t.bold("Subagent Model Configuration")));
        lines.push(t.fg("borderAccent", "─".repeat(w)));
        lines.push("");

        // ── Agent section ─────────────────────────────────────────
        if (this.step === "agent") {
            lines.push(
                " " +
                    t.fg("accent", t.bold("AGENTS")) +
                    t.fg("dim", " — select an agent to configure"),
            );
            lines.push("");
            const agentLines = this.agentList.render(w - 2);
            for (const line of agentLines) lines.push(line);
            lines.push("");
            lines.push(
                " " +
                    t.fg("dim", "↑↓ navigate  ·  enter select  ·  esc cancel"),
            );
        } else {
            lines.push(" " + t.fg("dim", "AGENT"));
            const name = this.selectedAgent?.name ?? "";
            const src = this.selectedAgent?.source ?? "";
            if (name) {
                lines.push(
                    " " + t.fg("accent", t.bold(name)) +
                        t.fg("dim", "  " + src),
                );
            }
            if (this.selectedAgent?.description) {
                lines.push("");
                for (const wline of wrapTextWithAnsi(
                    t.fg("muted", this.selectedAgent.description),
                    w - 2,
                )) {
                    lines.push(" " + wline);
                }
            }
        }

        // ── Divider ───────────────────────────────────────────────
        lines.push("");
        lines.push(t.fg("border", "─".repeat(w)));
        lines.push("");

        // ── Model section ─────────────────────────────────────────
        if (this.step === "model" && this.selectedAgent) {
            const currentModel = this.selectedAgent.model
                ? t.fg("accent", this.selectedAgent.model)
                : t.fg("dim", "inheriting default");
            lines.push(
                " " +
                    t.fg("accent", t.bold("MODEL")) +
                    t.fg(
                        "dim",
                        ` for "${this.selectedAgent.name}"` +
                            " — current: ",
                    ) +
                    currentModel,
            );
            lines.push("");
            const modelLines = this.modelList.render(w - 2);
            for (const line of modelLines) lines.push(line);
            lines.push("");
            lines.push(
                " " +
                    t.fg(
                        "dim",
                        "↑↓ navigate  ·  enter select  ·  esc back to agents",
                    ),
            );
        } else {
            lines.push(
                " " + t.fg("dim", "MODEL — select an agent first"),
            );
        }

        // ── Footer ────────────────────────────────────────────────
        lines.push("");
        lines.push(t.fg("borderAccent", "─".repeat(w)));

        this.cachedWidth = width;
        this.cachedLines = lines;
        return lines;
    }

    /** Rebuild agent items for the current width. */
    private rebuildAgentItems(itemWidth: number): void {
        const newItems = buildAgentItems(this.agents, this.theme, itemWidth);
        this.agentList.replaceItems(newItems);
    }

    wantsKeyRelease = false;

    invalidate(): void {
        this.cachedWidth = undefined;
        this.cachedLines = undefined;
    }
}

// ─── Entry point ─────────────────────────────────────────────────────

export async function configureSubagentModel(
    ctx: ExtensionContext,
): Promise<void> {
    const { builtin } = discoverAgentsAll(ctx.cwd);
    const enabledBuiltins = builtin.filter((a) => !a.disabled);

    if (enabledBuiltins.length === 0) {
        ctx.ui.notify("No builtin agents found.", "warning");
        return;
    }

    const models = ctx.modelRegistry.getAvailable();
    if (models.length === 0) {
        ctx.ui.notify(
            "No models available in the model registry." +
                " Configure models first via /model or models.json.",
            "error",
        );
        return;
    }

    const result = await ctx.ui.custom<
        { agent: AgentConfig; modelChoice: string } | null
    >(
        (tui: TUI, theme: Theme, _keybindings, done) => {
            const wizard = new ModelConfigWizard(
                enabledBuiltins,
                models,
                theme,
                tui,
                done,
            );
            return wizard;
        },
        { overlay: true },
    );

    if (!result) return;

    const { agent, modelChoice } = result;

    try {
        if (modelChoice === USE_DEFAULT) {
            const savedPath = removeBuiltinAgentOverride(
                ctx.cwd,
                agent.name,
                "user",
            );
            ctx.ui.notify(
                `✓ Reset ${agent.name} to inherit default model\n` +
                    `  Removed override from ${savedPath}\n` +
                    `  Note: /reload may be needed for this change to take effect.`,
                "info",
            );
        } else {
            const override: BuiltinAgentOverrideConfig = {
                model: modelChoice,
            };
            const savedPath = saveBuiltinAgentOverride(
                ctx.cwd,
                agent.name,
                "user",
                override,
            );
            ctx.ui.notify(
                `✓ Set ${agent.name} model to ${modelChoice}\n` +
                    `  Saved to ${savedPath}\n` +
                    `  Note: /reload may be needed for this change to take effect.`,
                "info",
            );
        }
    } catch (error) {
        const message =
            error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Failed to save model override: ${message}`, "error");
    }
}
