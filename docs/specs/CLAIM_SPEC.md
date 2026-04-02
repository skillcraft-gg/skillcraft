# Claim Specification

## Purpose

Defines the protocol for claiming credentials based on repository evidence.

Claims are submitted as GitHub issues and verified automatically.

---

## Claim Workflow

skillcraft claim 

CLI creates a claim issue in:

skillcraft-gg/credential-ledger

GitHub Actions verifies the evidence.

---

## Claim Payload

Example:

```yaml
claim_version: 1

claimant:
  github: blairhudson

credential:
  id: skillcraft-gg/practitioner-threat-model-l1

sources:
  - repo: https://github.com/blairhudson/project-a
    commits:
      - a1b2c3
      - d4e5f6

claim_id: sha256:5f9d1e


⸻

Claim Verification

GitHub Actions perform:
	1.	parse claim
	2.	load credential definition
	3.	clone repositories
	4.	verify commit proofs
	5.	validate requirements

⸻

Credential Issuance

If valid:

issued/users/<github>/<credential>.yaml

Example:

definition: skillcraft-gg/practitioner-threat-model-l1
subject:
  github: blairhudson
issued_at: 2026-03-15T10:05:00Z


⸻

Claim States

pending
processing
verified
issued
rejected

States are represented via GitHub labels.
