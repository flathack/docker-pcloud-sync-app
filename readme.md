# PCloud Sync Docker App

## Aktueller Stand

Der aktuelle Repository-Stand enthaelt bereits einen lauffaehigen MVP-Prototypen:

- FastAPI-Backend mit SQLite
- Session-basierte Anmeldung mit lokalem Admin-User
- CRUD fuer `sync_pairs`
- Run-Historie fuer `sync_runs`
- Runner-Basis fuer `rclone` mit Logdateien
- React-Frontend mit Login, Dashboard, Run-Historie und Log-Anzeige
- Dockerfile, `docker-compose.yml` und `.env.example`

Der aktuelle lokale Standard-Login fuer die Entwicklung ist:

```text
Benutzername: admin
Passwort: change-me-now
```

## Deployment Automation

Fuer wiederholbare Updates ist das Projekt jetzt auf einen Registry-basierten Ablauf ausgelegt:

- GitHub Actions baut bei Push auf `main` oder `master` automatisch ein Docker-Image
- Das Image wird nach `GHCR` gepusht
- Gebaut wird direkt fuer `linux/amd64` und `linux/arm64`
- Fuer Portainer gibt es eine separate Stack-Datei: `docker-compose.portainer.yml`

### CI-Datei

- `.github/workflows/docker-image.yml`

Die Action veroeffentlicht Images nach diesem Muster:

```text
ghcr.io/GITHUB_OWNER/pcloud-sync-docker-app:latest
ghcr.io/GITHUB_OWNER/pcloud-sync-docker-app:main
ghcr.io/GITHUB_OWNER/pcloud-sync-docker-app:sha-...
```

Mit deinem Account ergibt sich also spaeter z. B.:

```text
ghcr.io/flathack/pcloud-sync-docker-app:latest
```

### Portainer-Stack

- `docker-compose.portainer.yml`

Vor dem Deploy in Portainer muessen dort mindestens diese Werte ersetzt werden:

- `REPLACE_WITH_A_LONG_RANDOM_SECRET`
- `REPLACE_WITH_A_STRONG_PASSWORD`
- `/volume1/YOUR_NAS_SHARE`

### Empfohlener Update-Ablauf

1. Repository nach GitHub pushen
2. GitHub Action baut und pusht das Image nach GHCR
3. Portainer-Stack nutzt `docker-compose.portainer.yml`
4. In Portainer `Pull and redeploy` bzw. `Redeploy` ausfuehren

## Zielbild

Web-Anwendung zur Verwaltung und Beobachtung von Synchronisationen zwischen lokalen oder NAS-Ordnern und pCloud-Ordnern. Die App laeuft lokal in VSCode und spaeter produktiv in Docker auf einem Server oder NAS.

Die Anwendung soll:

- Sync-Paare verwalten
- rclone-basierte Sync-Jobs starten und stoppen
- Status, Historie und Logs anzeigen
- Login-geschuetzt sein
- spaeter optional Telegram-Benachrichtigungen unterstuetzen

## Annahmen

- Der Host, auf dem Docker laeuft, hat Zugriff auf lokale oder gemountete NAS-Pfade.
- pCloud wird ueber `rclone` mit konfiguriertem Remote angesprochen.
- Fuer das MVP reicht ein einzelner Admin-Benutzer.
- Es darf pro Sync-Paar immer nur ein aktiver Lauf gleichzeitig existieren.
- Historie und Job-Metadaten werden App-seitig gespeichert, auch wenn rclone Teilinformationen liefert.

## Stack-Empfehlung

### Empfohlener Stack fuer das MVP

