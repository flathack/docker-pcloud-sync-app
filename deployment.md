# Deploying SyncForge from GHCR

This repository only ships the public distribution artifacts for SyncForge.
The application source lives in a private repository and is not mirrored
here on purpose.

## What you get

- A prebuilt multi-arch image published to GitHub Container Registry
- A reference `docker-compose.ghcr.yml` that uses named volumes for
  persistent state
- A `.env.example` covering every runtime knob the image consumes

The image reference shown in the compose file is:

```text
ghcr.io/flathack/docker-syncforge:latest
```

Pin a specific tag (`main-<sha>`, `vX.Y.Z`) for production deployments
instead of relying on `:latest`.

## Quick start with Docker Compose

```bash
# 1. Fetch the public deployment files from this repository.
git clone https://github.com/flathack/syncforge.git
cd syncforge

# 2. Create your local environment file.
cp .env.example .env
$EDITOR .env

# 3. Pull and start the stack.
docker compose -f docker-compose.ghcr.yml pull
docker compose -f docker-compose.ghcr.yml up -d
```

After the container reports healthy, open `http://<host>:8000` and log in
with the admin credentials you placed in `.env`.

## Portainer stack

For Portainer, paste the contents of `docker-compose.ghcr.yml` into a new
stack and add an env file or stack-level environment variables. Mount your
real host paths instead of relying on the named volumes if you need the
container to reach shares outside Docker's volume driver.

## Updating

```bash
docker compose -f docker-compose.ghcr.yml pull
docker compose -f docker-compose.ghcr.yml up -d
```

To roll back, edit the `image:` line in the compose file to the previous
tag and re-run `up -d`.

## Persistence layout

| Mount                          | Purpose                                      |
| ------------------------------ | -------------------------------------------- |
| `syncforge-data`               | SQLite database and backend working data     |
| `syncforge-logs`               | Application and rclone logs                  |
| `syncforge-config`             | rclone config, certificates, custom configs  |

If you need to browse external shares (e.g. a NAS), bind-mount them under
`/mnt/nas` and add that path to `FILE_BROWSER_ROOTS` in `.env`.

## Security notes

- Always set `APP_SECRET_KEY` and `ADMIN_PASSWORD` to strong unique values
- Keep `SESSION_COOKIE_SECURE=true` whenever you serve over HTTPS
- Restrict the published port (`8000`) to trusted networks or put the
  container behind a reverse proxy with proper TLS

## Support and source

The public repository intentionally contains no application source. For
bug reports, feature requests, or contributions, please use the project's
normal private support channels.