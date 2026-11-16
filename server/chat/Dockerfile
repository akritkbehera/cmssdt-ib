FROM node:24-bookworm-slim
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends curl krb5-user ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY server/chat ./server/chat
USER node
ENV CHAT_HOST=0.0.0.0
EXPOSE 8787
CMD ["node", "server/chat/index.mjs"]
