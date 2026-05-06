---
name: pi-subagents
description: |
  Delegate work to subagents with single-agent, chain, parallel, async,
  forked-context, and intercom-coordinated workflows. Use for implementation
  handoffs, multi-step tasks, and parallel exploration where a single agent
  should stay in control while other agents contribute execution.
---

# Pi Subagents

This skill is for the main parent orchestrator only. Do not inject or follow it inside spawned child subagents. The parent session owns delegation and orchestration; child subagents should receive concrete role-specific tasks and should not run their own subagent workflows.

Use this skill when the parent orchestrator needs to launch a subagent, compose multiple agents into a workflow, or create/edit agents and chains on demand.

## Builtin Agent

The only builtin agent is `delegate` — a lightweight general-purpose subagent that inherits the parent model, carries no default reads or outputs, and can read, write, search, and execute tasks.

| Agent | Purpose | Tools |
|-------|---------|-------|
| `delegate` | Lightweight general-purpose delegate | read, grep, find, ls, bash, edit, write, contact_supervisor |

Builtin agents inherit the current Pi default model unless a run, user setting, or project setting overrides `model`.

## Tool vs Slash Commands

Agents can use the `subagent(...)` tool directly for execution, management, status, and control.
Humans often use the slash-command layer instead:

- `/run` — launch a single agent
- `/chain` — launch a chain of steps
- `/parallel` — launch top-level parallel tasks
- `/run-chain` — launch a saved `.chain.md` workflow
- `/subagents-doctor` — diagnose setup, discovery, async paths, and intercom bridge state
- `/subagents-model` — configure default models for builtin subagents

Prefer the tool when you are writing agent logic. Prefer the slash commands when
you are guiding a human through an interactive flow.

## Discovery and Scope Rules

Agent files can live in:
- `~/.pi/agent/agents/**/*.md` — user scope
- `.pi/agents/**/*.md` — canonical project scope
- legacy `.agents/**/*.md` — still read for compatibility, but `.pi/agents/` wins on conflicts

Chains live in:
- `~/.pi/agent/chains/**/*.chain.md` — user scope
- `.pi/chains/**/*.chain.md` — project scope

Discovery is recursive. `.chain.md` files do not define agents. Agents and chains can set optional frontmatter `package: code-analysis`; `name: delegate` plus `package: code-analysis` registers as runtime name `code-analysis.delegate` while serialization keeps `name` and `package` separate.

Precedence is by parsed runtime name:
1. project scope
2. user scope
3. builtin agents

## Running Subagents

### Single agent

```typescript
subagent({
  agent: "delegate",
  task: "Implement the approved feature. Requirements: ..."
})
```

### Forked context

```typescript
subagent({
  agent: "delegate",
  task: "Implement the approved plan in a branched thread.",
  context: "fork"
})
```

`context: "fork"` creates a branched child session from the current persisted
parent session. It does **not** create a fresh minimal context. Use it when you
want a separate execution thread that can still reference the parent session history.

### Parallel execution

```typescript
subagent({
  tasks: [
    { agent: "delegate", task: "Explore the auth module" },
    { agent: "delegate", task: "Audit the API client" }
  ]
})
```

Top-level parallel tasks can override per-task behavior:

```typescript
subagent({
  tasks: [
    { agent: "delegate", task: "Implement feature A", output: "feature-a.md", progress: true },
    { agent: "delegate", task: "Implement feature B", output: "feature-b.md", model: "anthropic/claude-sonnet-4" }
  ],
  concurrency: 2
})
```

Avoid duplicate output paths in parallel tasks. For large saved outputs, set `outputMode: "file-only"` together with an `output` path. The parent result then contains only a compact reference instead of the full saved content.

### Chain execution

```typescript
subagent({
  chain: [
    { agent: "delegate", task: "Map the auth flow and summarize key files" },
    { agent: "delegate", task: "Implement the migration from {previous}" }
  ]
})
```

Chain steps can use templated variables such as `{task}`, `{previous}`, and
`{chain_dir}`. This is the main way to pass structured summaries between steps
without forcing each step to rediscover everything.

### Async/background

Use async mode whenever the parent agent should keep working while a child runs. A normal foreground `subagent(...)` call blocks the parent until the child completes.

```typescript
subagent({
  agent: "delegate",
  task: "Run the full test suite",
  async: true
})
```

Inspect async runs with `subagent({ action: "status", id: "..." })` or `subagent({ action: "status" })` for active runs.

Use `resume` for follow-up work after a delegated run:

```typescript
subagent({ action: "resume", id: "run-id", message: "Follow up on this point." })
subagent({ action: "resume", id: "run-id", index: 1, message: "Continue the second child." })
```

Use diagnostics when setup or child startup looks wrong:

```typescript
subagent({ action: "doctor" })
```

Humans can use `/subagents-doctor` for the same read-only report. It checks runtime paths, discovery counts, async support, current session context, and intercom bridge state.

### Subagent control

