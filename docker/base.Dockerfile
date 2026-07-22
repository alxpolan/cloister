# Base image for all tenant agent containers.
# Each tenant gets its own container from this image with ./homes/<company>
# mounted at /home/node — auth state (~/.claude.json, ~/.codex/) and MCP
# config are therefore isolated per tenant on the filesystem level.
FROM node:20-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends git curl ca-certificates ripgrep \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code @openai/codex

# The container runs as the unprivileged node user (uid 1000); /home/node is
# replaced by the tenant bind mount at runtime.
USER node
ENV HOME=/home/node
WORKDIR /home/node/workspace

CMD ["sleep", "infinity"]
