# Build context is the repository root: the frontend's API types are generated from the
# FastAPI schema (web/src/types/api.ts is not committed), so stage 1 needs the Python code.

FROM python:3.12-slim AS schema
RUN pip install --no-cache-dir uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project
COPY core ./core
COPY alembic.ini ./
RUN uv run python -c "import json; from core.api.main import app; print(json.dumps(app.openapi()))" > /openapi.json

FROM node:20-alpine AS build
WORKDIR /app
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web ./
COPY --from=schema /openapi.json /openapi.json
RUN npx openapi-typescript /openapi.json -o src/types/api.ts && npm run build

FROM nginx:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
