import type { MetadataRoute } from 'next';

// Installable app (PWA): "Add to Home screen" on Android / iPhone opens full-screen like a native app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'FDE Job Finder',
    short_name: 'FDE Jobs',
    description: 'FDE & AI/ML jobs — Bengaluru office or remote from India',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0d1424',
    theme_color: '#0d1424',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Jobs', url: '/?tab=Jobs' },
      { name: 'Global companies hiring', url: '/?tab=Global%20companies%20hiring' },
    ],
  };
}
