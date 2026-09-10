import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Instagram,
  LoaderCircle,
  MessageCircle,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  WifiOff,
  X,
} from "lucide-react";
import { InstagramApiError, type ApiEnvelope, type InstagramOverview, type PendingAction } from "./types";

const SETUP_GUIDE = "https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/get-started";

export default function InstagramApp({ apiBase }: { apiBase: string }) {
  const [overview, setOverview] = useState<InstagramOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState("");
  const [unlockToken, setUnlockToken] = useState("");
  const [locked, setLocked] = useState(false);

  const request = useCallback(
    async <T,>(route: string, options?: RequestInit): Promise<T> => {
      const response = await fetch(`${apiBase}${route}`, {
        credentials: "same-origin",
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...(options?.headers ?? {}),
        },
      });
      const payload = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
      if (!response.ok || payload?.ok !== true || payload.data === undefined) {
        const detail = typeof payload?.error === "string" ? payload.error : payload?.error?.message;
        throw new InstagramApiError(detail ?? `Instagram request failed (${response.status})`, response.status);
      }
      return payload.data;
    },
    [accessToken, apiBase],
  );

  const load = useCallback(
    async (quiet = false) => {
      quiet ? setRefreshing(true) : setLoading(true);
      try {
        setOverview(await request<InstagramOverview>("/overview"));
        setError(null);
      } catch (reason) {
        if (reason instanceof InstagramApiError && reason.status === 401) setLocked(true);
        setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [request],
  );

  useEffect(() => void load(), [load]);

  function unlock(event: FormEvent) {
    event.preventDefault();
    const token = unlockToken.trim();
    if (!token) return;
    setError(null);
    setLocked(false);
    setAccessToken(token);
    setUnlockToken("");
  }

  async function decide(action: PendingAction, decision: "approve" | "reject") {
    setBusyAction(action.id);
    try {
      await request(`/actions/${encodeURIComponent(action.id)}/${decision}`, { method: "POST", body: "{}" });
      await load(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyAction(null);
    }
  }

  async function stopWrites() {
    if (!window.confirm("Disable all Instagram writes until the service is restarted or re-enabled by the operator?")) return;
    setBusyAction("kill-writes");
    try {
      await request("/kill-writes", { method: "POST", body: "{}" });
      await load(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyAction(null);
    }
  }

  if (loading) {
    return <StateMessage icon={<LoaderCircle className="spin" />} title="Opening Instagram" detail="Checking the local service and approval queue." />;
  }

  if (locked) {
    return <UnlockScreen token={unlockToken} setToken={setUnlockToken} submit={unlock} error={error} />;
  }

  if (!overview) {
    return <StateMessage icon={<WifiOff />} title="Instagram dashboard is unavailable" detail={error ?? "The plugin did not return a dashboard."} action={<button className="button" onClick={() => void load()}><RefreshCw size={15} />Retry</button>} />;
  }

  const connected = overview.connected;
  const writesEnabled = connected && overview.health.writes_enabled;
  return (
    <section className="instagram-shell">
      <header className="instagram-header">
        <div>
          <div className="eyebrow">ORION / INSTAGRAM</div>
          <div className="title-row">
            <h1>Instagram Operations</h1>
            <span className={`connection-badge ${connected ? "online" : "offline"}`}>
              {connected ? <CheckCircle2 size={13} /> : <WifiOff size={13} />}
              {connected ? "SERVICE ONLINE" : "SETUP REQUIRED"}
            </span>
          </div>
          <p>Official Meta API activity, approvals, and account safety for Neckermann Travel.</p>
        </div>
        <div className="header-actions">
          <button className="button" onClick={() => void load(true)} disabled={refreshing}>
            <RefreshCw size={15} className={refreshing ? "spin" : ""} />
            Refresh status
          </button>
          <a className="button primary" href={SETUP_GUIDE} target="_blank" rel="noreferrer">
            Open setup guide <ExternalLink size={14} />
          </a>
        </div>
      </header>

      {error && <div className="error-banner"><AlertTriangle size={16} /><span>{error}</span><button title="Dismiss" onClick={() => setError(null)}><X size={15} /></button></div>}

      <div className="status-rail" aria-label="Instagram service status">
        <Status label="Service" value={connected ? "Online" : "Offline"} detail={connected ? "Local MCP reachable" : overview.state === "unavailable" ? "Local MCP unavailable" : "Credential not configured"} tone={connected ? "good" : "muted"} />
        <Status label="Meta account" value={connected ? "Configured" : "Not connected"} detail={connected ? "Managed by Instagram MCP" : "Add live credentials later"} tone={connected ? "good" : "muted"} />
        <Status label="Writes" value={writesEnabled ? "Enabled" : "Disabled"} detail={overview.health.dry_run ? "Dry run is active" : "Service policy enforced"} tone={writesEnabled ? "warn" : "good"} />
        <Status label="Approval queue" value={overview.pending_available ? String(overview.pending.length) : "Unavailable"} detail={overview.pending_available ? "Human review required" : "Writes control remains available"} tone={!overview.pending_available || overview.pending.length ? "warn" : "good"} />
      </div>

      <div className="dashboard-grid">
        <div className="primary-column">
          {!connected && <SetupCard />}
          <Panel title="Pending actions" icon={<Clock3 size={17} />} meta={`${overview.pending.length} WAITING`}>
            {overview.pending.length ? (
              <div className="action-list">
                {overview.pending.map((action) => (
                  <article className="action-row" key={action.id}>
                    <div className="action-icon"><MessageCircle size={17} /></div>
                    <div className="action-copy">
                      <strong>{humanAction(action.action)}</strong>
                      <span>{action.target || "Instagram account"} · {action.principal}</span>
                      <small>Expires {formatTime(action.expires_at)}</small>
                      <div className="payload-review">
                        <span>Proposed payload</span>
                        <pre>{formatPayload(action.payload)}</pre>
                      </div>
                    </div>
                    <div className="row-actions">
                      <button className="icon-button approve" title="Approve action" disabled={busyAction === action.id} onClick={() => void decide(action, "approve")}><Check size={16} /></button>
                      <button className="icon-button reject" title="Reject action" disabled={busyAction === action.id} onClick={() => void decide(action, "reject")}><X size={16} /></button>
                    </div>
                  </article>
                ))}
              </div>
            ) : <Empty icon={overview.pending_available ? <CheckCircle2 size={24} /> : <AlertTriangle size={24} />} title={overview.pending_available ? "No actions are waiting" : "Approval queue is unavailable"} detail={overview.pending_available ? (connected ? "New comment, message, and publishing proposals will appear here." : "The queue will appear after the Instagram MCP service is connected.") : "Refresh to retry. Emergency write shutdown remains available."} />}
          </Panel>
          <Panel title="Recent activity" icon={<Activity size={17} />}>
            <Empty icon={<Activity size={24} />} title="No activity yet" detail={connected ? "Instagram events will appear after agents begin using the official API." : "Connect the service to begin receiving authenticated Instagram events."} />
          </Panel>
        </div>

        <aside className="secondary-column">
          <Panel title="Safety controls" icon={<ShieldCheck size={17} />}>
            <div className="safety-state">
              <div className={`safety-icon ${writesEnabled ? "warn" : "safe"}`}>
                {writesEnabled ? <ShieldCheck size={20} /> : <ShieldOff size={20} />}
              </div>
              <div><strong>{writesEnabled ? "Writes are enabled" : "Writes are disabled"}</strong><span>{connected ? "The service enforces account policy and rate limits." : "No Meta mutation can run in disconnected mode."}</span></div>
            </div>
            <ul className="guard-list">
              <li><Check size={14} />Human approval for queued writes</li>
              <li><Check size={14} />Agent permissions enforced by OpenClaw</li>
              <li><Check size={14} />Official Meta APIs only</li>
            </ul>
            <button className="danger-button" disabled={!connected || !writesEnabled || busyAction === "kill-writes"} onClick={() => void stopWrites()}>
              <ShieldOff size={15} />Disable all writes
            </button>
          </Panel>
          <Panel title="Connection" icon={<Instagram size={17} />}>
            <dl className="connection-list">
              <div><dt>Business</dt><dd>Neckermann Travel</dd></div>
              <div><dt>API</dt><dd>Instagram Graph API</dd></div>
              <div><dt>Mode</dt><dd>{overview.health.dry_run ? "Dry run" : "Policy controlled"}</dd></div>
              <div><dt>Transport</dt><dd>Local MCP service</dd></div>
            </dl>
          </Panel>
        </aside>
      </div>
    </section>
  );
}

function SetupCard() {
  const steps = [
    "Create or select the Meta developer app",
    "Connect the Neckermann Facebook Page and Instagram professional account",
    "Add the live operator token to Orion's private environment",
  ];
  return <section className="setup-card">
    <div className="setup-mark"><Instagram size={25} /></div>
    <div className="setup-copy">
      <span className="eyebrow">CONNECTION CHECKLIST</span>
      <h2>Connect Neckermann Instagram</h2>
      <p>The dashboard is installed. Add Meta credentials later to activate official reads, comments, messages, and publishing.</p>
      <ol>{steps.map((step, index) => <li key={step}><span>{index + 1}</span>{step}</li>)}</ol>
    </div>
  </section>;
}

function UnlockScreen({ token, setToken, submit, error }: { token: string; setToken: (value: string) => void; submit: (event: FormEvent) => void; error: string | null }) {
  return <div className="unlock-shell">
    <form className="unlock-card" onSubmit={submit}>
      <div className="unlock-icon"><ShieldCheck size={24} /></div>
      <span className="eyebrow">OPERATOR ACCESS</span>
      <h1>Unlock Instagram Operations</h1>
      <p>Enter the separate Orion ingress token to view proposed content and use approval controls.</p>
      <label><span>Ingress token</span><input type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" spellCheck={false} /></label>
      {error && <div className="unlock-error">{error}</div>}
      <button className="button primary" disabled={!token.trim()}><ShieldCheck size={15} />Unlock dashboard</button>
      <small>The token stays in this page's memory and is cleared when the dashboard reloads.</small>
    </form>
  </div>;
}

function Status({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: "good" | "warn" | "muted" }) {
  return <div className="status-item"><span>{label}</span><strong className={tone}><i />{value}</strong><small>{detail}</small></div>;
}

function Panel({ title, icon, meta, children }: { title: string; icon: ReactNode; meta?: string; children: ReactNode }) {
  return <section className="panel"><header><div className="panel-title">{icon}<h2>{title}</h2></div>{meta && <span className="panel-meta">{meta}</span>}</header><div className="panel-body">{children}</div></section>;
}

function Empty({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return <div className="empty-state"><div>{icon}</div><strong>{title}</strong><span>{detail}</span></div>;
}

function StateMessage({ icon, title, detail, action }: { icon: ReactNode; title: string; detail: string; action?: ReactNode }) {
  return <div className="state-message">{icon}<h2>{title}</h2><p>{detail}</p>{action}</div>;
}

function humanAction(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatTime(value: string | number) {
  const numeric = typeof value === "number" ? value : Number(value);
  const date = new Date(Number.isFinite(numeric) ? numeric : value);
  return Number.isNaN(date.valueOf()) ? "at an unknown time" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatPayload(value: PendingAction["payload"]) {
  if (typeof value !== "string") return JSON.stringify(value, null, 2);
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}
