# pi-basecamp

pi extension that runs the [basecamp-local-agent-connector](https://github.com/basecamp/basecamp-local-agent-connector) bridge inside pi. Watches Basecamp for trusted @mentions of your agent, acknowledges them, and does the work in the current pi session.

## Commands

- `/basecamp-connect` — start the connector using the last saved connection (`~/.config/basecamp-connect/last.json`)
- `/basecamp-disconnect` — stop it
- `/basecamp-status` — show whether it is running

## Requirements

- basecamp-local-agent-connector runtime (`bin/connect`) as a sibling checkout
- Tailscale, per the connector's setup
