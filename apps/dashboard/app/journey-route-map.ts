import sharp from 'sharp';

export interface ReportRoute {
  source: 'recorded' | 'navigation';
  coordinates: [number, number][];
  version?: number;
}
export interface RouteMap {
  png?: Uint8Array;
  caption: string;
}
export function parseReportRoute(value: unknown): ReportRoute | null {
  if (!value || typeof value !== 'object') return null;
  const route = value as ReportRoute;
  if (
    !['recorded', 'navigation'].includes(route.source) ||
    !Array.isArray(route.coordinates) ||
    route.coordinates.length < 2 ||
    !route.coordinates.every(
      (p) =>
        Array.isArray(p) &&
        p.length === 2 &&
        p.every((v) => typeof v === 'number' && Number.isFinite(v)) &&
        Math.abs(p[0]) <= 180 &&
        Math.abs(p[1]) <= 90,
    )
  )
    return null;
  return route;
}

export function encodeRoute(coordinates: [number, number][]) {
  let lastLat = 0,
    lastLng = 0;
  const encode = (value: number) => {
    let n = value < 0 ? ~(value << 1) : value << 1,
      out = '';
    while (n >= 32) {
      out += String.fromCharCode((32 | (n & 31)) + 63);
      n >>>= 5;
    }
    return out + String.fromCharCode(n + 63);
  };
  return coordinates
    .map(([lng, lat]) => {
      const a = Math.round(lat * 1e5),
        b = Math.round(lng * 1e5);
      const out = encode(a - lastLat) + encode(b - lastLng);
      lastLat = a;
      lastLng = b;
      return out;
    })
    .join('');
}

// Render the complete geometry locally if the basemap provider is unavailable.
// Unwrap longitude so date-line crossings do not become lines across the world.
export async function routeDiagram(coordinates: [number, number][]) {
  let previous = coordinates[0][0];
  const projected = coordinates.map(([lng, latitude]) => {
    while (lng - previous > 180) lng -= 360;
    while (lng - previous < -180) lng += 360;
    previous = lng;
    const lat = (Math.max(-85, Math.min(85, latitude)) * Math.PI) / 180;
    return [(lng * Math.PI) / 180, Math.log(Math.tan(Math.PI / 4 + lat / 2))];
  });
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const [x, y] of projected) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const scale = Math.min(
    1040 / Math.max(maxX - minX, 1e-6),
    480 / Math.max(maxY - minY, 1e-6),
  );
  const points = projected.map(([x, y]) => [
    600 + (x - (minX + maxX) / 2) * scale,
    320 - (y - (minY + maxY) / 2) * scale,
  ]);
  const line = points
    .map((p) => p.map((v) => v.toFixed(2)).join(','))
    .join(' ');
  const marker = (p: number[], label: string, color: string) =>
    `<circle cx="${p[0]}" cy="${p[1]}" r="19" fill="${color}" stroke="white" stroke-width="4"/><text x="${p[0]}" y="${p[1] + 6}" text-anchor="middle" font-family="sans-serif" font-size="17" fill="white">${label}</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="640"><defs><pattern id="grid" width="80" height="80" patternUnits="userSpaceOnUse"><path d="M 80 0 L 0 0 0 80" fill="none" stroke="#d5e2e0"/></pattern></defs><rect width="1200" height="640" fill="#edf4f2"/><rect width="1200" height="640" fill="url(#grid)"/><polyline points="${line}" fill="none" stroke="white" stroke-width="11" stroke-linejoin="round"/><polyline points="${line}" fill="none" stroke="#f35d32" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/>${marker(points[0], 'S', '#075261')}${marker(points[points.length - 1], 'E', '#a13b20')}<text x="1140" y="42" text-anchor="middle" font-family="sans-serif" font-size="22" fill="#075261">N ↑</text><text x="24" y="617" font-family="sans-serif" font-size="17" fill="#52666a">Route geometry · geographic projection · street basemap unavailable</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

export async function buildRouteMap(
  route: ReportRoute | null,
  options: { token?: string; fetcher?: typeof fetch } = {},
): Promise<RouteMap> {
  if (!route)
    return {
      caption:
        'No recorded path or saved navigation route is available for this journey.',
    };
  const caption =
    route.source === 'recorded'
      ? 'Recorded leader path. Lines connect GPS samples; gaps may not follow roads.'
      : `Saved navigation route${route.version ? ` (version ${route.version})` : ''}. This is not a recorded GPS track.`;
  const token =
    options.token ??
    process.env.MAPBOX_ACCESS_TOKEN ??
    process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
  if (token && route.coordinates.every((p) => Math.abs(p[1]) <= 85)) {
    const start = route.coordinates[0],
      end = route.coordinates[route.coordinates.length - 1];
    const overlay = `path-5+f35d32-1(${encodeURIComponent(encodeRoute(route.coordinates))}),pin-s-s+075261(${start.join(',')}),pin-s-e+a13b20(${end.join(',')})`;
    const url = `https://api.mapbox.com/styles/v1/mapbox/light-v11/static/${overlay}/auto/1200x640?padding=64&access_token=${encodeURIComponent(token)}`;
    // Preserve full geometry instead of dropping points to fit the provider URL limit.
    if (url.length <= 8192) {
      try {
        const response = await (options.fetcher ?? fetch)(url, {
          signal: AbortSignal.timeout(8000),
          cache: 'no-store',
        });
        if (
          !response.ok ||
          !response.headers.get('content-type')?.startsWith('image/')
        )
          throw new Error('Map image unavailable');
        const png = await sharp(Buffer.from(await response.arrayBuffer()), {
          limitInputPixels: 4000000,
        })
          .png()
          .toBuffer();
        return {
          png,
          caption: `${caption} S: start; E: end. Basemap © Mapbox © OpenStreetMap.`,
        };
      } catch {
        /* Keep exports useful with an accurate local route diagram. */
      }
    }
  }
  return {
    png: await routeDiagram(route.coordinates),
    caption: `${caption} S: start; E: end. Street basemap unavailable; route geometry shown.`,
  };
}
