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
# Containers run as unprivileged node (uid 1000) and can't write the global
# npm prefix. CLI versions are pinned to this image and updated by rebuilding
# it, so disable the runtime auto-updaters (they'd only fail noisily).
ENV DISABLE_AUTOUPDATER=1
ENV CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
WORKDIR /home/node/workspace

CMD ["sleep", "infinity"]
