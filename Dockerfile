FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-noto-cjk ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --chown=node:node package.json ./
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund
COPY --chown=node:node . .
RUN mkdir -p /app/.cache/gpt && chown -R node:node /app
ENV HOST=0.0.0.0 PORT=7860 NODE_ENV=production RESEARCH_BROWSER_EXECUTABLE=/usr/bin/chromium
EXPOSE 7860
USER node
CMD ["node", "src/server.mjs"]
