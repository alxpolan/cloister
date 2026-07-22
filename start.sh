#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

command -v docker >/dev/null 2>&1 || { echo "Docker is required — https://docs.docker.com/get-docker/"; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker daemon is not running."; exit 1; }

if [ ! -f .env ]; then
  {
    echo "SECRETS_KEY=$(openssl rand -hex 32)"
    echo "API_TOKEN=$(openssl rand -hex 32)"
  } > .env
  echo "Generated .env with a fresh encryption key and API token."
fi
if ! grep -q "^API_TOKEN=" .env; then
  echo "API_TOKEN=$(openssl rand -hex 32)" >> .env
  echo "Added a fresh API_TOKEN to your existing .env."
fi

echo "Building agent base image (Claude Code + Codex + mcp-remote + gh)…"
docker build -f docker/base.Dockerfile -t agent-base:latest docker/

echo "Starting Postgres, backend and dashboard…"
docker compose up -d --build

echo
echo "  Dashboard  →  http://localhost:3000"
echo "  API        →  http://localhost:8080 (bearer-token protected, loopback only)"
echo
echo "API token (for the macOS app, MCP server, Paperclip adapter):"
grep "^API_TOKEN=" .env | cut -d= -f2-
echo
echo "Create your first container in the dashboard, assign MCPs, then log in the CLIs."
