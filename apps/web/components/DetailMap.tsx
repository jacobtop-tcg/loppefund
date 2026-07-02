'use client';

import dynamic from 'next/dynamic';

const Inner = dynamic(() => import('./DetailMapInner.tsx').then((m) => m.DetailMapInner), {
  ssr: false,
  loading: () => (
    <div style={{ height: '100%', display: 'grid', placeItems: 'center', color: 'var(--ink-faint)', fontSize: 13 }}>
      Indlæser kort…
    </div>
  ),
});

export function DetailMap(props: { lat: number; lng: number }) {
  return <Inner {...props} />;
}
