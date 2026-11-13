# syntax=docker/dockerfile:1

FROM oven/bun:1
WORKDIR /usr/src/app

# Install workspace deps first for cache friendliness.
COPY package.json bun.lock ./
COPY apps/site/package.json ./apps/site/
COPY packages/core/package.json ./packages/core/
RUN bun install --frozen-lockfile

# Copy source last.
COPY apps/site ./apps/site
COPY packages/core ./packages/core

WORKDIR /usr/src/app/apps/site

# Build the static Tailwind stylesheet (gitignored output) into public/assets.
RUN bun run css:build

# Commit this image was built from. Deploy verification reads it back over HTTP
# to prove the running container is the one CI just built.
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA

ENV NODE_ENV=production
EXPOSE 8613

CMD ["bun", "server.ts"]
