'use client';
import { useEffect } from 'react';
import { reportCrash } from '@/components/TabBoundary';

// Last line of defence: anything that escapes a page guard lands here instead of a blank "Application error" screen.
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportCrash('app', error);
    if (/ChunkLoadError|Loading chunk|dynamically imported module/i.test(error.message)) {
      try { if (!sessionStorage.getItem('fj_reloaded')) { sessionStorage.setItem('fj_reloaded', '1'); window.location.reload(); return; } } catch {}
    }
    const t = setTimeout(reset, 1500); // self-heal: try again once on its own
    return () => clearTimeout(t);
  }, [error, reset]);
  return (
    <div style={{ padding: 24, fontFamily: 'system-ui' }}>
      <h2>Something broke — recovering…</h2>
      <p style={{ opacity: 0.7 }}>{error.message.slice(0, 200)}</p>
      <button onClick={reset}>Retry</button> <button onClick={() => window.location.reload()}>Reload</button>
    </div>
  );
}
