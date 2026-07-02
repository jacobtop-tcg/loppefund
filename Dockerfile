# Loppefund — single-container deploy (web app + pipeline in one image).
# Needs a persistent volume mounted at /app/data for loppefund.db.
FROM node:22-slim AS base
WORKDIR /app
ENV NODE_ENV=production

# Install all workspace deps (dev deps needed for the Next build).
FROM base AS build
ENV NODE_ENV=development
COPY package.json package-lock.json* ./
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/pipeline/package.json packages/pipeline/
COPY apps/web/package.json apps/web/
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build --workspace @loppefund/web

# Runtime image.
FROM base AS runtime
COPY --from=build /app ./
EXPOSE 3000
VOLUME ["/app/data"]
# The pipeline is scheduled separately (cron/host scheduler) with:
#   docker exec <container> node packages/pipeline/src/cli.ts run
CMD ["npm", "run", "start", "--workspace", "@loppefund/web"]
