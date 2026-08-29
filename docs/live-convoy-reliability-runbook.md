# Live Convoy Reliability: Design, Delivery, and Production Runbook

Last updated: 2026-08-30  
Owner: Tulink mobile and backend teams  
Status: Implemented on stacked local branches; not yet pushed or deployed

## Purpose

This document tracks the screen-off and app-resume reliability work for live
convoys. It is also the first reference during a production incident involving
missing members, a missing or divergent route, stale locations, reconnects, or
a journey that only recovers after reopening the app.

The intended experience is Google Maps/Waze-like journey continuity: the
journey is owned outside the visible map screen, location collection continues
under the mobile operating system's background rules, low-latency socket events
update an open app, and an authoritative server snapshot repairs any events
missed while the process or network was unavailable.

## The problem

The old live convoy lifecycle was partly owned by the map UI. When the screen
was hidden, rebuilt, or the app resumed, transport and location state could be
lost or recreated. Every phone could also calculate its own route, so the
leader and followers were not guaranteed to see the same polyline. Reopening
the app appeared to fix the journey because it triggered fresh API reads, GPS
acquisition, route calculation, and map drawing.

A single Server-Sent Events or WebSocket connection cannot by itself solve
screen-off continuity. Mobile operating systems may suspend the Dart process
and its network connection. The reliable model is:

1. one OS-supported background location stream per active journey;
2. one app-scoped live journey coordinator, independent of map visibility;
3. Socket.IO for low-latency hints while the process is runnable;
4. a versioned server-owned route and authoritative recovery snapshot;
5. idempotent reconnect/resume reconciliation after missed events.

## Issues found and their resolution

| ID | Issue | Impact | Resolution | State |
|---|---|---|---|---|
| LC-01 | The map screen owned convoy start/stop | Navigation, screen lock, and widget rebuilds could interrupt the journey | Move lifecycle ownership to an app-scoped coordinator driven by auth and active-journey state | Fixed |
| LC-02 | Multiple consumers opened native GPS streams | Duplicate publishing, battery drain, race conditions, and inconsistent fixes | Introduce one shared `JourneyLocationService` stream | Fixed |
| LC-03 | Android background collection lacked one clear foreground-service owner | Location could stop after screen-off or under background limits | Configure the shared stream with an ongoing foreground notification and wake lock | Fixed; device validation required |
| LC-04 | iOS location configuration was not journey-oriented | Auto-pausing or missing background mode could stop updates | Use automotive navigation activity, background updates, and disable automatic pausing | Fixed; physical-device validation required |
| LC-05 | Joining the room could sit behind GPS acquisition or permission UI | Users remained in `CONNECTING` even though convoy membership did not require a fix | Join and subscribe first; treat location permission/fix as an independent recoverable channel | Fixed |
| LC-06 | Map widgets could start/stop transport and open their own continuous stream | Rebuilds could duplicate or tear down live infrastructure | Remove transport ownership and continuous GPS calls from live map widgets; add an architecture regression test | Fixed |
| LC-07 | Resume depended on opening the journey screen | Peers, self-location, and map state stayed stale until manual reload | App coordinator refreshes active journeys, restores ownership, and runs a coalesced recovery transaction on resume | Fixed |
| LC-08 | Recovery used a locations-only endpoint | It could not authoritatively recover roster, route version, freshness, or cursor together | Add `GET /journeys/:id/live` and make Flutter prefer it, with an old-server 404 fallback | Fixed |
| LC-09 | Each client calculated a route locally | Members could see different polylines and reroutes | Store one canonical server-calculated route per journey and have all clients fetch it | Fixed |
| LC-10 | Route writes had no concurrency contract | Competing reroutes could overwrite each other | Add monotonically increasing versions, leader-only writes, request UUID idempotency, row locking, and compare-and-swap `baseVersion` | Fixed |
| LC-11 | Followers could reroute independently | Convoy members could diverge after off-route detection | Only the leader may create `INITIAL` or `LEADER_REROUTE` route versions | Fixed |
| LC-12 | A socket event could be missed during suspension | The map could remain on an old version after resume | Treat `route-updated` as a low-latency hint; always recover through canonical GET/live snapshot | Fixed |
| LC-13 | Late async reads could overwrite a newer journey or map surface | A stale route/snapshot from journey A could appear in journey B | Add journey/user/surface generations and exact route identity checks | Fixed |
| LC-14 | Duplicate or older route events could redraw stale state | Event replay and reconnect could cause redundant or backward updates | Scope events to the owned room and ignore versions not newer than the last accepted version | Fixed |
| LC-15 | Legacy cached routes were indistinguishable from canonical routes | Offline fallback could present a locally calculated route as authoritative | Persist canonical version/reason and only use a cache as canonical when it carries a server version | Fixed |
| LC-16 | Location response envelope handling was inconsistent | The legacy recovery fallback could parse an empty snapshot | Unwrap the standard API `data` envelope in the convoy API service | Fixed |
| LC-17 | Terminal/late work could publish into the wrong journey | A delayed permission or GPS result could revive a completed/switched journey | Use monotonic ownership generations and terminal reconciliation | Fixed |
| LC-18 | Background execution is constrained by OS/user settings | Force-stop, revoked permission, battery policy, or iOS termination can still halt live collection | Surface health/freshness, recover on next launch/resume, and follow the incident/device checklist below | Known platform constraint |

