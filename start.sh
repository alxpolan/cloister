#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

command -v docker >/dev/null 2>&1 || { echo "Docker is required — https://docs.docker.com/get-docker/"; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker daemon is not running."; exit 1; }

if [ ! -f .env ]; then
  echo "SECRETS_KEY=$(openssl rand -hex 32)" > .env
  echo "Generated .env with a fresh encryption key."
fi

echo "Building agent base image (Claude Code + Codex + mcp-remote + gh)…"
docker build -f docker/base.Dockerfile -t agent-base:latest docker/

echo "Starting Postgres, backend and dashboard…"
docker compose up -d --build

echo
echo "  Dashboard  →  http://localhost:3000"
echo "  API        →  http://localhost:8080"
echo
echo "Create your first container in the dashboard, assign MCPs, then log in the CLIs."
