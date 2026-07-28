# Cloister

**Isolated Claude Code & Codex, one cell per company.** Real logins, per-tenant
MCP servers, encrypted secrets — a walled cell for each client's agents, driven
by one terminal command.

<p align="center">
  <img src="https://raw.githubusercontent.com/alxpolan/cloister/main/docs/demo.gif" alt="Cloister CLI demo" width="800" />
</p>

If you run coding agents for more than one company, app, or client, they all
share the same `~/.claude.json`, the same globally-connected MCP servers, and the
same tokens — one agent can see another's GitHub, Notion or RevenueCat. Cloister
gives each company its own container with its own login, MCP servers and secrets,
isolated on the filesystem.

## Install

Requires Docker running.

```sh
npm install -g cloister-sh
cloister up
```

`cloister up` pulls the pre-built images and starts everything — dashboard
(http://localhost:3000), API and database. Create a container in the dashboard,
log in Claude/Codex, and you have an isolated agent runtime per company.

## Daily use

```sh
cloister                # list your cells and their status
cloister marteso        # open Claude Code in Marteso's isolated cell
cloister marteso codex  # …or Codex
cloister here marteso   # run against your CURRENT directory (the repo you have open)
```

`cloister marteso` is an ergonomic `docker exec -it agent-marteso claude` — same
native TUI, its own login and MCP servers, no leakage to other companies.

Stack lifecycle: `cloister up` · `cloister down` · `cloister status`.

## Links

- **Website** — https://cloister.sh
- **Source & docs** — https://github.com/alxpolan/cloister

MIT
