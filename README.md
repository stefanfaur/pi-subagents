<p>
  <img src="https://raw.githubusercontent.com/stefanfaur/pi-subagents/main/banner.png" alt="pi-subagents" width="1100">
</p>

# pi-subagents

`pi-subagents` lets Pi delegate work to focused child agents. Use it for implementation handoffs, parallel audits, saved workflows, background jobs, and anything else that benefits from a second set of model eyes.

## Installation

```bash
pi install git:github.com/stefanfaur/pi-subagents
```

That is the only required step. You can add optional pieces later.

## Try this first

You do not need to create agents, write config, or learn slash commands. After installing, ask Pi for delegation in plain language:

```text
Use a delegate subagent to implement the auth refactor.
```

```text
Run parallel delegates: one to audit the frontend, one to audit the backend.
```

```text
Run a chain: first explore the auth module, then implement the migration from those findings.
```

That is enough to start.

## What happens

Pi is the parent session. A subagent is a focused child Pi session with its own job.

When you ask for a subagent, Pi starts the child, gives it the task, and brings the result back. Foreground runs stream in the conversation. Background runs keep working and can be checked later.

Installing the extension does not start an automatic background agent. It gives Pi a delegation tool. If you want every implementation reviewed, say that in your prompt or put it in your project instructions.

## Builtin agent

The only builtin agent is `delegate` — a lightweight general-purpose subagent that inherits the parent model and has standard tools (read, grep, find, ls, bash, edit, write).

| Agent | Purpose |
|-------|---------|
| `delegate` | Lightweight general-purpose delegate that inherits the parent model with no default reads or outputs. |

## Changing the delegate agent's model

The delegate agent inherits your current Pi default model by default. To assign a specific model:

```text
/run delegate[model=anthropic/claude-sonnet-4] "Implement the auth refactor"
```

For a persistent override, use `/subagents-model` (interactive) or edit settings:

```json
{
  "subagents": {
    "agentOverrides": {
      "delegate": {
        "model": "anthropic/claude-sonnet-4",
        "thinking": "high",
        "fallbackModels": ["openai/gpt-5-mini"]
      }
    }
  }
}
```

Settings locations:
- User scope: `~/.pi/agent/settings.json`
- Project scope: `.pi/settings.json`

Useful override fields: `model`, `fallbackModels`, `thinking`, `systemPromptMode`, `inheritProjectContext`, `inheritSkills`, `defaultContext`, `disabled`, `skills`, `tools`, and `systemPrompt`.

## Creating custom agents

You can create project or user agents. For small tweaks to the builtin delegate, prefer overrides over copying the file.

### Agent markdown files

Agent files live in:
- `~/.pi/agent/agents/**/*.md` — user scope
- `.pi/agents/**/*.md` — canonical project scope
- legacy `.agents/**/*.md` — still read for compatibility, but `.pi/agents/` wins

A minimal agent file:

```markdown
---
name: my-agent
package: my-project
description: What this agent does
model: openai-codex/gpt-5.4
thinking: high
tools: read, grep, find, ls, bash, edit, write
systemPromptMode: replace
inheritProjectContext: true
inheritSkills: false
---

Your system prompt here.
```

Omit `package` for the traditional unqualified runtime name. Common optional fields: `defaultProgress`, `defaultReads`, `output`, `fallbackModels`, `maxSubagentDepth`.

With `package: my-project` and `name: my-agent`, this registers as `my-project.my-agent`.

### Via management mode

```typescript
subagent({
  action: "create",
  config: {
    name: "my-agent",
    package: "my-project",
    description: "Project-specific helper",
    systemPrompt: "You are a ...",
    systemPromptMode: "replace",
    model: "openai-codex/gpt-5.4",
    tools: "read,grep,find,ls,bash,edit,write"
  }
})

subagent({ action: "update", agent: "my-project.my-agent", config: { thinking: "high" } })
subagent({ action: "delete", agent: "my-project.my-agent" })
```

## Slash commands

Humans can use slash commands directly. Agents should prefer the `subagent(...)` tool.

| Command | Purpose |
|---------|---------|
| `/run` | Launch a single agent |
| `/chain` | Launch a chain of steps |
| `/parallel` | Launch top-level parallel tasks |
| `/run-chain` | Launch a saved `.chain.md` workflow |
| `/subagents-doctor` | Diagnose setup, discovery, and intercom bridge state |
| `/subagents-model` | Configure default models for builtin subagents |

### `/run` — single agent

```text
/run delegate "Implement the auth refactor"
/run delegate[model=anthropic/claude-sonnet-4] "Implement the auth refactor"
/run delegate "Run the full test suite" --bg
/run delegate "Audit from a branched session" --fork
```

### `/chain` — sequential pipeline

Each step's output feeds into the next as `{previous}`:

```text
/chain delegate "Explore the auth module" -> delegate "Implement the migration from {previous}"
/chain delegate -- explore auth -> delegate -- implement migration
/chain delegate[output=context.md] "scan code" -> delegate[reads=context.md] "analyze findings"
```

### `/parallel` — concurrent execution

```text
/parallel delegate "Audit frontend" -> delegate "Audit backend"
/parallel delegate -- audit frontend & backend
/parallel delegate[output=a.md,progress] "task A" -> delegate[output=b.md,model=gpt-4o] "task B"
```

