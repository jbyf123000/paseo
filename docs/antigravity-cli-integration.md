# Antigravity CLI ↔ Paseo Integration

Investigation notes and implementation options for wiring Google's Antigravity CLI (`agy`) into Paseo as an agent provider. Not a shipping checklist — decide a path before coding.

**Probed:** 2026-08-05 against local `agy` **1.1.10** on Windows (`C:\Users\…\AppData\Local\agy\bin\agy.exe`).

## Current state in this repo

| Surface                 | Status                                                                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Desktop editor target   | **Done.** `packages/desktop/src/features/editor-targets/targets/antigravity.ts` opens a workspace/file via `agy` / `antigravity` (`Open workspaces in Antigravity`, PR #1424). |
| Built-in agent provider | **None.** Registry factories are `claude`, `codex`, `copilot`, `cursor`, `opencode`, `pi`, `omp`, mocks.                                                                       |
| ACP catalog             | Gemini CLI only: `packages/app/src/data/acp-provider-catalog.ts` entry `gemini` → `npx -y @google/gemini-cli@0.52.0 --acp`. No Antigravity entry.                              |
| Custom `extends: "acp"` | Works only if the binary speaks ACP on stdio. `agy` does not.                                                                                                                  |

Paseo already knows how to drive ACP agents and how to build direct process adapters (Pi/OMP JSON-RPC, Codex app-server, Claude SDK). Antigravity fits neither path cleanly today.

## What Antigravity CLI is

- Product: [antigravity.google/product/antigravity-cli](https://antigravity.google/product/antigravity-cli)
- Docs: [antigravity.google/docs/cli/overview](https://antigravity.google/docs/cli/overview)
- Repo (mostly docs/issues, not full source): [github.com/google-antigravity/antigravity-cli](https://github.com/google-antigravity/antigravity-cli)
- Binary: `agy` (Windows install also accepts `antigravity` as an alias for some desktop launch paths)
- Config / state: `~/.gemini/antigravity-cli/` (`settings.json`, conversations, plugins, …)
- Auth: system keyring + Google Sign-In; headless uses cached credentials after one interactive login
- Shared agent harness with Antigravity 2.0 desktop; settings sync both ways

Install:

```bash
# macOS / Linux
curl -fsSL https://antigravity.google/cli/install.sh | bash

# Windows PowerShell
irm https://antigravity.google/cli/install.ps1 | iex
```

### Machine-facing surfaces (probed)

| Surface                                            | Purpose                      | Paseo-usable?                       |
| -------------------------------------------------- | ---------------------------- | ----------------------------------- |
| Interactive TUI (`agy`)                            | Full agent session           | No (needs a real PTY + human TUI)   |
| Headless print (`agy -p` / `--print` / `--prompt`) | One prompt, exit             | Yes, limited                        |
| `--output-format text\|json\|stream-json`          | Capture / NDJSON events      | Yes                                 |
| `--conversation <id>` / `-c`                       | Resume prior conversation    | Yes (process-per-turn)              |
| `--model` / `--effort` / `--agent` / `--mode`      | Pin run config               | Yes                                 |
| `agy models` / `agy agents`                        | Catalog discovery            | Yes (text list; no JSON flag today) |
| `--dangerously-skip-permissions`                   | Auto-approve tools           | Yes, dangerous                      |
| ACP / `--acp` / stdio JSON-RPC                     | Editor/orchestrator protocol | **No official support**             |

Headless docs: [docs/cli/headless](https://antigravity.google/docs/cli/headless).

Local smoke:

```text
agy -p "Reply with exactly: ok" --output-format json --print-timeout 30s
→ {"conversation_id":"…","status":"SUCCESS","response":"ok\n","usage":{…}}
```

`agy models` returned (account-dependent):

```text
gemini-3.6-flash-high|medium|low
gemini-3.5-flash-high|medium|low
gemini-3.1-pro-high|low
claude-sonnet-4-6
claude-opus-4-6-thinking
gpt-oss-120b-medium
```

### stream-json event shape (summary)

NDJSON lines:

1. `{"event":"init","conversation_id","init":{cwd,tools,permission_mode,model?,agent?}}`
2. many `{"event":"step_update","step_update":{step_index,state:ACTIVE|DONE,step_type,text_delta?,tool_name?,tool_info?,subagent_info?,usage?}}`
3. one `{"event":"result","result":{conversation_id,status,response,error?,usage,…}}`

Observed `step_type` values: `user_input`, `agent_response`, `tool`, `checkpoint`. Tool steps carry `tool_info.{name,parameters,output,error?}`.

### Headless permission model (critical gap)

There is **no mid-turn interactive permission bridge** in headless mode.

- Workspace file R/W: often auto-allowed
- Shell / other gated tools: soft-denied unless pre-allowed in `settings.json` or `--dangerously-skip-permissions`
- Soft-deny continues the run and prints a stderr notice; does not pause for Paseo UI approval

That alone makes a “full” Paseo agent experience (approve shell, deny write, answer questions) impossible without either:

- pre-configured `permissions.allow` on the host, or
- always-skip-permissions mode (unsafe default), or
- official ACP with `session/request_permission`

### ACP status

- Feature request: [antigravity-cli#31](https://github.com/google-antigravity/antigravity-cli/issues/31) (open; heavy +1 traffic)
- Gemini CLI had `--acp`; Antigravity CLI is the migration path and currently does **not** expose it
- Community adapters exist. The concrete candidate [maojindao55/agy-acp](https://github.com/maojindao55/agy-acp), published as `agy-acp-bridge` 0.2.2, is an ACP v1 bridge over `agy --print --output-format stream-json`; it is not official.

### Terms / product policy risk

Google FAQ ([docs/faq](https://antigravity.google/docs/faq)):

> Why can’t I use third party software (e.g. Claude Code, OpenClaw, OpenCode) with my Antigravity login?
>
> Using third party software, tools, or services to access Antigravity is a violation of our Terms of Service … may be grounds for suspension or termination … use a Vertex or AI Studio API key [for third-party coding agents with Gemini].

How strictly “drive official `agy` as a subprocess from Paseo” is interpreted is unclear. Risk factors:

| Approach                                                              | Policy risk (estimate)                                 |
| --------------------------------------------------------------------- | ------------------------------------------------------ |
| Open workspace in Antigravity (editor target)                         | Low — already shipping; launches Google’s own UI       |
| User runs `agy` in Paseo terminal only                                | Low — user-owned TTY, no harness wrapping              |
| Paseo spawns `agy -p` / stream-json as a first-class provider         | Medium — third-party orchestrator on Antigravity login |
| Community ACP shim + Antigravity OAuth                                | High — FAQ names this pattern                          |
| Vertex / AI Studio API key through another provider (Pi/OMP/OpenCode) | Low for policy; different product surface              |

Do not ship a default-on built-in that silently routes Antigravity-login traffic through Paseo without an explicit product/legal decision.

## Capability map vs Paseo provider contract

Paseo wants (from `AgentClient` / `AgentSession` in `agent-sdk-types.ts` and [providers.md](providers.md)):

| Capability              | ACP path              | Headless stream-json path                  | Notes                                                             |
| ----------------------- | --------------------- | ------------------------------------------ | ----------------------------------------------------------------- |
| Spawn agent process     | ✅                    | ✅                                         | One process per turn for headless                                 |
| Stream assistant text   | ✅                    | ✅ `agent_response.text_delta`             |                                                                   |
| Stream reasoning        | ✅ (if agent emits)   | Unclear / not distinct in docs             | May be folded into usage `thinking_tokens` only                   |
| Tool call timeline      | ✅                    | Partial                                    | Observe `tool` steps; no Paseo-side approve/deny                  |
| Permission prompts      | ✅                    | ❌                                         | Soft-deny or skip-all only                                        |
| Multi-turn session      | ✅ long-lived process | Process-per-turn + `--conversation`        | Higher spawn cost; cancel = kill child                            |
| Resume / import         | ✅ if agent supports  | `conversation_id` only                     | Import listing needs DB scrape under `~/.gemini/antigravity-cli/` |
| Model catalog           | ✅ runtime            | `agy models` parse                         | No JSON; parse text or pin static list                            |
| Modes                   | ✅                    | `--mode accept-edits\|plan`                | Thin vs Paseo mode UX                                             |
| Slash commands / skills | ✅                    | Limited / expansion flag                   | `--disable-slash-commands` in print mode                          |
| MCP injection           | ✅ `session/new`      | Via agy settings/plugins, not Paseo inject | No clean per-agent MCP from daemon                                |
| Cancel mid-turn         | ✅                    | Kill process                               |                                                                   |
| Images / attachments    | provider-specific     | Unknown in headless docs                   | Verify before promising                                           |
| Subagents               | provider-specific     | `subagent_info` in stream                  | Observe-only                                                      |

## Options

### Option A — Wait for official `agy --acp` (recommended default)

**What:** When Google ships ACP stdio, add a thin provider (or ACP catalog entry) like Copilot/Cursor/Gemini CLI.

**Work:**

1. Catalog or built-in: `command: ["agy", "--acp"]` (exact flag TBD)
2. Follow [providers.md](providers.md) ACP checklist: client class, manifest, registry factory, icon, e2e config
3. Or ACP catalog only if we want opt-in custom providers without a first-class ID

**Pros:** Matches Paseo architecture; permissions, streaming, session lifecycle for free via `ACPAgentClient`.  
**Cons:** Blocked on Google; timeline unknown despite #31.  
**Effort:** Small once ACP exists (days).  
**Ship risk:** Low.

### Option B — Direct headless stream-json provider (custom adapter)

**What:** Implement `AgentClient` / `AgentSession` that:

1. Resolves `agy` on PATH (or `runtimeSettings.command`)
2. `fetchCatalog`: run `agy models` (+ static modes `accept-edits` / `plan`; optional `agy agents`)
3. `createSession` / `resumeSession`: store `conversation_id` as native handle; no long-lived child
4. `run(prompt)`: spawn  
   `agy -p <prompt> --output-format stream-json [--conversation id] [--model …] [--mode …] [--effort …] [cwd]`  
   parse NDJSON → `AgentStreamEvent` / timeline items
5. Cancel: terminate child process
6. Persistence: `conversation_id` in agent storage handle

**Mode policy (product choice, pick one):**

| Mode id        | Launch flags                     | Meaning                                        |
| -------------- | -------------------------------- | ---------------------------------------------- |
| `plan`         | `--mode plan`                    | Planning-oriented (still no interactive perms) |
| `accept-edits` | `--mode accept-edits`            | Prefer edit acceptance                         |
| `unattended`   | `--dangerously-skip-permissions` | Full auto — only if user opts in               |

Default must not be unattended.

**Pros:** Works with today’s CLI; real streaming + tool observation; no third-party shim binary.  
**Cons:** Incomplete agent UX; process-per-turn; no Paseo permission UI; MCP injection awkward; policy risk remains.  
**Effort:** Medium–large (1–2 weeks for solid adapter + tests; more for import/history polish).  
**Ship risk:** Medium product + policy.

Rough file layout if chosen:

```text
packages/server/src/server/agent/providers/antigravity/
  agent.ts              # AntigravityAgentClient / Session
  stream-parser.ts      # NDJSON → events
  models.ts             # parse `agy models`
  conversation-store.ts # optional import from ~/.gemini/antigravity-cli
packages/protocol/src/provider-manifest.ts   # antigravity definition
packages/server/.../provider-registry.ts     # factory
packages/app/.../provider-icons + icon
docs/providers.md                            # short pointer only
```

### Option C — `agy-acp-bridge` as an experimental custom ACP provider

**Candidate:** [maojindao55/agy-acp](https://github.com/maojindao55/agy-acp), npm package `agy-acp-bridge` 0.2.2, Apache-2.0.

**Verified locally:**

```text
npx -y agy-acp-bridge --version
→ 0.2.2

ACP initialize (NDJSON JSON-RPC) → protocolVersion 1
agentCapabilities.sessionCapabilities = resume, list, close, delete, additionalDirectories
```

It can therefore be launched by Paseo's existing `GenericACPAgentClient`; no custom server-side `AgentClient` is needed for an initial experiment.

```json
{
  "agents": {
    "providers": {
      "antigravity-experimental": {
        "extends": "acp",
        "label": "Antigravity (experimental)",
        "command": ["npx", "-y", "agy-acp-bridge"],
        "params": {
          "supportsMcpServers": false
        }
      }
    }
  }
}
```

Use a globally installed, version-pinned executable for a repeatable host setup; `npx -y` resolves a mutable registry package on every new provider process.

**Adapter behavior from source review:**

| Feature             | Implementation / consequence                                                                                                                                                                                                        |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Streaming           | Parses native `stream-json` and emits ACP text chunks, tool calls, tool completion, and usage.                                                                                                                                      |
| Session persistence | Maps ACP session UUID → `agy --conversation <id>` in `~/.agy-acp-state.json`; it does not import all pre-existing Antigravity conversations.                                                                                        |
| Cancellation        | Kills the current `agy` child with `SIGINT`, then `SIGKILL` after two seconds. Verify on Windows before shipping, because signal behavior is platform-sensitive.                                                                    |
| Modes               | Only `accept-edits` and `plan`.                                                                                                                                                                                                     |
| Models              | Hard-coded list and context sizes, not `agy models`; it will drift as the CLI account catalog changes.                                                                                                                              |
| Attachments         | Serializes only text/resource content into the prompt; images/audio are intentionally dropped.                                                                                                                                      |
| MCP / permissions   | No ACP permission request or MCP-server capability. It inherits the headless limitation.                                                                                                                                            |
| Error contract      | `result.error` is emitted as an assistant-text `Error: …` chunk, but process exit otherwise resolves as `end_turn`; Paseo may show an apparent successful completed turn. Test and patch upstream before relying on failure states. |

**Security blocker:** its source automatically appends `--dangerously-skip-permissions` unless `--sandbox` is passed or `AGY_ACP_NO_SKIP_PERMISSIONS=1`. That makes arbitrary file edits and shell commands auto-approved. The README mentions passing flags through, but source only specially handles `--sandbox`; it does not implement a general pass-through argument layer.

Do **not** expose this as a built-in provider or catalog one-click install. At most document the explicit experimental custom-provider route after a product/legal decision. It remains subject to the Google FAQ's third-party-login restriction.

**Pros:** Existing ACP adapter; true process-streamed text/tool updates; resume/cancel baseline; a config-only Paseo experiment.  
**Cons:** Unofficial; ToS risk high; default unsafe permission behavior; static model data; no MCP injection; shallow error semantics; package has zero GitHub stars/issues at investigation time.  
**Effort:** Docs-only trial; upstream hardening required before any first-class integration.  
**Ship risk:** High for default user exposure.

### Option D — Soft integration only (expand what we already have)

No agent provider. Improve non-provider surfaces:

1. Keep / polish desktop “Open in Antigravity”
2. Optional: settings deep-link to install docs
3. Optional: command-center action “Open this workspace in Antigravity CLI” (`agy` in cwd)
4. Keep Gemini CLI ACP catalog until Google kills it; document migration gap

**Pros:** Zero policy gray area for agent driving; tiny code.  
**Cons:** Paseo cannot run Antigravity turns from the phone/app.  
**Effort:** Small.  
**Ship risk:** Low.

### Option E — Gemini models via API key, not Antigravity login

**What:** Users who want Gemini in Paseo use Vertex / AI Studio keys through Pi, OMP, OpenCode, or Claude-compatible gateways — as Google’s FAQ suggests.

**Pros:** Policy-clean; already possible with existing providers.  
**Cons:** Not Antigravity harness (no shared settings, skills, plugins, conversation export to Antigravity 2.0).  
**Effort:** Docs / recipes only.

### Option F — Hybrid phased plan (practical recommendation)

| Phase  | Deliverable                                                                                                                      | Gate                      |
| ------ | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| **0**  | This doc + product decision on ToS                                                                                               | —                         |
| **1**  | Soft integration polish (D) if anything missing                                                                                  | Always safe               |
| **2a** | If legal/product OK: experimental **disabled-by-default** headless provider (B), labeled “experimental / incomplete permissions” | Explicit enable in config |
| **2b** | Else: stay on D + E                                                                                                              | —                         |
| **3**  | When `agy --acp` ships: replace or dual-path to Option A; delete headless special-cases                                          | Official ACP              |

OMP is the pattern for “built-in but `enabledByDefault: false`”.

## Implementation sketch for Option B (if approved)

### Launch contract

```bash
agy -p "$PROMPT" \
  --output-format stream-json \
  --print-timeout 30m \
  [--conversation "$ID"] \
  [--model "$MODEL"] \
  [--mode accept-edits|plan] \
  [--effort low|medium|high] \
  [--agent "$AGENT"] \
  [--dangerously-skip-permissions] \
  [--sandbox]
```

Working directory: agent `cwd`. Do not rewrite user `settings.json` for MCP; if we later inject MCP, prefer documented plugin/settings APIs only.

### Event mapping (minimum)

| stream-json                     | Paseo                                                     |
| ------------------------------- | --------------------------------------------------------- |
| process start                   | `thread_started` / `turn_started`                         |
| `agent_response` + `text_delta` | `assistant_message` timeline deltas                       |
| `tool` ACTIVE                   | `tool_call` running                                       |
| `tool` DONE + `tool_info`       | complete tool_call with shell/read/edit detail heuristics |
| `result.usage`                  | `usage_updated` / `turn_completed`                        |
| `result.status=ERROR`           | `error` + failed turn                                     |
| process signal                  | `turn_canceled`                                           |

Canonical user message: emit one `user_message` with Paseo `clientMessageId` when the run is accepted (same rule as other providers).

### Catalog

- Parse `agy models` lines → `AgentModelDefinition[]`
- Static modes: `plan`, `accept-edits` (+ optional `unattended` behind capability/feature flag)
- `isAvailable`: binary on PATH + optional lightweight probe (`agy models` or `agy --version`); do not open browser (`NO_BROWSER` style env if any)

### Persistence / import

- Native handle: `{ conversationId }`
- Resume: next `-p` with `--conversation`
- Import listing: optional later — scan `~/.gemini/antigravity-cli/conversations` / summary DB; treat schema as unstable

### Tests

- Unit: stream parser fixtures (init / text deltas / tool / result / error)
- Unit: models text parser
- Local e2e behind env flag when `agy` + auth present (same pattern as other real-provider tests)
- Never default CI to live Google account calls

### App / protocol checklist (same as any new provider)

See [providers.md](providers.md). Minimum:

1. `AGENT_PROVIDER_DEFINITIONS` entry (`enabledByDefault: false` recommended)
2. Registry factory
3. Icon
4. E2E agent config + availability check
5. Public docs only if shipping to users

### Explicit non-goals for v1 headless

- Interactive tool permission UI
- Faithful MCP injection from Paseo daemon
- Subagent control plane (observe-only at most)
- Claiming feature parity with Claude/Codex/OMP
- Bundling unofficial ACP shims

## Decision matrix

| Goal                                                     | Prefer                                                     |
| -------------------------------------------------------- | ---------------------------------------------------------- |
| Full remote control of Antigravity agents from Paseo app | A (wait ACP) or B with big caveats                         |
| Ship something next sprint with low risk                 | D (+ E for Gemini models)                                  |
| Experimental opt-in for power users                      | B, disabled by default, clear UX warnings                  |
| Avoid ToS / account-ban risk                             | D or E only                                                |
| Unblock users after Gemini CLI sunset                    | A primary; B temporary bridge only if product accepts risk |

## Open questions for product

1. Is “Paseo spawns official `agy -p` with the user’s Antigravity login” acceptable under ToS for this fork / upstream contribution?
2. Is a **disabled-by-default experimental** provider acceptable without interactive permissions?
3. Should Antigravity appear as a first-class provider ID, or only as docs for custom config?
4. After Gemini CLI retirement, do we keep the `gemini` ACP catalog entry, rename, or remove?

## Sources

- Local probe: `agy` 1.1.10 help, `models`, headless `--output-format json`
- [CLI overview](https://antigravity.google/docs/cli/overview)
- [Headless mode](https://antigravity.google/docs/cli/headless)
- [FAQ third-party login](https://antigravity.google/docs/faq#why-cant-i-use-third-party-software-eg-claude-code-openclaw-opencode-with-my-antigravity-login)
- [ACP feature request #31](https://github.com/google-antigravity/antigravity-cli/issues/31)
- Repo: [google-antigravity/antigravity-cli](https://github.com/google-antigravity/antigravity-cli)
- [agy-acp-bridge](https://github.com/maojindao55/agy-acp) source, npm 0.2.2 version probe, and ACP v1 `initialize` handshake probe
- Internal: [providers.md](providers.md), [custom-providers.md](custom-providers.md), desktop `antigravity` editor target

## Suggested next step

Product pick: **D-only** vs **F with experimental B**. Do not implement B as default-on without answering the ToS question. If the answer is “wait for ACP,” leave a short note in public provider docs that Antigravity agent control is blocked on official ACP and link #31.