## Implemented PR stack

These branches are intentionally stacked. Merge each repository in the listed
order, or rebase each later branch after the preceding PR lands.

### Backend

1. `codex/feat-versioned-convoy-routes` — `b9e6a81`
   - Route schema and migration.
   - `GET/POST /journeys/:id/route`.
   - Leader authorization, server-owned destination/Mapbox calculation,
     idempotency, locking, and version conflict handling.
2. `codex/feat-live-journey-snapshot` — `501d233`
   - `GET /journeys/:id/live` with journey, canonical route, active roster,
     nullable member locations, freshness, cursor, and generation time.
   - Best-effort `route-updated` Socket.IO event after route commit.
3. `codex/docs-live-convoy-reliability` — this document.

### Flutter

1. `codex/refactor-shared-journey-location` — `e773f96`
   - One shared native journey location stream and background settings.
2. `codex/feat-app-live-journey-coordinator` — `60000cc`
   - App-scoped lifecycle ownership and resume recovery; UI transport ownership
     removed.
3. `codex/feat-canonical-live-routes` — `c805a94`
   - Canonical route GET/write, version conflict convergence, leader-only
     rerouting, `route-updated` handling, live snapshot recovery, cache identity,
     and regression coverage.

## Runtime lifecycle

### Start

1. The backend marks the journey active.
2. The app coordinator observes the active journey and owns the live session.
3. The app joins the Socket.IO journey room before waiting for a GPS fix.
4. The shared OS location stream starts once permission is available.
5. Every member requests the canonical route. If version zero has no route, the
   leader posts `INITIAL`; followers wait for the committed route.

### While travelling

- The shared location stream publishes the member's position.
- Socket.IO carries location and lifecycle updates while connected.
- Only the leader may post a reroute using its current `baseVersion`.
- After commit, the backend emits `route-updated`. Clients fetch the committed
  route instead of trusting event payload geometry.
- A `409 ROUTE_VERSION_CONFLICT` means another request won; the app fetches and
  displays that committed winner.

### Screen off, process suspension, reconnect, or resume

- Android foreground location and iOS background location keep collection
  eligible under platform rules.
- The socket may disconnect or be suspended; correctness does not depend on it
  remaining open continuously.
- On resume, duplicate signals coalesce into one transaction: refresh active
  journeys, restore room/location ownership, fetch `/journeys/:id/live`, and
  fetch/redraw the canonical route as needed.
- Snapshot merging must never overwrite a newer socket position.

### End

- Terminal journey state stops location publishing and room ownership.
- Late permission, GPS, API, or socket work is rejected by ownership generation.
- Live map layers and sources are removed by the single map owner.

## Deployment plan

Deploy backend before Flutter. Do not release the Flutter canonical-route build
before the route migration and endpoints are healthy in production.

1. Back up/verify the production database and apply the journey route migration.
2. Deploy backend route endpoints; smoke-test GET and a leader write in a test
   journey. Confirm follower writes return 403 and stale `baseVersion` returns
   409.
3. Deploy the live snapshot and `route-updated` event.
4. Verify `/journeys/:id/live` returns roster members without locations as well
   as members with locations, plus route version and cursor.
5. Release Flutter shared-location ownership.
6. Release Flutter app coordinator.
7. Release Flutter canonical route/live recovery.
8. Run the device acceptance matrix and watch the indicators below before full
   rollout.

The Flutter client has a 404 fallback to the older latest-locations endpoint,
which protects a rolling backend deployment. That fallback is for compatibility,
not the target steady state.

## Release acceptance matrix

Test with at least one physical Android device and one physical iPhone, using a
leader and follower in the same journey.

| Scenario | Expected result |
|---|---|
| Lock both screens for 15 minutes while moving | Foreground/background location remains eligible; latest timestamps advance; both recover without recreating the journey |
| Leave the app backgrounded and switch Wi-Fi/mobile data | Socket reconnects when runnable; live snapshot repairs missed state |
| Keep one member stationary | Member remains in roster; freshness and movement state are truthful; no disappearance caused by lack of movement |
| Deny location to one member | Room membership and roster remain; only that member's location channel reports failure/unknown |
| Leader goes off route | One new canonical version is committed; every member converges on the same version and geometry |
| Follower goes off route | Follower does not write or calculate a competing canonical route |
| Kill and relaunch app during active journey | Active journey ownership and the live snapshot restore members and route |
| End or switch journey during a delayed permission/GPS request | Late work does not publish or redraw into the new/ended journey |
| Backend route write is sent twice with the same request UUID | One version is created and the same result is returned |
| Two leader reroutes use the same base version | One commits; the other receives 409 and displays the winner |

## Production indicators

Add/retain dashboards and structured logs for:

