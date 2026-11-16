FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY server/chat ./server/chat
USER node
ENV CHAT_HOST=0.0.0.0
EXPOSE 8787
CMD ["node", "server/chat/index.mjs"]
