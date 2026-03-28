# Skillcraft CLI Specification

## Purpose

The `skillcraft` repository contains:

- the **Skillcraft CLI**
- git hook integration
- agent plugin integrations
- GitHub provider integration
- registry publishing tools
- documentation
- the **main Skillcraft website**

Site published at:

https://skillcraft.gg

The CLI enables developers to:

- enable Skillcraft in repositories
- capture skill usage evidence
- track progress toward credentials
- publish skills to the skills registry
- share loadouts with the community
- claim credentials based on verified evidence

---

# Responsibilities

The CLI provides the developer interface to the Skillcraft ecosystem.

Responsibilities include:

- repository enablement
- skill evidence capture
- progress inspection
- credential claim submission
- skill publishing
- loadout sharing
- loadout usage tracking
- multi-repository evidence aggregation
- verification of local repository evidence

The CLI interacts with these repositories:

skillcraft-gg/skills-registry
skillcraft-gg/loadouts
skillcraft-gg/credential-ledger

---

# CLI Commands

Skillcraft — verifiable AI skill usage for developers

Usage:
  skillcraft <command> [options]

Core commands:
  enable                Enable Skillcraft in the current repository
  disable               Disable Skillcraft in the current repository
  status                Show Skillcraft status for this repository
  doctor                Diagnose configuration or environment issues

Evidence & progress:
  progress              Show skill and loadout progress
  skills                List detected skills in the repository
  verify                Verify repository evidence integrity

Claims:
  claim <credential>    Submit a credential claim
  claim list            Show claimable credentials
  claim status          Show status of submitted claims

Skills:
    skills add <id>       Install a skill from the registry
    skills inspect <id>    Show detailed registry info for a skill
    skills search [query] Browse skills from the published search index
    skills publish <id>   Publish a skill to the registry
    skills validate       Validate a local skill against the standard

`skills search` reads the published registry index and supports:

- `--source <source>` to filter results to one registry source
- `--limit <n>` to cap displayed results

`skills inspect` fetches `SKILL.md` for the selected entry to show additional context.

`skills add` supports both local and external identifiers:

- `owner/slug` for skills in `skillcraft-gg/skills-registry`
- `source:slug` or `source:owner/slug` for external registries

Loadouts:
  loadout use <id>      Activate a loadout for development
  loadout clear         Clear the active loadout
  loadout share <id>    Publish a loadout to the registry

Repositories:
  repos list            List repositories tracked by Skillcraft
  repos prune           Remove missing repositories from tracking

Options:
  --repo <path>         Use a specific repository
  --all-repos           Use all enabled repositories
  --json                Output machine-readable JSON
  -h, --help            Show help
  -v, --version         Show version

---

# Global CLI State

Global state is stored in:

~/.skillcraft/

Structure:

~/.skillcraft/
config.json
repos.json
cache/
claims/

## config.json

Stores user configuration.

Example:

