/**
 * Bespoke inline icons, hand-drawn to match the editorial Fraunces/Instrument
 * Sans aesthetic — thin rounded strokes, `currentColor`, no emoji. Replacing the
 * generic emoji glyphs (✦ ☀️ ⚠️) with a cohesive icon language is the single
 * biggest "this was designed, not assembled" signal on the cards.
 */
import type { SVGProps } from 'react';

type IconProps = { size?: number } & SVGProps<SVGSVGElement>;

const base = (size: number): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

/** Hidden-gem mark — a four-point sparkle with a smaller companion. */
export function GemIcon({ size = 13, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M12 3.2c.5 2.9 1.9 4.3 4.8 4.8-2.9.5-4.3 1.9-4.8 4.8-.5-2.9-1.9-4.3-4.8-4.8C10.1 7.5 11.5 6.1 12 3.2Z" fill="currentColor" stroke="none" />
      <path d="M18.4 13.6c.26 1.5.98 2.2 2.5 2.5-1.52.3-2.24 1-2.5 2.5-.26-1.5-.98-2.2-2.5-2.5 1.52-.3 2.24-1 2.5-2.5Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Calendar — add-to-calendar CTA. */
export function CalendarIcon({ size = 15, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
    </svg>
  );
}

/** Compass/navigation — "find vej" wayfinding CTA. */
export function NavIcon({ size = 15, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <circle cx="12" cy="12" r="9" />
      <path d="M15.6 8.4 13.4 13.4 8.4 15.6 10.6 10.6 15.6 8.4Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Camera — photo contribution. */
export function CameraIcon({ size = 15, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M4 8.5h3l1.4-2.2h7.2L17 8.5h3a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z" />
      <circle cx="12" cy="13" r="3.2" />
    </svg>
  );
}

/** Info — circled i, for the approximate-location note. */
export function InfoIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 7.6h.01" />
    </svg>
  );
}

/** Heart — the saved/favourites signal. */
export function HeartIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M12 20s-7-4.4-9.2-8.6C1.4 8.7 2.6 5.5 5.7 5.1c2-.26 3.4.9 4.3 2.2.9-1.3 2.3-2.46 4.3-2.2 3.1.4 4.3 3.6 2.9 6.3C19 15.6 12 20 12 20Z" />
    </svg>
  );
}

/** Target/crosshair — the "near me" geolocation control. */
export function TargetIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" />
      <path d="M12 1.8v3M12 19.2v3M1.8 12h3M19.2 12h3" />
    </svg>
  );
}

/** Check — the "on" state for toggle chips (trip, etc.). */
export function CheckIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M5 12.5 10 17.5 19 6.5" />
    </svg>
  );
}

/** Route — a two-pin trip line, for the loppetur chip. */
export function RouteIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <circle cx="6" cy="18" r="2.2" />
      <circle cx="18" cy="6" r="2.2" />
      <path d="M8 16.2c3-1 5.4-3.4 6.4-6.4" strokeDasharray="0.1 3" />
    </svg>
  );
}

/** Warning — rounded triangle with a stem+dot. */
export function WarnIcon({ size = 13, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M12 4.3 3.4 19a1 1 0 0 0 .87 1.5h15.46A1 1 0 0 0 20.6 19L12 4.3Z" />
      <path d="M12 10v4" />
      <path d="M12 17.2h.01" />
    </svg>
  );
}

function Sun({ size, ...rest }: { size: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(size)} {...rest}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.6v2M12 19.4v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.6 12h2M19.4 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
    </svg>
  );
}
function PartlyCloudy({ size, ...rest }: { size: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(size)} {...rest}>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 2.8v1.2M3.4 8H2.2M4.5 4.5l.9.9M11.5 4.5l-.9.9" />
      <path d="M9 18h8.2a3 3 0 0 0 .3-6A4.2 4.2 0 0 0 10 11.4 3.3 3.3 0 0 0 9 18Z" />
    </svg>
  );
}
function Cloud({ size, ...rest }: { size: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M7.5 18h9a3.5 3.5 0 0 0 .3-7A5 5 0 0 0 7 9.6 3.7 3.7 0 0 0 7.5 18Z" />
    </svg>
  );
}
function Fog({ size, ...rest }: { size: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M6.5 12h9a3.3 3.3 0 0 0 .3-6.6A4.7 4.7 0 0 0 6 7.9 3.5 3.5 0 0 0 6.5 12Z" />
      <path d="M4 15.5h16M6 19h12" />
    </svg>
  );
}
function Rain({ size, ...rest }: { size: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M7 13.5h9a3.3 3.3 0 0 0 .3-6.6A4.7 4.7 0 0 0 6.6 9.4 3.5 3.5 0 0 0 7 13.5Z" />
      <path d="M9 16.5 8 19M13 16.5 12 19M17 16.5 16 19" />
    </svg>
  );
}
function Snow({ size, ...rest }: { size: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M7 13.5h9a3.3 3.3 0 0 0 .3-6.6A4.7 4.7 0 0 0 6.6 9.4 3.5 3.5 0 0 0 7 13.5Z" />
      <path d="M9 17.2h.01M13 17.2h.01M11 19.4h.01M15 19.4h.01" />
    </svg>
  );
}
function Thunder({ size, ...rest }: { size: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M7 13h9a3.3 3.3 0 0 0 .3-6.6A4.7 4.7 0 0 0 6.6 8.9 3.5 3.5 0 0 0 7 13Z" />
      <path d="M12.5 14.5 10 18h2.4L11 21" fill="none" />
    </svg>
  );
}

/** WMO weather code -> a bespoke weather icon (mirrors weatherGlyph's ranges). */
export function WeatherIcon({ code, size = 13, ...rest }: { code: number } & IconProps) {
  if (code === 0) return <Sun size={size} {...rest} />;
  if (code <= 2) return <PartlyCloudy size={size} {...rest} />;
  if (code === 3) return <Cloud size={size} {...rest} />;
  if (code <= 48) return <Fog size={size} {...rest} />;
  if (code <= 67) return <Rain size={size} {...rest} />;
  if (code <= 77) return <Snow size={size} {...rest} />;
  if (code <= 82) return <Rain size={size} {...rest} />;
  if (code <= 86) return <Snow size={size} {...rest} />;
  return <Thunder size={size} {...rest} />;
}
