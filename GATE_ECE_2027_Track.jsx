import { useState, useMemo, useCallback, useEffect, useRef } from "react";

/* ---------- standardized style maps (mirror the Lists sheet in Google Sheets) ---------- */
const STATUS_STYLE = {
  "Not Started": { bg: "#F1EFE8", color: "#5F5E5A" },
  "In Progress": { bg: "#FAEEDA", color: "#854F0B" },
  "Done": { bg: "#EAF3DE", color: "#3B6D11" },
  "Skipped": { bg: "#FCEBEB", color: "#A32D2D" },
};
const CONFIDENCE_STYLE = {
  "Low": { bg: "#FCEBEB", color: "#A32D2D" },
  "Medium": { bg: "#FAEEDA", color: "#854F0B" },
  "High": { bg: "#EAF3DE", color: "#3B6D11" },
};
const PRIORITY_STYLE = {
  "Very High": { bg: "#EEEDFE", color: "#3C3489" },
  "High": { bg: "#FAEEDA", color: "#854F0B" },
  "Medium": { bg: "#E1F5EE", color: "#0F6E56" },
};
const MOCK_STATUS_STYLE = {
  "Scheduled": { bg: "#F1EFE8", color: "#5F5E5A" },
  "Completed": { bg: "#EAF3DE", color: "#3B6D11" },
  "Missed": { bg: "#FCEBEB", color: "#A32D2D" },
  "Rescheduled": { bg: "#FAEEDA", color: "#854F0B" },
};

const POLL_VERSION_MS = 8000; // cheap "did anything change" check
const STORAGE_KEY = "gate_apps_script_url";
const USER_KEY = "gate_user_name";

/* ---------------------------------- small UI atoms ---------------------------------- */
function Badge({ text, style }) {
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 4,
      fontSize: 11, fontWeight: 500, whiteSpace: "nowrap",
      background: style?.bg || "#F1EFE8", color: style?.color || "#5F5E5A",
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
        border: "0.5px solid var(--color-border-tertiary)",
        borderRadius: 4, padding: "2px 6px", fontSize: 12,
        background: styleMap?.[value]?.bg || "var(--color-background-secondary)",
        color: styleMap?.[value]?.color || "var(--color-text-primary)",
        fontWeight: 500, cursor: disabled ? "not-allowed" : "pointer", appearance: "auto",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {!options?.includes(value) && value ? <option value={value}>{value}</option> : null}
      {(options || []).map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function ProgressBar({ pct, color = "#7F77DD", height = 6 }) {
  return (
    <div style={{ background: "var(--color-border-tertiary)", borderRadius: 99, height, overflow: "hidden", minWidth: 60 }}>
      <div style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: color, height: "100%", borderRadius: 99, transition: "width 0.3s" }} />
    </div>
  );
}

