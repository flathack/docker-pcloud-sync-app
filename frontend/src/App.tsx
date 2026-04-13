import { useEffect, useState, type FormEvent } from "react";

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
  short_log: string;
  created_at: string;
};

const initialFormState = {
  name: "",
  source_path: "",
  destination_path: "",
  mode: "sync",
  direction: "push",
};

export function App() {
  const [syncPairs, setSyncPairs] = useState<SyncPairSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formState, setFormState] = useState(initialFormState);
  const [selectedSyncPairId, setSelectedSyncPairId] = useState<string | null>(null);
  const [runs, setRuns] = useState<SyncRunSummary[]>([]);
  const [runLoading, setRunLoading] = useState(false);
  const [runActionId, setRunActionId] = useState<string | null>(null);

  async function loadSyncPairs() {
    try {
      setError(null);
      const response = await fetch("http://localhost:8000/api/sync-pairs");
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
    void loadSyncPairs();
  }, []);

  useEffect(() => {
    if (!selectedSyncPairId) {
      setRuns([]);
      return;
    }

    async function loadRuns() {
      try {
        setRunLoading(true);
        const response = await fetch(
          `http://localhost:8000/api/sync-pairs/${selectedSyncPairId}/runs`,
        );
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
  }, [selectedSyncPairId]);

  async function handleCreateSyncPair(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("http://localhost:8000/api/sync-pairs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
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
      const response = await fetch(`http://localhost:8000/api/sync-pairs/${id}`, {
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
      const response = await fetch(`http://localhost:8000/api/sync-pairs/${id}/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ trigger_type: "manual" }),
      });

      if (!response.ok) {
        throw new Error(`Run-Start fehlgeschlagen mit Status ${response.status}`);
      }

      setSelectedSyncPairId(id);
      await loadSyncPairs();
      const runsResponse = await fetch(`http://localhost:8000/api/sync-pairs/${id}/runs`);
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

  return (
    <main className="page-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">PCloud Sync Docker App</p>
          <h1>Sync-Dashboard fuer NAS und pCloud</h1>
          <p className="hero-copy">
            Der Prototyp laedt erste Sync-Paare aus dem FastAPI-Backend und
            bildet die Grundstruktur fuer Dashboard, Monitoring und spaetere
            Steuerung.
          </p>
        </div>
        <div className="hero-stat">
          <span>Sync-Paare</span>
          <strong>{syncPairs.length}</strong>
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
                    <dt>Fehler</dt>
                    <dd>{run.error_count}</dd>
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
