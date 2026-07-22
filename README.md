# Agent Containers

**Give every company its own isolated Claude Code & Codex — one dashboard, real logins, per-tenant MCP servers.**

If you run coding agents for more than one company, app, or client, they all
share the same `~/.claude.json`, the same globally-connected MCP servers, and
the same tokens. One agent can see another's GitHub, Notion, RevenueCat — even
though they should be strictly separated.

Agent Containers fixes that. Each company gets its own Docker container with
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

Requires Docker (running) and `openssl`.

```sh
git clone https://github.com/<you>/agent-containers.git
cd agent-containers
./start.sh
```

- **Dashboard** → http://localhost:3000
- **API** → http://localhost:8080

Then, per company:

1. **New container** → e.g. name `Marteso`, slug `marteso`.
2. **MCPs** → tick the servers you want; paste a token or click **Authorize** for
   OAuth servers.
3. **Start**, then **Login** next to Claude Code / Codex.

That's it — the company now has an isolated agent runtime. Repos the agents
clone live in `homes/<company>/workspace/`, persistent across restarts.

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
- The API has no built-in auth — run it locally, or behind an authenticating
  reverse proxy. Do not expose it directly.
- Use fine-grained, per-company tokens so a tenant's agent can only reach that
  tenant's resources. Isolation is only as tight as the tokens you bind.

## Status

Working and used in production by the author across multiple companies. Expect
sharp edges — it depends on the current behavior of the Claude Code and Codex
CLIs, which can change between releases.

German docs and deeper implementation notes: [`docs/README.de.md`](docs/README.de.md).

## License

MIT — see [LICENSE](LICENSE).
