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
  schedule_enabled: boolean;
  schedule_type: string;
  schedule_interval_minutes: number;
  schedule_time: string | null;
  schedule_weekday: number | null;
  next_run_at: string | null;
  last_run_at: string | null;
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
  report: string;
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
type RunLogResponse = { log: string };
type BrowserField = "source_path" | "destination_path" | null;
type BrowserMode = "local" | "remote";
type AppSection = "dashboard" | "settings";

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "/api").replace(/\/$/, "");
const weekdayOptions = [
  { value: 0, label: "Montag" },
  { value: 1, label: "Dienstag" },
  { value: 2, label: "Mittwoch" },
  { value: 3, label: "Donnerstag" },
  { value: 4, label: "Freitag" },
  { value: 5, label: "Samstag" },
  { value: 6, label: "Sonntag" },
];
const initialFormState = {
  name: "",
  source_path: "",
  destination_path: "",
  mode: "sync",
  direction: "push",
  schedule_enabled: true,
  schedule_type: "daily",
  schedule_interval_minutes: 1440,
  schedule_time: "02:00",
  schedule_weekday: 0,
};
const initialLoginState = { username: "admin", password: "change-me-now" };

async function apiFetch(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  const hasBody = init?.body !== undefined && init?.body !== null;
  if (hasBody && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(`${apiBaseUrl}${path}`, { credentials: "include", ...init, headers });
}

function formatBytes(value: number) {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let current = value;
  let index = 0;
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index += 1;
  }
  return `${current.toFixed(current >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDateTime(value: string | null) {
  if (!value) return "Nicht geplant";
  return new Date(value).toLocaleString("de-DE");
}

function describeSchedule(pair: Pick<SyncPairSummary, "schedule_enabled" | "schedule_type" | "schedule_interval_minutes" | "schedule_time" | "schedule_weekday">) {
  if (!pair.schedule_enabled) return "Nur manuell";
  if (pair.schedule_type === "interval") return `Alle ${pair.schedule_interval_minutes} Minuten`;
  if (pair.schedule_type === "hourly") return `Stuendlich um Minute ${pair.schedule_time?.split(":")[1] ?? "00"}`;
  if (pair.schedule_type === "weekly") {
    const weekday = weekdayOptions.find((item) => item.value === pair.schedule_weekday)?.label ?? "Montag";
    return `Woechentlich ${weekday}, ${pair.schedule_time ?? "00:00"} Uhr`;
  }
  return `Taeglich um ${pair.schedule_time ?? "00:00"} Uhr`;
}

export function App() {
  const [currentUser, setCurrentUser] = useState<UserSummary | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [loginSubmitting, setLoginSubmitting] = useState(false);
  const [loginState, setLoginState] = useState(initialLoginState);
  const [activeSection, setActiveSection] = useState<AppSection>("dashboard");
  const [syncPairs, setSyncPairs] = useState<SyncPairSummary[]>([]);
  const [recentRuns, setRecentRuns] = useState<SyncRunSummary[]>([]);
  const [runs, setRuns] = useState<SyncRunSummary[]>([]);
  const [selectedSyncPairId, setSelectedSyncPairId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedRunLog, setSelectedRunLog] = useState<string>("");
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [runLoading, setRunLoading] = useState(false);
  const [runActionId, setRunActionId] = useState<string | null>(null);
  const [runLogLoading, setRunLogLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [formState, setFormState] = useState(initialFormState);
  const [scheduleEditState, setScheduleEditState] = useState({
    schedule_enabled: true,
    schedule_type: "daily",
    schedule_interval_minutes: 1440,
    schedule_time: "02:00",
    schedule_weekday: 0,
  });
  const [browserField, setBrowserField] = useState<BrowserField>(null);
  const [browserMode, setBrowserMode] = useState<BrowserMode>("local");
  const [browserData, setBrowserData] = useState<BrowserResponse | null>(null);
  const [browserLoading, setBrowserLoading] = useState(false);
  const [newDirectoryName, setNewDirectoryName] = useState("");
  const [creatingDirectory, setCreatingDirectory] = useState(false);
  const [rcloneStatus, setRcloneStatus] = useState<RcloneConfigStatus | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [uploadingConfig, setUploadingConfig] = useState(false);
  const [selectedConfigFile, setSelectedConfigFile] = useState<File | null>(null);
  const [testResult, setTestResult] = useState<RcloneConfigTestResult | null>(null);

  const selectedSyncPair = syncPairs.find((pair) => pair.id === selectedSyncPairId) ?? null;
  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? null;
  const successfulRuns = recentRuns.filter((run) => run.status === "success").length;
  const totalBytes = recentRuns.reduce((sum, run) => sum + run.bytes_transferred, 0);
  const totalFiles = recentRuns.reduce((sum, run) => sum + run.files_transferred, 0);

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
    const response = await apiFetch("/sync-pairs", { method: "GET" });
    if (!response.ok) throw new Error(`Sync-Paare laden fehlgeschlagen mit Status ${response.status}`);
    const data = (await response.json()) as SyncPairSummary[];
    setSyncPairs(data);
    setSelectedSyncPairId((current) => data.some((pair) => pair.id === current) ? current : (data[0]?.id ?? null));
  }

  async function loadRecentRuns() {
    const response = await apiFetch("/runs?limit=24", { method: "GET" });
    if (!response.ok) throw new Error(`Runs laden fehlgeschlagen mit Status ${response.status}`);
    setRecentRuns((await response.json()) as SyncRunSummary[]);
  }

  async function loadDashboardData() {
    try {
      setDashboardLoading(true);
      setError(null);
      await Promise.all([loadSyncPairs(), loadRecentRuns(), loadRcloneStatus()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setDashboardLoading(false);
    }
  }

  async function loadRuns(syncPairId: string) {
    try {
      setRunLoading(true);
      const response = await apiFetch(`/sync-pairs/${syncPairId}/runs`, { method: "GET" });
      if (!response.ok) throw new Error(`Run-Historie antwortet mit Status ${response.status}`);
      const data = (await response.json()) as SyncRunSummary[];
      setRuns(data);
      setSelectedRunId((current) => data.some((run) => run.id === current) ? current : (data[0]?.id ?? null));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setRunLoading(false);
    }
  }

  async function loadRunLog(runId: string) {
    try {
      setRunLogLoading(true);
      const response = await apiFetch(`/runs/${runId}/log`, { method: "GET" });
      if (!response.ok) throw new Error(`Run-Bericht antwortet mit Status ${response.status}`);
      setSelectedRunLog(((await response.json()) as RunLogResponse).log);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
      setSelectedRunLog("");
    } finally {
      setRunLogLoading(false);
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
      setError(null);
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
    setNewDirectoryName("");
    void loadBrowser(field ? formState[field] || null : null, mode);
  }

  function closeBrowser() {
    setBrowserField(null);
    setBrowserData(null);
    setNewDirectoryName("");
  }

  function applyBrowserPath(path: string) {
    if (!browserField) return;
    setFormState((current) => ({ ...current, [browserField]: path }));
    closeBrowser();
  }

  async function handleCreateDirectory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newDirectoryName.trim()) return;
    try {
      setCreatingDirectory(true);
      const response = await apiFetch("/browser/directories", {
        method: "POST",
        body: JSON.stringify({
          path: browserData?.current_path || null,
          backend_type: browserMode,
          directory_name: newDirectoryName,
        }),
      });
      if (!response.ok) throw new Error(`Ordner anlegen fehlgeschlagen mit Status ${response.status}`);
      setBrowserData((await response.json()) as BrowserResponse);
      setNewDirectoryName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setCreatingDirectory(false);
    }
  }

  useEffect(() => { void checkSession(); }, []);

  useEffect(() => {
    if (!currentUser) {
      setSyncPairs([]);
      setRecentRuns([]);
      setRuns([]);
      setSelectedSyncPairId(null);
      setSelectedRunId(null);
      setSelectedRunLog("");
      setDashboardLoading(false);
      return;
    }
    void loadDashboardData();
  }, [currentUser]);

  useEffect(() => {
    if (!selectedSyncPairId || !currentUser) return void setRuns([]);
    void loadRuns(selectedSyncPairId);
  }, [selectedSyncPairId, currentUser]);

  useEffect(() => {
    if (!selectedSyncPair) return;
    setScheduleEditState({
      schedule_enabled: selectedSyncPair.schedule_enabled,
      schedule_type: selectedSyncPair.schedule_type,
      schedule_interval_minutes: selectedSyncPair.schedule_interval_minutes,
      schedule_time: selectedSyncPair.schedule_time ?? "02:00",
      schedule_weekday: selectedSyncPair.schedule_weekday ?? 0,
    });
  }, [selectedSyncPair]);

  useEffect(() => {
    if (!selectedRunId) {
      setSelectedRunLog("");
      return;
    }
    void loadRunLog(selectedRunId);
  }, [selectedRunId]);

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
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } finally {
      setCurrentUser(null);
      setSyncPairs([]);
      setRecentRuns([]);
      setRuns([]);
      setSelectedSyncPairId(null);
      setSelectedRunId(null);
    }
  }

  async function handleCreateSyncPair(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await apiFetch("/sync-pairs", { method: "POST", body: JSON.stringify(formState) });
      if (!response.ok) throw new Error(`Anlegen fehlgeschlagen mit Status ${response.status}`);
      setFormState(initialFormState);
      setCreateOpen(false);
      await loadDashboardData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteSyncPair(id: string) {
    try {
      const response = await apiFetch(`/sync-pairs/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(`Loeschen fehlgeschlagen mit Status ${response.status}`);
      setSelectedSyncPairId((current) => (current === id ? null : current));
      await loadDashboardData();
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
      await loadDashboardData();
      await loadRuns(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setRunActionId(null);
    }
  }

  async function handleUpdateSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedSyncPair) return;
    try {
      setSubmitting(true);
      const response = await apiFetch(`/sync-pairs/${selectedSyncPair.id}`, {
        method: "PUT",
        body: JSON.stringify(scheduleEditState),
      });
      if (!response.ok) throw new Error(`Zeitplan speichern fehlgeschlagen mit Status ${response.status}`);
      await loadDashboardData();
      await loadRuns(selectedSyncPair.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setSubmitting(false);
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

  if (sessionLoading) {
    return <main className="page-shell"><section className="panel"><p className="state">Pruefe Anmeldung...</p></section></main>;
  }

  if (!currentUser) {
    return (
      <main className="page-shell auth-shell">
        <section className="hero auth-hero">
          <div>
            <p className="eyebrow">PCloud Sync Docker App</p>
            <h1>Anmeldung fuer das Sync-Dashboard</h1>
            <p className="hero-copy">Melde dich mit dem lokalen Admin-Benutzer an, um Sync-Paare, Reports und Zeitplaene zu verwalten.</p>
          </div>
        </section>
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
        <div>
          <p className="eyebrow">PCloud Sync</p>
          <h1 className="sidebar-title">Admin</h1>
          <p className="sidebar-copy">Angemeldet als {currentUser.username}</p>
        </div>
        <nav className="sidebar-nav">
          <button className={`sidebar-link ${activeSection === "dashboard" ? "active" : ""}`} type="button" onClick={() => setActiveSection("dashboard")}>Dashboard</button>
          <button className={`sidebar-link ${activeSection === "settings" ? "active" : ""}`} type="button" onClick={() => setActiveSection("settings")}>Settings</button>
        </nav>
        <button className="table-button logout-button" type="button" onClick={handleLogout}>Logout</button>
      </aside>

      <div className="content-shell">
        {activeSection === "dashboard" ? (
          <>
            <section className="hero hero-rich">
              <div>
                <p className="eyebrow">Dashboard</p>
                <h1>Sync-Zentrale fuer NAS und pCloud</h1>
                <p className="hero-copy">Hier siehst du, was zuletzt passiert ist, planst automatische Laeufe und oeffnest Berichte pro Sync.</p>
                {!rcloneStatus?.exists ? <p className="state error">rclone ist noch nicht konfiguriert. Richte die Verbindung in den Settings ein.</p> : null}
              </div>
              <div className="hero-actions">
                <button className="primary-button" type="button" onClick={() => setCreateOpen((current) => !current)}>{createOpen ? "Dialog schliessen" : "Neuen Sync anlegen"}</button>
              </div>
            </section>

            <section className="stats-grid">
              <article className="stat-card accent-blue"><span>Sync-Paare</span><strong>{syncPairs.length}</strong><p>Aktive Verbindungen im System</p></article>
              <article className="stat-card accent-gold"><span>Erfolgreiche Laeufe</span><strong>{successfulRuns}</strong><p>Aus den letzten {recentRuns.length} Runs</p></article>
              <article className="stat-card accent-green"><span>Transfer-Volumen</span><strong>{formatBytes(totalBytes)}</strong><p>Gesamt ueber die letzte Run-Serie</p></article>
              <article className="stat-card accent-slate"><span>Dateien bewegt</span><strong>{totalFiles}</strong><p>Transferierte Dateien aus Reports</p></article>
            </section>

            {createOpen ? (
              <section className="panel form-panel">
                <div className="panel-header"><div><p className="eyebrow">Neuer Eintrag</p><h2>Sync-Paar anlegen</h2></div></div>
                <form className="sync-form" onSubmit={handleCreateSyncPair}>
                  <label><span>Name</span><input required value={formState.name} onChange={(event) => setFormState((current) => ({ ...current, name: event.target.value }))} /></label>
                  <label><span>Modus</span><select value={formState.mode} onChange={(event) => setFormState((current) => ({ ...current, mode: event.target.value }))}><option value="sync">sync</option><option value="copy">copy</option><option value="bisync">bisync</option></select></label>
                  <label className="path-field">
                    <span>Quelle</span>
                    <div className="path-input-row">
                      <input required value={formState.source_path} onChange={(event) => setFormState((current) => ({ ...current, source_path: event.target.value }))} />
                      <button className="table-button" type="button" onClick={() => openBrowser("source_path", "local")}>Ordner waehlen</button>
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
                  <label><span>Richtung</span><select value={formState.direction} onChange={(event) => setFormState((current) => ({ ...current, direction: event.target.value }))}><option value="push">push</option><option value="pull">pull</option><option value="bidirectional">bidirectional</option></select></label>
                  <label className="schedule-toggle"><span>Zeitplan aktiv</span><input type="checkbox" checked={formState.schedule_enabled} onChange={(event) => setFormState((current) => ({ ...current, schedule_enabled: event.target.checked }))} /></label>
                  <label><span>Intervall</span><select value={formState.schedule_type} onChange={(event) => setFormState((current) => ({ ...current, schedule_type: event.target.value }))}><option value="daily">Taeglich</option><option value="weekly">Woechentlich</option><option value="hourly">Stuendlich</option><option value="interval">Alle X Minuten</option></select></label>
                  {formState.schedule_type === "interval" ? (
                    <label><span>Minuten</span><input min={5} step={5} type="number" value={formState.schedule_interval_minutes} onChange={(event) => setFormState((current) => ({ ...current, schedule_interval_minutes: Number(event.target.value) }))} /></label>
                  ) : (
                    <label><span>Uhrzeit</span><input type="time" value={formState.schedule_time} onChange={(event) => setFormState((current) => ({ ...current, schedule_time: event.target.value }))} /></label>
                  )}
                  {formState.schedule_type === "weekly" ? (
                    <label><span>Wochentag</span><select value={formState.schedule_weekday} onChange={(event) => setFormState((current) => ({ ...current, schedule_weekday: Number(event.target.value) }))}>{weekdayOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                  ) : null}
                  <button className="primary-button" type="submit" disabled={submitting}>{submitting ? "Speichere..." : "Sync speichern"}</button>
                </form>
              </section>
            ) : null}

            {error ? <p className="state error">Fehler: {error}</p> : null}

            <section className="panel dashboard-panel">
              <div className="panel-header"><div><p className="eyebrow">Uebersicht</p><h2>Deine Syncs</h2></div></div>
              {dashboardLoading ? <p className="state">Lade Dashboard...</p> : null}
              {!dashboardLoading ? (
                <div className="sync-grid">
                  {syncPairs.map((pair) => (
                    <article className={`sync-card ${selectedSyncPairId === pair.id ? "selected" : ""}`} key={pair.id}>
                      <div className="sync-card-header">
                        <div>
                          <h3>{pair.name}</h3>
                          <p>{describeSchedule(pair)}</p>
                        </div>
                        <span className={`badge ${pair.last_status === "success" ? "idle" : pair.last_status === "error" ? "error" : "running"}`}>{pair.last_status}</span>
                      </div>
                      <dl className="sync-card-meta">
                        <div><dt>Quelle</dt><dd>{pair.source_path}</dd></div>
                        <div><dt>Ziel</dt><dd>{pair.destination_path}</dd></div>
                        <div><dt>Naechster Lauf</dt><dd>{formatDateTime(pair.next_run_at)}</dd></div>
                        <div><dt>Letzter Lauf</dt><dd>{formatDateTime(pair.last_run_at)}</dd></div>
                      </dl>
                      <div className="action-stack">
                        <button className="table-button" type="button" onClick={() => setSelectedSyncPairId(pair.id)}>Berichte</button>
                        <button className="table-button primary-inline" type="button" disabled={runActionId === pair.id} onClick={() => void handleStartRun(pair.id)}>{runActionId === pair.id ? "Laeuft..." : "Jetzt starten"}</button>
                        <button className="table-button" type="button" onClick={() => void handleDeleteSyncPair(pair.id)}>Loeschen</button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : null}
            </section>

            <section className="dashboard-split">
              <section className="panel">
                <div className="panel-header"><div><p className="eyebrow">Zeitplan</p><h2>{selectedSyncPair ? `Zeitplan fuer ${selectedSyncPair.name}` : "Kein Sync ausgewaehlt"}</h2></div></div>
                {!selectedSyncPair ? <p className="state">Waehle oben ein Sync-Paar aus, um den Zeitplan zu bearbeiten.</p> : null}
                {selectedSyncPair ? (
                  <form className="sync-form compact-form" onSubmit={handleUpdateSchedule}>
                    <label className="schedule-toggle"><span>Zeitplan aktiv</span><input type="checkbox" checked={scheduleEditState.schedule_enabled} onChange={(event) => setScheduleEditState((current) => ({ ...current, schedule_enabled: event.target.checked }))} /></label>
                    <label><span>Intervall</span><select value={scheduleEditState.schedule_type} onChange={(event) => setScheduleEditState((current) => ({ ...current, schedule_type: event.target.value }))}><option value="daily">Taeglich</option><option value="weekly">Woechentlich</option><option value="hourly">Stuendlich</option><option value="interval">Alle X Minuten</option></select></label>
                    {scheduleEditState.schedule_type === "interval" ? (
                      <label><span>Minuten</span><input min={5} step={5} type="number" value={scheduleEditState.schedule_interval_minutes} onChange={(event) => setScheduleEditState((current) => ({ ...current, schedule_interval_minutes: Number(event.target.value) }))} /></label>
                    ) : (
                      <label><span>Uhrzeit</span><input type="time" value={scheduleEditState.schedule_time} onChange={(event) => setScheduleEditState((current) => ({ ...current, schedule_time: event.target.value }))} /></label>
                    )}
                    {scheduleEditState.schedule_type === "weekly" ? (
                      <label><span>Wochentag</span><select value={scheduleEditState.schedule_weekday} onChange={(event) => setScheduleEditState((current) => ({ ...current, schedule_weekday: Number(event.target.value) }))}>{weekdayOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                    ) : null}
                    <button className="primary-button" type="submit" disabled={submitting}>{submitting ? "Speichere..." : "Zeitplan speichern"}</button>
                  </form>
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
                      <button className={`run-card ${selectedRunId === run.id ? "selected" : ""}`} key={run.id} type="button" onClick={() => setSelectedRunId(run.id)}>
                        <div className="run-card-header">
                          <span className={`badge ${run.status}`}>{run.status}</span>
                          <strong>{formatDateTime(run.started_at)}</strong>
                        </div>
                        <p>{run.short_log}</p>
                        <dl className="run-metrics">
                          <div><dt>Trigger</dt><dd>{run.trigger_type}</dd></div>
                          <div><dt>Dateien</dt><dd>{run.files_transferred}</dd></div>
                          <div><dt>Bytes</dt><dd>{formatBytes(run.bytes_transferred)}</dd></div>
                          <div><dt>Dauer</dt><dd>{run.duration_seconds}s</dd></div>
                        </dl>
                      </button>
                    ))}
                  </div>
                ) : null}
              </section>

              <section className="panel report-panel">
                <div className="panel-header"><div><p className="eyebrow">Bericht</p><h2>{selectedRun ? "Laufdetails" : "Kein Lauf ausgewaehlt"}</h2></div></div>
                {!selectedRun ? <p className="state">Waehle links einen Lauf aus, um den Bericht anzuzeigen.</p> : null}
                {selectedRun ? (
                  <>
                    <div className="report-summary">
                      <article className="report-highlight"><span>Status</span><strong>{selectedRun.status}</strong></article>
                      <article className="report-highlight"><span>Trigger</span><strong>{selectedRun.trigger_type}</strong></article>
                      <article className="report-highlight"><span>Exit-Code</span><strong>{selectedRun.exit_code ?? "-"}</strong></article>
                      <article className="report-highlight"><span>Geloeschte Dateien</span><strong>{selectedRun.files_deleted}</strong></article>
                    </div>
                    <p className="report-copy">{selectedRun.report}</p>
                    <div className="report-detail-grid">
                      <article className="report-block"><h3>Kennzahlen</h3><p>Dateien: {selectedRun.files_transferred}</p><p>Datenmenge: {formatBytes(selectedRun.bytes_transferred)}</p><p>Fehler: {selectedRun.error_count}</p><p>Gestartet: {formatDateTime(selectedRun.started_at)}</p><p>Beendet: {formatDateTime(selectedRun.finished_at)}</p></article>
                      <article className="report-block"><h3>Kommando</h3><code>{selectedRun.rclone_command}</code></article>
                    </div>
                    <article className="report-block">
                      <h3>Vollstaendiges Log</h3>
                      {runLogLoading ? <p className="state">Lade Log...</p> : <pre className="log-output">{selectedRunLog || "Kein Log verfuegbar."}</pre>}
                    </article>
                  </>
                ) : null}
              </section>
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
                <div><p className="eyebrow">Dateibrowser</p><h2>{browserField === "source_path" ? "Quellordner waehlen" : "Zielordner waehlen"}</h2></div>
                <button className="table-button" type="button" onClick={closeBrowser}>Schliessen</button>
              </div>

              <div className="browser-topbar">
                <div className="browser-location">
                  <span className="browser-chip">{browserMode === "remote" ? "Remote" : "Lokal"}</span>
                  <strong>{browserData?.current_path || (browserMode === "remote" ? "pcloud:" : "Wurzeln")}</strong>
                </div>
                <div className="inline-actions">
                  <button className="table-button" type="button" disabled={browserMode === "local"} onClick={() => void loadBrowser(null, "local")}>Lokal</button>
                  <button className="table-button primary-inline" type="button" disabled={browserMode === "remote"} onClick={() => void loadBrowser(null, "remote")}>Remote</button>
                  <button className="table-button" type="button" disabled={!browserData?.parent_path} onClick={() => void loadBrowser(browserData?.parent_path ?? null, browserMode)}>Eine Ebene hoch</button>
                </div>
              </div>

              <form className="browser-create-row" onSubmit={handleCreateDirectory}>
                <input placeholder="Neuen Zielordner anlegen" value={newDirectoryName} onChange={(event) => setNewDirectoryName(event.target.value)} />
                <button className="primary-button" type="submit" disabled={creatingDirectory || !newDirectoryName.trim()}>{creatingDirectory ? "Lege an..." : "Ordner anlegen"}</button>
              </form>

              {browserLoading ? <p className="state">Lade Ordner...</p> : null}
              {!browserLoading && browserData?.entries.length === 0 ? <p className="state">Keine Unterordner gefunden.</p> : null}

              <div className="browser-shell">
                <div className="browser-column">
                  <div className="browser-column-header"><span>Name</span><span>Pfad</span><span>Aktion</span></div>
                  <div className="browser-list file-browser">
                    {browserData?.entries.map((entry) => (
                      <article className="browser-entry" key={entry.path}>
                        <div className="browser-entry-main">
                          <span className="folder-icon">DIR</span>
                          <div>
                            <strong>{entry.name}</strong>
                            <p>{entry.path}</p>
                          </div>
                        </div>
                        <div className="inline-actions">
                          <button className="table-button" type="button" onClick={() => void loadBrowser(entry.path, browserMode)}>Oeffnen</button>
                          <button className="table-button primary-inline" type="button" onClick={() => applyBrowserPath(entry.path)}>Auswaehlen</button>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              </div>

              <div className="browser-footer">
                <button className="primary-button" type="button" onClick={() => applyBrowserPath(browserData?.current_path || "")} disabled={!browserData?.current_path}>Aktuellen Ordner uebernehmen</button>
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </main>
  );
}