| Bereich | Empfehlung | Begruendung |
|---|---|---|
| Backend | Python + FastAPI | Schnell produktiv, starke Typisierung mit Pydantic, gut fuer API + Prozesssteuerung |
| Frontend | React + Vite + TypeScript | Schnelle lokale Entwicklung, gute Admin-UI-Basis |
| Datenbank | SQLite | Einfach fuer lokalen Start und Docker-MVP |
| ORM | SQLAlchemy + Alembic | Solide Migrationen, spaeter leicht auf PostgreSQL umstellbar |
| UI | React mit Material UI oder shadcn/ui + Tailwind | Moderne Admin-Oberflaeche, schnell umsetzbar |
| Auth | Cookie-Session mit serverseitiger Sessionverwaltung | Einfacher und sicherer fuer internes Admin-Tool als JWT im MVP |
| Jobsteuerung | App startet `rclone`-Prozesse direkt | Einfacher fuer lokales MVP, bessere Kontrolle ueber Run-Historie |
| Scheduler | APScheduler | Einfach fuer Cron- oder Intervall-Jobs innerhalb des Containers |

### Warum nicht Node/NestJS als erste Wahl

Node.js mit Express oder NestJS ist ebenfalls moeglich. Fuer dieses Projekt hat FastAPI aber Vorteile:

- Subprozess-Steuerung fuer `rclone` ist in Python sehr direkt
- JSON-Parsing, Background-Tasks und API-Definition sind mit wenig Boilerplate umsetzbar
- SQLAlchemy + Alembic sind fuer ein kleines Admin-System sehr robust
- Ein spaeterer Wechsel auf PostgreSQL ist unkompliziert

## Architekturuebersicht

```text
+-----------------------+        HTTPS        +---------------------------+
| React Frontend        | <-----------------> | FastAPI Backend           |
| Dashboard / Forms     |                     | Auth / API / Scheduler    |
+-----------------------+                     +------------+--------------+
                                                          |
                                                          | SQLAlchemy
                                                          v
                                             +---------------------------+
                                             | SQLite / PostgreSQL       |
                                             | users / sync_pairs / runs |
                                             +---------------------------+
                                                          |
                                             start/stop   | logs/status
                                                          v
                                             +---------------------------+
                                             | rclone process layer      |
                                             | sync / copy / bisync      |
                                             +---------------------------+
                                                          |
                                                          v
                                             +---------------------------+
                                             | Local/NAS + pCloud        |
                                             +---------------------------+
```

## Komponenten

### 1. Frontend

- Login-Seite
- Dashboard mit Karten oder Tabelle fuer alle Sync-Paare
- Detailseite pro Sync-Paar
- Formulare fuer Anlegen, Bearbeiten, Aktivieren, Deaktivieren
- Run-Historie mit Kurzlogs
- Buttons fuer `Start`, `Stop`, `Run now`

### 2. Backend API

- Authentifizierung und Session-Handling
- CRUD fuer Sync-Paare
- Ausloesen und Stoppen von Sync-Laeufen
- Bereitstellen von Status, Historie und Logs
- Scheduler fuer geplante Jobs
- Telegram-Modul als optionale Benachrichtigungs-Schnittstelle

### 3. Sync Runner

- Startet `rclone sync`, `rclone copy` oder `rclone bisync`
- Schreibt Start- und Endstatus in die Datenbank
- Erfasst Logs, Exit-Code, Dauer und zusammengefasste Kennzahlen
- Sperrt parallele Starts desselben Sync-Paares

### 4. Persistence

- SQLite-Datei fuer MVP
- Log-Dateien optional unter `/app/data/logs`
- rclone-Konfiguration als Mount oder Secret

## Architekturentscheidung: RC/API vs. direkte Prozesse

### A. rclone als separater Dienst mit RC/API

**Vorteile**

- Trennung zwischen Web-App und Sync-Engine
- Theoretisch bessere Erweiterbarkeit fuer verteilte Architekturen
- Teilweise standardisierte Runtime-Informationen ueber RC

**Nachteile**

- Zusaetzlicher Dienst und zusaetzliche Absicherung notwendig
- RC muss sicher exponiert oder intern geroutet werden
- Monitoring bleibt unvollstaendig, wenn eigene Job-Historie benoetigt wird
- Stop/Start-Verhalten und Zuordnung zu App-Jobs wird komplexer

