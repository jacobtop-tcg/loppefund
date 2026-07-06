'use client';

import dynamic from 'next/dynamic';
import { MapSkeleton } from './MapSkeleton.tsx';

const Inner = dynamic(() => import('./DetailMapInner.tsx').then((m) => m.DetailMapInner), {
  ssr: false,
  loading: () => <MapSkeleton />,
});

export function DetailMap(props: { lat: number; lng: number; approximate?: boolean }) {
  return <Inner {...props} />;
}
