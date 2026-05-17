FROM node:20-bookworm-slim

WORKDIR /workspace

# Keep npm cache in a dedicated volume path to speed up repeated runs.
ENV npm_config_cache=/npm-cache

CMD ["bash", "-lc", "npm ci && npm run build && npm test"]