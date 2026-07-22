# Agent Containers

Multi-Tenant-Dashboard für isolierte Claude-Code-/Codex-Container — pro Firma
(Marteso, KalBuddy, Pocketz, RowTally, …) ein eigener Docker-Container mit
eigenem `$HOME`, eigener `~/.claude.json`/`.mcp.json` und eigenem
`~/.codex/`-Auth-State. MCP-Server und Tokens sind strikt pro Firma getrennt —
rein filesystembasiert, unabhängig von `--strict-mcp-config`.

Gedacht als Ausführungsebene für [Paperclip](https://github.com/paperclipai/paperclip):
statt `claude` direkt auf dem Host zu spawnen, ruft ein späterer
`claude_docker`-Adapter `POST /run` auf.

## Architektur

```
frontend/   Next.js-Dashboard (Port 3000)
backend/    Fastify + dockerode + pg + libsodium (Port 8080)
docker/     base.Dockerfile — Basis-Image mit Claude Code + Codex CLI
homes/      pro Firma ein Home-Verzeichnis, gemountet als /home/node
```

- **Isolation:** `./homes/<firma>/` wird als `/home/node` in den Container
  `agent-<firma>` gemountet. Claude-Auth (`~/.claude.json`), Codex-Auth
  (`~/.codex/auth.json`) und Workspace liegen darin und überleben Neustarts.
- **MCP-Config:** Bei jedem Start rendert das Backend
  `workspace/.mcp.json` komplett neu aus der DB und setzt in `.claude.json`
  `mcpServers: {}` + `enabledMcpjsonServers` — es gibt keinen anderen
  MCP-Kanal in den Container. Auth-Felder in `.claude.json` werden gemerged,
  nie überschrieben.
- **Secrets:** Tokens liegen libsodium-verschlüsselt (secretbox) in Postgres
  und werden nur beim Container-Start als Env-Variablen injiziert. In der
  MCP-Config referenzierbar als `${GITHUB_TOKEN}` etc. (Claude Code expandiert
  Env-Variablen in `.mcp.json`).
- **Docker-Socket:** nur das Backend spricht mit der Docker-API. Agent-
  Container bekommen den Socket nie gemountet.

## Setup

Voraussetzungen: Docker (läuft), Node 20+ (nur für lokale Entwicklung).

```sh
# 1. Verschlüsselungskey generieren
cp .env.example .env
echo "SECRETS_KEY=$(openssl rand -hex 32)" > .env

# 2. Basis-Image für die Agent-Container bauen
docker build -f docker/base.Dockerfile -t agent-base:latest docker/

# 3. Alles starten
docker compose up --build
```

Dashboard: http://localhost:3000 · API: http://localhost:8080

### Workflow (pro Firma: zuordnen → einloggen → fertig)

Die MCP-Server werden **einmal global** im **MCP catalog** definiert
(GitHub, Notion, RevenueCat sind vorgeseedet; eigene per „Add server").
Pro Firma dann nur noch:

1. **New container** → Name `Marteso`, Slug `marteso`.
2. **MCPs** auf der Karte → gewünschte Server anhaken; wo ein Token nötig
   ist, entweder vorhandenes Secret wählen oder direkt Token pasten
   (wird automatisch als Secret `<firma>-<server>` verschlüsselt gespeichert).
3. **Start**, dann **login** neben Claude Code / Codex.

Für Sonderfälle gibt es im MCPs-Dialog „Advanced: raw JSON extras"
(zusätzliche Server nur für diesen Container, überschreibt bei
Namensgleichheit den Katalog).

### CLIs authentifizieren (einmalig pro Firma)

Direkt im Dashboard: in der Container-Karte neben „Claude Code" bzw. „Codex"
auf **login** klicken. Es öffnet sich ein Terminal-Dialog:

- **Claude Code** (`claude setup-token`): Authorization-URL anklicken, im
  Browser freigeben, den angezeigten Code zurück ins Eingabefeld pasten.
- **Codex** (`codex login`): der Container wird dafür automatisch mit
  Port 1455 neu gestartet (OAuth-Callback von localhost), URL anklicken,
  im Browser einloggen — der Redirect landet im Container. Ein normaler
  Restart entfernt den Port wieder. Nur ein Container kann gleichzeitig
  einen Codex-Login laufen haben. Alternative ohne Browser-Flow:
  API-Key als Secret speichern und im Terminal-Dialog
  `codex login --api-key <key>` … oder klassisch per
  `docker exec -it agent-<firma> codex login --api-key <key>`.

Fallback bleibt immer: `docker exec -it agent-<firma> claude` / `codex`.

Der Auth-State landet im gemounteten Home (`homes/marteso/`) und bleibt über
Stop/Start/Recreate erhalten. Das Dashboard zeigt pro Container getrennt an,
ob Claude Code und Codex authentifiziert sind.

### OAuth-MCP-Server (Remote)

Remote-Server einfach in der MCP-Config eintragen:

```json
{ "notion": { "type": "http", "url": "https://mcp.notion.com/mcp" } }
```

Sie werden auch in die Codex-`config.toml` übernommen. OAuth-Tokens, die
Claude Code nach dem Authorize speichert, landen im Container-Home und sind
damit pro Firma isoliert. Achtung: der interaktive `/mcp`-Authorize-Flow
nutzt einen zufälligen localhost-Callback-Port im Container und funktioniert
daher nur, wenn der Server/CLI einen Code-Paste-Fallback anbietet. Robuster
Weg für Server mit Token-Support: Token als Secret speichern und per
`"headers": { "Authorization": "Bearer ${MEIN_TOKEN}" }` referenzieren.

## API

| Route | Beschreibung |
| --- | --- |
| `GET /containers` | Liste inkl. Live-Status, Auth-Status beider CLIs, Accounts |
| `POST /containers` | `{ name, company }` — legt Home-Verzeichnis + DB-Eintrag an |
| `POST /containers/:id/start` | rendert Configs, (re)erstellt + startet Container |
| `POST /containers/:id/stop` | stoppt Container |
| `DELETE /containers/:id` | entfernt Container + DB-Eintrag (Home bleibt) |
| `GET/POST/PUT/DELETE /mcp-catalog` | globale MCP-Server-Definitionen |
| `GET/PUT /containers/:id/mcps` | Katalog-Zuweisung + Secret-Bindings pro Container |
| `PUT /containers/:id/mcp-config` | Raw-JSON-Extras, mergen über den Katalog |
| `PUT /containers/:id/accounts` | Low-level Env-Injection (`{ accounts: [...] }`, API-only) |
| `POST /containers/:id/auth/:cli` | startet interaktive Login-Session (`claude`\|`codex`) |
| `GET /auth-sessions/:sid` | Terminal-Output der Session (ANSI-bereinigt) |
| `POST /auth-sessions/:sid/input` | `{ text }` — Code/Antwort an die Session senden |
| `DELETE /auth-sessions/:sid` | Session abbrechen |
| `GET /secrets` | nur Refs, nie Klartext |
| `PUT /secrets` | `{ ref, value }` — verschlüsselt speichern |
| `POST /run` | `{ company, prompt, cli?: "claude"\|"codex", timeoutMs? }` |

### /run (Paperclip-Adapter)

```sh
curl -s localhost:8080/run -X POST -H 'content-type: application/json' \
  -d '{"company":"marteso","prompt":"Sag hallo"}'
# → { "exitCode": 0, "stdout": "...", "stderr": "" }
```

Intern: `docker exec agent-marteso claude -p "<prompt>" --output-format text
--dangerously-skip-permissions` (läuft als unprivilegierter `node`-User im
Container). Für Codex: `codex exec --skip-git-repo-check "<prompt>"`.

## Lokale Entwicklung (ohne Compose für Backend/Frontend)

```sh
docker compose up postgres -d
cd backend  && SECRETS_KEY=<key aus .env> npm run dev   # Port 8080, DB via localhost:5433
cd frontend && npm run dev                              # Port 3000
```

Hinweis: Läuft das Backend direkt auf dem Host, ist `HOST_HOMES_DIR` nicht
nötig (Default = `./homes`). Im Compose-Setup ermittelt das Backend den Host-Pfad
automatisch aus seinen eigenen Mounts (Override: `HOST_HOMES_DIR`), weil der
Docker-Daemon Bind-Mounts auf dem Host auflöst.

## Sicherheit

- Secrets nur verschlüsselt in der DB (libsodium secretbox, Key aus
  `SECRETS_KEY`), Klartext existiert nur im Env des jeweiligen Containers.
- `GET /secrets` liefert ausschließlich Referenzen.
- Kein Agent-Container erhält den Docker-Socket oder erweiterte Privilegien;
  alle laufen als `node` (uid 1000) mit `RestartPolicy: unless-stopped`.
- Die API selbst hat keine AuthN — nur lokal betreiben oder hinter einen
  Reverse-Proxy mit Auth legen, bevor sie irgendwo erreichbar ist.

## Paperclip-Integration (`claude_docker`-Adapter)

`paperclip-adapter/` ist ein Paperclip-Adapter-Plugin, das Agent-Heartbeats
statt auf dem Host im isolierten Firmen-Container ausführt (`POST /run`).

Registrierung in `~/.paperclip/adapter-plugins.json`:

```json
[{
  "packageName": "claude-docker-paperclip-adapter",
  "localPath": "/pfad/zu/agent-containers/paperclip-adapter",
  "type": "claude_docker",
  "installedAt": "2026-07-22T00:00:00Z"
}]
```

Agent-Konfiguration in Paperclip:

```json
{
  "adapterType": "claude_docker",
  "adapterConfig": { "company": "marteso", "cli": "claude", "timeoutSec": 900 }
}
```

Der Adapter injiziert `PAPERCLIP_API_URL` (localhost → `host.docker.internal`
umgeschrieben), `PAPERCLIP_AGENT_ID`, `PAPERCLIP_COMPANY_ID` und den Run-JWT
als `PAPERCLIP_API_KEY` in den Container-Exec, sodass der Agent aus dem
Container heraus Issues lesen/kommentieren kann. Environment-Test in
Paperclip prüft Backend, Container-Status und CLI-Auth. Bestehende Agents
umstellen: `PATCH /api/agents/:id` mit `adapterType: "claude_docker"`.

## Lokaler MCP-Server (Claude Code & Co steuern die Container)

`mcp/server.mjs` ist ein stdio-MCP-Server, der die Backend-API wrappt und in
`.mcp.json` des Repos registriert ist. Jede Claude-Code-Session in diesem
Projekt kann damit direkt Container verwalten:

`list_containers`, `create_container`, `start_container`, `stop_container`,
`run_agent` (Prompt in Container ausführen), `list_mcp_catalog`,
`get/set_mcp_assignments`, `set_secret`, `list_secret_refs`, `bind_paperclip_company`
(stellt alle Agents einer Paperclip-Firma auf den gewünschten Container um).

Setup: `cd mcp && npm install` — danach den Server beim nächsten
Claude-Code-Start im Projekt genehmigen. Für andere Clients (Claude Desktop
etc.): `node mcp/server.mjs` mit Env `AGENT_API_URL=http://localhost:8080`.
