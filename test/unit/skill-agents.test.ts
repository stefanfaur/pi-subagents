import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getSkillFrontmatter, clearSkillCache } from "../../src/agents/skills.ts";

describe("getSkillFrontmatter", () => {
	let tmpDir: string;
	let cwd: string;

	before(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-skill-agent-test-"));
		cwd = tmpDir;
		const skillDir = path.join(tmpDir, ".agents", "skills", "test-skill");
		fs.mkdirSync(skillDir, { recursive: true });
		fs.writeFileSync(path.join(skillDir, "SKILL.md"), [
			"---",
			"name: test-skill",
			"description: A test skill",
			"standalone: true",
			"tools: read, bash",
			"---",
			"",
			"# Test Skill",
			"This is the body.",
		].join("\n"));
		clearSkillCache();
	});

	after(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns frontmatter and body for a standalone skill", () => {
		const result = getSkillFrontmatter("test-skill", cwd);
		assert.ok(result);
		assert.strictEqual(result!.frontmatter.standalone, "true");
		assert.strictEqual(result!.frontmatter.tools, "read, bash");
		assert.ok(result!.body.includes("# Test Skill"));
		assert.ok(result!.body.includes("This is the body."));
		assert.ok(result!.filePath.endsWith("SKILL.md"));
	});

	it("returns undefined for unknown skill", () => {
		assert.strictEqual(getSkillFrontmatter("nonexistent", cwd), undefined);
	});
});
