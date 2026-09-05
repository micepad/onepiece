# pi-basecamp-subagents

pi extension that runs the [basecamp-local-agent-connector](https://github.com/basecamp/basecamp-local-agent-connector) bridge inside pi, but hands each mention off to a background pi-subagents `worker` agent (fresh context, async) instead of doing the work inline. The watcher stays free to take new mentions.

Same commands as [pi-basecamp](../pi-basecamp): `/basecamp-connect`, `/basecamp-disconnect`, `/basecamp-status`.

## Requirements

- basecamp-local-agent-connector runtime (`bin/connect`)
- pi-subagents extension installed and answering `subagents:rpc:v1` requests
