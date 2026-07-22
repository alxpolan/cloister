# Contributing

Thanks for your interest! This project is young and moving fast.

## Dev setup

```sh
./start.sh                 # Postgres + backend + frontend via Docker
# or run pieces natively:
docker compose up postgres -d
cd backend  && SECRETS_KEY=<key> npm run dev   # :8080, DB on localhost:5433
cd frontend && npm run dev                     # :3000
```

The native macOS app lives in `Agents/` (Xcode 26, macOS 26 — needs the Liquid
Glass / current SwiftUI APIs).

## Ground rules

- Keep agent containers unprivileged and socket-free; only the backend talks to
  Docker.
- Never write plaintext secrets to disk. Bindings reference encrypted secrets;
  tokens are injected as env vars at container start.
- MCP config is generated from the DB on every start — don't hand-edit the files
  inside `homes/`.

## Reporting issues

The trickiest bugs here come from the underlying CLIs (raw-TTY input, OAuth
callback ports, env inheritance). When filing a bug, include the CLI versions
(`docker exec agent-<company> claude --version` / `codex --version`) and the
relevant container logs.