### B. Web-App startet rclone-Prozesse selbst

**Vorteile**

- Einfachste Docker-Topologie fuer MVP
- Volle Kontrolle ueber Start, Stop, Timeout, Exit-Code und Log-Zuordnung
- App kann Run-Historie direkt selbst fuehren
- Lokale Entwicklung in VSCode sehr einfach

**Nachteile**

- Engere Kopplung zwischen App und rclone-Ausfuehrung
- Prozessmanagement muss sauber implementiert werden
- Bei spaeterer horizontaler Skalierung ist ein Job-Worker-Modell sinnvoll

### Vergleich

| Kriterium | Ansatz A: RC/API | Ansatz B: Prozesse direkt |
|---|---|---|
| Sicherheit | Mehr Angriffsoberflaeche wegen RC-Endpunkt | Einfacher, da kein separater Steuerport noetig |
| Wartbarkeit | Mehr Komponenten | Weniger Komponenten im MVP |
| Monitoring | RC liefert Runtime-Daten, aber nicht alles | App kann genau die Historie speichern, die gebraucht wird |
| Parallelitaet | Gut, aber schwieriger sauber zuordbar | Gut genug fuer MVP mit App-seitigen Locks |
| Logging | Verstreut auf RC/rclone/App | Zentral pro Run erfassbar |
| Docker-Betrieb | Zwei Dienste oder komplexerer Container | Ein Container reicht fuer MVP |
| Fehlerbehandlung | API- und Prozessfehler getrennt | Direkter Zugriff auf Exit-Code und stderr |

### Empfehlung

- **MVP:** Ansatz B, also `rclone` direkt aus der App starten
- **Spaeter:** Optional Hybrid oder eigener Worker-Dienst, wenn mehrere Runner, Queueing oder verteilte Ausfuehrung benoetigt werden

## Fachliches Datenmodell

### Kernobjekte

#### `users`

| Feld | Typ | Beschreibung |
|---|---|---|
| id | UUID / Integer | Primaerschluessel |
| username | String | Eindeutig |
| password_hash | String | Argon2 oder bcrypt |
| role | String | `admin`, spaeter `viewer`, `operator` |
| is_active | Boolean | Aktivstatus |
| created_at | DateTime | Erstellung |
| updated_at | DateTime | Aenderung |

#### `sync_pairs`

| Feld | Typ | Beschreibung |
|---|---|---|
| id | UUID | Primaerschluessel |
| name | String | Anzeigename |
| source_path | String | Lokaler oder NAS-Pfad |
| destination_path | String | pCloud-Pfad oder umgekehrt |
| direction | String | `push`, `pull`, `bidirectional` |
| mode | String | `sync`, `copy`, `bisync` |
| schedule_type | String | `manual`, `cron` |
| schedule_expr | String nullable | Cron-Ausdruck |
| rclone_flags_json | JSON/Text | Zusatzflags |
| status | String | `idle`, `running`, `disabled`, `error` |
| enabled | Boolean | Aktiviert |
| last_run_at | DateTime nullable | Letzter Start |
| last_success_at | DateTime nullable | Letzter erfolgreicher Lauf |
| last_status | String nullable | Ergebnis des letzten Laufs |
| created_at | DateTime | Erstellung |
| updated_at | DateTime | Aenderung |

#### `sync_runs`

| Feld | Typ | Beschreibung |
|---|---|---|
| id | UUID | Primaerschluessel |
| sync_pair_id | UUID | FK auf `sync_pairs` |
| trigger_type | String | `manual`, `schedule`, `startup`, `retry` |
| status | String | `queued`, `running`, `success`, `error`, `stopped` |
| started_at | DateTime | Startzeit |
| finished_at | DateTime nullable | Endzeit |
| duration_seconds | Integer nullable | Dauer |
| files_transferred | Integer | Anzahl uebertragener Dateien |
| files_deleted | Integer | Anzahl geloeschter Dateien |
| error_count | Integer | Fehleranzahl |
| bytes_transferred | BigInteger | Datenmenge |
| exit_code | Integer nullable | Prozess-Exit-Code |
| short_log | Text | Zusammenfassung |
| full_log_path | String nullable | Pfad zur Logdatei |
| rclone_command | Text | Effektiv gestarteter Befehl |
| created_at | DateTime | Erstellung |

