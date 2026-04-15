import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import packageJson from "../package.json";

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
  max_delete_count: number;
  backup_dir: string | null;
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
  average_speed_bytes_per_second: number;
  exit_code: number | null;
  short_log: string;
  report: string;
  full_log_path: string | null;
  rclone_command: string;
  created_at: string;
};
type SyncRunProgressPoint = {
  timestamp: string;
  speed_bytes_per_second: number;
  bytes_transferred: number;
  percent_complete: number | null;
};
type SyncRunProgressStatus = {
  run_id: string;
  status: string;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
  bytes_transferred: number;
  total_bytes: number | null;
  files_transferred: number;
  total_files: number | null;
  average_speed_bytes_per_second: number;
  eta_seconds: number | null;
  estimated_completion_at: string | null;
  percent_complete: number | null;
  history: SyncRunProgressPoint[];
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
type TelegramSettingsStatus = {
  enabled: boolean;
  bot_token_configured: boolean;
  chat_id: string | null;
  notify_on_success: boolean;
  notify_on_error: boolean;
  detail: string;
};
type TelegramTestResult = { ok: boolean; detail: string };
type RunLogResponse = { log: string };
type UserAdminSummary = { username: string; role: string; is_active: boolean; created_at: string };
type BrowserField = "source_path" | "destination_path" | null;
type BrowserMode = "local" | "remote";
type AppSection = "dashboard" | "sync-targets" | "users" | "settings";
type ThemeMode = "light" | "dark";

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
  enabled: true,
  schedule_enabled: true,
  schedule_type: "daily",
  schedule_interval_minutes: 1440,
  schedule_time: "02:00",
  schedule_weekday: 0,
  max_delete_count: 25,
  backup_dir: "",
};
const initialLoginState = { username: "admin", password: "change-me-now" };
const initialUserFormState = { username: "", password: "", role: "admin", is_active: true };
const initialPasswordResetState = { username: "", password: "" };
const initialTelegramFormState = {
  enabled: false,
  bot_token: "",
  chat_id: "",
  notify_on_success: false,
  notify_on_error: true,
};
const appVersion = packageJson.version;

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

