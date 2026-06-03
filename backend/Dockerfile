FROM node:20-alpine

# tailscale CLI is needed by ``TailscaleClient`` (transport/tailscale.ts) to
# probe peer reachability and resolve hostnames. We only need the CLI; the
# tailscaled daemon stays on the host and is reached via the bind-mounted
# /var/run/tailscale socket (see docker-compose.yml). Without this the CLI
# would ENOENT and every machine would be misreported as offline.
RUN apk add --no-cache tailscale

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

RUN rm -f .env .env.example

EXPOSE 3000

COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["docker-entrypoint.sh"]
