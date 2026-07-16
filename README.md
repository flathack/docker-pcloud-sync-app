# SyncForge

SyncForge is a Docker-ready pCloud sync and backup control app built around
rclone, FastAPI, and React. It exposes a small web UI plus a bearer-token
agent API for automation, and ships as a multi-arch image on GitHub
Container Registry.

This public repository only contains the distribution artifacts. The
application source code is maintained in a private repository.

## Container image

```text
ghcr.io/flathack/docker-syncforge:latest
```

Pin a specific tag (for example `main-<sha>` or `vX.Y.Z`) for production
deployments.

## What's in this repo

| File                          | Purpose                                                   |
| ----------------------------- | --------------------------------------------------------- |
| `README.md`                   | This file                                                 |
| `docker-compose.ghcr.yml`     | Reference compose file that pulls the GHCR image         |
| `.env.example`                | All runtime variables consumed by the image               |
| `deployment.md`               | End-to-end deployment guide for Compose and Portainer     |

## Getting started

```bash
git clone https://github.com/flathack/syncforge.git
cd syncforge
cp .env.example .env
$EDITOR .env
docker compose -f docker-compose.ghcr.yml up -d
```

Then open `http://<host>:8000` and sign in with the admin credentials from
`.env`. See `deployment.md` for Portainer stacks, persistent storage,
updates, and security notes.

## License

MIT License. See `LICENSE` if present in the release artifacts published
alongside the image.