function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${remainingSeconds}s`;
  return `${minutes}m ${remainingSeconds}s`;
}

function formatPercent(value: number | null) {
  if (value === null || Number.isNaN(value)) return "Wird berechnet";
  return `${value.toFixed(0)}%`;
}

function buildSpeedPolyline(points: SyncRunProgressPoint[]) {
  if (points.length === 0) return "";
  const maxSpeed = Math.max(...points.map((point) => point.speed_bytes_per_second), 1);
  return points
    .map((point, index) => {
      const x = points.length === 1 ? 0 : (index / (points.length - 1)) * 100;
      const y = 100 - (point.speed_bytes_per_second / maxSpeed) * 100;
      return `${x},${y}`;
    })
    .join(" ");
}

function describeSchedule(pair: Pick<SyncPairSummary, "schedule_enabled" | "schedule_type" | "schedule_interval_minutes" | "schedule_time" | "schedule_weekday">) {
  if (!pair.schedule_enabled) return "Nur manuell";
  if (pair.schedule_type === "interval") return `Alle ${pair.schedule_interval_minutes} Minuten`;
  if (pair.schedule_type === "hourly") return `Stündlich um Minute ${pair.schedule_time?.split(":")[1] ?? "00"}`;
  if (pair.schedule_type === "weekly") {
    const weekday = weekdayOptions.find((item) => item.value === pair.schedule_weekday)?.label ?? "Montag";
    return `Wöchentlich ${weekday}, ${pair.schedule_time ?? "00:00"} Uhr`;
  }
  return `Täglich um ${pair.schedule_time ?? "00:00"} Uhr`;
}

function extractRemoteName(path: string): string {
  const colonIndex = path.indexOf(":");
  if (colonIndex > 0 && !path.startsWith("/")) return path.substring(0, colonIndex);
  return "Lokal";
}

function buildDailyTransferData(allRuns: SyncRunSummary[], days: number = 14): { label: string; bytes: number }[] {
  const result: { label: string; bytes: number }[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(now);
    day.setDate(day.getDate() - i);
    const dayStr = day.toISOString().slice(0, 10);
    const dayLabel = day.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
    const dayBytes = allRuns
      .filter((run) => run.started_at?.slice(0, 10) === dayStr && run.status !== "running")
      .reduce((sum, run) => sum + run.bytes_transferred, 0);
    result.push({ label: dayLabel, bytes: dayBytes });
  }
  return result;
}

export function App() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") return "light";
    return window.localStorage.getItem("theme-mode") === "dark" ? "dark" : "light";
  });
  const [currentUser, setCurrentUser] = useState<UserSummary | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [loginSubmitting, setLoginSubmitting] = useState(false);
  const [loginState, setLoginState] = useState(initialLoginState);
  const [activeSection, setActiveSection] = useState<AppSection>("dashboard");
  const [users, setUsers] = useState<UserAdminSummary[]>([]);
  const [syncPairs, setSyncPairs] = useState<SyncPairSummary[]>([]);
  const [recentRuns, setRecentRuns] = useState<SyncRunSummary[]>([]);
  const [chartRuns, setChartRuns] = useState<SyncRunSummary[]>([]);
  const [runs, setRuns] = useState<SyncRunSummary[]>([]);
  const [selectedSyncPairId, setSelectedSyncPairId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedRunLog, setSelectedRunLog] = useState<string>("");
  const [runProgressById, setRunProgressById] = useState<Record<string, SyncRunProgressStatus>>({});
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [runLoading, setRunLoading] = useState(false);
  const [runActionId, setRunActionId] = useState<string | null>(null);
  const [quickStartPairId, setQuickStartPairId] = useState<string>("");
  const [runLogLoading, setRunLogLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [formState, setFormState] = useState(initialFormState);
  const [editingSyncPairId, setEditingSyncPairId] = useState<string | null>(null);
  const [scheduleEditState, setScheduleEditState] = useState({
    schedule_enabled: true,
    schedule_type: "daily",
    schedule_interval_minutes: 1440,
    schedule_time: "02:00",
    schedule_weekday: 0,
    max_delete_count: 25,
    backup_dir: "",
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
  const [testRemote, setTestRemote] = useState<string>("");
  const [telegramStatus, setTelegramStatus] = useState<TelegramSettingsStatus | null>(null);
  const [telegramFormState, setTelegramFormState] = useState(initialTelegramFormState);
  const [telegramSaving, setTelegramSaving] = useState(false);
  const [telegramTesting, setTelegramTesting] = useState(false);
  const [telegramTestResult, setTelegramTestResult] = useState<TelegramTestResult | null>(null);
  const [userLoading, setUserLoading] = useState(false);
  const [userSubmitting, setUserSubmitting] = useState(false);
  const [userFormState, setUserFormState] = useState(initialUserFormState);
  const [passwordResetState, setPasswordResetState] = useState(initialPasswordResetState);

  const selectedSyncPair = syncPairs.find((pair) => pair.id === selectedSyncPairId) ?? null;
  const successfulRuns = recentRuns.filter((run) => run.status === "success").length;
  const totalBytes = recentRuns.reduce((sum, run) => sum + run.bytes_transferred, 0);
  const totalFiles = recentRuns.reduce((sum, run) => sum + run.files_transferred, 0);
  const activeRuns = Array.from(
    new Map(
      [...recentRuns, ...runs]
        .filter((run) => run.status === "running")
        .map((run) => [run.id, run]),
    ).values(),
  );

  async function checkSession() {
    try {
      const response = await apiFetch("/auth/me", { method: "GET" });
      if (response.status === 401) return void setCurrentUser(null);
      if (!response.ok) throw new Error(`Session-Prüfung fehlgeschlagen mit Status ${response.status}`);
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
    setSelectedSyncPairId((current) => data.some((pair) => pair.id === current) ? current : null);
  }

  async function loadRecentRuns() {
    const response = await apiFetch("/runs?limit=24", { method: "GET" });
    if (!response.ok) throw new Error(`Runs laden fehlgeschlagen mit Status ${response.status}`);
    setRecentRuns((await response.json()) as SyncRunSummary[]);
  }

  async function loadChartRuns() {
    const response = await apiFetch("/runs?limit=250", { method: "GET" });
    if (!response.ok) throw new Error(`Chart-Runs laden fehlgeschlagen mit Status ${response.status}`);
    setChartRuns((await response.json()) as SyncRunSummary[]);
  }

  async function loadDashboardData() {
    try {
      setDashboardLoading(true);
      setError(null);
      await Promise.all([loadSyncPairs(), loadRecentRuns(), loadChartRuns(), loadRcloneStatus()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setDashboardLoading(false);
    }
  }

  async function loadUsers() {
    try {
      setUserLoading(true);
      const response = await apiFetch("/users", { method: "GET" });
      if (response.status === 403) return void setUsers([]);
      if (!response.ok) throw new Error(`Benutzer laden fehlgeschlagen mit Status ${response.status}`);
      setUsers((await response.json()) as UserAdminSummary[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setUserLoading(false);
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

  async function loadRunProgress(runId: string) {
    try {
      const response = await apiFetch(`/runs/${runId}/progress`, { method: "GET" });
      if (!response.ok) {
        if (response.status === 404) {
          setRunProgressById((current) => {
            const next = { ...current };
            delete next[runId];
            return next;
          });
          return;
        }
        throw new Error(`Run-Fortschritt antwortet mit Status ${response.status}`);
      }
      const data = (await response.json()) as SyncRunProgressStatus;
      setRunProgressById((current) => ({ ...current, [runId]: data }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
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

  async function loadTelegramStatus() {
    try {
      const response = await apiFetch("/settings/telegram", { method: "GET" });
      if (!response.ok) throw new Error(`Telegram-Status antwortet mit Status ${response.status}`);
      const data = (await response.json()) as TelegramSettingsStatus;
      setTelegramStatus(data);
      setTelegramFormState((current) => ({
        ...current,
        enabled: data.enabled,
        chat_id: data.chat_id ?? "",
        notify_on_success: data.notify_on_success,
        notify_on_error: data.notify_on_error,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
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
    document.documentElement.dataset.theme = themeMode;
    window.localStorage.setItem("theme-mode", themeMode);
  }, [themeMode]);

  useEffect(() => {
    if (!currentUser) {
      setUsers([]);
      setSyncPairs([]);
      setRecentRuns([]);
      setChartRuns([]);
      setRuns([]);
      setSelectedSyncPairId(null);
      setSelectedRunId(null);
      setSelectedRunLog("");
      setRunProgressById({});
      setDashboardLoading(false);
      return;
    }
    void loadDashboardData();
    if (currentUser.role === "admin") void loadUsers();
    void loadTelegramStatus();
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
      max_delete_count: selectedSyncPair.max_delete_count,
      backup_dir: selectedSyncPair.backup_dir ?? "",
    });
  }, [selectedSyncPair]);

  useEffect(() => {
    if (!selectedRunId) {
      setSelectedRunLog("");
      return;
    }
    void loadRunLog(selectedRunId);
  }, [selectedRunId]);

  useEffect(() => {
    if (!currentUser) return;
    const runningRunIds = Array.from(new Set(
      [...runs, ...recentRuns]
        .filter((run) => run.status === "running")
        .map((run) => run.id),
    ));
    if (runningRunIds.length === 0) return;

    void Promise.all(runningRunIds.map((runId) => loadRunProgress(runId)));

    const intervalId = window.setInterval(() => {
      void Promise.all(runningRunIds.map((runId) => loadRunProgress(runId)));
    }, 2000);

    return () => window.clearInterval(intervalId);
  }, [currentUser, runs, recentRuns]);

  useEffect(() => {
    if (!currentUser) return;
    const hasRunningRun = runs.some((run) => run.status === "running") || recentRuns.some((run) => run.status === "running") || syncPairs.some((pair) => pair.status === "running");
    if (!hasRunningRun) return;

    const intervalId = window.setInterval(() => {
      void loadDashboardData();
      if (selectedSyncPairId) void loadRuns(selectedSyncPairId);
    }, 5000);

    return () => window.clearInterval(intervalId);
  }, [currentUser, runs, recentRuns, syncPairs, selectedSyncPairId]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginSubmitting(true);
    setError(null);
    try {
      const response = await apiFetch("/auth/login", { method: "POST", body: JSON.stringify(loginState) });
      if (!response.ok) throw new Error("Login fehlgeschlagen. Bitte Zugangsdaten prüfen.");
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
      setChartRuns([]);
      setRuns([]);
      setSelectedSyncPairId(null);
      setSelectedRunId(null);
      setRunProgressById({});
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
      setCreateOpen(false);
      await loadDashboardData();
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
      schedule_enabled: pair.schedule_enabled,
      schedule_type: pair.schedule_type,
      schedule_interval_minutes: pair.schedule_interval_minutes,
      schedule_time: pair.schedule_time ?? "02:00",
      schedule_weekday: pair.schedule_weekday ?? 0,
      max_delete_count: pair.max_delete_count,
      backup_dir: pair.backup_dir ?? "",
    });
    setCreateOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleCancelEdit() {
    setEditingSyncPairId(null);
    setFormState(initialFormState);
    setCreateOpen(false);
  }

  async function handleDeleteSyncPair(id: string) {
    try {
      const response = await apiFetch(`/sync-pairs/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(`Loeschen fehlgeschlagen mit Status ${response.status}`);
      if (editingSyncPairId === id) handleCancelEdit();
      setSelectedSyncPairId((current) => (current === id ? null : current));
      await loadDashboardData();
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
      const startedRun = (await response.json()) as SyncRunSummary;
      setSelectedSyncPairId(id);
      setSelectedRunId(startedRun.id);
      await loadRunProgress(startedRun.id);
      await loadDashboardData();
      await loadRuns(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setRunActionId(null);
    }
  }

  function toggleSyncPair(id: string) {
    setSelectedRunId(null);
    setSelectedSyncPairId((current) => current === id ? null : id);
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
    if (!selectedConfigFile) return void setError("Bitte zuerst eine rclone.conf auswählen.");
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
      const remoteName = testRemote || rcloneStatus?.remotes[0] ?? null;
      const response = await apiFetch("/settings/rclone/test", {
        method: "POST",
        body: JSON.stringify({ remote_name: remoteName }),
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

  async function handleTelegramSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      setTelegramSaving(true);
      const response = await apiFetch("/settings/telegram", {
        method: "PUT",
        body: JSON.stringify(telegramFormState),
      });
      if (!response.ok) throw new Error(`Telegram speichern fehlgeschlagen mit Status ${response.status}`);
      const data = (await response.json()) as TelegramSettingsStatus;
      setTelegramStatus(data);
      setTelegramFormState((current) => ({ ...current, bot_token: "" }));
      setTelegramTestResult(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setTelegramSaving(false);
    }
  }

  async function handleTelegramTest() {
    try {
      setTelegramTesting(true);
      const response = await apiFetch("/settings/test-telegram", {
        method: "POST",
        body: JSON.stringify({ message: "Testnachricht aus dem SyncForge Settings-Bereich." }),
      });
      if (!response.ok) throw new Error(`Telegram-Test fehlgeschlagen mit Status ${response.status}`);
      setTelegramTestResult((await response.json()) as TelegramTestResult);
      await loadTelegramStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setTelegramTesting(false);
    }
  }

  async function handleCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      setUserSubmitting(true);
      const response = await apiFetch("/users", {
        method: "POST",
        body: JSON.stringify(userFormState),
      });
      if (!response.ok) throw new Error(`Benutzer anlegen fehlgeschlagen mit Status ${response.status}`);
      setUserFormState(initialUserFormState);
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setUserSubmitting(false);
    }
  }

  async function handleToggleUserActive(user: UserAdminSummary) {
    try {
      const response = await apiFetch(`/users/${encodeURIComponent(user.username)}`, {
        method: "PUT",
        body: JSON.stringify({ is_active: !user.is_active }),
      });
      if (!response.ok) throw new Error(`Benutzerstatus speichern fehlgeschlagen mit Status ${response.status}`);
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    }
  }

  async function handleResetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      setUserSubmitting(true);
      const response = await apiFetch(`/users/${encodeURIComponent(passwordResetState.username)}/password`, {
        method: "PUT",
        body: JSON.stringify({ password: passwordResetState.password }),
      });
      if (!response.ok) throw new Error(`Passwort-Reset fehlgeschlagen mit Status ${response.status}`);
      setPasswordResetState(initialPasswordResetState);
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setUserSubmitting(false);
    }
  }

  async function handleDeleteUser(username: string) {
    try {
      const response = await apiFetch(`/users/${encodeURIComponent(username)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(`Benutzer löschen fehlgeschlagen mit Status ${response.status}`);
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    }
  }

  if (sessionLoading) {
    return <main className="page-shell"><section className="panel"><p className="state">Prüfe Anmeldung...</p></section></main>;
  }

  if (!currentUser) {
    return (
      <main className="page-shell auth-shell">
        <section className="hero auth-hero">
          <div>
            <p className="eyebrow">SyncForge</p>
            <h1>Anmeldung für das Sync-Dashboard</h1>
            <p className="hero-copy">Melde dich mit dem lokalen Admin-Benutzer an, um Sync-Paare, Reports und Zeitpläne zu verwalten.</p>
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
        <div className="sidebar-top">
          <div className="sidebar-brand">
            <div className="sidebar-brand-mark">
              <img src="/icon-options/cloud-file-panel.svg" alt="SyncForge Icon" />
            </div>
            <div>
              <p className="sidebar-brand-title">SyncForge</p>
              <p className="sidebar-brand-subtitle">Container Edition</p>
            </div>
          </div>
          <div className="sidebar-home-link">Home</div>
        </div>

        <div className="sidebar-middle">
          <section className="sidebar-cluster">
            <div className="sidebar-cluster-head">
              <span className="sidebar-cluster-title">ALPHA-DOCKER</span>
            </div>
            <nav className="sidebar-nav sidebar-card-nav">
              <button className={`sidebar-link ${activeSection === "dashboard" ? "active" : ""}`} type="button" onClick={() => setActiveSection("dashboard")}>Dashboard</button>
              <button className={`sidebar-link ${activeSection === "sync-targets" ? "active" : ""}`} type="button" onClick={() => setActiveSection("sync-targets")}>Sync-Ziele</button>
              {currentUser.role === "admin" ? <button className={`sidebar-link ${activeSection === "users" ? "active" : ""}`} type="button" onClick={() => setActiveSection("users")}>Users</button> : null}
              <button className={`sidebar-link ${activeSection === "settings" ? "active" : ""}`} type="button" onClick={() => setActiveSection("settings")}>Settings</button>
            </nav>
          </section>

          <section className="sidebar-meta">
            <p className="sidebar-section-label">Session</p>
            <div className="sidebar-user-card">
              <p className="sidebar-user-name">{currentUser.username}</p>
              <p className="sidebar-copy">Angemeldet und aktiv</p>
            </div>
            <a className="sidebar-help-link" href="https://flathack.github.io/help/syncforge-hilfe.html" target="_blank" rel="noreferrer">Hilfe öffnen</a>
          </section>
        </div>

        <div className="sidebar-bottom">
          <div className="sidebar-version-card">
            <strong>Sync Center</strong>
            <p>Reports, Zeitpläne und Browser im Portainer-Stil.</p>
          </div>
          <button className="table-button theme-toggle" type="button" onClick={() => setThemeMode((current) => current === "dark" ? "light" : "dark")}>
            {themeMode === "dark" ? "Hellmodus" : "Dunkelmodus"}
          </button>
          <button className="table-button logout-button" type="button" onClick={handleLogout}>Logout</button>
        </div>
      </aside>

      <div className="content-shell">
        {activeSection === "dashboard" ? (
          <>
            <section className="hero hero-rich">
              <div>
                <p className="eyebrow">Dashboard</p>
                <h1>Sync-Zentrale</h1>
                <p className="hero-copy">Hier siehst du, was zuletzt passiert ist, und startest manuelle Sync-Läufe.</p>
                {!rcloneStatus?.exists ? <p className="state error">rclone ist noch nicht konfiguriert. Richte die Verbindung in den Settings ein.</p> : null}
              </div>
            </section>

            <section className="stats-grid">
              <article className="stat-card accent-blue"><span>Sync-Paare</span><strong>{syncPairs.length}</strong><p>Aktive Verbindungen im System</p></article>
              <article className="stat-card accent-gold"><span>Erfolgreiche Läufe</span><strong>{successfulRuns}</strong><p>Aus den letzten {recentRuns.length} Runs</p></article>
              <article className="stat-card accent-green"><span>Transfer-Volumen</span><strong>{formatBytes(totalBytes)}</strong><p>Gesamt über die letzte Run-Serie</p></article>
              <article className="stat-card accent-slate"><span>Dateien bewegt</span><strong>{totalFiles}</strong><p>Transferierte Dateien aus Reports</p></article>
            </section>

            {(() => {
              const dailyData = buildDailyTransferData(chartRuns);
              const maxBytes = Math.max(...dailyData.map((d) => d.bytes), 1);
              return (
                <section className="panel">
                  <div className="panel-header"><div><p className="eyebrow">Transfer</p><h2>Datenvolumen der letzten 14 Tage</h2></div></div>
                  <div className="bar-chart-shell">
                    <svg className="bar-chart" viewBox="0 0 700 220" preserveAspectRatio="none">
                      {dailyData.map((d, i) => {
                        const barWidth = 700 / dailyData.length * 0.65;
                        const gap = 700 / dailyData.length * 0.35;
                        const x = i * (barWidth + gap) + gap / 2;
                        const barHeight = Math.max(2, (d.bytes / maxBytes) * 180);
                        return (
                          <g key={d.label}>
                            <rect className="bar-chart-bar" x={x} y={180 - barHeight} width={barWidth} height={barHeight} rx={3} />
                            <title>{d.label}: {formatBytes(d.bytes)}</title>
                            <text className="bar-chart-label" x={x + barWidth / 2} y={200} textAnchor="middle">{d.label}</text>
                            {d.bytes > 0 ? <text className="bar-chart-value" x={x + barWidth / 2} y={180 - barHeight - 6} textAnchor="middle">{formatBytes(d.bytes)}</text> : null}
                          </g>
                        );
                      })}
                    </svg>
                  </div>
                </section>
              );
            })()}

            {activeRuns.length > 0 ? (
              <section className="running-sync-banner">
                <div className="panel-header">
                  <div>
                    <p className="eyebrow">Live jetzt</p>
                    <h2>{activeRuns.length === 1 ? "Aktiver Kopiervorgang" : "Aktive Kopiervorgaenge"}</h2>
                  </div>
                  <span className="badge running">{activeRuns.length} aktiv</span>
                </div>
                <div className="running-sync-grid">
                  {activeRuns.map((run) => {
                    const pair = syncPairs.find((item) => item.id === run.sync_pair_id) ?? null;
                    const progress = runProgressById[run.id];
                    const progressPoints = progress?.history ?? [];
                    const speedPolyline = buildSpeedPolyline(progressPoints);
                    const percent = progress?.percent_complete ?? null;
                    const speedValue = progress?.average_speed_bytes_per_second ?? run.average_speed_bytes_per_second;
                    const bytesValue = progress?.bytes_transferred ?? run.bytes_transferred;
                    const filesValue = progress?.files_transferred ?? run.files_transferred;
                    const finishEstimate = progress?.estimated_completion_at ?? null;

                    return (
                      <article className="running-sync-card" key={run.id}>
                        <div className="running-sync-head">
                          <div>
                            <strong>{pair?.name ?? "Unbekanntes Sync-Paar"}</strong>
                            <p>{pair ? `${pair.source_path} → ${pair.destination_path}` : run.short_log}</p>
                          </div>
                          <strong className="running-sync-percent">{percent !== null ? formatPercent(percent) : "Läuft"}</strong>
                        </div>
                        <div className="progress-bar-shell" aria-hidden="true">
                          <div className="progress-bar-fill" style={{ width: `${Math.max(4, percent ?? 6)}%` }} />
                          <svg className="progress-speed-chart" viewBox="0 0 100 100" preserveAspectRatio="none">
                            <polyline points={speedPolyline} />
                          </svg>
                        </div>
                        <div className="running-sync-metrics">
                          <article><span>Geschwindigkeit</span><strong>{formatBytes(speedValue)}/s</strong></article>
                          <article><span>Dateien</span><strong>{filesValue}{progress?.total_files ? ` / ${progress.total_files}` : ""}</strong></article>
                          <article><span>Transfer</span><strong>{formatBytes(bytesValue)}{progress?.total_bytes ? ` / ${formatBytes(progress.total_bytes)}` : ""}</strong></article>
                          <article><span>ETA</span><strong>{finishEstimate ? formatDateTime(finishEstimate) : "Wird berechnet"}</strong></article>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ) : null}

            <section className="panel">
              <div className="panel-header"><div><p className="eyebrow">Manueller Start</p><h2>Sync-Job starten</h2></div></div>
              <div className="inline-actions">
                <select value={quickStartPairId} onChange={(event) => setQuickStartPairId(event.target.value)}>
                  <option value="">Sync-Paar wählen...</option>
                  {syncPairs.filter((p) => p.enabled).map((pair) => <option key={pair.id} value={pair.id}>{pair.name} ({pair.source_path} → {pair.destination_path})</option>)}
                </select>
                <button className="primary-button" type="button" disabled={!quickStartPairId || !!runActionId} onClick={() => { if (quickStartPairId) void handleStartRun(quickStartPairId); }}>{runActionId ? "Wird gestartet..." : "Starten"}</button>
              </div>
            </section>

            {error ? <p className="state error">Fehler: {error}</p> : null}
          </>
        ) : activeSection === "sync-targets" ? (
          <>
            <section className="hero hero-rich">
              <div>
                <p className="eyebrow">Sync-Ziele</p>
                <h1>Alle Sync-Paare</h1>
                <p className="hero-copy">Deine Sync-Jobs, gruppiert nach Quell-Remote.</p>
              </div>
              <div className="hero-actions">
                <button className="primary-button" type="button" onClick={() => setCreateOpen((current) => !current)}>{createOpen ? "Dialog schließen" : "Neuen Sync anlegen"}</button>
              </div>
            </section>

            {createOpen ? (
              <section className="panel form-panel">
                <div className="panel-header"><div><p className="eyebrow">{editingSyncPairId ? "Bearbeiten" : "Neuer Eintrag"}</p><h2>{editingSyncPairId ? "Sync-Paar bearbeiten" : "Sync-Paar anlegen"}</h2></div>{editingSyncPairId ? <button className="table-button" type="button" onClick={handleCancelEdit}>Abbrechen</button> : null}</div>
                <form className="sync-form" onSubmit={handleCreateSyncPair}>
                  <label><span>Name</span><input required value={formState.name} onChange={(event) => setFormState((current) => ({ ...current, name: event.target.value }))} /></label>
                  <label><span>Modus</span><select value={formState.mode} onChange={(event) => setFormState((current) => ({ ...current, mode: event.target.value }))}><option value="sync">sync</option><option value="copy">copy</option><option value="bisync">bisync</option></select></label>
                  <label className="path-field">
                    <span>Quelle</span>
                    <div className="path-input-row">
                      <input required value={formState.source_path} onChange={(event) => setFormState((current) => ({ ...current, source_path: event.target.value }))} />
                      <button className="table-button" type="button" onClick={() => openBrowser("source_path", "local")}>Ordner wählen</button>
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
                  <label className="toggle-field"><span>Aktivierung</span><button className={`toggle-button ${formState.enabled ? "is-enabled" : ""}`} type="button" aria-pressed={formState.enabled} onClick={() => setFormState((current) => ({ ...current, enabled: !current.enabled }))}><span className="toggle-thumb" /><span>{formState.enabled ? "Aktiv" : "Deaktiviert"}</span></button></label>
                  <label className="schedule-toggle"><span>Zeitplan aktiv</span><input type="checkbox" checked={formState.schedule_enabled} onChange={(event) => setFormState((current) => ({ ...current, schedule_enabled: event.target.checked }))} /></label>
                  <label><span>Intervall</span><select value={formState.schedule_type} onChange={(event) => setFormState((current) => ({ ...current, schedule_type: event.target.value }))}><option value="daily">Täglich</option><option value="weekly">Wöchentlich</option><option value="hourly">Stündlich</option><option value="interval">Alle X Minuten</option></select></label>
                  {formState.schedule_type === "interval" ? (
                    <label><span>Minuten</span><input min={5} step={5} type="number" value={formState.schedule_interval_minutes} onChange={(event) => setFormState((current) => ({ ...current, schedule_interval_minutes: Number(event.target.value) }))} /></label>
                  ) : (
                    <label><span>Uhrzeit</span><input type="time" value={formState.schedule_time} onChange={(event) => setFormState((current) => ({ ...current, schedule_time: event.target.value }))} /></label>
                  )}
                  {formState.schedule_type === "weekly" ? (
                    <label><span>Wochentag</span><select value={formState.schedule_weekday} onChange={(event) => setFormState((current) => ({ ...current, schedule_weekday: Number(event.target.value) }))}>{weekdayOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                  ) : null}
                  <label><span>Max. Löschungen</span><input min={0} type="number" value={formState.max_delete_count} onChange={(event) => setFormState((current) => ({ ...current, max_delete_count: Number(event.target.value) }))} /></label>
                  <label className="path-field"><span>Backup-Verzeichnis für Löschungen</span><input placeholder="Optional, z. B. pcloud:/deleted-backup" value={formState.backup_dir} onChange={(event) => setFormState((current) => ({ ...current, backup_dir: event.target.value }))} /></label>
                  <button className="primary-button" type="submit" disabled={submitting}>{submitting ? "Speichere..." : editingSyncPairId ? "Aenderungen speichern" : "Sync speichern"}</button>
                </form>
              </section>
            ) : null}

            {dashboardLoading ? <p className="state">Lade Sync-Paare...</p> : null}
            {!dashboardLoading && syncPairs.length === 0 ? <p className="state">Noch keine Sync-Paare vorhanden.</p> : null}
            {!dashboardLoading && syncPairs.length > 0 ? (() => {
              const grouped: Record<string, SyncPairSummary[]> = {};
              for (const pair of syncPairs) {
                const key = extractRemoteName(pair.source_path);
                if (!grouped[key]) grouped[key] = [];
                grouped[key].push(pair);
              }
              return Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([remote, pairs]) => (
                <section className="panel sync-group" key={remote}>
                  <div className="panel-header"><div><p className="eyebrow">Quelle</p><h2>{remote}</h2></div><span className="badge muted">{pairs.length} {pairs.length === 1 ? "Paar" : "Paare"}</span></div>
                  <div className="sync-list">
                    {pairs.map((pair) => {
                      const isOpen = selectedSyncPairId === pair.id;
                      return (
                        <article className={`sync-row ${isOpen ? "open" : ""}`} key={pair.id}>
                          <button className="sync-row-summary" type="button" onClick={() => toggleSyncPair(pair.id)}>
                            <div className="sync-row-main">
                              <strong>{pair.name}</strong>
                              <span>{describeSchedule(pair)}</span>
                            </div>
                            <div className="sync-row-meta">
                              <span>{pair.source_path}</span>
                              <span>{pair.destination_path}</span>
                              <span>{formatDateTime(pair.last_run_at)}</span>
                              <span>{formatDateTime(pair.next_run_at)}</span>
                              <span className={`badge ${pair.status === "running" ? "running" : pair.last_status === "error" ? "error" : "idle"}`}>{pair.status === "running" ? "running" : pair.last_status}</span>
                            </div>
                          </button>

                          {isOpen ? (
                            <div className="sync-row-detail">
                              <div className="sync-row-toolbar">
                                <div className="action-stack">
                                  <button className="table-button" type="button" onClick={() => handleEditSyncPair(pair)}>Bearbeiten</button>
                                  <button className="table-button" type="button" onClick={() => void handleToggleSyncPair(pair)}>{pair.enabled ? "Deaktivieren" : "Aktivieren"}</button>
                                  <button className="table-button primary-inline" type="button" disabled={runActionId === pair.id || !pair.enabled} onClick={() => void handleStartRun(pair.id)}>{runActionId === pair.id ? "Läuft..." : "Jetzt starten"}</button>
                                  <button className="table-button" type="button" onClick={() => void handleDeleteSyncPair(pair.id)}>Löschen</button>
                                </div>
                              </div>

                              <div className="sync-expanded-grid">
                                <section className="subpanel">
                                  <div className="panel-header"><div><p className="eyebrow">Zeitplan</p><h3>{pair.name}</h3></div></div>
                                  <form className="sync-form compact-form" onSubmit={handleUpdateSchedule}>
                                    <label className="schedule-toggle"><span>Zeitplan aktiv</span><input type="checkbox" checked={scheduleEditState.schedule_enabled} onChange={(event) => setScheduleEditState((current) => ({ ...current, schedule_enabled: event.target.checked }))} /></label>
                                    <label><span>Intervall</span><select value={scheduleEditState.schedule_type} onChange={(event) => setScheduleEditState((current) => ({ ...current, schedule_type: event.target.value }))}><option value="daily">Täglich</option><option value="weekly">Wöchentlich</option><option value="hourly">Stündlich</option><option value="interval">Alle X Minuten</option></select></label>
                                    {scheduleEditState.schedule_type === "interval" ? (
                                      <label><span>Minuten</span><input min={5} step={5} type="number" value={scheduleEditState.schedule_interval_minutes} onChange={(event) => setScheduleEditState((current) => ({ ...current, schedule_interval_minutes: Number(event.target.value) }))} /></label>
                                    ) : (
                                      <label><span>Uhrzeit</span><input type="time" value={scheduleEditState.schedule_time} onChange={(event) => setScheduleEditState((current) => ({ ...current, schedule_time: event.target.value }))} /></label>
                                    )}
                                    {scheduleEditState.schedule_type === "weekly" ? (
                                      <label><span>Wochentag</span><select value={scheduleEditState.schedule_weekday} onChange={(event) => setScheduleEditState((current) => ({ ...current, schedule_weekday: Number(event.target.value) }))}>{weekdayOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                                    ) : null}
                                    <label><span>Max. Löschungen</span><input min={0} type="number" value={scheduleEditState.max_delete_count} onChange={(event) => setScheduleEditState((current) => ({ ...current, max_delete_count: Number(event.target.value) }))} /></label>
                                    <label><span>Backup-Verzeichnis</span><input placeholder="Optional" value={scheduleEditState.backup_dir} onChange={(event) => setScheduleEditState((current) => ({ ...current, backup_dir: event.target.value }))} /></label>
                                    <button className="primary-button" type="submit" disabled={submitting}>{submitting ? "Speichere..." : "Zeitplan speichern"}</button>
                                  </form>
                                </section>

                                <section className="subpanel subpanel-wide">
                                  <div className="panel-header"><div><p className="eyebrow">Verlauf</p><h3>Übertragungen</h3></div></div>
                                  {runLoading ? <p className="state">Lade letzte Läufe...</p> : null}
                                  {!runLoading && runs.length === 0 ? <p className="state">Bisher wurden für dieses Sync-Paar noch keine Dateien übertragen.</p> : null}
                                  {runs.length > 0 ? (
                                    <div className="run-table">
                                      {runs.map((run) => {
                                        const progress = runProgressById[run.id];
                                        const progressPoints = progress?.history ?? [];
                                        const speedPolyline = buildSpeedPolyline(progressPoints);
                                        const percent = progress?.percent_complete ?? (run.status === "success" ? 100 : null);
                                        const speedValue = progress?.average_speed_bytes_per_second ?? run.average_speed_bytes_per_second;
                                        const bytesValue = progress?.bytes_transferred ?? run.bytes_transferred;
                                        const filesValue = progress?.files_transferred ?? run.files_transferred;
                                        const finishEstimate = progress?.estimated_completion_at ?? null;

                                        return (
                                          <article className={`run-row ${selectedRunId === run.id ? "selected" : ""}`} key={run.id}>
                                            <button className="run-row-summary" type="button" onClick={() => setSelectedRunId((current) => current === run.id ? null : run.id)}>
                                              <span>{formatDateTime(run.started_at)}</span>
                                              <span>{filesValue}</span>
                                              <span>{formatBytes(bytesValue)}</span>
                                              <span>{run.status === "running" ? "läuft..." : formatDuration(run.duration_seconds)}</span>
                                              <span>{formatBytes(speedValue)}/s</span>
                                              <span>{run.status === "running" && finishEstimate ? formatDateTime(finishEstimate) : formatDateTime(run.finished_at)}</span>
                                              <span className={`badge ${run.status}`}>{run.status}</span>
                                            </button>
                                            {selectedRunId === run.id ? (
                                              <div className="run-row-detail">
                                                {run.status === "running" && progress ? (
                                                  <section className="live-progress-card">
                                                    <div className="live-progress-head">
                                                      <div>
                                                        <p className="eyebrow">Live-Fortschritt</p>
                                                        <h3>Kopiervorgang läuft</h3>
                                                      </div>
                                                      <strong>{formatPercent(percent)}</strong>
                                                    </div>
                                                    <div className="progress-bar-shell" aria-hidden="true">
                                                      <div className="progress-bar-fill" style={{ width: `${Math.max(4, percent ?? 6)}%` }} />
                                                      <svg className="progress-speed-chart" viewBox="0 0 100 100" preserveAspectRatio="none">
                                                        <polyline points={speedPolyline} />
                                                      </svg>
                                                    </div>
                                                    <div className="live-progress-grid">
                                                      <article className="report-highlight"><span>Geschwindigkeit</span><strong>{formatBytes(speedValue)}/s</strong></article>
                                                      <article className="report-highlight"><span>Dateien bewegt</span><strong>{filesValue}{progress.total_files ? ` / ${progress.total_files}` : ""}</strong></article>
                                                      <article className="report-highlight"><span>Transfer</span><strong>{formatBytes(bytesValue)}{progress.total_bytes ? ` / ${formatBytes(progress.total_bytes)}` : ""}</strong></article>
                                                      <article className="report-highlight"><span>Voraussichtliches Ende</span><strong>{finishEstimate ? formatDateTime(finishEstimate) : "Wird berechnet"}</strong></article>
                                                    </div>
                                                  </section>
                                                ) : null}
                                                <div className="report-summary">
                                                  <article className="report-highlight"><span>Dateien bewegt</span><strong>{filesValue}</strong></article>
                                                  <article className="report-highlight"><span>Transfer-Volumen</span><strong>{formatBytes(bytesValue)}</strong></article>
                                                  <article className="report-highlight"><span>Ø Geschwindigkeit</span><strong>{formatBytes(speedValue)}/s</strong></article>
                                                  <article className="report-highlight"><span>Dauer</span><strong>{run.status === "running" ? "läuft..." : formatDuration(run.duration_seconds)}</strong></article>
                                                </div>
                                                <p className="report-copy">{run.report}</p>
                                                <div className="report-detail-grid">
                                                  <article className="report-block">
                                                    <h3>Kennzahlen</h3>
                                                    <p>Start: {formatDateTime(run.started_at)}</p>
                                                    <p>Ende: {run.status === "running" && finishEstimate ? formatDateTime(finishEstimate) : formatDateTime(run.finished_at)}</p>
                                                    <p>Trigger: {run.trigger_type}</p>
                                                    <p>Gelöschte Dateien: {run.files_deleted}</p>
                                                    <p>Fehler: {run.error_count}</p>
                                                    <p>Exit-Code: {run.exit_code ?? "-"}</p>
                                                  </article>
                                                  <article className="report-block"><h3>Kommando</h3><code>{run.rclone_command}</code></article>
                                                </div>
                                                <article className="report-block">
                                                  <h3>Vollständiges Log</h3>
                                                  {runLogLoading ? <p className="state">Lade Log...</p> : <pre className="log-output">{selectedRunLog || "Kein Log verfügbar."}</pre>}
                                                </article>
                                              </div>
                                            ) : null}
                                          </article>
                                        );
                                      })}
                                    </div>
                                  ) : null}
                                </section>
                              </div>
                            </div>
                          ) : null}
                        </article>
                      );
                    })}
                  </div>
                </section>
              ));
            })() : null}
          </>
        ) : activeSection === "users" && currentUser.role === "admin" ? (
          <>
            <section className="hero">
              <div>
                <p className="eyebrow">Users</p>
                <h1>Benutzerverwaltung</h1>
                <p className="hero-copy">Hier verwaltest du lokale Benutzerkonten für Anmeldung und Administration.</p>
              </div>
            </section>

            {error ? <p className="state error">Fehler: {error}</p> : null}

            <section className="dashboard-split">
              <section className="panel">
                <div className="panel-header"><div><p className="eyebrow">Anlegen</p><h2>Neuen Benutzer erstellen</h2></div></div>
                <form className="sync-form compact-form" onSubmit={handleCreateUser}>
                  <label><span>Benutzername</span><input required value={userFormState.username} onChange={(event) => setUserFormState((current) => ({ ...current, username: event.target.value }))} /></label>
                  <label><span>Passwort</span><input required minLength={8} type="password" value={userFormState.password} onChange={(event) => setUserFormState((current) => ({ ...current, password: event.target.value }))} /></label>
                  <label><span>Rolle</span><select value={userFormState.role} onChange={(event) => setUserFormState((current) => ({ ...current, role: event.target.value }))}><option value="admin">admin</option></select></label>
                  <label className="schedule-toggle"><span>Aktiv</span><input type="checkbox" checked={userFormState.is_active} onChange={(event) => setUserFormState((current) => ({ ...current, is_active: event.target.checked }))} /></label>
                  <button className="primary-button" type="submit" disabled={userSubmitting}>{userSubmitting ? "Speichere..." : "Benutzer anlegen"}</button>
                </form>
              </section>

              <section className="panel">
                <div className="panel-header"><div><p className="eyebrow">Passwort</p><h2>Passwort zurücksetzen</h2></div></div>
                <form className="sync-form compact-form" onSubmit={handleResetPassword}>
                  <label><span>Benutzer</span><select required value={passwordResetState.username} onChange={(event) => setPasswordResetState((current) => ({ ...current, username: event.target.value }))}><option value="">Bitte wählen</option>{users.map((user) => <option key={user.username} value={user.username}>{user.username}</option>)}</select></label>
                  <label><span>Neues Passwort</span><input required minLength={8} type="password" value={passwordResetState.password} onChange={(event) => setPasswordResetState((current) => ({ ...current, password: event.target.value }))} /></label>
                  <button className="primary-button" type="submit" disabled={userSubmitting}>{userSubmitting ? "Speichere..." : "Passwort setzen"}</button>
                </form>
              </section>

              <section className="panel report-panel">
                <div className="panel-header"><div><p className="eyebrow">Benutzer</p><h2>Vorhandene Accounts</h2></div><button className="table-button" type="button" onClick={() => void loadUsers()}>Aktualisieren</button></div>
                {userLoading ? <p className="state">Lade Benutzer...</p> : null}
                {!userLoading ? (
                  <div className="run-list">
                    {users.map((user) => (
                      <article className="run-card" key={user.username}>
                        <div className="run-card-header">
                          <strong>{user.username}</strong>
                          <span className={`badge ${user.is_active ? "idle" : "error"}`}>{user.is_active ? "aktiv" : "deaktiviert"}</span>
                        </div>
                        <p>Rolle: {user.role}</p>
                        <p>Angelegt: {formatDateTime(user.created_at)}</p>
                        <div className="action-stack">
                          <button className="table-button" type="button" disabled={user.username === currentUser.username} onClick={() => void handleToggleUserActive(user)}>{user.is_active ? "Deaktivieren" : "Aktivieren"}</button>
                          <button className="table-button" type="button" disabled={user.username === currentUser.username} onClick={() => void handleDeleteUser(user.username)}>Löschen</button>
                        </div>
                      </article>
                    ))}
                  </div>
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
                <p className="hero-copy">Hier richtest du die `rclone.conf` für pCloud ein, prüfst die Verbindung und verwaltest die technischen Grundlagen des Systems.</p>
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
                    <article className="settings-card"><span className={`badge ${rcloneStatus.is_valid ? "idle" : "error"}`}>{rcloneStatus.is_valid ? "gültig" : "ungültig"}</span><h3>Erkannte Remotes</h3><p>{rcloneStatus.remotes.length > 0 ? rcloneStatus.remotes.join(", ") : "Keine"}</p></article>
                    <article className="settings-card"><span className="badge idle">Info</span><h3>Datei</h3><p>{rcloneStatus.file_size ? `${rcloneStatus.file_size} Bytes` : "Keine Dateigröße"}</p><p>{rcloneStatus.updated_at ? new Date(rcloneStatus.updated_at).toLocaleString("de-DE") : "Noch nie aktualisiert"}</p></article>
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
              <div className="panel-header"><div><p className="eyebrow">Verbindungstest</p><h2>Erkannten Remote prüfen</h2></div></div>
              <div className="inline-actions">
                {rcloneStatus && rcloneStatus.remotes.length > 0 ? (
                  <select value={testRemote || rcloneStatus.remotes[0]} onChange={(event) => setTestRemote(event.target.value)}>
                    {rcloneStatus.remotes.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                ) : null}
                <button className="primary-button" type="button" disabled={testLoading || !rcloneStatus?.remotes.length} onClick={() => void handleRcloneTest()}>{testLoading ? "Teste..." : "Remote testen"}</button>
                <span className="settings-note">{rcloneStatus?.remotes.length ? "" : "Zuerst eine gültige rclone.conf hochladen"}</span>
              </div>
              {testResult ? <p className={`state ${testResult.ok ? "" : "error"}`}>{testResult.detail}</p> : null}
            </section>

            <section className="panel">
              <div className="panel-header"><div><p className="eyebrow">Telegram</p><h2>Benachrichtigungen</h2></div><button className="table-button" type="button" onClick={() => void loadTelegramStatus()}>Aktualisieren</button></div>
              {telegramStatus ? (
                <>
                  <div className="settings-grid">
                    <article className="settings-card"><span className={`badge ${telegramStatus.enabled ? "idle" : "running"}`}>{telegramStatus.enabled ? "aktiv" : "inaktiv"}</span><h3>Modulstatus</h3><p>{telegramStatus.detail}</p></article>
                    <article className="settings-card"><span className={`badge ${telegramStatus.bot_token_configured ? "idle" : "error"}`}>{telegramStatus.bot_token_configured ? "konfiguriert" : "fehlt"}</span><h3>Bot und Chat</h3><p>{telegramStatus.chat_id ? `Chat-ID: ${telegramStatus.chat_id}` : "Noch keine Chat-ID gespeichert"}</p></article>
                    <article className="settings-card"><span className="badge idle">Trigger</span><h3>Versandregeln</h3><p>Erfolg: {telegramStatus.notify_on_success ? "ja" : "nein"}</p><p>Fehler: {telegramStatus.notify_on_error ? "ja" : "nein"}</p></article>
                  </div>
                </>
              ) : null}
            </section>

            <section className="panel">
              <div className="panel-header"><div><p className="eyebrow">Telegram Setup</p><h2>Bot verbinden</h2></div></div>
              <form className="settings-form" onSubmit={handleTelegramSave}>
                <label className="schedule-toggle"><span>Telegram aktivieren</span><input type="checkbox" checked={telegramFormState.enabled} onChange={(event) => setTelegramFormState((current) => ({ ...current, enabled: event.target.checked }))} /></label>
                <label><span>Bot Token</span><input type="password" placeholder={telegramStatus?.bot_token_configured ? "Bereits gespeichert, nur für Änderung neu eingeben" : "123456:ABC..."} value={telegramFormState.bot_token} onChange={(event) => setTelegramFormState((current) => ({ ...current, bot_token: event.target.value }))} /></label>
                <label><span>Chat-ID</span><input value={telegramFormState.chat_id} onChange={(event) => setTelegramFormState((current) => ({ ...current, chat_id: event.target.value }))} /></label>
                <label className="schedule-toggle"><span>Bei Erfolg senden</span><input type="checkbox" checked={telegramFormState.notify_on_success} onChange={(event) => setTelegramFormState((current) => ({ ...current, notify_on_success: event.target.checked }))} /></label>
                <label className="schedule-toggle"><span>Bei Fehler senden</span><input type="checkbox" checked={telegramFormState.notify_on_error} onChange={(event) => setTelegramFormState((current) => ({ ...current, notify_on_error: event.target.checked }))} /></label>
                <button className="primary-button" type="submit" disabled={telegramSaving}>{telegramSaving ? "Speichere..." : "Telegram speichern"}</button>
              </form>
            </section>

            <section className="panel">
              <div className="panel-header"><div><p className="eyebrow">Telegram Test</p><h2>Testnachricht senden</h2></div></div>
              <div className="inline-actions">
                <button className="primary-button" type="button" disabled={telegramTesting || !telegramStatus?.bot_token_configured} onClick={() => void handleTelegramTest()}>{telegramTesting ? "Sende..." : "Testnachricht senden"}</button>
                <span className="settings-note">{telegramStatus?.bot_token_configured ? "Sendet eine kurze Testnachricht an den konfigurierten Chat." : "Zuerst Token und Chat-ID speichern"}</span>
              </div>
              {telegramTestResult ? <p className={`state ${telegramTestResult.ok ? "" : "error"}`}>{telegramTestResult.detail}</p> : null}
            </section>
          </>
        )}

        <footer className="app-footer">
          Entwickelt von Steven Schödel, Version {appVersion}
        </footer>

        {browserField ? (
          <div className="browser-overlay" role="dialog" aria-modal="true">
            <section className="browser-panel">
              <div className="panel-header">
                <div><p className="eyebrow">Dateibrowser</p><h2>{browserField === "source_path" ? "Quellordner wählen" : "Zielordner wählen"}</h2></div>
                <button className="table-button" type="button" onClick={closeBrowser}>Schließen</button>
              </div>

              <div className="browser-topbar">
                <div className="browser-location">
                  <span className="browser-chip">{browserMode === "remote" ? "Remote" : "Lokal"}</span>
                  <strong>{browserData?.current_path || (browserMode === "remote" ? "Remotes" : "Wurzeln")}</strong>
                </div>
                <div className="inline-actions">
                  <button className="table-button" type="button" disabled={browserMode === "local"} onClick={() => void loadBrowser(null, "local")}>Lokal</button>
                  <button className="table-button primary-inline" type="button" disabled={browserMode === "remote"} onClick={() => void loadBrowser(null, "remote")}>Remote</button>
                  <button className="table-button" type="button" disabled={browserData?.parent_path == null} onClick={() => void loadBrowser(browserData?.parent_path ?? null, browserMode)}>Eine Ebene hoch</button>
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
                          <button className="table-button" type="button" onClick={() => void loadBrowser(entry.path, browserMode)}>Öffnen</button>
                          <button className="table-button primary-inline" type="button" onClick={() => applyBrowserPath(entry.path)}>Auswählen</button>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              </div>

              <div className="browser-footer">
                <button className="primary-button" type="button" onClick={() => applyBrowserPath(browserData?.current_path || "")} disabled={!browserData?.current_path}>Aktuellen Ordner übernehmen</button>
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </main>
  );
}