#### `app_settings`

| Feld | Typ | Beschreibung |
|---|---|---|
| key | String | Schluessel |
| value | Text | Wert |
| updated_at | DateTime | Aenderung |

### Minimales Schema als SQL-Beispiel

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sync_pairs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_path TEXT NOT NULL,
  destination_path TEXT NOT NULL,
  direction TEXT NOT NULL,
  mode TEXT NOT NULL,
  schedule_type TEXT NOT NULL DEFAULT 'manual',
  schedule_expr TEXT,
  rclone_flags_json TEXT,
  status TEXT NOT NULL DEFAULT 'idle',
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  last_success_at TEXT,
  last_status TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sync_runs (
  id TEXT PRIMARY KEY,
  sync_pair_id TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  duration_seconds INTEGER,
  files_transferred INTEGER NOT NULL DEFAULT 0,
  files_deleted INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  bytes_transferred INTEGER NOT NULL DEFAULT 0,
  exit_code INTEGER,
  short_log TEXT,
  full_log_path TEXT,
  rclone_command TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (sync_pair_id) REFERENCES sync_pairs(id)
);
```

## API-Design

### Auth

| Methode | Pfad | Zweck |
|---|---|---|
| `POST` | `/api/auth/login` | Login mit Username/Passwort |
| `POST` | `/api/auth/logout` | Session beenden |
| `GET` | `/api/auth/me` | Aktuellen Benutzer laden |

### Sync-Paare

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/api/sync-pairs` | Liste aller Sync-Paare |
| `POST` | `/api/sync-pairs` | Neues Sync-Paar anlegen |
| `GET` | `/api/sync-pairs/{id}` | Detailansicht |
| `PUT` | `/api/sync-pairs/{id}` | Bearbeiten |
| `DELETE` | `/api/sync-pairs/{id}` | Loeschen |
| `POST` | `/api/sync-pairs/{id}/enable` | Aktivieren |
| `POST` | `/api/sync-pairs/{id}/disable` | Deaktivieren |
| `POST` | `/api/sync-pairs/{id}/run` | Manuellen Lauf starten |
| `POST` | `/api/sync-pairs/{id}/stop` | Aktiven Lauf stoppen, spaeter als echter Prozessabbruch |

### Monitoring

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/api/runs` | Letzte Runs global |
| `GET` | `/api/sync-pairs/{id}/runs` | Historie eines Sync-Paares |
| `GET` | `/api/runs/{run_id}` | Run-Details |
| `GET` | `/api/runs/{run_id}/log` | Vollstaendiges Log |
| `GET` | `/api/dashboard/summary` | Kennzahlen fuer Dashboard |

### Settings

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/api/settings` | Aktuelle Einstellungen |
| `PUT` | `/api/settings` | Einstellungen aktualisieren |
| `POST` | `/api/settings/test-telegram` | Telegram-Testnachricht |

### Beispiel: `POST /api/sync-pairs/{id}/run`

```json
{
  "trigger": "manual"
}
```

### Beispielantwort fuer Sync-Status

```json
{
  "id": "sp_local_photos_to_pcloud",
  "name": "Fotos NAS -> pCloud",
  "source_path": "/mnt/nas/photos",
  "destination_path": "pcloud:/photos-backup",
  "direction": "push",
  "mode": "sync",
  "enabled": true,
  "status": "running",
  "last_run_at": "2026-04-13T13:22:00Z",
  "last_status": "success",
  "current_run": {
    "run_id": "run_01",
    "started_at": "2026-04-13T14:00:00Z",
    "files_transferred": 124,
    "error_count": 0,
    "bytes_transferred": 834234233,
    "progress_percent": 78
  }
}
```

