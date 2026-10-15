'use client';
import { Component, type ReactNode } from 'react';

/** Send a crash to Observability (never throws). */
export function reportCrash(where: string, err: unknown, healed = false) {
  try {
    const e = err as { message?: string; stack?: string };
    fetch('/api/clienterr', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ where, message: e?.message || String(err), stack: e?.stack || '', healed }), keepalive: true }).catch(() => {});
  } catch {}
}
// a new deploy replaced the code this open tab was using → the fix is simply loading the new version
const isStaleCode = (e: unknown) => /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(String((e as Error)?.message || e));

/**
 * Self-healing page guard: one page crashing never takes the whole app down.
 * 1st crash → silently re-mounts the page once (most crashes are a bad API answer or a race).
 * Old code after a deploy → reloads the app once. Still broken → a small card with Retry / Reload, and the crash is logged.
 */
export default class TabBoundary extends Component<{ name: string; children: ReactNode }, { err: Error | null; tries: number }> {
  state = { err: null as Error | null, tries: 0 };
  static getDerivedStateFromError(err: Error) { return { err }; }
  componentDidCatch(err: Error) {
    if (isStaleCode(err)) {
      try { if (!sessionStorage.getItem('fj_reloaded')) { sessionStorage.setItem('fj_reloaded', '1'); reportCrash(this.props.name, err, true); window.location.reload(); return; } } catch {}
    }
    const auto = this.state.tries < 1;
    reportCrash(this.props.name, err, auto);
    if (auto) setTimeout(() => this.setState((s) => ({ err: null, tries: s.tries + 1 })), 400);
  }
  componentDidUpdate(prev: { name: string }) {
    if (prev.name !== this.props.name && (this.state.err || this.state.tries)) this.setState({ err: null, tries: 0 }); // switching page = fresh start
  }
  render() {
    if (!this.state.err) return this.props.children;
    if (this.state.tries < 1) return <div className="panel small muted">Recovering this page…</div>;
    return (
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>⚠ “{this.props.name}” hit an error</h3>
        <p className="small muted">The rest of the app still works. The error was logged in Setup → Observability.</p>
        <pre className="small mono" style={{ whiteSpace: 'pre-wrap', opacity: 0.8 }}>{this.state.err.message.slice(0, 300)}</pre>
        <div className="row" style={{ gap: 6 }}>
          <button className="primary" onClick={() => this.setState({ err: null, tries: 0 })}>⟳ Retry this page</button>
          <button onClick={() => { try { sessionStorage.removeItem('fj_reloaded'); } catch {} window.location.reload(); }}>Reload app</button>
        </div>
      </div>
    );
  }
}
