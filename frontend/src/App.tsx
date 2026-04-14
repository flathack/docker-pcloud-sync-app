import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";

type UserSummary = { username: string; role: string; is_active: boolean; created_at: string };
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
type BrowserEntry = { name: string; path: string; entry_type: string };
type BrowserResponse = {
  current_path: string;
  parent_path: string | null;
  backend_type: string;
  entries: BrowserEntry[];
};
type RcloneConfigStatus = {
  exists: boolean;
  config_path: string;
  file_size: number | null;
  updated_at: string | null;
  remotes: string[];
  is_valid: boolean;
  detail: string;
};
type RcloneConfigTestResult = { ok: boolean; remote_name: string | null; detail: string };
type BrowserField = "source_path" | "destination_path" | null;
type BrowserMode = "local" | "remote";
type AppSection = "dashboard" | "settings";

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "/api").replace(/\/$/, "");
const initialFormState = {
  name: "",
  source_path: "",
  destination_path: "",
  mode: "sync",
  direction: "push",
  enabled: true,
};
const initialLoginState = { username: "admin", password: "change-me-now" };

async function apiFetch(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  const hasBody = init?.body !== undefined && init?.body !== null;
  if (hasBody && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(`${apiBaseUrl}${path}`, { credentials: "include", ...init, headers });
}

export function App() {
  const [currentUser, setCurrentUser] = useState<UserSummary | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [loginSubmitting, setLoginSubmitting] = useState(false);
  const [loginState, setLoginState] = useState(initialLoginState);
  const [activeSection, setActiveSection] = useState<AppSection>("dashboard");
  const [syncPairs, setSyncPairs] = useState<SyncPairSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formState, setFormState] = useState(initialFormState);
  const [editingSyncPairId, setEditingSyncPairId] = useState<string | null>(null);
  const [selectedSyncPairId, setSelectedSyncPairId] = useState<string | null>(null);
  const [runs, setRuns] = useState<SyncRunSummary[]>([]);
  const [runLoading, setRunLoading] = useState(false);
  const [runActionId, setRunActionId] = useState<string | null>(null);
  const [browserField, setBrowserField] = useState<BrowserField>(null);
  const [browserMode, setBrowserMode] = useState<BrowserMode>("local");
  const [browserData, setBrowserData] = useState<BrowserResponse | null>(null);
  const [browserLoading, setBrowserLoading] = useState(false);
  const [rcloneStatus, setRcloneStatus] = useState<RcloneConfigStatus | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [uploadingConfig, setUploadingConfig] = useState(false);
  const [selectedConfigFile, setSelectedConfigFile] = useState<File | null>(null);
  const [testResult, setTestResult] = useState<RcloneConfigTestResult | null>(null);

  async function checkSession() {
    try {
      const response = await apiFetch("/auth/me", { method: "GET" });
      if (response.status === 401) return void setCurrentUser(null);
      if (!response.ok) throw new Error(`Session-Pruefung fehlgeschlagen mit Status ${response.status}`);
      setCurrentUser((await response.json()) as UserSummary);
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
      if (!response.ok) throw new Error(`API antwortet mit Status ${response.status}`);
      const data = (await response.json()) as SyncPairSummary[];
      setSyncPairs(data);
      setSelectedSyncPairId((current) => current ?? data[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setLoading(false);
    }
  }

  async function loadRcloneStatus() {
    try {
      setSettingsLoading(true);
      const response = await apiFetch("/settings/rclone/status", { method: "GET" });
      if (!response.ok) throw new Error(`rclone-Status antwortet mit Status ${response.status}`);
      setRcloneStatus((await response.json()) as RcloneConfigStatus);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setSettingsLoading(false);
    }
  }

  async function loadBrowser(path: string | null, mode: BrowserMode) {
    try {
      setBrowserLoading(true);
      const params = new URLSearchParams({ backend_type: mode });
      if (path) params.set("path", path);
      const response = await apiFetch(`/browser?${params.toString()}`, { method: "GET" });
      if (!response.ok) throw new Error(`Browser antwortet mit Status ${response.status}`);
      setBrowserData((await response.json()) as BrowserResponse);
      setBrowserMode(mode);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setBrowserLoading(false);
    }
  }

  function openBrowser(field: BrowserField, mode: BrowserMode) {
    setBrowserField(field);
    void loadBrowser(field ? formState[field] || null : null, mode);
  }

  function closeBrowser() {
    setBrowserField(null);
    setBrowserData(null);
  }

  function applyBrowserPath(path: string) {
    if (!browserField) return;
    setFormState((current) => ({ ...current, [browserField]: path }));
    closeBrowser();
  }

  useEffect(() => { void checkSession(); }, []);

  useEffect(() => {
    if (!currentUser) {
      setSyncPairs([]);
      setRuns([]);
      setSelectedSyncPairId(null);
      setRcloneStatus(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    void loadSyncPairs();
    void loadRcloneStatus();
  }, [currentUser]);

  useEffect(() => {
    if (!selectedSyncPairId || !currentUser) return void setRuns([]);
    async function loadRuns() {
      try {
        setRunLoading(true);
        const response = await apiFetch(`/sync-pairs/${selectedSyncPairId}/runs`, { method: "GET" });
        if (!response.ok) throw new Error(`Run-Historie antwortet mit Status ${response.status}`);
        setRuns((await response.json()) as SyncRunSummary[]);
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
      const response = await apiFetch("/auth/login", { method: "POST", body: JSON.stringify(loginState) });
      if (!response.ok) throw new Error("Login fehlgeschlagen. Bitte Zugangsdaten pruefen.");
      setCurrentUser((await response.json()) as UserSummary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setLoginSubmitting(false);
    }
  }

  async function handleLogout() {
    try { await apiFetch("/auth/logout", { method: "POST" }); }
    finally {
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
      const isEditing = editingSyncPairId !== null;
      const response = await apiFetch(isEditing ? `/sync-pairs/${editingSyncPairId}` : "/sync-pairs", {
        method: isEditing ? "PUT" : "POST",
        body: JSON.stringify(formState),
      });
      if (!response.ok) throw new Error(`${isEditing ? "Speichern" : "Anlegen"} fehlgeschlagen mit Status ${response.status}`);
      setFormState(initialFormState);
      setEditingSyncPairId(null);
      await loadSyncPairs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setSubmitting(false);
    }
  }

  function handleEditSyncPair(pair: SyncPairSummary) {
    setEditingSyncPairId(pair.id);
    setFormState({
      name: pair.name,
      source_path: pair.source_path,
      destination_path: pair.destination_path,
      mode: pair.mode,
      direction: pair.direction,
      enabled: pair.enabled,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleCancelEdit() {
    setEditingSyncPairId(null);
    setFormState(initialFormState);
  }

  async function handleDeleteSyncPair(id: string) {
    try {
      const response = await apiFetch(`/sync-pairs/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(`Loeschen fehlgeschlagen mit Status ${response.status}`);
      if (editingSyncPairId === id) handleCancelEdit();
      setSelectedSyncPairId((current) => (current === id ? null : current));
      await loadSyncPairs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    }
  }

  async function handleToggleSyncPair(pair: SyncPairSummary) {
    try {
      const response = await apiFetch(`/sync-pairs/${pair.id}`, {
        method: "PUT",
        body: JSON.stringify({ enabled: !pair.enabled }),
      });
      if (!response.ok) throw new Error(`Aktivierung fehlgeschlagen mit Status ${response.status}`);
      if (editingSyncPairId === pair.id) {
        setFormState((current) => ({ ...current, enabled: !pair.enabled }));
      }
      await loadSyncPairs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    }
  }

  async function handleStartRun(id: string) {
    try {
      setRunActionId(id);
      const response = await apiFetch(`/sync-pairs/${id}/run`, {
        method: "POST",
        body: JSON.stringify({ trigger_type: "manual" }),
      });
      if (!response.ok) throw new Error(`Run-Start fehlgeschlagen mit Status ${response.status}`);
      setSelectedSyncPairId(id);
      await loadSyncPairs();
      const runsResponse = await apiFetch(`/sync-pairs/${id}/runs`, { method: "GET" });
      if (!runsResponse.ok) throw new Error(`Run-Historie antwortet mit Status ${runsResponse.status}`);
      setRuns((await runsResponse.json()) as SyncRunSummary[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setRunActionId(null);
    }
  }

  function handleConfigFileChange(event: ChangeEvent<HTMLInputElement>) {
    setSelectedConfigFile(event.target.files?.[0] ?? null);
  }

  async function handleRcloneUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedConfigFile) return void setError("Bitte zuerst eine rclone.conf auswaehlen.");
    try {
      setUploadingConfig(true);
      const formData = new FormData();
      formData.append("file", selectedConfigFile);
      const response = await fetch(`${apiBaseUrl}/settings/rclone/upload`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (!response.ok) throw new Error(`Upload fehlgeschlagen mit Status ${response.status}`);
      setRcloneStatus((await response.json()) as RcloneConfigStatus);
      setSelectedConfigFile(null);
      setTestResult(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setUploadingConfig(false);
    }
  }

  async function handleRcloneTest() {
    try {
      setTestLoading(true);
      const response = await apiFetch("/settings/rclone/test", {
        method: "POST",
        body: JSON.stringify({ remote_name: rcloneStatus?.remotes[0] ?? null }),
      });
      if (!response.ok) throw new Error(`rclone-Test fehlgeschlagen mit Status ${response.status}`);
      setTestResult((await response.json()) as RcloneConfigTestResult);
      await loadRcloneStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setTestLoading(false);
    }
  }

  const selectedSyncPair = syncPairs.find((pair) => pair.id === selectedSyncPairId) ?? null;

  if (sessionLoading) return <main className="page-shell"><section className="panel"><p className="state">Pruefe Anmeldung...</p></section></main>;

  if (!currentUser) {
    return (
      <main className="page-shell auth-shell">
        <section className="hero auth-hero"><div><p className="eyebrow">PCloud Sync Docker App</p><h1>Anmeldung fuer das Sync-Dashboard</h1><p className="hero-copy">Melde dich mit dem lokalen Admin-Benutzer an, um Sync-Paare und rclone zu verwalten.</p></div></section>
        <section className="panel auth-panel">
          <div className="panel-header"><div><p className="eyebrow">Login</p><h2>Zugangsdaten</h2></div></div>
          {error ? <p className="state error">Fehler: {error}</p> : null}
          <form className="sync-form" onSubmit={handleLogin}>
            <label><span>Benutzername</span><input required value={loginState.username} onChange={(event) => setLoginState((current) => ({ ...current, username: event.target.value }))} /></label>
            <label><span>Passwort</span><input required type="password" value={loginState.password} onChange={(event) => setLoginState((current) => ({ ...current, password: event.target.value }))} /></label>
            <button className="primary-button" type="submit" disabled={loginSubmitting}>{loginSubmitting ? "Melde an..." : "Anmelden"}</button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="app-layout">
      <aside className="sidebar">
        <div><p className="eyebrow">PCloud Sync</p><h1 className="sidebar-title">Admin</h1><p className="sidebar-copy">Angemeldet als {currentUser.username}</p></div>
        <nav className="sidebar-nav">
          <button className={`sidebar-link ${activeSection === "dashboard" ? "active" : ""}`} type="button" onClick={() => setActiveSection("dashboard")}>Dashboard</button>
          <button className={`sidebar-link ${activeSection === "settings" ? "active" : ""}`} type="button" onClick={() => setActiveSection("settings")}>Settings</button>
        </nav>
        <button className="table-button logout-button" type="button" onClick={handleLogout}>Logout</button>
      </aside>
      <div className="content-shell">
        {activeSection === "dashboard" ? (
          <>
            <section className="hero">
              <div>
                <p className="eyebrow">Dashboard</p>
                <h1>Sync-Dashboard fuer NAS und pCloud</h1>
                <p className="hero-copy">Hier verwaltest du Sync-Paare, startest manuelle Laeufe und beobachtest den aktuellen Zustand.</p>
                {!rcloneStatus?.exists ? <p className="state error">rclone ist noch nicht konfiguriert. Richte die Verbindung in den Settings ein.</p> : null}
              </div>
              <div className="hero-actions"><div className="hero-stat"><span>Sync-Paare</span><strong>{syncPairs.length}</strong></div></div>
            </section>

            <section className="panel form-panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">{editingSyncPairId ? "Bearbeiten" : "Neuer Eintrag"}</p>
                  <h2>{editingSyncPairId ? "Sync-Paar bearbeiten" : "Sync-Paar anlegen"}</h2>
                </div>
                {editingSyncPairId ? <button className="table-button" type="button" onClick={handleCancelEdit}>Abbrechen</button> : null}
              </div>
              <form className="sync-form" onSubmit={handleCreateSyncPair}>
                <label><span>Name</span><input required value={formState.name} onChange={(event) => setFormState((current) => ({ ...current, name: event.target.value }))} /></label>
                <label className="path-field">
                  <span>Quelle</span>
                  <div className="path-input-row">
                    <input required value={formState.source_path} onChange={(event) => setFormState((current) => ({ ...current, source_path: event.target.value }))} />
                    <button className="table-button" type="button" onClick={() => openBrowser("source_path", "local")}>Browser</button>
                  </div>
                </label>
                <label className="path-field">
                  <span>Ziel</span>
                  <div className="path-input-row">
                    <input required value={formState.destination_path} onChange={(event) => setFormState((current) => ({ ...current, destination_path: event.target.value }))} />
                    <div className="inline-actions">
                      <button className="table-button" type="button" onClick={() => openBrowser("destination_path", "local")}>Lokal</button>
                      <button className="table-button primary-inline" type="button" onClick={() => openBrowser("destination_path", "remote")}>Remote</button>
                    </div>
                  </div>
                </label>
                <label><span>Modus</span><select value={formState.mode} onChange={(event) => setFormState((current) => ({ ...current, mode: event.target.value }))}><option value="sync">sync</option><option value="copy">copy</option><option value="bisync">bisync</option></select></label>
                <label><span>Richtung</span><select value={formState.direction} onChange={(event) => setFormState((current) => ({ ...current, direction: event.target.value }))}><option value="push">push</option><option value="pull">pull</option><option value="bidirectional">bidirectional</option></select></label>
                <label className="toggle-field">
                  <span>Aktivierung</span>
                  <button
                    className={`toggle-button ${formState.enabled ? "is-enabled" : ""}`}
                    type="button"
                    aria-pressed={formState.enabled}
                    onClick={() => setFormState((current) => ({ ...current, enabled: !current.enabled }))}
                  >
                    <span className="toggle-thumb" />
                    <span>{formState.enabled ? "Aktiv" : "Deaktiviert"}</span>
                  </button>
                </label>
                <button className="primary-button" type="submit" disabled={submitting}>{submitting ? "Speichere..." : editingSyncPairId ? "Aenderungen speichern" : "Sync-Paar speichern"}</button>
              </form>
            </section>

            <section className="panel dashboard-panel">
              <div className="panel-header"><div><p className="eyebrow">Uebersicht</p><h2>Aktuelle Verbindungen</h2></div></div>
              {loading ? <p className="state">Lade Sync-Paare...</p> : null}
              {error ? <p className="state error">Fehler: {error}</p> : null}
              {!loading && !error ? (
                <div className="table-wrapper">
                  <table>
                    <thead><tr><th>Name</th><th>Quelle</th><th>Ziel</th><th>Modus</th><th>Richtung</th><th>Status</th><th>Letzter Lauf</th><th>Aktiv</th><th>Aktion</th></tr></thead>
                    <tbody>
                      {syncPairs.map((pair) => (
                        <tr key={pair.id}>
                          <td>{pair.name}</td><td>{pair.source_path}</td><td>{pair.destination_path}</td><td>{pair.mode}</td><td>{pair.direction}</td>
                          <td><span className={`badge ${pair.status}`}>{pair.status}</span></td>
                          <td>{pair.last_status}</td>
                          <td><span className={`badge ${pair.enabled ? "success" : "muted"}`}>{pair.enabled ? "aktiv" : "deaktiviert"}</span></td>
                          <td>
                            <div className="action-stack">
                              <button className="table-button" type="button" onClick={() => setSelectedSyncPairId(pair.id)}>Details</button>
                              <button className="table-button" type="button" onClick={() => handleEditSyncPair(pair)}>Bearbeiten</button>
                              <button className="table-button" type="button" onClick={() => void handleToggleSyncPair(pair)}>{pair.enabled ? "Deaktivieren" : "Aktivieren"}</button>
                              <button className="table-button primary-inline" type="button" disabled={runActionId === pair.id || !pair.enabled} onClick={() => void handleStartRun(pair.id)}>{runActionId === pair.id ? "Laeuft..." : "Run now"}</button>
                              <button className="table-button" type="button" onClick={() => void handleDeleteSyncPair(pair.id)}>Loeschen</button>
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
              <div className="panel-header"><div><p className="eyebrow">Run-Historie</p><h2>{selectedSyncPair ? selectedSyncPair.name : "Noch kein Sync-Paar ausgewaehlt"}</h2></div></div>
              {!selectedSyncPair ? <p className="state">Waehle oben ein Sync-Paar aus.</p> : null}
              {selectedSyncPair && runLoading ? <p className="state">Lade letzte Laeufe...</p> : null}
              {selectedSyncPair && !runLoading && runs.length === 0 ? <p className="state">Fuer dieses Sync-Paar gibt es noch keine Laeufe.</p> : null}
              {selectedSyncPair && runs.length > 0 ? (
                <div className="run-list">
                  {runs.map((run) => (
                    <article className="run-card" key={run.id}>
                      <div className="run-card-header"><span className={`badge ${run.status}`}>{run.status}</span><strong>{new Date(run.started_at).toLocaleString("de-DE")}</strong></div>
                      <p>{run.short_log}</p>
                      <dl className="run-metrics">
                        <div><dt>Dateien</dt><dd>{run.files_transferred}</dd></div>
                        <div><dt>Bytes</dt><dd>{run.bytes_transferred}</dd></div>
                        <div><dt>Dauer</dt><dd>{run.duration_seconds}s</dd></div>
                        <div><dt>Exit-Code</dt><dd>{run.exit_code ?? "-"}</dd></div>
                      </dl>
                    </article>
                  ))}
                </div>
              ) : null}
            </section>
          </>
        ) : (
          <>
            <section className="hero">
              <div>
                <p className="eyebrow">Settings</p>
                <h1>rclone und Systemkonfiguration</h1>
                <p className="hero-copy">Hier richtest du die `rclone.conf` fuer pCloud ein, pruefst die Verbindung und verwaltest die technischen Grundlagen des Systems.</p>
              </div>
            </section>

            <section className="panel">
              <div className="panel-header"><div><p className="eyebrow">rclone</p><h2>Konfigurationsstatus</h2></div><button className="table-button" type="button" onClick={() => void loadRcloneStatus()}>Aktualisieren</button></div>
              {settingsLoading ? <p className="state">Lade rclone-Status...</p> : null}
              {error ? <p className="state error">Fehler: {error}</p> : null}
              {rcloneStatus ? (
                <>
                  <div className="settings-grid">
                    <article className="settings-card"><span className={`badge ${rcloneStatus.exists ? "idle" : "error"}`}>{rcloneStatus.exists ? "vorhanden" : "fehlt"}</span><h3>Konfigurationsdatei</h3><p>{rcloneStatus.config_path}</p></article>
                    <article className="settings-card"><span className={`badge ${rcloneStatus.is_valid ? "idle" : "error"}`}>{rcloneStatus.is_valid ? "gueltig" : "ungueltig"}</span><h3>Erkannte Remotes</h3><p>{rcloneStatus.remotes.length > 0 ? rcloneStatus.remotes.join(", ") : "Keine"}</p></article>
                    <article className="settings-card"><span className="badge idle">Info</span><h3>Datei</h3><p>{rcloneStatus.file_size ? `${rcloneStatus.file_size} Bytes` : "Keine Dateigroesse"}</p><p>{rcloneStatus.updated_at ? new Date(rcloneStatus.updated_at).toLocaleString("de-DE") : "Noch nie aktualisiert"}</p></article>
                  </div>
                  <p className="state">{rcloneStatus.detail}</p>
                </>
              ) : null}
            </section>

            <section className="panel">
              <div className="panel-header"><div><p className="eyebrow">Upload</p><h2>rclone.conf hochladen</h2></div></div>
              <form className="settings-form" onSubmit={handleRcloneUpload}>
                <label><span>Konfigurationsdatei</span><input type="file" accept=".conf" onChange={handleConfigFileChange} /></label>
                <button className="primary-button" type="submit" disabled={uploadingConfig}>{uploadingConfig ? "Lade hoch..." : "rclone.conf hochladen"}</button>
              </form>
            </section>

            <section className="panel">
              <div className="panel-header"><div><p className="eyebrow">Verbindungstest</p><h2>Erkannten Remote pruefen</h2></div></div>
              <div className="inline-actions">
                <button className="primary-button" type="button" disabled={testLoading || !rcloneStatus?.remotes.length} onClick={() => void handleRcloneTest()}>{testLoading ? "Teste..." : "Remote testen"}</button>
                <span className="settings-note">{rcloneStatus?.remotes.length ? `Testet standardmaessig ${rcloneStatus.remotes[0]}` : "Zuerst eine gueltige rclone.conf hochladen"}</span>
              </div>
              {testResult ? <p className={`state ${testResult.ok ? "" : "error"}`}>{testResult.detail}</p> : null}
            </section>
          </>
        )}

        {browserField ? (
          <div className="browser-overlay" role="dialog" aria-modal="true">
            <section className="browser-panel">
              <div className="panel-header">
                <div><p className="eyebrow">Pfadbrowser</p><h2>{browserField === "source_path" ? "Quelle waehlen" : "Ziel waehlen"}</h2></div>
                <button className="table-button" type="button" onClick={closeBrowser}>Schliessen</button>
              </div>
              <div className="browser-toolbar">
                <span className="browser-path">{browserData?.current_path || (browserMode === "remote" ? "pcloud:" : "Wurzeln")}</span>
                <div className="inline-actions">
                  <button className="table-button" type="button" disabled={browserMode === "local"} onClick={() => void loadBrowser(null, "local")}>Lokal</button>
                  <button className="table-button primary-inline" type="button" disabled={browserMode === "remote"} onClick={() => void loadBrowser(null, "remote")}>Remote</button>
                  <button className="table-button" type="button" disabled={!browserData?.parent_path} onClick={() => void loadBrowser(browserData?.parent_path ?? null, browserMode)}>Hoch</button>
                </div>
              </div>
              {browserLoading ? <p className="state">Lade Ordner...</p> : null}
              {!browserLoading && browserData?.entries.length === 0 ? <p className="state">Keine Unterordner gefunden.</p> : null}
              <div className="browser-list">
                {browserData?.entries.map((entry) => (
                  <article className="browser-entry" key={entry.path}>
                    <div><strong>{entry.name}</strong><p>{entry.path}</p></div>
                    <div className="inline-actions">
                      <button className="table-button" type="button" onClick={() => void loadBrowser(entry.path, browserMode)}>Oeffnen</button>
                      <button className="table-button primary-inline" type="button" onClick={() => applyBrowserPath(entry.path)}>Auswaehlen</button>
                    </div>
                  </article>
                ))}
              </div>
              <div className="browser-footer">
                <button className="primary-button" type="button" onClick={() => applyBrowserPath(browserData?.current_path || "")} disabled={!browserData?.current_path}>Aktuellen Pfad uebernehmen</button>
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </main>
  );
}