function MetricCard({ label, value, sub, color }) {
  return (
    <div style={{ background: "var(--color-background-secondary)", borderRadius: 8, padding: "12px 16px", flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 500, color: color || "var(--color-text-primary)", lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function SyncDot({ status }) {
  const map = {
    idle: { color: "#888780", label: "Connecting…" },
    syncing: { color: "#BA7517", label: "Syncing…" },
    saved: { color: "#3B6D11", label: "Live" },
    error: { color: "#A32D2D", label: "Sync error" },
    offline: { color: "#888780", label: "Not connected" },
  };
  const s = map[status] || map.idle;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--color-text-secondary)" }}>
      <span style={{ width: 7, height: 7, borderRadius: 99, background: s.color, display: "inline-block",
        animation: status === "syncing" ? "pulse 1s infinite" : "none" }} />
      {s.label}
    </div>
  );
}

/* ---------------------------------- backend hook ---------------------------------- */
function useGateBackend(apiUrl, userName) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [syncStatus, setSyncStatus] = useState("idle");
  const versionRef = useRef(0);
  const pollRef = useRef(null);

  const fetchSnapshot = useCallback(async () => {
    if (!apiUrl) return;
    try {
      const res = await fetch(apiUrl, { method: "GET" });
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
    } catch {
      // silent — next poll will retry; full fetch errors are surfaced separately
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
    // optimistic local update
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
        headers: { "Content-Type": "text/plain;charset=utf-8" }, // avoids CORS preflight on Apps Script
        body: JSON.stringify({ sheet, id, field, value, user: userName || "Guest" }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Write failed");
      versionRef.current = json.version;
      setSyncStatus("saved");
    } catch (err) {
      setError(String(err.message || err));
      setSyncStatus("error");
      fetchSnapshot(); // reconcile with server truth on failure
    }
  }, [apiUrl, userName, fetchSnapshot]);

  return { data, loading, error, syncStatus, write, refresh: fetchSnapshot };
}

/* ---------------------------------- main component ---------------------------------- */
export default function GateTracker() {
  const [tab, setTab] = useState("dashboard");
  const [apiUrl, setApiUrl] = useState("");
  const [userName, setUserName] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [filterSubject, setFilterSubject] = useState("All");
  const [filterStatus, setFilterStatus] = useState("All");
  const [storageReady, setStorageReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const u = await window.storage.get(STORAGE_KEY, false);
        if (u) { setApiUrl(u.value); setUrlInput(u.value); }
      } catch {}
      try {
        const n = await window.storage.get(USER_KEY, false);
        if (n) { setUserName(n.value); setNameInput(n.value); }
      } catch {}
      setStorageReady(true);
    })();
  }, []);

  const { data, loading, error, syncStatus, write, refresh } = useGateBackend(apiUrl, userName);

  const saveConnection = useCallback(async () => {
    setApiUrl(urlInput.trim());
    setUserName(nameInput.trim());
    try {
      await window.storage.set(STORAGE_KEY, urlInput.trim(), false);
      await window.storage.set(USER_KEY, nameInput.trim(), false);
    } catch {}
  }, [urlInput, nameInput]);

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
    <div style={{ fontFamily: "var(--font-sans)", color: "var(--color-text-primary)", maxWidth: 980, margin: "0 auto", paddingBottom: 32 }}>
      <h2 className="sr-only">GATE ECE 2027 Preparation Tracker</h2>

      {/* Header */}
      <div style={{ padding: "20px 0 0", borderBottom: "0.5px solid var(--color-border-tertiary)", marginBottom: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>GATE ECE 2027 · Live</div>
            <div style={{ fontSize: 20, fontWeight: 500, lineHeight: 1.2 }}>Preparation Tracker</div>
            <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 4 }}>
              {daysToExam !== null ? `${daysToExam} days to exam` : "Connect to your Sheet to begin"} &nbsp;·&nbsp; Target AIR &lt; {config.TargetAIR || "—"}
            </div>
          </div>
          <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
            <SyncDot status={notConnected ? "offline" : syncStatus} />
            <div style={{ textAlign: "center", minWidth: 56 }}>
              <div style={{ fontSize: 22, fontWeight: 500, color: "#534AB7" }}>{overallPct}%</div>
              <div style={{ fontSize: 10, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Overall</div>
            </div>
            <div style={{ width: 80 }}>
              <ProgressBar pct={overallPct} color="#534AB7" height={8} />
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 0, overflowX: "auto" }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              display: "flex", alignItems: "center", gap: 6, padding: "8px 16px",
              background: "transparent", border: "none", borderBottom: tab === t.id ? "2px solid #534AB7" : "2px solid transparent",
              color: tab === t.id ? "#534AB7" : "var(--color-text-secondary)",
              fontWeight: tab === t.id ? 500 : 400, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap",
            }}>{t.label}</button>
          ))}
        </div>
      </div>

      {/* Connection banner */}
      {storageReady && notConnected && tab !== "settings" && (
        <div style={{ margin: "16px 0", padding: "12px 16px", background: "#FAEEDA", borderRadius: 8, fontSize: 13, color: "#854F0B" }}>
          Not connected to Google Sheets yet. Open the <strong>Settings</strong> tab and paste your Apps Script Web App URL to start live syncing.
        </div>
      )}
      {apiUrl && error && (
        <div style={{ margin: "16px 0", padding: "12px 16px", background: "#FCEBEB", borderRadius: 8, fontSize: 13, color: "#A32D2D", display: "flex", justifyContent: "space-between", gap: 12 }}>
          <span>Couldn't reach the backend: {error}</span>
          <button onClick={refresh} style={{ background: "transparent", border: "1px solid #A32D2D", borderRadius: 6, padding: "2px 10px", color: "#A32D2D", cursor: "pointer", fontSize: 12 }}>Retry</button>
        </div>
      )}
      {apiUrl && loading && (
        <div style={{ padding: "40px 0", textAlign: "center", color: "var(--color-text-tertiary)", fontSize: 13 }}>Loading live data…</div>
      )}

      {/* SETTINGS TAB */}
      {tab === "settings" && (
        <div style={{ padding: "20px 0", maxWidth: 560 }}>
          <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 4 }}>Connect to your Google Sheet</div>
          <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 16, lineHeight: 1.5 }}>
            Deploy the included Apps Script as a Web App (see SETUP_GUIDE.md), then paste the URL below.
            Everyone who opens this dashboard with the same URL sees the same live data — edits made here,
            in the Sheet, or by a study partner all sync within a few seconds.
          </div>
          <label style={{ fontSize: 12, fontWeight: 500, display: "block", marginBottom: 4 }}>Apps Script Web App URL</label>
          <input value={urlInput} onChange={e => setUrlInput(e.target.value)} placeholder="https://script.google.com/macros/s/.../exec"
            style={{ width: "100%", padding: "8px 10px", fontSize: 13, border: "0.5px solid var(--color-border-tertiary)", borderRadius: 6, marginBottom: 12 }} />
          <label style={{ fontSize: 12, fontWeight: 500, display: "block", marginBottom: 4 }}>Your name (shown in the change log)</label>
          <input value={nameInput} onChange={e => setNameInput(e.target.value)} placeholder="e.g. Priya"
            style={{ width: "100%", padding: "8px 10px", fontSize: 13, border: "0.5px solid var(--color-border-tertiary)", borderRadius: 6, marginBottom: 16 }} />
          <button onClick={saveConnection} style={{ background: "#534AB7", color: "white", border: "none", borderRadius: 6, padding: "8px 18px", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>
            Save & Connect
          </button>
          {apiUrl && <div style={{ marginTop: 16 }}><SyncDot status={syncStatus} /></div>}
        </div>
      )}

      {/* DASHBOARD TAB */}
      {tab === "dashboard" && apiUrl && !loading && (
        <div style={{ padding: "20px 0" }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20 }}>
            <MetricCard label="Topics Done" value={`${stats.done}/${stats.totalTopics}`} sub={`${stats.inProgress} in progress`} color="#534AB7" />
            <MetricCard label="PYQs Solved" value={stats.totalPyq} sub={`of ${stats.pyqTarget} target`} color="#1D9E75" />
            <MetricCard label="Mocks Completed" value={stats.mocksDone} sub={`of ${mocks.length} scheduled`} color="#D85A30" />
            <MetricCard label="Avg Mock Score" value={`${stats.avgScorePct}%`} sub="across completed mocks" color="#378ADD" />
            <MetricCard label="High Confidence" value={stats.highConf} sub={`of ${stats.totalTopics} topics`} color="#0F6E56" />
          </div>

          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 10 }}>Subject-wise Progress</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {subjects.map(s => {
              const pct = Number(s.pctComplete) ? Math.round(Number(s.pctComplete) * 100) : 0;
              return (
                <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
                  <div style={{ width: 8, height: 8, borderRadius: 99, background: `#${s.color || "888780"}`, flexShrink: 0 }} />
                  <div style={{ width: 170, fontSize: 12.5, flexShrink: 0 }}>{s.name}</div>
                  <Badge text={s.priority} style={PRIORITY_STYLE[s.priority]} />
                  <div style={{ flex: 1 }}><ProgressBar pct={pct} color={`#${s.color || "534AB7"}`} /></div>
                  <div style={{ fontSize: 12, color: "var(--color-text-secondary)", width: 84, textAlign: "right" }}>{s.topicsDone}/{s.topicsTotal} topics</div>
                  <div style={{ fontSize: 12, color: "var(--color-text-secondary)", width: 90, textAlign: "right" }}>{s.pyqDone}/{s.pyqTarget} PYQs</div>
                  <div style={{ fontSize: 13, fontWeight: 500, width: 44, textAlign: "right" }}>{pct}%</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TOPICS TAB */}
      {tab === "topics" && apiUrl && !loading && (
        <div style={{ padding: "20px 0" }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
            <select value={filterSubject} onChange={e => setFilterSubject(e.target.value)}
              style={{ padding: "6px 10px", fontSize: 12, border: "0.5px solid var(--color-border-tertiary)", borderRadius: 6 }}>
              <option value="All">All Subjects</option>
              {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
              style={{ padding: "6px 10px", fontSize: 12, border: "0.5px solid var(--color-border-tertiary)", borderRadius: 6 }}>
              <option value="All">All Statuses</option>
              {(lists.TopicStatus || []).map(o => <option key={o} value={o}>{o}</option>)}
            </select>
            <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", alignSelf: "center" }}>{filteredTopics.length} topics</div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--color-border-tertiary)", textAlign: "left" }}>
                  {["Subject", "Topic", "Difficulty", "Status", "Confidence", "PYQ Done / Target", "Rev 1", "Rev 2", "Rev 3", "Notes"].map(h => (
                    <th key={h} style={{ padding: "8px 10px", color: "var(--color-text-tertiary)", fontWeight: 500, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredTopics.map(t => (
                  <tr key={t.id} className="row-hover" style={{ borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
                    <td style={{ padding: "8px 10px", whiteSpace: "nowrap", color: `#${subjectById[t.subjectId]?.color || "888780"}` }}>{subjectById[t.subjectId]?.shortName || t.subject}</td>
                    <td style={{ padding: "8px 10px", fontWeight: 500, minWidth: 160 }}>{t.topic}</td>
                    <td style={{ padding: "8px 10px" }}>{t.difficulty}</td>
                    <td style={{ padding: "8px 10px" }}>
                      <InlineSelect value={t.status} options={lists.TopicStatus} styleMap={STATUS_STYLE} onChange={v => updateTopic(t.id, "status", v)} />
                    </td>
                    <td style={{ padding: "8px 10px" }}>
                      <InlineSelect value={t.confidence} options={lists.Confidence} styleMap={CONFIDENCE_STYLE} onChange={v => updateTopic(t.id, "confidence", v)} />
                    </td>
                    <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                      <input type="number" value={t.pyqDone} onChange={e => updateTopic(t.id, "pyqDone", Number(e.target.value))}
                        style={{ width: 40, padding: "2px 4px", fontSize: 12, border: "0.5px solid var(--color-border-tertiary)", borderRadius: 4 }} /> / {t.pyqTarget}
                    </td>
                    {["rev1", "rev2", "rev3"].map(f => (
                      <td key={f} style={{ padding: "8px 10px", textAlign: "center" }}>
                        <input type="checkbox" checked={String(t[f]) === "TRUE" || t[f] === true}
                          onChange={e => updateTopic(t.id, f, e.target.checked ? "TRUE" : "FALSE")} />
                      </td>
                    ))}
                    <td style={{ padding: "8px 10px" }}>
                      <input type="text" defaultValue={t.notes} onBlur={e => updateTopic(t.id, "notes", e.target.value)}
                        placeholder="Add a note…" style={{ width: 130, padding: "2px 4px", fontSize: 12, border: "0.5px solid var(--color-border-tertiary)", borderRadius: 4 }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MOCK TESTS TAB */}
      {tab === "mocks" && apiUrl && !loading && (
        <div style={{ padding: "20px 0" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--color-border-tertiary)", textAlign: "left" }}>
                  {["Date", "Type", "Covers", "Platform", "Status", "Score", "Rank Est.", "Weak Areas", "Action Taken"].map(h => (
                    <th key={h} style={{ padding: "8px 10px", color: "var(--color-text-tertiary)", fontWeight: 500, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {mocks.map(m => (
                  <tr key={m.id} className="row-hover" style={{ borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
                    <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>{m.date ? new Date(m.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : ""}</td>
                    <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>{m.type}</td>
                    <td style={{ padding: "8px 10px", maxWidth: 160 }}>{m.subjectsCovered}</td>
                    <td style={{ padding: "8px 10px", color: "var(--color-text-secondary)" }}>{m.platform}</td>
                    <td style={{ padding: "8px 10px" }}>
                      <InlineSelect value={m.status} options={lists.MockStatus} styleMap={MOCK_STATUS_STYLE} onChange={v => updateMock(m.id, "status", v)} />
                    </td>
                    <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                      <input type="number" defaultValue={m.score} onBlur={e => updateMock(m.id, "score", Number(e.target.value))}
                        placeholder="—" style={{ width: 48, padding: "2px 4px", fontSize: 12, border: "0.5px solid var(--color-border-tertiary)", borderRadius: 4 }} /> / {m.maxScore}
                    </td>
                    <td style={{ padding: "8px 10px" }}>
                      <input type="text" defaultValue={m.rankEst} onBlur={e => updateMock(m.id, "rankEst", e.target.value)}
                        placeholder="e.g. 500" style={{ width: 60, padding: "2px 4px", fontSize: 12, border: "0.5px solid var(--color-border-tertiary)", borderRadius: 4 }} />
                    </td>
                    <td style={{ padding: "8px 10px" }}>
                      <input type="text" defaultValue={m.weakAreas} onBlur={e => updateMock(m.id, "weakAreas", e.target.value)}
                        placeholder="Weak topics…" style={{ width: 110, padding: "2px 4px", fontSize: 12, border: "0.5px solid var(--color-border-tertiary)", borderRadius: 4 }} />
                    </td>
                    <td style={{ padding: "8px 10px" }}>
                      <input type="text" defaultValue={m.actionTaken} onBlur={e => updateMock(m.id, "actionTaken", e.target.value)}
                        placeholder="Action…" style={{ width: 110, padding: "2px 4px", fontSize: 12, border: "0.5px solid var(--color-border-tertiary)", borderRadius: 4 }} />
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
        <div style={{ padding: "20px 0" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
            {plan.map((m, i) => (
              <div key={i} style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 12, padding: "14px 16px", borderLeft: `3px solid #${m.color}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 500 }}>{m.month}</div>
                    <Badge text={m.phase} style={{ bg: "#EEEDFE", color: "#3C3489" }} />
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginBottom: 2 }}>Target</div>
                    <div style={{ fontSize: 10, color: `#${m.color}`, fontWeight: 500, maxWidth: 120, textAlign: "right" }}>{m.targetOutcome}</div>
                  </div>
                </div>
                <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>{m.primaryFocus}</div>
                <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginBottom: 8, lineHeight: 1.5 }}>{m.keyTopics}</div>
                <div style={{ borderTop: "0.5px solid var(--color-border-tertiary)", paddingTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                  <div>
                    <div style={{ fontSize: 10, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>PYQ goal</div>
                    <div style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>{m.pyqGoal}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Mock test</div>
                    <div style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>{m.mockGoal}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <style>{`
        .row-hover:hover { background: var(--color-background-secondary) !important; }
        .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
      `}</style>
    </div>
  );
}