- count and latency of `GET /journeys/:id/live` by status code;
- count and latency of canonical route GET/POST;
- `ROUTE_VERSION_CONFLICT` rate;
- Mapbox calculation errors and cache hit rate;
- Socket room joins, reconnects, disconnect reason, and `route-updated` emits;
- latest location age by active journey/member and `LIVE/DELAYED/STALE/UNKNOWN`;
- active journey count versus foreground location publishers where mobile
  telemetry is available;
- mobile recovery attempts, recovery failures, accepted route version, and
  current journey ID (never raw auth tokens or unnecessarily precise location
  history).

## Production incident runbook

Use incident label/component `live-convoy-reliability` and link this document in
the incident channel, ticket, and postmortem. Record app version, backend
release, journey ID, affected user IDs, platform/OS, timestamps and timezone,
network transition, permission state, and whether the screen was locked. Do not
copy auth tokens into tickets or logs.

### 1. Establish scope

- One member or every member?
- Android, iOS, or both?
- Location missing, route missing/divergent, roster missing, or journey falsely
  terminal?
- Only while screen-off, or also while foregrounded?
- Does resume recover automatically, only after reopening, or not at all?

### 2. Query authoritative state

As an affected authorized participant, inspect:

- `GET /journeys/{journeyId}/live`: journey status, roster, each location state
  and age, cursor, route version, and `generatedAt`;
- `GET /journeys/{journeyId}/route`: version, reason, geometry, origin and
  destination;
- server logs for room join/disconnect, snapshot errors, location writes,
  Mapbox failures, route writes/conflicts, and `route-updated` emission.

Interpretation:

- Correct `/live`, incorrect UI: mobile recovery/rendering problem.
- Incorrect `/live`, correct database/location writes: snapshot assembly/cache
  problem.
- Stale/missing writes from one phone: permission/background execution/device
  issue.
- Different client routes with the same version: cache or parsing defect.
- Different versions: missed event plus failed canonical recovery.

### 3. Device checks

- Location permission is precise/while-in-use plus the required background
  grant for the platform and release policy.
- Android foreground journey notification is present and not blocked; battery
  saver/vendor task-killer settings have not restricted Tulink.
- iOS Background Modes includes location updates; Background App Refresh and
  location access have not been disabled.
- The app was not force-stopped. A force-stop/explicit termination is a platform
  boundary and must be reported distinctly from ordinary screen lock.
- Device clock, connectivity, and installed app build match the incident record.

### 4. Safe mitigations

- If sockets are degraded but REST is healthy, keep canonical GET and `/live`
  available; clients can recover on resume.
- If `route-updated` emission is failing, do not disable canonical route storage;
  direct clients/support to refresh/recover while the event path is repaired.
- If Mapbox route creation is degraded, preserve the last committed route and
  stop repeated reroute attempts; do not allow followers to create alternatives.
- If `/live` alone is broken, the released Flutter client can use its 404 legacy
  fallback only when the endpoint is unavailable. Do not convert server errors
  to 404 merely to trigger fallback without incident-lead approval.
- If mobile background publishing is unsafe or causing severe battery drain,
  pause the mobile rollout through the release channel. Backend route/snapshot
  changes are backward-compatible and should normally remain deployed.

### 5. Rollback references

- Flutter canonical route/recovery: parent of `c805a94` (`60000cc`).
- Flutter app coordinator: parent of `60000cc` (`e773f96`).
- Flutter shared location: parent of `e773f96` (`d55a39c`).
- Backend live snapshot/event: parent of `501d233` (`b9e6a81`).
- Backend canonical routes: parent of `b9e6a81` (`fa0bba1`).

Prefer reverting the affected release commit through a reviewed rollback PR.
Do not drop the route table during an incident; preserving route versions aids
recovery and investigation. If backend canonical routes must be rolled back,
first roll back or pause the Flutter canonical-route release.

### 6. Closeout

Attach a timeline, root cause, affected journey count, last known good versions,
mitigation, permanent fix, tests added, and whether this issue table/runbook
needs an update. Add a dated row to the change log below.

## Verification record

As of 2026-08-30:

- Backend: lint, typecheck, and production build passed.
- Backend: 19 suites and 129 tests passed.
- Flutter: 493 tests passed and 14 intentional tests were skipped.
- Scoped Dart analysis reported no errors. The repository still has a pre-existing
  lint backlog.
- The local Flutter SDK's `flutter analyze` launcher is missing its analysis
  server snapshot; `dart analyze` was used for changed-file validation.
- Physical screen-off/background acceptance and production smoke tests remain
  release gates and cannot be proven by unit tests.

## Change log and incident tracking

| Date | Type | Reference | Summary | Follow-up |
|---|---|---|---|---|
| 2026-08-30 | Implementation | Backend `b9e6a81`, `501d233`; Flutter `e773f96`, `60000cc`, `c805a94` | Added app-owned lifecycle, shared background location, authoritative recovery, and versioned canonical routes | Push PR stack, deploy backend-first, complete physical-device matrix |

For every later production issue, append a row with the incident/ticket link,
affected releases, root cause, mitigation, fix PR, and validation result.