Subagent control is the runtime visibility and intervention layer for delegated runs. Use soft interrupt when a child is clearly blocked or drifting:

```typescript
subagent({ action: "interrupt" })
subagent({ action: "interrupt", id: "abc123" })
```

A soft interrupt cancels the current child turn and leaves the run paused. After an interrupt, decide the next explicit action: resume with clearer instructions, replace the task, ask the user, or stop the workflow.

### Clarify TUI

```typescript
subagent({
  agent: "delegate",
  task: "Implement feature X",
  clarify: true
})
```

Chains default to clarify mode; set `clarify: false` to skip it.

### Worktree Isolation

When multiple agents might write concurrently, use worktrees:

```typescript
subagent({
  tasks: [
    { agent: "delegate", task: "Implement feature A" },
    { agent: "delegate", task: "Implement feature B" }
  ],
  worktree: true
})
```

`worktree: true` gives each parallel task its own git worktree branched from HEAD. This requires a clean git state.

## Subagent + Intercom Coordination

`pi-subagents` works without `pi-intercom`. When `pi-intercom` is installed and enabled, the intercom bridge can automatically give child agents a private coordination channel back to the parent session.

Use `contact_supervisor` with `reason: "need_decision"` when a subagent is blocked on a decision or needs clarification instead of guessing.

Use `contact_supervisor` with `reason: "progress_update"` for meaningful progress updates or when explicitly asked.

```typescript
contact_supervisor({
  reason: "need_decision",
  message: "Should I optimize for readability or performance here?"
})
```

The parent replies with:

```typescript
intercom({ action: "reply", message: "Optimize for readability." })
```

If intercom messages do not show up, run `subagent({ action: "doctor" })` or `/subagents-doctor`.

## Management Mode

### List available agents and chains

```typescript
subagent({ action: "list" })
```

### Create an agent

```typescript
subagent({
  action: "create",
  config: {
    name: "my-agent",
    package: "code-analysis",
    description: "Project-specific implementation helper",
    systemPrompt: "Your system prompt here.",
    systemPromptMode: "replace",
    model: "openai-codex/gpt-5.4",
    tools: "read,grep,find,ls,bash,edit,write"
  }
})
```

### Update an agent

```typescript
subagent({
  action: "update",
  agent: "code-analysis.my-agent",
  config: {
    thinking: "high"
  }
})
```

### Delete an agent

```typescript
subagent({ action: "delete", agent: "code-analysis.my-agent" })
```

## Creating and Editing Agents by File

A minimal agent file:

```markdown
---
name: my-agent
package: code-analysis
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

Omit `package` for the traditional unqualified runtime name. Common optional fields include: `defaultProgress`, `defaultReads`, `output`, `fallbackModels`, `maxSubagentDepth`.

For small builtin changes such as a model swap, prefer `subagents.agentOverrides` in settings.

## Important Constraints

- **Forking requires a persisted parent session.** If the current session does not have a persisted session file, forked runs fail. Use `context: "fresh"` explicitly when forking is not available.
- **Forked runs inherit parent history.** They are branched threads, not fresh filtered contexts.
- **Default subagent nesting depth is 2.** Deeper recursive delegation is blocked unless configured otherwise.
- **Attention signals are not lifecycle state.** `needs_attention` means no activity has been observed past the configured threshold. `paused` means the child turn was intentionally interrupted.
- **Intercom asks are blocking.** A session can only maintain one pending outbound ask wait state at a time.
- **Keep conversational authority clear.** Advisory subagents should not silently become second decision-makers.

## Best Practices

- **Keep writes single-threaded by default.** One main decision-maker plus delegated execution subagents around it.
- **Prefer narrow tasks.** Give subagents specific tasks rather than vague mandates.
- **Escalate decisions upward.** If a subagent encounters an unapproved product, architecture, or scope choice, it should coordinate back via `intercom` instead of deciding alone.
- **Name sessions meaningfully.** Use `/name` so intercom targeting stays stable.

## Error Handling

**"Unknown agent"**
```typescript
subagent({ action: "list" })
// Check available agents and chains, then confirm scope/precedence.
```

**Setup, discovery, or intercom confusion**
```typescript
subagent({ action: "doctor" })
// Check runtime paths, async support, discovery counts, current session, and intercom bridge state.
```

**"Max subagent depth exceeded"**
```typescript
// Flatten the workflow or raise maxSubagentDepth in config.
```

**"Session manager did not return a session file"**
```typescript
// Persist the current session before using context: "fork".
```

**Intercom "Already waiting for a reply"**
```typescript
// Resolve the current outbound ask before starting another one.
```

**Parallel output-path conflict**
```typescript
// Give each parallel task a distinct output path, or disable output for tasks that do not need it.
```

**Worktree launch fails**
```typescript
// Ensure the git working tree is clean and task cwd overrides match the shared cwd.
```

**Child fails before starting**
```typescript
// Inspect `subagent({ action: "status", id: "..." })`, artifact metadata/output logs, and run doctor.
```
