# =============================================================================================
# @weaver/worker — Layer C, the autonomous engine.
#
# Built from the REPOSITORY ROOT, not from this directory:
#
#     docker build -f apps/worker/Dockerfile -t weaver-worker .
#
# The worker depends on four workspace packages by `workspace:*`, so a build context rooted at
# apps/worker cannot see them. Every path below is therefore relative to the repo root.
#
# Deliberately provider-neutral. `fly.toml` sits beside this file, but nothing in here is
# Fly-specific — the same image runs on Render, Railway, Cloud Run or a plain VM. The point of
# choosing Docker over a platform buildpack was to keep the hosting decision reversible; see
# docs/DEPLOYMENT.md for what each provider then needs.
# =============================================================================================

# Node 24, matching local development. Pinned to a minor rather than floating on `24-slim`, because
# an engine that changes underneath a long-running process is exactly the class of surprise this
# project has spent two days learning to avoid.
ARG NODE_VERSION=24.16.0

# ---------------------------------------------------------------------------------------------
# Stage 1 — build
#
# Full toolchain: pnpm, TypeScript, dev dependencies. None of it survives into the runtime image.
# ---------------------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS build

# Corepack ships with Node and pins pnpm from the lockfile's own `packageManager` field where one
# exists, so the build uses the same pnpm the lockfile was written by.
RUN corepack enable

# pnpm asks for TTY confirmation before rewriting a node_modules directory. `CI=true` is the
# documented way to say "nobody is watching, proceed", and is true here in every sense.
ENV CI=true

WORKDIR /repo

# Manifests first, sources second. Docker caches layers by content, so a change to a .ts file that
# leaves dependencies untouched reuses the install layer instead of re-resolving the whole tree.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/contracts/package.json   packages/contracts/
COPY packages/validation/package.json  packages/validation/
COPY packages/brightdata/package.json  packages/brightdata/
COPY packages/healing/package.json     packages/healing/
COPY apps/worker/package.json          apps/worker/

# `--frozen-lockfile` makes a lockfile that disagrees with the manifests a build failure rather
# than a silent resolution. A deploy is the wrong place to discover a dependency drifted.
RUN pnpm install --frozen-lockfile --filter @weaver/worker...

COPY packages/ packages/
COPY apps/worker/ apps/worker/

# `...` includes the workspace dependencies, so this builds contracts, validation, brightdata and
# healing before the worker that imports their `dist` output.
RUN pnpm --filter @weaver/worker... build

# `pnpm deploy` rather than a `--prod` reinstall, and the difference is not cosmetic.
#
# A `--prod` install unlinks dev dependencies but leaves their contents behind in the virtual store
# at node_modules/.pnpm — 90 MB of them here, most of it PGlite, a WASM build of Postgres we use to
# run the tests against real SQL. Unreachable from the worker, still in every layer.
#
# `deploy` instead writes a self-contained tree with the workspace packages copied in as real
# directories: what comes out is what the process can actually load.
#
# `--legacy` because pnpm v10 deploys only from workspaces with `inject-workspace-packages=true`.
# Setting that flag workspace-wide would change how every local install links workspace packages —
# copies instead of symlinks, so an edit to `packages/contracts` would stop being visible to the
# worker until reinstalled. That is a real cost to the development loop to satisfy one build step,
# so the flag goes on the build step instead.
RUN pnpm deploy --legacy --filter @weaver/worker --prod /out

# ---------------------------------------------------------------------------------------------
# Stage 2 — runtime
# ---------------------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS runtime

ENV NODE_ENV=production

# Bright Data's CLI is spawned as a subprocess with `shell: true`, so the shell resolves the binary.
# Pointing at it by absolute path rather than relying on PATH removes a whole class of "works on my
# machine": the worker fails at boot with a readable message if the binary is missing, instead of
# every CLI call failing later with "command not found" inside a redacted argv.
ENV BRIGHTDATA_CLI_BIN=/app/node_modules/.bin/brightdata

# Unprivileged. The `node` user ships with the base image; the worker writes nothing to disk except
# stdout, so it needs no writable volume and no elevated rights.
WORKDIR /app
COPY --from=build --chown=node:node /out /app
USER node

# No HEALTHCHECK and no EXPOSE, both deliberate. This is a worker, not a service: it opens no port,
# and a platform that waits for one will report a healthy process as a failed deploy. Liveness is
# the process being alive — see docs/DEPLOYMENT.md on why the restart policy is the health check.

# Exec form, so node is PID 1 and receives SIGTERM directly. Wrapped in a shell it would not, and
# the graceful shutdown — stop claiming, let the in-flight job finish, then exit — would never run.
# That shutdown is the difference between a deploy that waits for a heal and one that abandons a
# collector mid-repair with credits already spent.
CMD ["node", "--enable-source-maps", "dist/index.js"]
