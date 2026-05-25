FROM node:22-alpine AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm install

COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    unzip \
    && curl -fsSL https://rclone.org/install.sh | bash \
    && apt-get purge -y unzip \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

COPY backend /app/backend
COPY --from=frontend-builder /app/frontend/dist /app/frontend-dist

RUN mkdir -p /app/backend/data /app/data/logs /app/data/config/rclone

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD if [ -n "$SSL_CERTFILE" ] && [ -n "$SSL_KEYFILE" ]; then curl -k -f https://localhost:8000/api/health; else curl -f http://localhost:8000/api/health; fi

CMD ["python", "/app/backend/app/server.py"]
