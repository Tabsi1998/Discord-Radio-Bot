# escape=\
FROM node:20-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates libopus0 libopus-dev python3 make g++ pkg-config \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY src ./src
COPY web ./web
COPY stations.json ./stations.json
COPY docker-entrypoint.sh ./docker-entrypoint.sh

RUN chmod +x /app/docker-entrypoint.sh

ENV NODE_ENV=production

CMD ["/app/docker-entrypoint.sh"]
