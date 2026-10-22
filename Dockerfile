# ZimERP web app — production image (Azure Container Apps, on-premise installs).
# Build:  docker build -t zimerp .
# Run:    docker run -p 3000:3000 --env-file .env zimerp

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S zimerp && adduser -S zimerp -G zimerp
COPY --from=build --chown=zimerp:zimerp /app/.next/standalone ./
COPY --from=build --chown=zimerp:zimerp /app/.next/static ./.next/static
COPY --from=build --chown=zimerp:zimerp /app/public ./public
USER zimerp
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/ >/dev/null || exit 1
CMD ["node", "server.js"]
