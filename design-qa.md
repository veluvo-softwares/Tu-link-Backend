# Dashboard Live Map Design QA

## Target

- Reference: design reference supplied during the review session
- Implementation: `http://localhost:3001/dashboard/live?demo=1`
- Reference viewport: 1440 x 1024 CSS pixels
- Implementation viewport: 1440 x 1024 CSS pixels
- Final implementation capture: local QA capture (not committed)
- Side-by-side comparison: local QA capture (not committed)
- Refined decomposed inspector capture: local QA capture (not committed)
- Refined mobile capture: local QA capture (not committed)
- Responsive navigation capture (663 x 851): local QA capture (not committed)

## State Reviewed

- Three representative Nairobi journeys
- Seven visible team members
- Reporting, delayed, and offline location states
- Selected journey with delayed member telemetry
- Real empty state at `/dashboard/live`
- Development-only populated state at `/dashboard/live?demo=1`

## Visual Review

- Map remains the dominant workspace at desktop and mobile widths.
- Left command rail matches the reference hierarchy: live status, search, filters, journey queue, and fit-to-map action.
- Floating summary exposes journey, member, and attention totals without competing with the map.
- Selected journey drawer prioritizes operational status, destination, member freshness, speed, movement, and battery.
- Carbon, graphite, white, silver, red, green, and amber states follow the Tu-Link motorsport visual system.
- Header, panels, borders, typography, spacing, overlays, and controls remain legible over Mapbox dark tiles.
- The implementation intentionally omits route polylines and gap calculations because the current live-journey response does not provide authoritative route or formation-gap data.

## Interaction Review

- Search narrows journeys by journey, destination, or member name.
- Attention filter limits the queue to journeys with stale or disconnected members.
- Selecting a journey updates and focuses the detail drawer.
- Selecting a member updates telemetry and map focus.
- Drawer close and fit-all controls work.
- At 390 x 844, the drawer becomes a scrollable command sheet and the journey rail becomes a bottom browser.
- Empty and no-match states provide clear next actions.

## Iterations

1. Replaced the content-led dashboard with the selected map-led command-center layout.
2. Added real Mapbox participant and destination layers, freshness classification, filtering, and journey focus.
3. Added a development-only deterministic demo state for review without leaking fabricated operations into production.
4. Stabilized demo timestamps and removed a hydration-prone clock initialization.
5. Corrected Clerk organization-switcher contrast in the dark header.
6. Restarted the development server after production build output invalidated its hot-reload cache; the final page has no runtime overlay.
7. Replaced the accidental Times fallback with a verified Inter interface and Rajdhani brand lockup by aligning font tokens with Next.js local-font variables.
8. Deconstructed the opaque right-side drawer into separate glance, team, telemetry, and action modules so the map remains visible between operational details.
9. Preserved a unified, scrollable command sheet on mobile where fragmented floating modules would reduce usability.
10. Added a compact-width hamburger trigger and leading navigation drawer with active states, descriptive labels, focus containment, Escape dismissal, backdrop dismissal, and route-close behavior.
11. Verified navigation from the live map to Team & access at the reported 663 x 851 viewport.

## Verification

- `npm run typecheck --workspace @tulink/dashboard`: passed
- `npm run build --workspace @tulink/dashboard`: passed
- `git diff --check`: passed
- Final DOM inspection: no Next.js error overlay

final result: passed
