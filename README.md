# Cloister

**Isolated Claude Code & Codex, one cell per company.** Real logins, per-tenant
MCP servers, encrypted secrets — a walled cell for each client's agents, driven
by one terminal command: `cloister`.

<p align="center">
  <img src="docs/demo.gif" alt="Cloister CLI demo — agents lists cells, then drops into a company's isolated Claude Code session" width="800" />
</p>

If you run coding agents for more than one company, app, or client, they all
share the same `~/.claude.json`, the same globally-connected MCP servers, and
the same tokens. One agent can see another's GitHub, Notion, RevenueCat — even
though they should be strictly separated.

Cloister fixes that. Each company gets its own Docker container with
its own `$HOME`, its own Claude Code / Codex login, and its own MCP servers and
secrets — isolated at the filesystem level, not by convention. A clean
dashboard (web + native macOS app) manages the fleet, and a drop-in
[Paperclip](https://github.com/paperclipai/paperclip) adapter runs orchestrated
agents inside the right container automatically.

> Built by someone who manages ~8 companies and 50+ accounts and got tired of
> agents leaking into each other. This is the missing isolation layer.

---

## Why

- **Real per-tenant isolation.** `./homes/<company>/` is mounted as
  `/home/node`. Claude auth (`~/.claude.json`), Codex auth (`~/.codex/`), MCP
  OAuth tokens and the workspace all live there — separated on disk, robust
  against known `--strict-mcp-config` bugs.
- **Subscription logins that survive automation.** Log in Claude Code and Codex
  *from the dashboard* (`setup-token` capture + a container-side OAuth callback
  proxy for Codex). The auth state persists across restarts.
- **OAuth MCP servers that work for autonomous runs.** Notion, Vercel, PostHog,
  RevenueCat and friends are pre-authorized once via the dashboard (`mcp-remote`
  under the hood); the token lands in the tenant home so headless runs just work.
- **A global MCP catalog.** Define a server once (with real favicons), then tick
  it on per company and paste the token — no hand-written JSON per container.
- **Encrypted secrets.** Tokens are libsodium-encrypted in Postgres and only
  ever decrypted into the target container's environment at runtime.
- **Real git, not just the GitHub MCP.** Each container ships `git` + `gh` with
  per-company identity and a credential helper wired to the bound token —
  agents can clone, commit and push, not just call the API.
- **No Docker socket in agent containers.** Only the backend talks to Docker.

## Quick start

Requires Docker running.

```sh
npm install -g cloister-sh
cloister up
```

`cloister up` pulls the pre-built images and starts everything — dashboard, API
and database. Then, per company:

1. **New container** → e.g. name `Marteso`, slug `marteso`.
2. **MCPs** → tick the servers you want; paste a token or click **Authorize** for
   OAuth servers.
3. **Start**, then **Login** next to Claude Code / Codex.

That's it — the company now has an isolated agent runtime.

<details>
<summary>From source (for development)</summary>

```sh
git clone https://github.com/alxpolan/cloister.git
cd cloister
./start.sh        # installs the CLI and builds + starts everything locally
```
</details>

## Daily use: the `cloister` CLI

Managing containers happens in the dashboard; *working* in one happens in your
terminal. `cloister <company>` drops you straight into the real, native Claude
Code or Codex session inside that company's cell — separate shells for your
coding agents.

```sh
cloister                # list your cells and their status
cloister marteso        # open Claude Code in Marteso's isolated cell
cloister marteso codex  # open Codex instead
cloister here marteso   # run against your CURRENT directory (the repo you have open)
cloister marteso -- --model opus   # pass args straight to the CLI
```

`cloister marteso` is just an ergonomic `docker exec -it agent-marteso claude` —
same native TUI, its own login and MCP servers, no leakage to other companies.
(`agents` is a shorter alias for the same command.)

Stack lifecycle: `cloister up` · `cloister down` · `cloister status`.

### Work on the project you already have open

`cloister here` runs a company's isolated agent against your **current
directory** — the repo you have open in VS Code — instead of the container's
own workspace. It reuses that company's login, MCP servers, secrets and git
identity, but edits the exact files in front of you:

```sh
cd ~/code/marteso-app       # your VS Code project
cloister here marteso         # Claude Code, isolated as Marteso, on THIS folder
cloister here marteso codex   # …or Codex
```

Under the hood it starts a throwaway container that mounts the company home
(auth + tokens) plus your working directory, so the agent can read, edit,
commit and push your open project with the right identity — nothing leaks
between companies.

## Architecture

```
frontend/          Next.js dashboard (port 3000)
backend/           Fastify + dockerode + pg + libsodium (port 8080)
Agents/            Native macOS app (SwiftUI, macOS 26) — same features, native
docker/            base.Dockerfile — Claude Code + Codex + mcp-remote + gh
mcp/               Local MCP server so any Claude Code session can drive the fleet
paperclip-adapter/ Paperclip adapter plugin (claude_docker)
homes/             Per-company home dir, mounted as /home/node
```

## Paperclip integration

`paperclip-adapter/` is a Paperclip adapter plugin (`claude_docker`) that runs
each agent heartbeat inside the tenant's container instead of on the host — with
its logins, MCPs and secrets. Register it in `~/.paperclip/adapter-plugins.json`,
pick **Claude Docker** as the agent's adapter, choose a model (Claude Fable /
Opus / Sonnet / Haiku or Codex GPT-5.6), and point it at a container slug.

The included MCP server also exposes a `bind_paperclip_company` tool that flips
every agent of a Paperclip company onto the container in one call.

## Security

- Secrets are encrypted at rest (libsodium secretbox, key from `SECRETS_KEY`);
  plaintext only exists in the target container's env.
- Agent containers never receive the Docker socket or extra privileges; they run
  as unprivileged `node` (uid 1000).
- The API is protected by a shared bearer token (`API_TOKEN`, generated by
  `./start.sh`) and bound to loopback by default. All first-party clients send
  it; the web dashboard proxies it server-side so it never reaches the browser.
- Use fine-grained, per-company tokens so a tenant's agent can only reach that
  tenant's resources. Isolation is only as tight as the tokens you bind.

## Status

Working and used in production by the author across multiple companies. Expect
sharp edges — it depends on the current behavior of the Claude Code and Codex
CLIs, which can change between releases.

German docs and deeper implementation notes: [`docs/README.de.md`](docs/README.de.md).

## License

MIT — see [LICENSE](LICENSE).
