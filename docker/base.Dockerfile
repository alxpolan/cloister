FROM node:20-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends git curl ca-certificates ripgrep \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code @openai/codex mcp-remote

USER node
ENV HOME=/home/node
WORKDIR /home/node/workspace

CMD ["sleep", "infinity"]
