# Agent Teams — Master Reference Guide

> Working reference for designing and running effective Claude Code agent teams.
> Source: https://code.claude.com/docs/en/agent-teams (behavior as of v2.1.178+; version-gated notes call out the release).
> Audience: the lead session (me) when planning multi-agent work on this project.

---

## 1. What agent teams are

Multiple Claude Code instances working together. One session is the **team lead** (the main session — always me, fixed for the session lifetime). It spawns **teammates**, each a full independent Claude Code session with its own context window. Teammates coordinate through a **shared task list** and message **each other directly** — not just back to the lead.

**The distinguishing feature vs. subagents:** teammates talk to each other and self-coordinate. Subagents only report results back to the caller and never communicate peer-to-peer.

---

## 2. Enable (already done in this project)

Set the env var to `1` in `settings.json` (or shell environment):

```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

Without it: no team is set up at session start, no team directories are written, and I will not spawn or propose teammates. **A session restart is required after enabling.**

> This project has it set in `.claude/settings.local.json`.

---

## 3. Decision guide — teams vs. subagents vs. single session

| Situation | Use |
| :-- | :-- |
| Workers need to share findings, challenge each other, coordinate | **Agent team** |
| Quick focused workers that just report a result back | **Subagents** |
| Sequential work, same-file edits, many dependencies | **Single session** |
| Manual isolated parallelism without auto-coordination | **Git worktrees** |

| | Subagents | Agent teams |
| :-- | :-- | :-- |
| **Context** | Own window; result returns to caller | Own window; fully independent |
| **Communication** | Report to main agent only | Teammates message each other directly |
| **Coordination** | Main agent manages all work | Shared task list, self-coordination |
| **Best for** | Result-only focused tasks | Work needing discussion/collaboration |
| **Token cost** | Lower (summarized back) | Higher (each is a separate instance) |

**Strongest team use cases:** research & review, new modules/features (separate ownership), debugging with competing hypotheses, cross-layer changes (frontend/backend/tests each owned separately).

**Teams add coordination overhead and use significantly more tokens.** Only reach for them when teammates can genuinely operate independently in parallel.

---

## 4. How to start a team

Describe the task and the teammates in natural language. Teams form when the first teammate is spawned. Two paths:
- **User requests teammates** — explicit ask.
- **Claude proposes teammates** — I suggest it when a task benefits from parallelism; user confirms first. **Teammates are never spawned without approval.**

Good starter prompt (roles are independent, no waiting on each other):

```text
I'm designing a CLI tool that tracks TODO comments across a codebase.
Spawn three teammates to explore this from different angles:
one on UX, one on technical architecture, one playing devil's advocate.
```

---

## 5. Architecture

| Component | Role |
| :-- | :-- |
| **Team lead** | Main session; spawns teammates, coordinates, synthesizes |
| **Teammates** | Separate Claude Code instances, each on assigned tasks |
| **Task list** | Shared work items teammates claim & complete |
| **Mailbox** | JSON-file messaging system between agents |

**Storage (session-derived name = `session-` + first 8 chars of session ID):**
- Team config: `~/.claude/teams/{team-name}/config.json` — removed when session ends.
- Mailbox: `~/.claude/teams/{team-name}/inboxes/{agent-name}.json`.
- Task list: `~/.claude/tasks/{team-name}/` — **persists** locally (never uploaded), so resumed sessions keep tasks. Retention follows `cleanupPeriodDays`.

**Do not hand-edit or pre-author `config.json`** — it holds runtime state (session IDs, tmux pane IDs) and is overwritten on the next state update. There is **no project-level team config**; a `.claude/teams/teams.json` is treated as an ordinary file, not config.

The `members` array in team config lists each teammate's name, agent ID, and agent type — teammates can read it to discover each other. Task dependencies resolve automatically: completing a task unblocks its dependents.

---

## 6. Controlling the team

### Display modes
- **In-process** (default): all teammates run inside the main terminal. Works anywhere, no setup.
- **Split panes**: each teammate gets a pane; requires tmux or iTerm2 (`it2` CLI).

Set via `~/.claude/settings.json`:
```json
{ "teammateMode": "auto" }
```
Or per-session: `claude --teammate-mode auto`

Values: `"in-process"` (default), `"auto"` (split panes if already in tmux or iTerm2+`it2`, else in-process), `"tmux"` (split panes, auto-detect tmux vs iTerm2), `"iterm2"` (native iTerm2 panes, requires `it2`, v2.1.186+).

> **On this machine (Windows):** split panes are **not supported** in Windows Terminal (nor VS Code integrated terminal or Ghostty). Stay on the default in-process mode.

### In-process agent panel (below the prompt input)
- **Up/Down arrows**: select a teammate
- **Enter**: open the teammate's transcript and message it directly
- **Escape**: interrupt the selected teammate's current turn
- **`x`** on a selected teammate: stop it
- **Ctrl+T**: toggle the task list

Idle rows hide 30s after the whole panel goes idle (v2.1.199 behavior) and reappear on the teammate's next turn — hidden ≠ stopped; message it by name to bring it back. >3 idle teammates collapse into one `N idle agents` row (Enter expands).

While viewing a teammate: plain text and skills go to that teammate, but built-in commands (e.g. `/model`, `/fast`) still run in the lead. `/effort` applies to the viewed teammate's later turns.

### Specifying teammates & models
Claude decides count by default, or specify:
```text
Spawn 4 teammates to refactor these modules in parallel. Use Sonnet for each teammate.
```
- Teammates do **not** inherit the lead's `/model` by default. Set **Default teammate model** in `/config` (pick "Default (leader's model)" to follow the lead).
- Teammates inherit the lead's **effort level**. Model and fast mode are **fixed at spawn**.

### Plan approval gate (for risky work)
```text
Spawn an architect teammate to refactor the authentication module.
Require plan approval before they make any changes.
```
Teammate works read-only in plan mode → submits plan → lead approves or rejects with feedback → on reject, revises and resubmits → on approve, implements. **The lead approves autonomously** (no separate prompt to the user). Steer it with criteria in the prompt, e.g. "only approve plans that include test coverage."

### Assign & claim tasks
Three states: pending, in progress, completed. Tasks can depend on other tasks (blocked until dependencies complete).
- **Lead assigns**: tell the lead which task → which teammate.
- **Self-claim**: after finishing, a teammate picks up the next unassigned, unblocked task.
- File locking prevents claim race conditions.

### Talk to teammates directly
Each teammate is a full session. Message any by name to add instructions, ask follow-ups, or redirect. Names are lead-assigned at spawn — **tell the lead what to name each teammate** if you want to reference them later.

### Shut down a teammate
```text
Ask the researcher teammate to shut down
```
Lead sends a shutdown request; teammate approves (exits gracefully) or rejects with explanation. Shared directories clean up automatically at session end.

---

## 7. Reusing subagent definitions as teammates

Reference a subagent type (project/user/plugin/CLI scope) by name at spawn:
```text
Spawn a teammate using the security-reviewer agent type to audit the auth module.
```
- The teammate honors that definition's `tools` allowlist and `model`.
- The definition's body is **appended** to the teammate's system prompt (not a replacement).
- Coordination tools (`SendMessage`, task tools) are **always** available even if `tools` restricts others.
- **Not applied as a teammate:** `skills` and `mcpServers` frontmatter. Teammates load skills/MCP from project + user settings like a normal session.

> This project's memory defines an **Eng-Manager-over-5-specialists** operating model. Encode those roles as reusable subagent definitions so the same role works both as a delegated subagent and as a team teammate.

---

## 8. Permissions

- Teammates start with the **lead's** permission settings (incl. `--dangerously-skip-permissions`).
- You **cannot** set per-teammate modes at spawn; you can change an individual teammate's mode after spawning.
- Teammate permission prompts **bubble up to the lead session** — approve them there. Plan approval is the designed exception (lead grants without prompting the user).
- Security guardrails: a `SendMessage` from another agent is labeled as coming from another Claude session, not the user. A teammate **cannot** approve a permission prompt, give consent on the user's behalf, or relay a denied action to another teammate to bypass a check. In auto mode, a relayed approval claim is treated as untrusted input.
- **Reduce friction:** pre-approve common operations in permission settings *before* spawning teammates.

---

## 9. Context & communication

Each teammate loads the same project context as a normal session (CLAUDE.md, MCP servers, skills) **plus the spawn prompt**. It does **not** inherit the lead's conversation history.

- **Automatic message delivery** — no polling needed.
- **Idle notifications** — teammate notifies the lead when it stops (v2.1.198+: also reports API-error failures with the error text).
- **Shared task list** — all agents see status and claim work.
- **Direct messaging** — one message per recipient; to reach everyone, send one each.

---

## 10. Quality gates via hooks

Enforce rules when work finishes or tasks change state. **Exit code 2** sends feedback and blocks the transition:
- `TeammateIdle` — runs as a teammate is about to go idle. Exit 2 → send feedback, keep it working.
- `TaskCreated` — runs as a task is created. Exit 2 → prevent creation + feedback.
- `TaskCompleted` — runs as a task is marked complete. Exit 2 → prevent completion + feedback.

Example uses: block "complete" until tests/lint pass, force a task to be split, reject work that violates a project invariant.

---

## 11. Best practices

1. **Give teammates enough context.** They don't inherit conversation history — put task specifics in the spawn prompt (files, constraints, stack details, what to report). Example:
   ```text
   Spawn a security reviewer teammate with the prompt: "Review the authentication
   module at src/auth/ for security vulnerabilities. Focus on token handling,
   session management, and input validation. The app uses JWT tokens stored in
   httpOnly cookies. Report any issues with severity ratings."
   ```
2. **Team size: start with 3–5.** Token cost scales linearly; coordination overhead and diminishing returns rise beyond that. Three focused teammates often beat five scattered ones.
3. **Tasks per teammate: aim for 5–6.** Keeps everyone busy and lets the lead reassign if someone gets stuck. ~15 independent tasks → 3 teammates.
4. **Size tasks right.** Too small = overhead exceeds benefit. Too large = long runs without check-ins risk wasted effort. Just right = a self-contained unit with a clear deliverable (a function, a test file, a review).
5. **Avoid file conflicts.** Two teammates editing one file overwrite each other. Partition files so each teammate owns a distinct set.
6. **Wait for teammates to finish.** If the lead starts doing the work itself: `Wait for your teammates to complete their tasks before proceeding`.
7. **Start with research/review.** Clear boundaries, no parallel-write conflicts — best for learning the workflow (review a PR, research a library, investigate a bug).
8. **Monitor and steer.** Check progress, redirect failing approaches, synthesize as findings arrive. Don't run unattended too long.

---

## 12. Ready-to-adapt prompt patterns

**Parallel code review** (distinct lenses so they don't overlap):
```text
Spawn three teammates to review PR #142:
- One focused on security implications
- One checking performance impact
- One validating test coverage
Have them each review and report findings.
```

**Competing hypotheses / adversarial debugging:**
```text
Users report the app exits after one message instead of staying connected.
Spawn 5 agent teammates to investigate different hypotheses. Have them talk to
each other to try to disprove each other's theories, like a scientific debate.
Update the findings doc with whatever consensus emerges.
```

**Cross-layer feature** (partition by file ownership):
```text
Spawn 3 teammates to build feature X: one owns the backend route in server.js,
one owns the React page in src/, one writes the test script in scripts/.
Each owns a distinct set of files. Have the backend teammate message the frontend
teammate the final response shape. Wait for all to finish, then I'll review.
```

---

## 13. Troubleshooting

| Symptom | Fix |
| :-- | :-- |
| Teammates not appearing | Check the agent panel (Up/Down + Enter). Idle rows hide after 30s — message by name to restore. Ensure the task was complex enough to warrant a team. |
| Too many permission prompts | Pre-approve common ops in permission settings before spawning. |
| Teammate stopped on an error | Select it, Enter to read output; give instructions directly, or spawn a replacement. (v2.1.198+: a message wakes a teammate waiting to retry.) |
| Lead shuts down before work is done | Tell it to keep going / wait for teammates before proceeding. |
| Split panes not working | Not supported on Windows Terminal / VS Code / Ghostty — use in-process. On mac: `which tmux`; for iTerm2 confirm `it2` + Python API enabled. |
| Orphaned tmux session | `tmux ls` then `tmux kill-session -t <name>` (mac/tmux only). |

---

## 14. Limitations (experimental)

- **No session resumption with in-process teammates:** `/resume` and `/rewind` don't restore them. After resume, the lead may message teammates that no longer exist — tell it to spawn new ones.
- **Task status can lag:** teammates sometimes fail to mark tasks complete, blocking dependents. Check if work is actually done; update status manually or nudge the teammate.
- **Shutdown can be slow:** a teammate finishes its current request/tool call first.
- **One team per session:** exactly one team, scoped to the session. No additional named teams, no sharing across sessions.
- **No nested teams:** teammates can't spawn teammates. Only the lead manages the team.
- **No background subagents from in-process teammates:** their subagents run foreground; `run_in_background` / `background: true` returns an error.
- **Lead is fixed:** can't promote a teammate or transfer leadership.
- **Permissions set at spawn:** all start with the lead's mode; change individually after spawn only.
- **Split panes require tmux or iTerm2.**

---

## 15. Quick project checklist (before spawning a team here)

- [ ] Is this genuinely parallelizable, or would a single session / subagents be cheaper? (Teams cost significantly more tokens.)
- [ ] Have I partitioned files so no two teammates edit the same one? (`server.js`, `src/`, `scripts/`, `migrations/` are natural seams.)
- [ ] Did I put stack/context specifics in each spawn prompt? (Teammates don't see this conversation.)
- [ ] 3–5 teammates, ~5–6 tasks each?
- [ ] Named each teammate so I can address them later?
- [ ] Pre-approved common Bash/PowerShell ops so prompts don't pile up on the lead?
- [ ] For risky schema/migration work, required plan approval with explicit criteria?
- [ ] Staying in-process mode (Windows — no split panes)?
```