### Background and fork flags

Both `--bg` and `--fork` work with `/run`, `/chain`, `/parallel`, and `/run-chain`:

```text
/run delegate "audit the codebase" --bg
/chain delegate "analyze auth" -> delegate "design refactor" --bg
/parallel delegate "scan frontend" -> delegate "scan backend" --bg
/run delegate "review from a branched session" --fork
/run delegate "review in a branched session" --fork --bg
```

## Core concepts

### Forked context

`context: "fork"` creates a branched child session from the current persisted parent session. It does **not** create a fresh minimal context — the child inherits the parent's session history. Use it when you want a separate execution thread that can still reference the parent session.

```typescript
subagent({
  agent: "delegate",
  task: "Implement the approved plan.",
  context: "fork"
})
```

Forking requires a persisted parent session. Use `context: "fresh"` when that is not available.

### Async/background runs

Use async mode when the parent agent should keep working while a child runs:

```typescript
subagent({
  agent: "delegate",
  task: "Run the full test suite",
  async: true
})
```

Inspect with `subagent({ action: "status", id: "..." })` or `subagent({ action: "status" })`. Follow up with `subagent({ action: "resume", id: "...", message: "..." })`.

### Chain execution

Chain steps receive `{task}`, `{previous}`, and `{chain_dir}` variables:

```typescript
subagent({
  chain: [
    { agent: "delegate", task: "Map the auth flow and summarize key files" },
    { agent: "delegate", task: "Implement the migration from {previous}" }
  ]
})
```

### Parallel execution

```typescript
subagent({
  tasks: [
    { agent: "delegate", task: "Audit frontend" },
    { agent: "delegate", task: "Audit backend" }
  ],
  concurrency: 2
})
```

Per-task overrides:

```typescript
subagent({
  tasks: [
    { agent: "delegate", task: "Implement feature A", output: "a.md", progress: true },
    { agent: "delegate", task: "Implement feature B", output: "b.md", model: "openai/gpt-5-mini" }
  ],
  concurrency: 2
})
```

Avoid duplicate output paths. For large output, use `outputMode: "file-only"`.

### Saved chains

Chain files use `.chain.md` extension and live in:
- `~/.pi/agent/chains/**/*.chain.md` — user scope
- `.pi/chains/**/*.chain.md` — project scope

Example `review.chain.md`:

```markdown
---
name: review
description: Review a branch with two passes
---

## delegate
task: Review the diff for correctness. Do not edit files.

## delegate
task: Review the diff for simplicity. Do not edit files.
```

```text
/run-chain review -- review this branch
```

### With intercom (optional)

`pi-subagents` works without `pi-intercom`. Install it for child-to-parent coordination:

```bash
pi install npm:pi-intercom
```

Then child agents blocked on a decision can ask:

```typescript
contact_supervisor({
  reason: "need_decision",
  message: "Should I optimize for readability or performance?"
})
```

And the parent replies with `intercom({ action: "reply", message: "..." })`.

### Worktree isolation

```typescript
subagent({
  tasks: [
    { agent: "delegate", task: "Implement feature A" },
    { agent: "delegate", task: "Implement feature B" }
  ],
  worktree: true
})
```

Each task gets its own git worktree branched from HEAD. Requires a clean git state.

### Prompting subagents

A strong subagent prompt includes:
- **Goal**: the concrete outcome
- **Context/evidence**: relevant files, diffs, decisions, constraints
- **Success criteria**: what must be true before finishing
- **Hard constraints**: no edits for review-only, escalation for unapproved decisions
- **Validation**: targeted checks to run
- **Output**: expected summary shape or artifact path
- **Stop rules**: when to ask via intercom, when to stop

### Subagent control

Monitor and intervene on delegated runs:

```typescript
subagent({ action: "status", id: "abc123" })
subagent({ action: "interrupt" })
subagent({ action: "interrupt", id: "abc123" })
```

### Manage agents programmatically

```typescript
subagent({ action: "list" })
subagent({ action: "get", agent: "delegate" })
subagent({ action: "create", config: { ... } })
subagent({ action: "update", agent: "my-agent", config: { ... } })
subagent({ action: "delete", agent: "my-agent" })
```

## Constraints

- **Default subagent nesting depth is 2.** Deeper recursive delegation is blocked unless configured otherwise.
- **Forking requires a persisted parent session.** Use `context: "fresh"` when forking is not available.
- **Forked runs inherit parent history.** They are branched threads, not fresh filtered contexts.
- **Intercom asks are blocking.** A session can only maintain one pending outbound ask at a time.

## Optional: pi-web-access

The web search tools (`web_search`, `fetch_content`, `get_search_content`) require [pi-web-access](https://github.com/nicobailon/pi-web-access):

```bash
pi install npm:pi-web-access
```

## Optional: pi-intercom

For child-to-parent coordination during subagent runs:

```bash
pi install npm:pi-intercom
```

## Diagnostics

If subagents don't start, behavior feels off, or intercom is not delivering, run diagnostics:

```text
/subagents-doctor
```

Or from code:

```typescript
subagent({ action: "doctor" })
```

## Development

```bash
git clone https://github.com/stefanfaur/pi-subagents.git
cd pi-subagents
npm install
npm test
```