```json
{
  "githubUser": "blairhudson"
}

repos.json

Tracks Skillcraft-enabled repositories.

Example:

{
  "repos": [
    {
      "path": "/Users/blair/code/project-a",
      "remote": "https://github.com/blairhudson/project-a"
    }
  ]
}


⸻

Repository Enablement

Running:

skillcraft enable

Initializes Skillcraft in the current repository.

Creates:

.skillcraft.json
.git/skillcraft/

Example .skillcraft.json:

{
  "version": 1,
  "proofRef": "skillcraft/proofs/v1"
}

Also installs:
	•	git commit hook
	•	managed Opencode plugin integration at `.opencode/plugins/skillcraft.mjs`
	•	AI model provenance state at `.git/skillcraft/ai-model-context.json`
	•	repo entry in ~/.skillcraft/repos.json

⸻

Evidence Generation

Skill usage events are captured by agent plugins.

Plugins write pending events to:

.git/skillcraft/pending.json

Example:

{
  "skills": [
    "blairhudson/threat-model@sha256:abc123",
    "anthropic:xlsx"
  ]
}

`source:...` denotes a non-local source and is only accepted for `skills add` / queued
skills. Loadout IDs remain local `owner/slug` only.

The commit hook converts pending events into proof objects.

When Opencode is enabled, the managed plugin captures runtime provenance and
writes it to `.git/skillcraft/ai-model-context.json` so proof files include:

- `agent.provider`
- `model.provider`
- `model.name`

Proof objects are stored under:

branch: skillcraft/proofs/v1

Each commit receives a trailer referencing the proof:

Skillcraft-Ref: ab4c2d


⸻

Loadout Context

Developers may activate loadouts locally.

Example command:

skillcraft loadout use blairhudson/secure-dev

Active loadouts are stored in:

.git/skillcraft/context.json

Example:

{
  "activeLoadouts": [
    "blairhudson/secure-dev"
  ]
}

Commit proofs include active loadouts.

Proof documents may also include optional provenance fields:

- `agent.provider`
- `model.provider`
- `model.name`

Example proof:

{
  "commit": "abc123",
  "skills": [
    "blairhudson/threat-model"
  ],
  "loadouts": [
    "blairhudson/secure-dev"
  ]
}

Loadouts are optional but provide stronger workflow evidence.

⸻

Skill Publishing

The CLI allows publishing skills to the registry.

Command:

skillcraft skills publish <owner>/<slug>

Publishing workflow:
	1.	validate local skill directory
	2.	clone or fork skillcraft-gg/skills-registry
	3.	copy skill files into registry structure
	4.	commit changes
	5.	create pull request using GitHub CLI

Validation ensures compatibility with the AgentSkills standard.

⸻

Loadout Sharing

Developers can publish loadouts to the registry.

Command:

skillcraft loadout share <owner>/<slug>

Example:

skillcraft loadout share blairhudson/secure-dev

Loadout sharing workflow:
	1.	validate local loadout definition
	2.	verify referenced skills exist
	3.	clone or fork skillcraft-gg/loadouts
	4.	create directory:

loadouts/<owner>/<slug>/

	5.	write loadout.yaml
	6.	commit changes
	7.	create pull request via GitHub provider

Example loadout definition:

id: blairhudson/secure-dev
name: Secure Dev
description: Secure development workflow
skills:
  - blairhudson/threat-model
  - skillcraft-gg/code-review
  - skillcraft-gg/dependency-audit

Pull requests are validated by GitHub Actions in the loadouts repository.

⸻

Multi-Repository Evidence

The CLI can aggregate evidence across multiple repositories.

Commands support:

--repo <path>
--all-repos

Example:

skillcraft claim skillcraft-gg/practitioner-threat-model-l1 --all-repos

Repositories are discovered from:

~/.skillcraft/repos.json


⸻

Claim Submission

Credentials are claimed using:

skillcraft claim <owner>/<slug>

The CLI:
	1.	gathers evidence from repositories
	2.	constructs a claim payload
	3.	opens a GitHub issue in:

skillcraft-gg/credential-ledger

GitHub Actions verify the claim and issue credentials.

⸻

GitHub Integration

GitHub integration is implemented via a provider layer.

The default provider uses the gh CLI.

Responsibilities include:
	•	retrieving authenticated GitHub identity
	•	creating claim issues
	•	creating skill publishing PRs
	•	creating loadout publishing PRs
	•	querying claim status

This abstraction allows future support for other forge providers.

⸻

GitHub Pages

The `skillcraft` repository provides CLI code and documentation.
Public pages are rendered by `skillcraft-gg.github.io`.

Published at:

https://skillcraft.gg

Route ownership:

/ and /docs are sourced directly from `skillcraft`.
/skills, /loadouts, and /credentials are generated from their registry sources
(`skillcraft-gg/skills-registry`, `skillcraft-gg/loadouts`, `skillcraft-gg/credential-ledger`)
when those registries change.

The site must:
	•	build as static assets
	•	require no backend
	•	be deployable via GitHub Pages
	•	rebuild when registry repositories change

⸻

Agent Integrations

Skillcraft integrates with AI agent environments.

Initial integration:

OpenCode

Plugins monitor skill execution and record events.

Future integrations may include:
	•	Claude Code
	•	Cursor
	•	Copilot
