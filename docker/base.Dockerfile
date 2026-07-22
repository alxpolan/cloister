FROM node:20-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends git curl ca-certificates ripgrep \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code @openai/codex mcp-remote

USER node
ENV HOME=/home/node
WORKDIR /home/node/workspace

CMD ["sleep", "infinity"]
