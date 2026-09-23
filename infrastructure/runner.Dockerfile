FROM docker:28-cli AS dockercli
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx esbuild apps/runner/src/index.ts --bundle --platform=node --packages=external --format=esm --outfile=dist/runner/index.js
FROM node:24-bookworm-slim
COPY --from=dockercli /usr/local/bin/docker /usr/local/bin/docker
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist/runner ./dist/runner
EXPOSE 7000 3002
CMD ["node", "dist/runner/index.js"]
