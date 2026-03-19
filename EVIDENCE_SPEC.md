# Evidence Specification

## Purpose

Defines how Skillcraft records skill usage as verifiable evidence.

Evidence consists of:

- proof objects
- commit trailers referencing those proofs

---

## Evidence Lifecycle

1. Agent executes skill.
2. Plugin records event locally.
3. Commit hook generates proof.
4. Commit receives trailer referencing proof.

Example trailer:

Skillcraft-Ref: ab4c2d

---

## Pending Events

Stored in:

.git/skillcraft/pending.json

Example:

```json
{
  "skills": [
    "blairhudson/threat-model@sha256:abc123"
  ]
}


⸻

Proof Objects

Stored in:

skillcraft/proofs/v1

Example proof:

{
  "version": 1,
  "commit": "abc123",
  "skills": [
    {
      "id": "blairhudson/threat-model",
      "version": "sha256:abc"
    }
  ],
  "loadouts": [
    "blairhudson/secure-dev"
  ],
  "timestamp": "2026-03-15T10:05:00Z"
}


⸻

Loadout Context

Proofs may optionally include loadouts.

"loadouts": ["blairhudson/secure-dev"]

Loadout context is derived from the developer’s active loadouts.

⸻

Loadout Activation

The CLI may track active loadouts in:

.git/skillcraft/context.json

Example:

{
  "activeLoadouts": [
    "blairhudson/secure-dev"
  ]
}

Commit proofs include the active loadouts.

⸻

Proof ID

Proof IDs are generated as:

sha256(commit + skills + timestamp)

Truncated to 6–8 hex characters.

⸻

Verification

skillcraft verify

Checks:
	•	commit trailers
	•	proof objects
	•	skill identifiers
	•	loadout identifiers

---
