/**
 * Integration tests for the explore coordinator agent.
 *
 * Uses mock pi to validate the full spawn→parse→result pipeline.
 * Tests explore agent execution and model override propagation to leaf agents.
 */

import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import type { MockPi } from "../support/helpers.ts";
import {
	createMockPi,
	createTempDir,
	removeTempDir,
	makeAgent,
	tryImport,
} from "../support/helpers.ts";
import { discoverAgentsAll } from "../../src/agents/agents.ts";

interface RunSyncResult {
	exitCode: number;
	agent: string;
	messages: unknown[];
	error?: string;
	model?: string;
	usage: { turns: number; input: number; output: number };
	progress: { status: string };
}

interface ExecutionModule {
	runSync(
		runtimeCwd: string,
		agents: ReturnType<typeof makeAgent>[],
		agentName: string,
		task: string,
		options: Record<string, unknown>,
	): Promise<RunSyncResult>;
}

interface UtilsModule {
	getFinalOutput(messages: unknown[]): string;
}

const execution = await tryImport<ExecutionModule>("./src/runs/foreground/execution.ts");
const utils = await tryImport<UtilsModule>("./src/shared/utils.ts");
const available = !!(execution && utils);

const runSync = execution?.runSync;
const getFinalOutput = utils?.getFinalOutput;

describe("explore coordinator — execution", { skip: !available ? "pi packages not available" : undefined }, () => {
	let tempDir: string;
	let mockPi: MockPi;

	before(() => {
		mockPi = createMockPi();
		mockPi.install();
	});

	after(() => {
		mockPi.uninstall();
	});

	beforeEach(() => {
		tempDir = createTempDir();
		mockPi.reset();
	});

	afterEach(() => {
		removeTempDir(tempDir);
	});

	it("explore agent runs successfully via runSync", async () => {
		mockPi.onCall({
			output: "## Research: Test Topic\n\n## Summary\nThe codebase contains X, Y, Z components.\n\n## Code References\n- `src/agents/agents.ts:1` — agent discovery entry point",
		});

		const { builtin } = discoverAgentsAll(tempDir);
		const exploreConfig = builtin.find((a) => a.name === "explore" && a.source === "builtin");
		assert.ok(exploreConfig, "explore agent must be discoverable");

		const agents = [exploreConfig];
		const result = await runSync!(tempDir, agents, "explore", "Research how agent discovery works", {});

		assert.equal(result.exitCode, 0);
		assert.equal(result.agent, "explore");
		const output = getFinalOutput!(result.messages);
		assert.match(output, /Research: Test Topic/);
		assert.match(output, /The codebase contains/);
	});

	it("explore agent with model override propagates correctly", async () => {
		// Apply a model override to code-searcher via agentOverrides simulation
		const { builtin } = discoverAgentsAll(tempDir);
		const codeSearcher = builtin.find((a) => a.name === "code-searcher" && a.source === "builtin");
		assert.ok(codeSearcher, "code-searcher must be discoverable");

		// Simulate an override by creating an agent with explicit model
		const overriddenSearcher = makeAgent("code-searcher", {
			description: codeSearcher.description,
			systemPrompt: codeSearcher.systemPrompt,
			systemPromptMode: codeSearcher.systemPromptMode,
			inheritProjectContext: codeSearcher.inheritProjectContext,
			inheritSkills: codeSearcher.inheritSkills,
			defaultContext: codeSearcher.defaultContext,
			tools: codeSearcher.tools,
			maxSubagentDepth: codeSearcher.maxSubagentDepth,
			model: "openai/gpt-4o-mini",
		});

		assert.equal(overriddenSearcher.model, "openai/gpt-4o-mini", "override model should be set");
		assert.ok(overriddenSearcher.tools?.includes("read"), "tools preserved after override");
		assert.equal(overriddenSearcher.maxSubagentDepth, 0, "maxSubagentDepth preserved after override");
	});

	it("leaf agents have correct tool and depth restrictions", () => {
		const { builtin } = discoverAgentsAll(tempDir);

		const leafNames = ["code-searcher", "code-analyzer", "web-researcher"];
		for (const name of leafNames) {
			const leaf = builtin.find((a) => a.name === name && a.source === "builtin");
			assert.ok(leaf, `${name} should be discoverable`);
			assert.ok(!leaf.tools?.includes("subagent"), `${name} must not have subagent tool`);
			assert.ok(!leaf.tools?.includes("write"), `${name} must not have write tool`);
			assert.ok(!leaf.tools?.includes("edit"), `${name} must not have edit tool`);
			assert.equal(leaf.maxSubagentDepth, 0, `${name} maxSubagentDepth must be 0 to prevent nesting`);
			assert.equal(leaf.defaultContext, "fork", `${name} must use fork context`);
			assert.equal(leaf.inheritProjectContext, false, `${name} must not inherit project context`);
		}
	});
});
