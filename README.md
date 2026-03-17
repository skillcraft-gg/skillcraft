# Skillcraft CLI

Quick install and local development notes.

## Install from GitHub

```bash
npm install -g github:skillcraft-gg/skillcraft
```

Verify with:

```bash
skillcraft --version
```

## Development setup

```bash
git clone https://github.com/skillcraft-gg/skillcraft.git
cd skillcraft
npm install
npm run build
npm link
```

`npm link` exposes `skillcraft` locally for iterative development.

Rebuild after edits:

```bash
npm run build
```

Check wiring:

```bash
skillcraft --help
```

## Smoke tests

Run the rerunnable CLI surface tests:

```bash
npm run smoke
```

This keeps external dependencies out of the run and exercises the command
surface (`enable`, `status`, `progress`, `loadout`, `skills`, `repos`, `disable`, and related paths).

`skills add` and `skills search` are included in these flows. Queue local and external skills by
ID, or browse the published registry index:

```bash
skillcraft skills add acme/threat-model
skillcraft skills add anthropic:xlsx
skillcraft skills inspect anthropic:xlsx
skillcraft skills search "threat model"
skillcraft skills search --source anthropic parser
```
