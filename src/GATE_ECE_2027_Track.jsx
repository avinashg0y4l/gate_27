import { useState, useMemo, useCallback, useEffect, useRef } from "react";

/* ---------- standardized style maps (styled for premium Claude theme) ---------- */
const STATUS_STYLE = {
  "Not Started": { bg: "rgba(148, 163, 184, 0.08)", color: "hsl(var(--text-400))" },
  "In Progress": { bg: "rgba(245, 158, 11, 0.08)", color: "var(--warning-color)" },
  "Done": { bg: "rgba(16, 185, 129, 0.08)", color: "var(--success-color)" },
  "Skipped": { bg: "rgba(239, 68, 68, 0.08)", color: "var(--danger-color)" },
};
const CONFIDENCE_STYLE = {
  "Low": { bg: "rgba(239, 68, 68, 0.08)", color: "var(--danger-color)" },
  "Medium": { bg: "rgba(245, 158, 11, 0.08)", color: "var(--warning-color)" },
  "High": { bg: "rgba(16, 185, 129, 0.08)", color: "var(--success-color)" },
};
const PRIORITY_STYLE = {
  "Very High": { bg: "rgba(168, 85, 247, 0.1)", color: "#c084fc" },
  "High": { bg: "rgba(245, 158, 11, 0.1)", color: "var(--warning-color)" },
  "Medium": { bg: "rgba(56, 189, 248, 0.1)", color: "var(--info-color)" },
};
const MOCK_STATUS_STYLE = {
  "Scheduled": { bg: "rgba(148, 163, 184, 0.08)", color: "hsl(var(--text-400))" },
  "Completed": { bg: "rgba(16, 185, 129, 0.08)", color: "var(--success-color)" },
  "Missed": { bg: "rgba(239, 68, 68, 0.08)", color: "var(--danger-color)" },
  "Rescheduled": { bg: "rgba(245, 158, 11, 0.08)", color: "var(--warning-color)" },
};

const DEFAULT_API_URL = "https://script.google.com/macros/s/AKfycbxC5raiITG8gPLGhwv3tmKtEEdynqPdxwUAS3A9EKZYkiPQFtVaGgj8DvjH-3LTsiufCw/exec";
const POLL_VERSION_MS = 8000;
const STORAGE_KEY = "gate_apps_script_url";
const USER_KEY = "gate_user_name";

/* ---------------------------------- storage helpers ---------------------------------- */
async function getStorageItem(key) {
  try {
    if (window.storage && typeof window.storage.get === "function") {
      const res = await window.storage.get(key, false);
      return res?.value || null;
    }
  } catch (e) {}
  return localStorage.getItem(key);
}

async function setStorageItem(key, value) {
  try {
    if (window.storage && typeof window.storage.set === "function") {
      await window.storage.set(key, value, false);
      return;
    }
  } catch (e) {}
  localStorage.setItem(key, value);
}

/* ---------------------------------- small UI atoms ---------------------------------- */
function Badge({ text, style }) {
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 6,
      fontSize: 11, fontWeight: 600, whiteSpace: "nowrap",
      background: style?.bg || "rgba(148, 163, 184, 0.08)",
      color: style?.color || "hsl(var(--text-400))",
      border: `1px solid ${style?.color ? style.color + "22" : "transparent"}`
    }}>{text}</span>
  );
}

