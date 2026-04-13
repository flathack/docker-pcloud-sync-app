import { useEffect, useState, type FormEvent } from "react";

type UserSummary = {
  username: string;
  role: string;
  is_active: boolean;
  created_at: string;
};

type SyncPairSummary = {
  id: string;
  name: string;
  source_path: string;
  destination_path: string;
  mode: string;
  direction: string;
  status: string;
  last_status: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

type SyncRunSummary = {
  id: string;
  sync_pair_id: string;
  trigger_type: string;
  status: string;
  started_at: string;
  finished_at: string;
  duration_seconds: number;
  files_transferred: number;
  files_deleted: number;
  error_count: number;
  bytes_transferred: number;
  exit_code: number | null;
  short_log: string;
  full_log_path: string | null;
  rclone_command: string;
  created_at: string;
};

const apiBaseUrl = "http://localhost:8000/api";

const initialFormState = {
  name: "",
  source_path: "",
  destination_path: "",
  mode: "sync",
  direction: "push",
};

const initialLoginState = {
  username: "admin",
  password: "change-me-now",
};

async function apiFetch(path: string, init?: RequestInit) {
  return fetch(`${apiBaseUrl}${path}`, {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

export function App() {
  const [currentUser, setCurrentUser] = useState<UserSummary | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [loginSubmitting, setLoginSubmitting] = useState(false);
  const [loginState, setLoginState] = useState(initialLoginState);
  const [syncPairs, setSyncPairs] = useState<SyncPairSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formState, setFormState] = useState(initialFormState);
  const [selectedSyncPairId, setSelectedSyncPairId] = useState<string | null>(null);
  const [runs, setRuns] = useState<SyncRunSummary[]>([]);
  const [runLoading, setRunLoading] = useState(false);
  const [runActionId, setRunActionId] = useState<string | null>(null);

  async function checkSession() {
    try {
      const response = await apiFetch("/auth/me", { method: "GET" });
      if (response.status === 401) {
        setCurrentUser(null);
        return;
      }
      if (!response.ok) {
        throw new Error(`Session-Pruefung fehlgeschlagen mit Status ${response.status}`);
      }

      const user = (await response.json()) as UserSummary;
      setCurrentUser(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setSessionLoading(false);
    }
  }

  async function loadSyncPairs() {
    try {
      setError(null);
      const response = await apiFetch("/sync-pairs", { method: "GET" });
      if (!response.ok) {
        throw new Error(`API antwortet mit Status ${response.status}`);
      }

      const data = (await response.json()) as SyncPairSummary[];
      setSyncPairs(data);
      setSelectedSyncPairId((current) => current ?? data[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void checkSession();
  }, []);

  useEffect(() => {
    if (!currentUser) {
      setSyncPairs([]);
      setRuns([]);
      setSelectedSyncPairId(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    void loadSyncPairs();
  }, [currentUser]);

  useEffect(() => {
    if (!selectedSyncPairId || !currentUser) {
      setRuns([]);
      return;
    }

    async function loadRuns() {
      try {
        setRunLoading(true);
        const response = await apiFetch(`/sync-pairs/${selectedSyncPairId}/runs`, {
          method: "GET",
        });
        if (!response.ok) {
          throw new Error(`Run-Historie antwortet mit Status ${response.status}`);
        }

        const data = (await response.json()) as SyncRunSummary[];
        setRuns(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unbekannter Fehler");
      } finally {
        setRunLoading(false);
      }
    }

    void loadRuns();
  }, [selectedSyncPairId, currentUser]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginSubmitting(true);
    setError(null);

    try {
      const response = await apiFetch("/auth/login", {
        method: "POST",
        body: JSON.stringify(loginState),
      });
      if (!response.ok) {
        throw new Error("Login fehlgeschlagen. Bitte Zugangsdaten pruefen.");
      }

      const user = (await response.json()) as UserSummary;
      setCurrentUser(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setLoginSubmitting(false);
    }
  }

  async function handleLogout() {
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } finally {
      setCurrentUser(null);
      setSyncPairs([]);
      setRuns([]);
      setSelectedSyncPairId(null);
    }
  }

  async function handleCreateSyncPair(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await apiFetch("/sync-pairs", {
        method: "POST",
        body: JSON.stringify(formState),
      });

      if (!response.ok) {
        throw new Error(`Anlegen fehlgeschlagen mit Status ${response.status}`);
      }

      setFormState(initialFormState);
      await loadSyncPairs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteSyncPair(id: string) {
    try {
      setError(null);
      const response = await apiFetch(`/sync-pairs/${id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error(`Loeschen fehlgeschlagen mit Status ${response.status}`);
      }

      setSelectedSyncPairId((current) => (current === id ? null : current));
      await loadSyncPairs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    }
  }

  async function handleStartRun(id: string) {
    try {
      setRunActionId(id);
      setError(null);
      const response = await apiFetch(`/sync-pairs/${id}/run`, {
        method: "POST",
        body: JSON.stringify({ trigger_type: "manual" }),
      });

      if (!response.ok) {
        throw new Error(`Run-Start fehlgeschlagen mit Status ${response.status}`);
      }

      setSelectedSyncPairId(id);
      await loadSyncPairs();
      const runsResponse = await apiFetch(`/sync-pairs/${id}/runs`, {
        method: "GET",
      });
      if (!runsResponse.ok) {
        throw new Error(`Run-Historie antwortet mit Status ${runsResponse.status}`);
      }

      const runsData = (await runsResponse.json()) as SyncRunSummary[];
      setRuns(runsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setRunActionId(null);
    }
  }

  const selectedSyncPair = syncPairs.find((pair) => pair.id === selectedSyncPairId) ?? null;

  if (sessionLoading) {
    return (
      <main className="page-shell">
        <section className="panel">
          <p className="state">Pruefe Anmeldung...</p>
        </section>
      </main>
    );
  }

  if (!currentUser) {
    return (
      <main className="page-shell auth-shell">
        <section className="hero auth-hero">
          <div>
            <p className="eyebrow">PCloud Sync Docker App</p>
            <h1>Anmeldung fuer das Sync-Dashboard</h1>
            <p className="hero-copy">
              Melde dich mit dem lokalen Admin-Benutzer an, um Sync-Paare,
              Run-Historie und spaetere rclone-Steuerung zu verwalten.
            </p>
          </div>
        </section>

        <section className="panel auth-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Login</p>
              <h2>Zugangsdaten</h2>
            </div>
          </div>

          {error ? <p className="state error">Fehler: {error}</p> : null}

          <form className="sync-form" onSubmit={handleLogin}>
            <label>
              <span>Benutzername</span>
              <input
                required
                value={loginState.username}
                onChange={(event) =>
                  setLoginState((current) => ({ ...current, username: event.target.value }))
                }
              />
            </label>

            <label>
              <span>Passwort</span>
              <input
                required
                type="password"
                value={loginState.password}
                onChange={(event) =>
                  setLoginState((current) => ({ ...current, password: event.target.value }))
                }
              />
            </label>

            <button className="primary-button" type="submit" disabled={loginSubmitting}>
              {loginSubmitting ? "Melde an..." : "Anmelden"}
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">PCloud Sync Docker App</p>
          <h1>Sync-Dashboard fuer NAS und pCloud</h1>
          <p className="hero-copy">
            Angemeldet als <strong>{currentUser.username}</strong>. Das Dashboard
            zeigt geschuetzte Sync-Paare, Run-Historie und den manuellen
            Trigger fuer erste rclone-Laeufe.
          </p>
        </div>
        <div className="hero-actions">
          <div className="hero-stat">
            <span>Sync-Paare</span>
            <strong>{syncPairs.length}</strong>
          </div>
          <button className="table-button logout-button" type="button" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </section>

      <section className="panel form-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Neuer Eintrag</p>
            <h2>Sync-Paar anlegen</h2>
          </div>
        </div>

        <form className="sync-form" onSubmit={handleCreateSyncPair}>
          <label>
            <span>Name</span>
            <input
              required
              value={formState.name}
              onChange={(event) =>
                setFormState((current) => ({ ...current, name: event.target.value }))
              }
            />
          </label>

          <label>
            <span>Quelle</span>
            <input
              required
              value={formState.source_path}
              onChange={(event) =>
                setFormState((current) => ({ ...current, source_path: event.target.value }))
              }
            />
          </label>

          <label>
            <span>Ziel</span>
            <input
              required
              value={formState.destination_path}
              onChange={(event) =>
                setFormState((current) => ({
                  ...current,
                  destination_path: event.target.value,
                }))
              }
            />
          </label>

          <label>
            <span>Modus</span>
            <select
              value={formState.mode}
              onChange={(event) =>
                setFormState((current) => ({ ...current, mode: event.target.value }))
              }
            >
              <option value="sync">sync</option>
              <option value="copy">copy</option>
              <option value="bisync">bisync</option>
            </select>
          </label>

          <label>
            <span>Richtung</span>
            <select
              value={formState.direction}
              onChange={(event) =>
                setFormState((current) => ({ ...current, direction: event.target.value }))
              }
            >
              <option value="push">push</option>
              <option value="pull">pull</option>
              <option value="bidirectional">bidirectional</option>
            </select>
          </label>

          <button className="primary-button" type="submit" disabled={submitting}>
            {submitting ? "Speichere..." : "Sync-Paar speichern"}
          </button>
        </form>
      </section>

      <section className="panel dashboard-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Dashboard</p>
            <h2>Aktuelle Verbindungen</h2>
          </div>
        </div>

        {loading ? <p className="state">Lade Sync-Paare...</p> : null}
        {error ? <p className="state error">Fehler: {error}</p> : null}

        {!loading && !error ? (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Quelle</th>
                  <th>Ziel</th>
                  <th>Modus</th>
                  <th>Richtung</th>
                  <th>Status</th>
                  <th>Letzter Lauf</th>
                  <th>Aktiv</th>
                  <th>Aktion</th>
                </tr>
              </thead>
              <tbody>
                {syncPairs.map((pair) => (
                  <tr key={pair.id}>
                    <td>{pair.name}</td>
                    <td>{pair.source_path}</td>
                    <td>{pair.destination_path}</td>
                    <td>{pair.mode}</td>
                    <td>{pair.direction}</td>
                    <td>
                      <span className={`badge ${pair.status}`}>{pair.status}</span>
                    </td>
                    <td>{pair.last_status}</td>
                    <td>{pair.enabled ? "ja" : "nein"}</td>
                    <td>
                      <div className="action-stack">
                        <button
                          className="table-button"
                          type="button"
                          onClick={() => setSelectedSyncPairId(pair.id)}
                        >
                          Details
                        </button>
                        <button
                          className="table-button primary-inline"
                          type="button"
                          disabled={runActionId === pair.id}
                          onClick={() => void handleStartRun(pair.id)}
                        >
                          {runActionId === pair.id ? "Laeuft..." : "Run now"}
                        </button>
                        <button
                          className="table-button"
                          type="button"
                          onClick={() => void handleDeleteSyncPair(pair.id)}
                        >
                          Loeschen
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Run-Historie</p>
            <h2>
              {selectedSyncPair ? selectedSyncPair.name : "Noch kein Sync-Paar ausgewaehlt"}
            </h2>
          </div>
        </div>

        {!selectedSyncPair ? <p className="state">Waehle oben ein Sync-Paar aus.</p> : null}
        {selectedSyncPair && runLoading ? <p className="state">Lade letzte Laeufe...</p> : null}

        {selectedSyncPair && !runLoading && runs.length === 0 ? (
          <p className="state">Fuer dieses Sync-Paar gibt es noch keine Laeufe.</p>
        ) : null}

        {selectedSyncPair && runs.length > 0 ? (
          <div className="run-list">
            {runs.map((run) => (
              <article className="run-card" key={run.id}>
                <div className="run-card-header">
                  <span className={`badge ${run.status}`}>{run.status}</span>
                  <strong>{new Date(run.started_at).toLocaleString("de-DE")}</strong>
                </div>
                <p>{run.short_log}</p>
                <dl className="run-metrics">
                  <div>
                    <dt>Dateien</dt>
                    <dd>{run.files_transferred}</dd>
                  </div>
                  <div>
                    <dt>Bytes</dt>
                    <dd>{run.bytes_transferred}</dd>
                  </div>
                  <div>
                    <dt>Dauer</dt>
                    <dd>{run.duration_seconds}s</dd>
                  </div>
                  <div>
                    <dt>Exit-Code</dt>
                    <dd>{run.exit_code ?? "-"}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        ) : null}
      </section>
    </main>
  );
}
