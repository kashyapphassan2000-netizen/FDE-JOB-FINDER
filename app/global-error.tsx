'use client';
import { useEffect } from 'react';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    fetch('/api/clienterr', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ where: 'root', message: error.message, stack: error.stack || '' }), keepalive: true }).catch(() => {});
  }, [error]);
  return (
    <html lang="en"><body style={{ fontFamily: 'system-ui', padding: 24, background: '#0d1424', color: '#fff' }}>
      <h2>FDE Job Finder hit an error</h2>
      <p style={{ opacity: 0.7 }}>{error.message.slice(0, 200)}</p>
      <button onClick={reset}>Retry</button> <button onClick={() => window.location.reload()}>Reload</button>
    </body></html>
  );
}
