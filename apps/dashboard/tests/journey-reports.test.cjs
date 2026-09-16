const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const { PDFDocument } = require('pdf-lib');
const app = path.resolve(__dirname, '../app');
function load(file, mocks = {}) {
  const filename = path.resolve(app, file);
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = mod.require.bind(mod);
  mod.require = (name) =>
    Object.hasOwn(mocks, name) ? mocks[name] : original(name);
  mod._compile(
    ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
    filename,
  );
  return mod.exports;
}
const reports = load('journey-reports.ts');
const fixture = {
  id: '12345678-1234-1234-1234-123456789abc',
  name: 'Sample journey: Nairobi to Karen',
  status: 'COMPLETED',
  destinationName: 'Karen Shopping Centre',
  destinationAddress: 'Karen, Nairobi',
  createdAt: '2026-09-11T06:00:00Z',
  scheduledFor: null,
  startTime: '2026-09-11T07:00:00Z',
  endTime: '2026-09-11T07:45:00Z',
};

test('duration bands have exact non-overlapping boundaries', () => {
  for (const [seconds, group] of [
    [0, 'Under 30 minutes'],
    [1799, 'Under 30 minutes'],
    [1800, '30–60 minutes'],
    [3599, '30–60 minutes'],
    [3600, '1–2 hours'],
    [7199, '1–2 hours'],
    [7200, '2+ hours'],
  ]) {
    const item = {
      ...fixture,
      endTime: new Date(
        Date.parse(fixture.startTime) + seconds * 1000,
      ).toISOString(),
    };
    assert.equal(reports.durationGroup(item), group);
    assert.equal(reports.durationSeconds(item), seconds);
  }
});
test('ongoing, pending, missing, invalid, and reversed timestamps cannot inflate averages', () => {
  for (const changes of [
    { status: 'ACTIVE' },
    { status: 'PENDING' },
    { startTime: null },
    { endTime: null },
    { endTime: 'invalid' },
    { endTime: fixture.createdAt },
  ])
    assert.equal(reports.durationSeconds({ ...fixture, ...changes }), null);
  assert.equal(
    reports.durationGroup({ ...fixture, status: 'ACTIVE' }),
    'In progress',
  );
  assert.equal(
    reports.durationGroup({ ...fixture, status: 'PENDING' }),
    'Not started',
  );
  assert.equal(
    reports.durationGroup({ ...fixture, startTime: null }),
    'Duration unavailable',
  );
  assert.equal(
    reports.durationSeconds({ ...fixture, status: 'CANCELLED' }),
    2700,
  );
});
test('report props exclude invitation codes and leader identities', () => {
  const result = reports.reportFields({
    ...fixture,
    inviteCode: 'private',
    leaderId: 'private',
  });
  assert.equal('inviteCode' in result, false);
  assert.equal('leaderId' in result, false);
});
const routeFile = 'api/operator/journey-reports/[journeyId]/route.ts';
const params = { params: Promise.resolve({ journeyId: fixture.id }) };
function route(
  identity,
  fetchImpl,
  pdfImpl = async () => Uint8Array.from([37, 80, 68, 70]),
) {
  return load(routeFile, {
    '@clerk/nextjs/server': { auth: async () => identity },
    '../../../../operator-api': { operatorFetch: fetchImpl },
    '../../../../journey-reports': reports,
    '../../../../journey-route-map': {
      parseReportRoute: () => null,
      buildRouteMap: async () => ({ caption: 'No route data' }),
    },
    '../../../../journey-report-pdf': { buildJourneyPdf: pdfImpl },
  });
}
const identity = {
  userId: 'operator',
  orgId: 'org',
  getToken: async () => 'token',
};
const request = (suffix = '') =>
  new Request(
    `https://dashboard.example/api/operator/journey-reports/${fixture.id}${suffix}`,
  );