## Wie Monitoring und Historie umgesetzt werden sollen

### Datenquelle

`rclone` liefert ueber Exit-Code, stdout, stderr und optional JSON-nahe Formate bereits nutzbare Informationen. Fuer das MVP ist die App aber die autoritative Quelle fuer Historie. Der aktuelle Code schreibt pro Lauf bereits eine Logdatei und speichert Exit-Code, Kommandozeile und Kurzstatus in `sync_runs`.

### Vorgehen

1. Beim Start eines Jobs legt die App einen `sync_runs`-Eintrag mit `status=running` an.
2. Die App startet `rclone` als Subprozess mit klar definierten Parametern.
3. stdout und stderr werden in eine Logdatei und optional in einen In-Memory-Puffer geschrieben.
4. Nach Prozessende parsed die App relevante Metriken aus dem Output.
5. Ergebnis wird in `sync_runs` und `sync_pairs.last_*` zurueckgeschrieben.

### Wichtige rclone-Optionen fuer bessere Auswertbarkeit

```bash
rclone sync SOURCE DEST \
  --use-json-log \
  --log-level INFO \
  --stats 10s \
  --stats-one-line-json
```

### Empfehlung zur Auswertung

- Bevorzugt JSON-Logs oder One-Line-Stats verwenden
- App-seitig Parser fuer:
  - `bytes`
  - `checks`
  - `transfers`
  - `errors`
  - geloeschte Dateien, falls im Log erkennbar
- Falls bestimmte Werte nicht sicher extrahierbar sind:
  - Wert als `null` oder `0` speichern
  - Kurzlog mit Hinweis ergaenzen

## Authentifizierung und Sicherheit

### MVP

- Ein lokaler Admin-Benutzer
- Login per Username/Passwort
- Passwort-Hashing per PBKDF2 als pragmatische lokale MVP-Loesung
- Serverseitige Session in signiertem Cookie
- Session-Cookie:
  - `HttpOnly`
  - `Secure` in Produktion
  - `SameSite=Lax`

### Spaeter skalierbar

- OIDC fuer Single Sign-On
- Optional LDAP fuer interne NAS- oder Unternehmensumgebungen
- Rollenmodell:
  - `admin`: alles
  - `operator`: Runs starten/stoppen, keine Systemeinstellungen
  - `viewer`: nur lesen

### Weitere Sicherheitsmassnahmen

- Keine beliebigen Shell-Commands aus der UI
- Pfadvalidierung fuer lokale Quellordner
- rclone-Konfiguration nicht im Image einbacken
- Secrets ueber Volume oder Docker Secrets
- Rate Limiting fuer Login-Endpunkte
- Audit-Log fuer kritische Aktionen spaeter einplanen

## Docker-Setup

### Container-Strategie

Fuer das MVP ein Container:

- FastAPI-Backend
- Frontend statisch mit ausgelieferter Build-Ausgabe
- `rclone` im selben Container installiert

Spaeter moeglich:

- Frontend separat
- API separat
- Worker separat

### Beispiel `Dockerfile`

```dockerfile
FROM node:22-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
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
    rclone \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

COPY backend /app/backend
COPY --from=frontend-builder /app/frontend/dist /app/frontend-dist

RUN mkdir -p /app/data/db /app/data/logs /app/data/config

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD curl -f http://localhost:8000/api/health || exit 1

CMD ["uvicorn", "app.main:app", "--app-dir", "/app/backend", "--host", "0.0.0.0", "--port", "8000"]
```

### Beispiel `docker-compose.yml`

