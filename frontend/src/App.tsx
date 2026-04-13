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

  async function loadSyncPairs() {
    try {
      setError(null);
      const response = await fetch("http://localhost:8000/api/sync-pairs");
      if (!response.ok) {
        throw new Error(`API antwortet mit Status ${response.status}`);
      }

      const data = (await response.json()) as SyncPairSummary[];
      setSyncPairs(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSyncPairs();
  }, []);

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

      await loadSyncPairs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    }
  }

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

      <section className="panel">
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
                      <button
                        className="table-button"
                        type="button"
                        onClick={() => void handleDeleteSyncPair(pair.id)}
                      >
                        Loeschen
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </main>
  );
}
