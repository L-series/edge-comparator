FROM node:26-bookworm-slim@sha256:582460f614631b59b824ac6020533b9bf339c7fdf3a6d7db31abb6b4065f0212

WORKDIR /workspace
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund \
    && mkdir reports \
    && chown node:node reports
COPY --chown=node:node . .
USER node
CMD ["npm", "run", "check"]