function InlineSelect({ value, options, onChange, styleMap, disabled }) {
  return (
    <select
      value={value || ""}
      disabled={disabled}
      onChange={e => onChange(e.target.value)}
      style={{
        border: "1px solid hsl(var(--border-100))",
        borderRadius: 6, padding: "4px 8px", fontSize: 12,
        background: styleMap?.[value]?.bg || "hsl(var(--bg-200))",
        color: styleMap?.[value]?.color || "hsl(var(--text-000))",
        fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer", appearance: "auto",
        opacity: disabled ? 0.5 : 1,
        outline: "none"
      }}
    >
      {!options?.includes(value) && value ? <option value={value}>{value}</option> : null}
      {(options || []).map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function ProgressBar({ pct, color = "hsl(var(--accent-brand))", height = 8 }) {
  return (
    <div style={{ background: "hsl(var(--bg-200))", borderRadius: 99, height, overflow: "hidden", minWidth: 60, border: "1px solid hsl(var(--border-200))" }}>
      <div style={{
        width: `${Math.min(100, Math.max(0, pct))}%`,
        background: color,
        height: "100%",
        borderRadius: 99,
        transition: "width 0.4s cubic-bezier(0.16, 1, 0.3, 1)"
      }} />
    </div>
  );
}

function MetricCard({ label, value, sub, color }) {
  return (
    <div className="claude-card" style={{
      flex: 1,
      minWidth: 180,
      borderLeft: `3px solid ${color || "hsl(var(--accent-brand))"}`
    }}>
      <div style={{ fontSize: 11, color: "hsl(var(--text-400))", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>{label}</div>
      <div className="font-mono" style={{ fontSize: 26, fontWeight: 700, color: "hsl(var(--text-000))", lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "hsl(var(--text-400))", marginTop: 6, fontWeight: 500 }}>{sub}</div>}
    </div>
  );
}

function SyncDot({ status }) {
  const map = {
    idle: { color: "hsl(var(--text-400))", label: "Connecting…" },
    syncing: { color: "var(--warning-color)", label: "Syncing…" },
    saved: { color: "var(--success-color)", label: "Live" },
    error: { color: "var(--danger-color)", label: "Sync error" },
    offline: { color: "hsl(var(--text-400))", label: "Not connected" },
  };
  const s = map[status] || map.idle;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "hsl(var(--text-400))", fontWeight: 600 }}>
      <span style={{
        width: 8, height: 8, borderRadius: 99, background: s.color, display: "inline-block",
        boxShadow: `0 0 6px ${s.color}`,
        animation: status === "syncing" ? "pulse-dot 1.2s infinite" : "none"
      }} />
      {s.label}
    </div>
  );
}

/* ---------------------------------- backend hook ---------------------------------- */
function useGateBackend(apiUrl, userName, passcode) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [syncStatus, setSyncStatus] = useState("idle");
  const versionRef = useRef(0);
  const pollRef = useRef(null);

  const fetchSnapshot = useCallback(async () => {
    if (!apiUrl) return;
    try {
      const res = await fetch(apiUrl, { 
        method: "GET"
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const json = await res.json();
      versionRef.current = json.version || 0;
      setData(json);
      setError(null);
      setSyncStatus("saved");
    } catch (err) {
      setError(String(err.message || err));
      setSyncStatus("error");
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  const checkVersion = useCallback(async () => {
    if (!apiUrl) return;
    try {
      const res = await fetch(apiUrl + (apiUrl.includes("?") ? "&" : "?") + "action=version");
      const json = await res.json();
      if (json.version !== versionRef.current) {
        await fetchSnapshot();
      }
    } catch (e) {
      // silent
    }
  }, [apiUrl, fetchSnapshot]);

  useEffect(() => {
    if (!apiUrl) { setLoading(false); return; }
    setLoading(true);
    fetchSnapshot();
    pollRef.current = setInterval(checkVersion, POLL_VERSION_MS);
    return () => clearInterval(pollRef.current);
  }, [apiUrl, fetchSnapshot, checkVersion]);

  const write = useCallback(async (sheet, id, field, value, optimisticKey) => {
    setSyncStatus("syncing");
    setData(prev => {
      if (!prev) return prev;
      const key = optimisticKey;
      const list = prev[key];
      if (!list) return prev;
      return { ...prev, [key]: list.map(row => String(row.id) === String(id) ? { ...row, [field]: value } : row) };
    });
    try {
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ sheet, id, field, value, user: userName || "Guest", passcode: passcode }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Write failed");
      versionRef.current = json.version;
      setSyncStatus("saved");
    } catch (err) {
      setError(String(err.message || err));
      setSyncStatus("error");
      fetchSnapshot();
    }
  }, [apiUrl, userName, passcode, fetchSnapshot]);

  return { data, loading, error, syncStatus, write, refresh: fetchSnapshot };
}

/* ---------------------------------- main component ---------------------------------- */
export default function GateTracker() {
  const [tab, setTab] = useState("dashboard");
  const [apiUrl, setApiUrl] = useState("");
  const [userName, setUserName] = useState("");
  const [passcode, setPasscode] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [passcodeInput, setPasscodeInput] = useState("");
  const [filterSubject, setFilterSubject] = useState("All");
  const [filterStatus, setFilterStatus] = useState("All");
  const [storageReady, setStorageReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const u = await getStorageItem(STORAGE_KEY);
        if (u) {
          setApiUrl(u);
          setUrlInput(u);
        } else {
          setApiUrl(DEFAULT_API_URL);
          setUrlInput(DEFAULT_API_URL);
        }
      } catch {}
      try {
        const n = await getStorageItem(USER_KEY);
        if (n) {
          setUserName(n);
          setNameInput(n);
        } else {
          setUserName("Aspirant");
          setNameInput("Aspirant");
        }
      } catch {}
      try {
        const p = await getStorageItem("gate_edit_passcode");
        if (p) {
          setPasscode(p);
          setPasscodeInput(p);
        }
      } catch {}
      setStorageReady(true);
    })();
  }, []);

  const { data, loading, error, syncStatus, write, refresh } = useGateBackend(apiUrl, userName, passcode);

  const saveConnection = useCallback(async () => {
    const cleanUrl = urlInput.trim();
    const cleanName = nameInput.trim();
    const cleanPass = passcodeInput.trim();
    setApiUrl(cleanUrl);
    setUserName(cleanName);
    setPasscode(cleanPass);
    try {
      await setStorageItem(STORAGE_KEY, cleanUrl);
      await setStorageItem(USER_KEY, cleanName);
      await setStorageItem("gate_edit_passcode", cleanPass);
    } catch {}
  }, [urlInput, nameInput, passcodeInput]);

  const resetToDefault = useCallback(async () => {
    setUrlInput(DEFAULT_API_URL);
    setApiUrl(DEFAULT_API_URL);
    try {
      await setStorageItem(STORAGE_KEY, DEFAULT_API_URL);
    } catch {}
  }, []);

  const lists = data?.lists || {};
  const subjects = data?.subjects || [];
  const topics = data?.topics || [];
  const mocks = data?.mocks || [];
  const plan = data?.plan || [];
  const config = data?.config || {};

  const subjectById = useMemo(() => {
    const m = {};
    subjects.forEach(s => { m[s.id] = s; });
    return m;
  }, [subjects]);

  const updateTopic = useCallback((id, field, value) => {
    write("Topics", id, field, value, "topics");
  }, [write]);

  const updateMock = useCallback((id, field, value) => {
    write("MockTests", id, field, value, "mocks");
  }, [write]);

  const stats = useMemo(() => {
    const totalTopics = topics.length;
    const done = topics.filter(t => t.status === "Done").length;
    const inProgress = topics.filter(t => t.status === "In Progress").length;
    const totalPyq = topics.reduce((a, t) => a + (Number(t.pyqDone) || 0), 0);
    const pyqTarget = Number(config.PYQTotalTarget) || 1500;
    const mocksDone = mocks.filter(m => m.status === "Completed").length;
    const highConf = topics.filter(t => t.confidence === "High").length;
    const completedScores = mocks.filter(m => m.status === "Completed" && m.score !== "" && m.maxScore);
    const avgScorePct = completedScores.length
      ? Math.round(completedScores.reduce((a, m) => a + (Number(m.score) / Number(m.maxScore)) * 100, 0) / completedScores.length)
      : 0;
    return { totalTopics, done, inProgress, totalPyq, pyqTarget, mocksDone, highConf, avgScorePct };
  }, [topics, mocks, config]);

  const filteredTopics = useMemo(() => topics.filter(t => {
    if (filterSubject !== "All" && String(t.subjectId) !== String(filterSubject)) return false;
    if (filterStatus !== "All" && t.status !== filterStatus) return false;
    return true;
  }), [topics, filterSubject, filterStatus]);

  const tabs = [
    { id: "dashboard", label: "Dashboard" },
    { id: "topics", label: "Topic Tracker" },
    { id: "mocks", label: "Mock Tests" },
    { id: "plan", label: "Study Plan" },
    { id: "settings", label: "Settings" },
  ];

  const overallPct = stats.totalTopics ? Math.round((stats.done / stats.totalTopics) * 100) : 0;
  const daysToExam = config.ExamDate
    ? Math.ceil((new Date(config.ExamDate) - new Date()) / 86400000)
    : null;

  const notConnected = !apiUrl;

  return (
    <div style={{ maxWidth: 1140, margin: "0 auto", paddingBottom: 64 }}>
      <h2 className="sr-only">GATE ECE 2027 Preparation Tracker</h2>

      {/* Header Panel */}
      <div style={{
        backgroundColor: "hsl(var(--bg-100))",
        border: "1px solid hsl(var(--border-200))",
        borderRadius: 16,
        padding: "24px 28px",
        marginBottom: 24,
        boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
        position: "relative"
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContents: "space-between", gap: 20, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 11, color: "hsl(var(--accent-brand))", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 6, fontWeight: 700 }}>GATE ECE 2027 Tracker</div>
            <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.2, letterSpacing: "-0.02em", color: "hsl(var(--text-000))" }}>Preparation Portal</div>
            <div style={{ fontSize: 13, color: "hsl(var(--text-400))", marginTop: 6, display: "flex", gap: 12, alignItems: "center" }}>
              <span>{daysToExam !== null ? `⚡ ${daysToExam} days remaining` : "Connect to Sheet"}</span>
              <span style={{ color: "hsl(var(--border-200))" }}>|</span>
              <span className="font-mono">🎯 Target AIR &lt; {config.TargetAIR || "—"}</span>
            </div>
          </div>
          
          <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
            <SyncDot status={notConnected ? "offline" : syncStatus} />
            <div style={{ height: 32, width: 1, background: "hsl(var(--border-200))" }} />
            <div style={{ textAlign: "right" }}>
              <div className="font-mono" style={{ fontSize: 28, fontWeight: 800, color: "hsl(var(--text-000))", lineHeight: 1 }}>{overallPct}%</div>
              <div style={{ fontSize: 10, color: "hsl(var(--text-400))", textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 4, fontWeight: 700 }}>Overall Progress</div>
            </div>
            <div style={{ width: 100 }}>
              <ProgressBar pct={overallPct} color="hsl(var(--accent-brand))" height={10} />
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div style={{ display: "flex", gap: 8, marginTop: 24, overflowX: "auto", borderTop: "1px solid hsl(var(--border-200))", paddingTop: 16 }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} className="Button_ghost__BUAoh" style={{
              display: "flex", alignItems: "center", gap: 6, padding: "8px 16px",
              backgroundColor: tab === t.id ? "hsl(var(--bg-200))" : "transparent",
              color: tab === t.id ? "hsl(var(--text-000))" : "hsl(var(--text-200))",
              fontWeight: tab === t.id ? 600 : 500, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap",
            }}>{t.label}</button>
          ))}
        </div>
      </div>

      {/* Connection banner */}
      {storageReady && notConnected && tab !== "settings" && (
        <div style={{ margin: "16px 0", padding: "14px 20px", background: "rgba(245, 158, 11, 0.08)", border: "1px solid rgba(245, 158, 11, 0.15)", borderRadius: 12, fontSize: 13.5, color: "var(--warning-color)", display: "flex", alignItems: "center", gap: 10 }}>
          <span>⚠️</span>
          <span>Not connected to Google Sheets yet. Open the <strong>Settings</strong> tab and paste your Apps Script Web App URL to start live syncing.</span>
        </div>
      )}
      {apiUrl && error && (
        <div style={{ margin: "16px 0", padding: "14px 20px", background: "rgba(239, 68, 68, 0.08)", border: "1px solid rgba(239, 68, 68, 0.15)", borderRadius: 12, fontSize: 13.5, color: "var(--danger-color)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span>❌</span>
            <span>Couldn't reach the backend: {error}</span>
          </div>
          <button onClick={refresh} className="Button_secondary__Teecd" style={{ padding: "4px 12px", fontSize: 12 }}>Retry Connection</button>
        </div>
      )}
      {apiUrl && loading && (
        <div style={{ padding: "80px 0", textAlign: "center", color: "hsl(var(--text-300))" }}>
          <div style={{ fontSize: 24, marginBottom: 12 }}>⚡</div>
          <div style={{ fontSize: 14, fontWeight: 500 }}>Syncing dashboard with Google Sheets...</div>
        </div>
      )}

      {/* SETTINGS TAB */}
      {tab === "settings" && (
        <div className="claude-card" style={{ maxWidth: 640, margin: "0 auto" }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: "hsl(var(--text-000))" }}>Database Connection Config</div>
          <div style={{ fontSize: 13, color: "hsl(var(--text-400))", marginBottom: 20, lineHeight: 1.6 }}>
            Deploy the included Apps Script as a Web App, then paste the URL below.
            Everyone using the same URL sees the same live data — edits made here or in Google Sheets sync in real-time.
          </div>
          
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 6, color: "hsl(var(--text-400))", textTransform: "uppercase", letterSpacing: "0.05em" }}>Apps Script Web App URL</label>
            <input value={urlInput} onChange={e => setUrlInput(e.target.value)} placeholder="https://script.google.com/macros/s/.../exec"
              style={{ width: "100%", padding: "10px 14px", fontSize: 13.5, boxSizing: "border-box" }} />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 6, color: "hsl(var(--text-400))", textTransform: "uppercase", letterSpacing: "0.05em" }}>Your Name (for the ChangeLog)</label>
            <input value={nameInput} onChange={e => setNameInput(e.target.value)} placeholder="e.g. Priya"
              style={{ width: "100%", padding: "10px 14px", fontSize: 13.5, boxSizing: "border-box" }} />
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 6, color: "hsl(var(--text-400))", textTransform: "uppercase", letterSpacing: "0.05em" }}>Write Passcode</label>
            <input type="password" value={passcodeInput} onChange={e => setPasscodeInput(e.target.value)} placeholder="Enter edit passcode"
              style={{ width: "100%", padding: "10px 14px", fontSize: 13.5, boxSizing: "border-box" }} />
          </div>

          <div style={{ display: "flex", gap: 12 }}>
            <button onClick={saveConnection} className="Button_primary__0oSjX">
              Save & Connect
            </button>
            <button onClick={resetToDefault} className="Button_secondary__Teecd">
              Reset to Default URL
            </button>
          </div>
          {apiUrl && <div style={{ marginTop: 20, borderTop: "1px solid hsl(var(--border-200))", paddingTop: 16 }}><SyncDot status={syncStatus} /></div>}
        </div>
      )}

      {/* DASHBOARD TAB */}
      {tab === "dashboard" && apiUrl && !loading && (
        <div>
          {/* Metrics Grid */}
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 24 }}>
            <MetricCard label="Topics Completed" value={`${stats.done}/${stats.totalTopics}`} sub={`${stats.inProgress} in progress`} color="hsl(var(--accent-brand))" />
            <MetricCard label="PYQs Solved" value={stats.totalPyq} sub={`of ${stats.pyqTarget} target`} color="var(--success-color)" />
            <MetricCard label="Mocks Completed" value={stats.mocksDone} sub={`of ${mocks.length} scheduled`} color="var(--warning-color)" />
            <MetricCard label="Avg Mock Score" value={`${stats.avgScorePct}%`} sub="across completed mocks" color="var(--info-color)" />
            <MetricCard label="High Confidence" value={stats.highConf} sub={`of ${stats.totalTopics} topics`} color="#a5b4fc" />
          </div>

          {/* Subject Progress Container */}
          <div className="claude-card">
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16, display: "flex", alignItems: "center", gap: 8, color: "hsl(var(--text-000))" }}>
              <span>📊</span> Subject-wise Progress
            </div>
            
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {subjects.map(s => {
                const pct = Number(s.pctComplete) ? Math.round(Number(s.pctComplete) * 100) : 0;
                const subjColor = s.color ? `#${s.color}` : "hsl(var(--accent-brand))";
                return (
                  <div key={s.id} style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 16,
                    padding: "12px 16px",
                    backgroundColor: "hsl(var(--bg-200))",
                    border: "1px solid hsl(var(--border-200))",
                    borderRadius: 12,
                    flexWrap: "wrap"
                  }}>
                    <div style={{ width: 10, height: 10, borderRadius: 99, background: subjColor, flexShrink: 0 }} />
                    <div style={{ width: 180, fontSize: 13.5, fontWeight: 600, flexShrink: 0, color: "hsl(var(--text-000))" }}>{s.name}</div>
                    <div style={{ flexShrink: 0 }}><Badge text={s.priority} style={PRIORITY_STYLE[s.priority]} /></div>
                    <div style={{ flex: 1, minWidth: 150 }}><ProgressBar pct={pct} color={subjColor} height={8} /></div>
                    <div className="font-mono" style={{ fontSize: 12.5, color: "hsl(var(--text-300))", width: 100, textAlign: "right", fontWeight: 500 }}>{s.topicsDone}/{s.topicsTotal} topics</div>
                    <div className="font-mono" style={{ fontSize: 12.5, color: "hsl(var(--text-300))", width: 100, textAlign: "right", fontWeight: 500 }}>{s.pyqDone}/{s.pyqTarget} PYQs</div>
                    <div className="font-mono" style={{ fontSize: 14, fontWeight: 700, width: 50, textAlign: "right", color: subjColor }}>{pct}%</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* TOPICS TAB */}
      {tab === "topics" && apiUrl && !loading && (
        <div className="claude-card">
          {/* Filtering bar */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <select value={filterSubject} onChange={e => setFilterSubject(e.target.value)}
                style={{ padding: "8px 12px", fontSize: 13, fontWeight: 600 }}>
                <option value="All">All Subjects</option>
                {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                style={{ padding: "8px 12px", fontSize: 13, fontWeight: 600 }}>
                <option value="All">All Statuses</option>
                {(lists.TopicStatus || []).map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div style={{ fontSize: 13, color: "hsl(var(--text-400))", fontWeight: 600 }}>{filteredTopics.length} topics found</div>
          </div>

          <div style={{ overflowX: "auto", border: "1px solid hsl(var(--border-200))", borderRadius: 10 }}>
            <table style={{ fontSize: 13 }}>
              <thead>
                <tr style={{ background: "hsl(var(--bg-200))", textAlign: "left" }}>
                  {["Subject", "Topic", "Difficulty", "Status", "Confidence", "PYQ Done / Target", "Rev 1", "Rev 2", "Rev 3", "Notes"].map(h => (
                    <th key={h} style={{ padding: "12px 14px", color: "hsl(var(--text-400))", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredTopics.map(t => {
                  const subjectColor = subjectById[t.subjectId]?.color ? `#${subjectById[t.subjectId].color}` : "hsl(var(--text-300))";
                  return (
                    <tr key={t.id} className="row-hover" style={{ borderBottom: "1px solid hsl(var(--border-200))" }}>
                      <td style={{ padding: "12px 14px", whiteSpace: "nowrap", color: subjectColor, fontWeight: 700 }}>
                        {subjectById[t.subjectId]?.shortName || t.subject}
                      </td>
                      <td style={{ padding: "12px 14px", fontWeight: 600, minWidth: 180, color: "hsl(var(--text-000))" }}>{t.topic}</td>
                      <td style={{ padding: "12px 14px" }}>
                        <span style={{
                          fontSize: 11, fontWeight: 600, padding: "2px 6px", borderRadius: 4,
                          background: t.difficulty === "Hard" ? "rgba(239, 68, 68, 0.08)" : t.difficulty === "Medium" ? "rgba(245, 158, 11, 0.08)" : "rgba(16, 185, 129, 0.08)",
                          color: t.difficulty === "Hard" ? "var(--danger-color)" : t.difficulty === "Medium" ? "var(--warning-color)" : "var(--success-color)"
                        }}>{t.difficulty}</span>
                      </td>
                      <td style={{ padding: "12px 14px" }}>
                        <InlineSelect value={t.status} options={lists.TopicStatus} styleMap={STATUS_STYLE} onChange={v => updateTopic(t.id, "status", v)} />
                      </td>
                      <td style={{ padding: "12px 14px" }}>
                        <InlineSelect value={t.confidence} options={lists.Confidence} styleMap={CONFIDENCE_STYLE} onChange={v => updateTopic(t.id, "confidence", v)} />
                      </td>
                      <td className="font-mono" style={{ padding: "12px 14px", whiteSpace: "nowrap", color: "hsl(var(--text-300))", fontWeight: 500 }}>
                        <input type="number" value={t.pyqDone} onChange={e => updateTopic(t.id, "pyqDone", Number(e.target.value))}
                          style={{ width: 44, padding: "4px 6px", fontSize: 12, textAlign: "center" }} />
                        <span style={{ margin: "0 4px" }}>/</span>
                        <span>{t.pyqTarget}</span>
                      </td>
                      {["rev1", "rev2", "rev3"].map(f => (
                        <td key={f} style={{ padding: "12px 14px", textAlign: "center" }}>
                          <input type="checkbox" checked={String(t[f]) === "TRUE" || t[f] === true}
                            onChange={e => updateTopic(t.id, f, e.target.checked ? "TRUE" : "FALSE")}
                            style={{ width: 15, height: 15, cursor: "pointer", accentColor: "hsl(var(--accent-brand))" }} />
                        </td>
                      ))}
                      <td style={{ padding: "12px 14px" }}>
                        <input type="text" defaultValue={t.notes} onBlur={e => updateTopic(t.id, "notes", e.target.value)}
                          placeholder="Add a note…" style={{ width: 140, padding: "5px 8px", fontSize: 12 }} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MOCK TESTS TAB */}
      {tab === "mocks" && apiUrl && !loading && (
        <div className="claude-card">
          <div style={{ overflowX: "auto", border: "1px solid hsl(var(--border-200))", borderRadius: 10 }}>
            <table style={{ fontSize: 13 }}>
              <thead>
                <tr style={{ background: "hsl(var(--bg-200))", textAlign: "left" }}>
                  {["Date", "Type", "Covers", "Platform", "Status", "Score", "Rank Est.", "Weak Areas", "Action Taken"].map(h => (
                    <th key={h} style={{ padding: "12px 14px", color: "hsl(var(--text-400))", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {mocks.map(m => (
                  <tr key={m.id} className="row-hover" style={{ borderBottom: "1px solid hsl(var(--border-200))" }}>
                    <td style={{ padding: "12px 14px", whiteSpace: "nowrap", fontWeight: 600, color: "hsl(var(--text-000))" }}>
                      {m.date ? new Date(m.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : ""}
                    </td>
                    <td style={{ padding: "12px 14px", whiteSpace: "nowrap", fontWeight: 500 }}>{m.type}</td>
                    <td style={{ padding: "12px 14px", maxWidth: 160, color: "hsl(var(--text-200))", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={m.subjectsCovered}>
                      {m.subjectsCovered}
                    </td>
                    <td style={{ padding: "12px 14px", color: "hsl(var(--text-400))" }}>{m.platform}</td>
                    <td style={{ padding: "12px 14px" }}>
                      <InlineSelect value={m.status} options={lists.MockStatus} styleMap={MOCK_STATUS_STYLE} onChange={v => updateMock(m.id, "status", v)} />
                    </td>
                    <td className="font-mono" style={{ padding: "12px 14px", whiteSpace: "nowrap", fontWeight: 500 }}>
                      <input type="number" defaultValue={m.score} onBlur={e => updateMock(m.id, "score", Number(e.target.value))}
                        placeholder="—" style={{ width: 48, padding: "4px 6px", fontSize: 12, textAlign: "center" }} />
                      <span style={{ margin: "0 4px", color: "hsl(var(--text-400))" }}>/</span>
                      <span style={{ color: "hsl(var(--text-200))" }}>{m.maxScore}</span>
                    </td>
                    <td style={{ padding: "12px 14px" }}>
                      <input type="text" defaultValue={m.rankEst} onBlur={e => updateMock(m.id, "rankEst", e.target.value)}
                        placeholder="Rank" style={{ width: 64, padding: "4px 6px", fontSize: 12 }} />
                    </td>
                    <td style={{ padding: "12px 14px" }}>
                      <input type="text" defaultValue={m.weakAreas} onBlur={e => updateMock(m.id, "weakAreas", e.target.value)}
                        placeholder="Weak topics…" style={{ width: 120, padding: "4px 6px", fontSize: 12 }} />
                    </td>
                    <td style={{ padding: "12px 14px" }}>
                      <input type="text" defaultValue={m.actionTaken} onBlur={e => updateMock(m.id, "actionTaken", e.target.value)}
                        placeholder="Action plan…" style={{ width: 120, padding: "4px 6px", fontSize: 12 }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* STUDY PLAN TAB */}
      {tab === "plan" && apiUrl && !loading && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
            {plan.map((m, i) => {
              const themeColor = m.color ? `#${m.color}` : "hsl(var(--accent-brand))";
              return (
                <div key={i} className="claude-card" style={{
                  borderLeft: `4px solid ${themeColor}`
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: "hsl(var(--text-000))", marginBottom: 4 }}>{m.month}</div>
                      <Badge text={m.phase} style={{ bg: `${themeColor}15`, color: themeColor }} />
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 10, color: "hsl(var(--text-400))", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700 }}>Target Goal</div>
                      <div style={{ fontSize: 11.5, color: themeColor, fontWeight: 700, maxWidth: 140, textAlign: "right", lineHeight: 1.3 }}>{m.targetOutcome}</div>
                    </div>
                  </div>
                  
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: "hsl(var(--text-000))" }}>{m.primaryFocus}</div>
                  <div style={{ fontSize: 12, color: "hsl(var(--text-200))", marginBottom: 16, lineHeight: 1.5 }}>{m.keyTopics}</div>
                  
                  <div style={{ borderTop: "1px solid hsl(var(--border-200))", paddingTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 10, color: "hsl(var(--text-400))", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700, marginBottom: 4 }}>PYQ goal</div>
                      <div className="font-mono" style={{ fontSize: 12, color: "hsl(var(--text-200))", fontWeight: 500 }}>{m.pyqGoal}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: "hsl(var(--text-400))", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700, marginBottom: 4 }}>Mock test</div>
                      <div className="font-mono" style={{ fontSize: 12, color: "hsl(var(--text-200))", fontWeight: 500 }}>{m.mockGoal}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