test('PDF requires signed-in organization membership and current visible journey', async () => {
  const never = () => {
    throw new Error('Must not fetch');
  };
  assert.equal((await route({}, never).GET(request(), params)).status, 401);
  assert.equal(
    (await route({ userId: 'x' }, never).GET(request(), params)).status,
    403,
  );
  assert.equal(
    (
      await route(identity, never).GET(request(), {
        params: Promise.resolve({ journeyId: 'invalid' }),
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await route(identity, async () => Response.json({ data: [] })).GET(
        request(),
        params,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await route(identity, async () => new Response('', { status: 403 })).GET(
        request(),
        params,
      )
    ).status,
    403,
  );
});
test('PDF responses distinguish view/download, stay private, and handle upstream failure', async () => {
  const handler = route(identity, async (path, token) => {
    if (path.endsWith('/report-route')) return Response.json({ data: null });
    assert.equal(path, '/operator/journeys');
    assert.equal(token, 'token');
    return Response.json({ data: [fixture] });
  });
  for (const [suffix, disposition] of [
    ['', 'inline'],
    ['?download=1', 'attachment'],
  ]) {
    const result = await handler.GET(request(suffix), params);
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('content-type'), 'application/pdf');
    assert.match(
      result.headers.get('content-disposition'),
      new RegExp(`^${disposition};`),
    );
    assert.equal(result.headers.get('cache-control'), 'private, no-store');
  }
  assert.equal(
    (
      await route(identity, async () => {
        throw new Error('offline');
      }).GET(request(), params)
    ).status,
    502,
  );
});
test('PDF generation produces a valid document and paginates long text', async () => {
  const { buildJourneyPdf } = load('journey-report-pdf.ts', {
    './journey-reports': reports,
  });
  const originalCwd = process.cwd();
  process.chdir(path.resolve(__dirname, '..'));
  try {
    const bytes = await buildJourneyPdf(fixture);
    const pdf = await PDFDocument.load(bytes);
    assert.equal(pdf.getPageCount(), 1);
    assert.equal(pdf.getTitle(), `Journey report - ${fixture.name}`);
    const long = await PDFDocument.load(
      await buildJourneyPdf({
        ...fixture,
        name: 'Journey '.repeat(100),
        destinationAddress: 'Long destination 🚌 '.repeat(150),
      }),
    );
    assert.ok(long.getPageCount() > 1);
    if (process.env.REPORT_SAMPLE_PATH)
      fs.writeFileSync(process.env.REPORT_SAMPLE_PATH, bytes);
  } finally {
    process.chdir(originalCwd);
  }
});

const maps = load('journey-route-map.ts');
const sampleRoute = {
  source: 'recorded',
  coordinates: [
    [36.8219, -1.2921],
    [36.812, -1.299],
    [36.801, -1.2995],
    [36.79, -1.306],
    [36.782, -1.306],
    [36.774, -1.318],
    [36.758, -1.322],
    [36.746, -1.328],
    [36.737, -1.32],
    [36.719, -1.319],
    [36.711, -1.322],
  ],
};
test('route validation rejects malformed geometry and preserves longitude/latitude order', () => {
  for (const value of [
    null,
    {},
    { source: 'invented', coordinates: sampleRoute.coordinates },
    { source: 'recorded', coordinates: [[1, 2]] },
    {
      source: 'recorded',
      coordinates: [
        [181, 1],
        [2, 3],
      ],
    },
    {
      source: 'recorded',
      coordinates: [
        [1, NaN],
        [2, 3],
      ],
    },
  ])
    assert.equal(maps.parseReportRoute(value), null);
  assert.deepEqual(maps.parseReportRoute(sampleRoute), sampleRoute);
  assert.equal(
    maps.encodeRoute([
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ]),
    '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
  );
});
test('map provider failure still renders the complete route as a labelled PNG', async () => {
  const result = await maps.buildRouteMap(sampleRoute, {
    token: 'test',
    fetcher: async () => new Response('', { status: 503 }),
  });
  assert.ok(result.png.length > 1000);
  assert.match(result.caption, /Street basemap unavailable/);
  const meta = await require('sharp')(result.png).metadata();
  assert.equal(meta.width, 1200);
  assert.equal(meta.height, 640);
  const saved = await maps.buildRouteMap(
    { ...sampleRoute, source: 'navigation', version: 2 },
    { token: '' },
  );
  assert.match(saved.caption, /not a recorded GPS track/);
  assert.equal((await maps.buildRouteMap(null)).png, undefined);
});
test('Mapbox image requests include full route, endpoint markers and attribution', async () => {
  const png = await maps.routeDiagram(sampleRoute.coordinates);
  const result = await maps.buildRouteMap(sampleRoute, {
    token: 'test-token',
    fetcher: async (url, options) => {
      assert.match(url, /path-5/);
      assert.match(url, /pin-s-s/);
      assert.match(url, /pin-s-e/);
      assert.match(url, /padding=64/);
      assert.equal(options.cache, 'no-store');
      return new Response(png, { headers: { 'content-type': 'image/png' } });
    },
  });
  assert.match(result.caption, /Mapbox/);
});
test('PDF embeds a route image on a second page', async () => {
  const { buildJourneyPdf } = load('journey-report-pdf.ts', {
    './journey-reports': reports,
  });
  const originalCwd = process.cwd();
  process.chdir(path.resolve(__dirname, '..'));
  try {
    const routeMap = await maps.buildRouteMap(sampleRoute, { token: '' });
    const bytes = await buildJourneyPdf(
      fixture,
      new Date('2026-09-13T08:00:00Z'),
      routeMap,
    );
    const pdf = await PDFDocument.load(bytes);
    assert.equal(pdf.getPageCount(), 2);
    assert.match(pdf.getPages()[1].node.Resources().toString(), /XObject/);
    if (process.env.REPORT_MAP_SAMPLE_PATH)
      fs.writeFileSync(process.env.REPORT_MAP_SAMPLE_PATH, bytes);
  } finally {
    process.chdir(originalCwd);
  }
});
