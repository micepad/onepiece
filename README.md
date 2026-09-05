# onepiece

Company brain: shared skills, pi extensions, and config for AI agents.

## Contents

| Path | What it is |
|------|------------|
| `pi-basecamp/` | pi extension — run the basecamp connector bridge inside pi (`/basecamp-connect`, `/basecamp-disconnect`, `/basecamp-status`) |
| `pi-basecamp-subagents/` | pi extension — same connector, but hands mentions off to a background pi-subagents worker |

## Install

Clone this repo and point pi at an extension directory, or copy one into your pi extensions path. Both extensions require the [basecamp-local-agent-connector](https://github.com/basecamp/basecamp-local-agent-connector) runtime (`bin/connect`) and read the last connection from `~/.config/basecamp-connect/last.json` (run `/basecamp-connect` once to configure).
