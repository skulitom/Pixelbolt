# Pixelbolt MCP server (stdio). Build: docker build -t pixelbolt .
# Run:   docker run -i --rm -v "$PWD:/data" pixelbolt
# Exports land in /data/output and saved revisions in /data/output/.revisions.

# Official Node 24 image on Alpine: the smallest official base; Pixelbolt is
# plain JavaScript with zero dependencies, so musl makes no difference.
FROM node:24-alpine AS pack
WORKDIR /src
COPY . .
# Ship exactly what `npm publish` would: package.json "files" plus package.json.
# --ignore-scripts so no lifecycle script runs; there is nothing to install.
RUN npm pack --ignore-scripts --pack-destination /tmp \
 && mkdir /app \
 && tar -xzf /tmp/pixelbolt-*.tgz -C /app --strip-components=1

FROM node:24-alpine
# The server needs only node: remove npm, npx, corepack and yarn from the
# running filesystem (less to attack or flag in scans; the base layers keep
# their bytes), and make an empty data folder for the non-root user.
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx \
      /usr/local/bin/corepack /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg \
 && mkdir /data && chown node:node /data
# Code stays root-owned and read-only to the server; only /data is writable.
COPY --from=pack /app /app
# The image's built-in unprivileged user (uid 1000).
USER node
# Pixelbolt reads and writes only under its working directory: mount a host
# folder here to keep the output. It needs no network access.
WORKDIR /data
ENTRYPOINT ["node", "/app/bin/pixelbolt.js", "mcp"]