```yaml
version: "3.9"

services:
  pcloud-sync-app:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: pcloud-sync-app
    ports:
      - "8000:8000"
    environment:
      APP_ENV: production
      APP_SECRET_KEY: change-me
      DATABASE_URL: sqlite:////app/data/db/app.db
      RCLONE_CONFIG: /app/data/config/rclone/rclone.conf
      DEFAULT_TIMEZONE: Europe/Berlin
      TELEGRAM_ENABLED: "false"
    volumes:
      - ./data/db:/app/data/db
      - ./data/logs:/app/data/logs
      - ./data/config:/app/data/config
      - /mnt/nas:/mnt/nas
    restart: unless-stopped
```

### Beispiel `.env.example`

```env
APP_ENV=development
APP_SECRET_KEY=please-change-me
DATABASE_URL=sqlite:///./data/db/app.db
DEFAULT_TIMEZONE=Europe/Berlin

ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-me-now

RCLONE_CONFIG=./data/config/rclone/rclone.conf
RCLONE_GLOBAL_FLAGS=--use-json-log --log-level INFO --stats 10s --stats-one-line-json

TELEGRAM_ENABLED=false
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

### Persistenz

| Bereich | Ort |
|---|---|
| SQLite DB | `/app/backend/data/app.db` |
| Run-Logs | `/app/data/logs/` |
| App-Konfiguration | `/app/data/config/` |
| rclone Config | `/app/data/config/rclone/rclone.conf` |

## Verzeichnisstruktur

```text
PCloud-Sync-Docker-App/
  backend/
    app/
      api/
      core/
      db/
      models/
      schemas/
      services/
      runners/
      scheduler/
      integrations/
      main.py
    requirements.txt
    alembic.ini
    migrations/
  frontend/
    src/
      app/
      components/
      pages/
      features/
      api/
      types/
    package.json
    vite.config.ts
  data/
    db/
    logs/
    config/
      rclone/
  Dockerfile
  docker-compose.yml
  .env.example
  readme.md
```

## UI-Empfehlung

### Dashboard

Tabelle oder Karten mit:

- Name
- Quelle
- Ziel
- Richtung
- Modus
- Letzter Lauf
- Letzter Status
- Laufend oder Idle
- Uebertragene Dateien
- Fehler
- Datenmenge
- Dauer
- Aktionen

### Detailseite

- Stammdaten des Sync-Paares
- Letzte 20 Runs
- Kurzprotokoll
- Letzter Fehler
- Button fuer `Run now`
- Button fuer `Stop`

### Design-Richtung

- Administrative, ruhige UI
- Responsive Layout
- Farbcodes:
  - Gruen fuer Erfolg
  - Gelb fuer laufend
  - Rot fuer Fehler
  - Grau fuer deaktiviert

## Telegram optional und modular

### Ziel

Kein fester Bestandteil des Kerns, sondern austauschbares Benachrichtigungsmodul.

### Umsetzung

- Interface `Notifier`
- Implementierung `TelegramNotifier`
- Events:
  - `run_succeeded`
  - `run_failed`
  - `daily_summary`

### Beispielstruktur

```python
class Notifier:
    def send_run_succeeded(self, run): ...
    def send_run_failed(self, run): ...
    def send_daily_summary(self, summary): ...
```

Wenn `TELEGRAM_ENABLED=false`, wird ein `NoopNotifier` verwendet.

## MVP-Umfang

### Empfohlene MVP-Featureliste

1. Login mit lokalem Admin-User
2. Dashboard mit Liste aller Sync-Paare
3. Sync-Paar anlegen, bearbeiten, loeschen
4. Manuellen Lauf starten
5. Run-Historie anzeigen
6. Logauszug anzeigen
7. Docker-Start lokal und auf NAS/Server

### Nicht im ersten MVP

- Mehrbenutzerbetrieb
- OIDC/LDAP
- Verteilte Worker
- Live-Websocket-Streaming
- Erweiterte Konfliktlogik fuer komplexe `bisync`-Faelle
- Echter Prozessabbruch fuer laufende rclone-Jobs
- Aktivieren/Deaktivieren pro Sync-Paar in der UI

## Meilensteinplan in 3 Phasen

### Phase 1: Lokaler Prototyp in VSCode

Ziel: End-to-End lokal lauffaehig.

- FastAPI-Grundgeruest
- SQLite anbinden
- Einfaches React-Frontend
- Login mit lokalem Admin
- `sync_pairs` CRUD
- Manueller Start eines `rclone`-Kommandos
- Speicherung eines `sync_runs`-Eintrags

### Phase 2: MVP fuer Docker

Ziel: Stabiler Ein-Container-Betrieb.

- Dockerfile und Compose
- Scheduler
- Historie, Logs und Fehlerhandling verbessern
- Healthcheck
- Persistente Volumes
- Absicherung von Settings und Secrets

### Phase 3: Produktivierung

Ziel: Betrieb auf Server oder NAS.

- PostgreSQL optional
- Rollenmodell erweitern
- Telegram-Modul
- Bessere Auswertung fuer `bisync`
- Optional OIDC oder LDAP
- Optional Worker-Modell statt direkter In-Process-Ausfuehrung

## Risiken und offene Punkte

| Thema | Risiko | Empfehlung |
|---|---|---|
| `bisync` | Konflikt- und Loeschlogik kann komplex sein | Im MVP klar kennzeichnen und zunaechst vorsichtig freigeben |
| Pfadrechte | Docker-Container braucht Host-Zugriff | Frueh mit echten Mounts testen |
| pCloud Remote | rclone-Konfiguration kann fehlerhaft sein | `rclone lsd` oder `rclone about` als Verbindungstest einbauen |
| Log-Parsing | Nicht alle Kennzahlen immer stabil extrahierbar | App-seitiges Mindestmodell definieren |
| Lang laufende Jobs | API-Prozess darf nicht blockieren | Background-Task oder interner Runner-Manager einsetzen |
| Container-Neustart | Laufende Jobs koennen abbrechen | Beim Start offene Runs als `interrupted` markieren |

## Konkrete naechste Schritte

1. `rclone` auf dem Zielsystem installieren oder im Container mit echter Konfiguration starten
2. `.env.example` nach `.env` uebertragen und Zugangsdaten anpassen
3. `RCLONE_CONFIG` auf eine funktionierende `rclone.conf` zeigen lassen
4. Frontend mit Node.js lokal starten oder direkt den Docker-Weg nutzen
5. Danach den ersten echten Sync gegen Testordner pruefen

## Erster Entwicklungsschritt fuer heute in VSCode

Der Prototyp ist inzwischen umgesetzt. Fuer den naechsten praktischen Entwicklungsschritt sollte jetzt ein echter End-to-End-Test folgen:

1. Node.js lokal installieren, falls noch nicht vorhanden
2. Backend starten
3. Frontend starten
4. Mit dem Admin-Login anmelden
5. Ein Test-Sync-Paar anlegen und `Run now` ausloesen

## Vorschlag fuer den allerersten Prototypen

### Backend-Mockantwort

```json
[
  {
    "id": "sync_1",
    "name": "NAS Fotos -> pCloud",
    "source_path": "/mnt/nas/fotos",
    "destination_path": "pcloud:/fotos",
    "mode": "sync",
    "direction": "push",
    "status": "idle",
    "last_status": "success"
  }
]
```

### Minimaler lokaler Ablauf

```bash
# Backend
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload

# Frontend
cd frontend
set VITE_API_BASE_URL=http://localhost:8000/api
npm install
npm run dev
```

## Klare Empfehlung

Wenn das Ziel ein robustes, einfach wartbares System ist, dann ist fuer den Start die Kombination aus **FastAPI + React + SQLite + direkter rclone-Prozesssteuerung** die pragmatischste Loesung. Sie ist lokal schnell testbar, Docker-tauglich und kann spaeter ohne Architekturbruch in Richtung PostgreSQL, OIDC und Worker-Modell erweitert werden.
