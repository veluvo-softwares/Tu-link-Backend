'use client';

import {
  ArrowRight,
  BatteryMedium,
  CaretDown,
  CheckCircle,
  Clock,
  Crosshair,
  MagnifyingGlass,
  MapPin,
  NavigationArrow,
  Path,
  Radio,
  UsersThree,
  WarningCircle,
  WifiSlash,
  X,
} from '@phosphor-icons/react';
import type { Feature, FeatureCollection, Point } from 'geojson';
import mapboxgl, { type GeoJSONSource, type Map as MapboxMap } from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { startTransition, useEffect, useRef, useState } from 'react';

export interface LiveLocation {
  journeyId: string;
  participantId: string;
  displayName: string;
  location: {
    latitude: number;
    longitude: number;
  };
  heading?: number;
  speed?: number;
  timestamp: number;
  positionRecordedAt?: number;
  connectionState?: string;
  lastSeenAt?: number;
  metadata?: {
    batteryLevel?: number;
    isMoving?: boolean;
  };
}

export interface LiveJourney {
  journey: {
    id: string;
    name: string;
    destinationAddress: string | null;
  };
  snapshot: {
    participants: Record<string, LiveLocation>;
    destination?: {
      latitude: number;
      longitude: number;
    };
    destinationAddress?: string;
  };
}

interface ApiEnvelope<T> {
  data: T;
}

interface LiveJourneyMapProps {
  initialJourneys: LiveJourney[];
  initialNow: number;
  mapboxToken: string;
  demoMode?: boolean;
}

type LocationState = 'reporting' | 'delayed' | 'offline';

interface ParticipantProperties {
  journeyId: string;
  journeyName: string;
  participantId: string;
  displayName: string;
  heading: number;
  locationState: LocationState;
  selected: boolean;
}

interface DestinationProperties {
  journeyId: string;
  journeyName: string;
  label: string;
}

const DELAYED_AFTER_MS = 30_000;
const OFFLINE_AFTER_MS = 60_000;

function recordedAt(location: LiveLocation) {
  return location.positionRecordedAt ?? location.timestamp;
}

function locationState(location: LiveLocation, now: number): LocationState {
  const age = now - recordedAt(location);
  if (location.connectionState === 'DISCONNECTED' || age >= OFFLINE_AFTER_MS) {
    return 'offline';
  }
  if (location.connectionState !== 'CONNECTED' || age >= DELAYED_AFTER_MS) {
    return 'delayed';
  }
  return 'reporting';
}

function relativeTime(timestamp: number, now: number) {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds} sec ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hr${hours === 1 ? '' : 's'} ago`;
}

function participantFeatures(
  journeys: LiveJourney[],
  selectedParticipantId: string | undefined,
  now: number,
): FeatureCollection<Point, ParticipantProperties> {
  const features: Array<Feature<Point, ParticipantProperties>> = [];

  for (const item of journeys) {
    for (const [participantId, location] of Object.entries(
      item.snapshot.participants,
    )) {
      features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [
            location.location.longitude,
            location.location.latitude,
          ],
        },
        properties: {
          journeyId: item.journey.id,
          journeyName: item.journey.name,
          participantId,
          displayName: location.displayName,
          heading: location.heading ?? 0,
          locationState: locationState(location, now),
          selected: participantId === selectedParticipantId,
        },
      });
    }
  }

  return { type: 'FeatureCollection', features };
}

function destinationFeatures(
  journeys: LiveJourney[],
): FeatureCollection<Point, DestinationProperties> {
  return {
    type: 'FeatureCollection',
    features: journeys.flatMap((item) => {
      if (!item.snapshot.destination) return [];
      return [
        {
          type: 'Feature' as const,
          geometry: {
            type: 'Point' as const,
            coordinates: [
              item.snapshot.destination.longitude,
              item.snapshot.destination.latitude,
            ],
          },
          properties: {
            journeyId: item.journey.id,
            journeyName: item.journey.name,
            label:
              item.snapshot.destinationAddress ??
              item.journey.destinationAddress ??
              'Destination',
          },
        },
      ];
    }),
  };
}

function journeyCoordinates(journeys: LiveJourney[], journeyId?: string) {
  return journeys
    .filter((item) => !journeyId || item.journey.id === journeyId)
    .flatMap((item) => {
      const coordinates = Object.values(item.snapshot.participants).map(
        (location) =>
          [location.location.longitude, location.location.latitude] as [
            number,
            number,
          ],
      );
      if (item.snapshot.destination) {
        coordinates.push([
          item.snapshot.destination.longitude,
          item.snapshot.destination.latitude,
        ]);
      }
      return coordinates;
    });
}

function focusMap(map: MapboxMap, journeys: LiveJourney[], journeyId?: string) {
  const coordinates = journeyCoordinates(journeys, journeyId);
  if (coordinates.length === 0) return;
  if (coordinates.length === 1) {
    map.easeTo({ center: coordinates[0], zoom: 14, duration: 800 });
    return;
  }

  const bounds = coordinates.reduce(
    (current, coordinate) => current.extend(coordinate),
    new mapboxgl.LngLatBounds(coordinates[0], coordinates[0]),
  );
  const compact = window.innerWidth <= 760;
  map.fitBounds(bounds, {
    padding: compact
      ? { top: 80, right: 36, bottom: 390, left: 36 }
      : { top: 110, right: journeyId ? 350 : 90, bottom: 100, left: 370 },
    maxZoom: 15,
    duration: 900,
  });
}

function journeyStatus(item: LiveJourney, now: number) {
  const members = Object.values(item.snapshot.participants);
  const attentionCount = members.filter(
    (member) => locationState(member, now) !== 'reporting',
  ).length;
  const latestTimestamp = members.reduce(
    (latest, member) => Math.max(latest, recordedAt(member)),
    0,
  );
  return { attentionCount, latestTimestamp };
}

function initialSelection(journeys: LiveJourney[], now: number) {
  const attentionJourney = journeys.find(
    (item) => journeyStatus(item, now).attentionCount > 0,
  );
  return attentionJourney?.journey.id ?? journeys[0]?.journey.id;
}

function selectedMember(item: LiveJourney | undefined, participantId?: string) {
  if (!item) return undefined;
  const members = Object.values(item.snapshot.participants);
  return (
    members.find((member) => member.participantId === participantId) ??
    members.sort((a, b) => recordedAt(a) - recordedAt(b))[0]
  );
}

export function LiveJourneyMap({
  initialJourneys,
  initialNow,
  mapboxToken,
  demoMode = false,
}: LiveJourneyMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const [journeys, setJourneys] = useState(initialJourneys);
  const journeysRef = useRef(initialJourneys);
  const [selectedJourneyId, setSelectedJourneyId] = useState<
    string | undefined
  >(() => initialSelection(initialJourneys, initialNow));
  const [selectedParticipantId, setSelectedParticipantId] = useState<string>();
  const [lastUpdatedAt, setLastUpdatedAt] = useState(initialNow);
  const [now, setNow] = useState(initialNow);
  const [connectionState, setConnectionState] = useState<
    'connected' | 'refreshing' | 'offline'
  >('connected');
  const [query, setQuery] = useState('');
  const [attentionOnly, setAttentionOnly] = useState(false);

  const selectedJourney = journeys.find(
    (item) => item.journey.id === selectedJourneyId,
  );
  const activeMember = selectedMember(selectedJourney, selectedParticipantId);
  const participantCount = journeys.reduce(
    (count, item) => count + Object.keys(item.snapshot.participants).length,
    0,
  );
  const attentionCount = journeys.reduce(
    (count, item) => count + journeyStatus(item, now).attentionCount,
    0,
  );
  const normalizedQuery = query.trim().toLowerCase();
  const filteredJourneys = journeys.filter((item) => {
    const status = journeyStatus(item, now);
    const searchable = [
      item.journey.name,
      item.snapshot.destinationAddress,
      item.journey.destinationAddress,
      ...Object.values(item.snapshot.participants).map(
        (member) => member.displayName,
      ),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return (
      (!attentionOnly || status.attentionCount > 0) &&
      (!normalizedQuery || searchable.includes(normalizedQuery))
    );
  });

  useEffect(() => {
    journeysRef.current = journeys;
  }, [journeys]);

  useEffect(() => {
    if (demoMode) return;
    const clock = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(clock);
  }, [demoMode]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new mapboxgl.Map({
      accessToken: mapboxToken,
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [36.8219, -1.2921],
      zoom: 10.5,
      attributionControl: false,
    });
    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl(), 'bottom-right');
    map.addControl(
      new mapboxgl.AttributionControl({ compact: true }),
      'bottom-left',
    );

    map.on('load', () => {
      map.addSource('live-participants', {
        type: 'geojson',
        data: participantFeatures(initialJourneys, undefined, initialNow),
      });
      map.addLayer({
        id: 'participant-halo',
        type: 'circle',
        source: 'live-participants',
        paint: {
          'circle-radius': ['case', ['get', 'selected'], 21, 15],
          'circle-color': [
            'match',
            ['get', 'locationState'],
            'reporting',
            'rgba(37,208,127,0.18)',
            'delayed',
            'rgba(255,176,32,0.20)',
            'rgba(141,136,127,0.18)',
          ],
          'circle-stroke-width': ['case', ['get', 'selected'], 2, 1],
          'circle-stroke-color': [
            'match',
            ['get', 'locationState'],
            'reporting',
            'rgba(37,208,127,0.55)',
            'delayed',
            'rgba(255,176,32,0.7)',
            'rgba(200,200,200,0.4)',
          ],
        },
      });
      map.addLayer({
        id: 'participant-dot',
        type: 'circle',
        source: 'live-participants',
        paint: {
          'circle-radius': ['case', ['get', 'selected'], 9, 7],
          'circle-color': [
            'match',
            ['get', 'locationState'],
            'reporting',
            '#25d07f',
            'delayed',
            '#ffb020',
            '#77736d',
          ],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      });
      map.addLayer({
        id: 'participant-label',
        type: 'symbol',
        source: 'live-participants',
        layout: {
          'text-field': ['get', 'displayName'],
          'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
          'text-size': 12,
          'text-offset': [0, 1.8],
          'text-anchor': 'top',
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': '#0d0d0d',
          'text-halo-width': 1.5,
        },
      });

      map.addSource('live-destinations', {
        type: 'geojson',
        data: destinationFeatures(initialJourneys),
      });
      map.addLayer({
        id: 'destination-dot',
        type: 'circle',
        source: 'live-destinations',
        paint: {
          'circle-radius': 9,
          'circle-color': '#e8002d',
          'circle-stroke-width': 3,
          'circle-stroke-color': '#ffffff',
        },
      });
      map.addLayer({
        id: 'destination-label',
        type: 'symbol',
        source: 'live-destinations',
        layout: {
          'text-field': ['get', 'label'],
          'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
          'text-size': 11,
          'text-offset': [0, 1.8],
          'text-anchor': 'top',
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': '#0d0d0d',
          'text-halo-width': 1.5,
        },
      });

      map.on('mouseenter', 'participant-dot', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'participant-dot', () => {
        map.getCanvas().style.cursor = '';
      });
      map.on('click', 'participant-dot', (event) => {
        const properties = event.features?.[0]?.properties as
          | ParticipantProperties
          | undefined;
        if (!properties) return;
        setSelectedJourneyId(properties.journeyId);
        setSelectedParticipantId(properties.participantId);
        focusMap(map, journeysRef.current, properties.journeyId);
      });

      focusMap(
        map,
        journeysRef.current,
        initialSelection(journeysRef.current, initialNow),
      );
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [mapboxToken, initialNow]);

  useEffect(() => {
    if (demoMode) return;

    async function refreshJourneys() {
      if (journeys.length === 0) setConnectionState('refreshing');
      try {
        const response = await fetch('/api/operator/live-journeys', {
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('Live feed unavailable');
        const payload = (await response.json()) as ApiEnvelope<LiveJourney[]>;
        startTransition(() => {
          setJourneys(payload.data);
          setLastUpdatedAt(Date.now());
          setConnectionState('connected');
        });
      } catch {
        setConnectionState('offline');
      }
    }

    const interval = window.setInterval(() => {
      void refreshJourneys();
    }, 5_000);
    return () => window.clearInterval(interval);
  }, [demoMode, journeys.length]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    const participantSource = map.getSource(
      'live-participants',
    ) as GeoJSONSource | null;
    const destinationSource = map.getSource(
      'live-destinations',
    ) as GeoJSONSource | null;
    participantSource?.setData(
      participantFeatures(journeys, selectedParticipantId, now),
    );
    destinationSource?.setData(destinationFeatures(journeys));
  }, [journeys, selectedParticipantId, now]);

  function selectJourney(journeyId?: string) {
    setSelectedJourneyId(journeyId);
    const nextJourney = journeys.find((item) => item.journey.id === journeyId);
    setSelectedParticipantId(selectedMember(nextJourney)?.participantId);
    const map = mapRef.current;
    if (map) focusMap(map, journeys, journeyId);
  }

  function selectParticipant(participant: LiveLocation) {
    setSelectedParticipantId(participant.participantId);
    const map = mapRef.current;
    if (map) {
      map.easeTo({
        center: [participant.location.longitude, participant.location.latitude],
        zoom: Math.max(map.getZoom(), 13),
        duration: 700,
      });
    }
  }

  const memberState = activeMember
    ? locationState(activeMember, now)
    : undefined;
  const selectedStatus = selectedJourney
    ? journeyStatus(selectedJourney, now)
    : undefined;
  const battery = activeMember?.metadata?.batteryLevel;
  const batteryPercent = battery === undefined ? undefined : Math.round(battery);
  const speed =
    activeMember?.speed === undefined
      ? undefined
      : Math.round(activeMember.speed * 3.6);

  return (
    <section className="live-map-stage">
      <div
        aria-label="Map showing live journey members and destinations"
        className="live-map-canvas"
        ref={containerRef}
      />

      <div className="map-command-summary" aria-label="Live operations summary">
        <span>
          <Path aria-hidden="true" size={17} weight="bold" />
          <strong>{journeys.length}</strong> live{' '}
          {journeys.length === 1 ? 'journey' : 'journeys'}
        </span>
        <span>
          <UsersThree aria-hidden="true" size={18} weight="bold" />
          <strong>{participantCount}</strong> visible{' '}
          {participantCount === 1 ? 'member' : 'members'}
        </span>
        <span className={attentionCount > 0 ? 'attention' : ''}>
          {attentionCount > 0 ? (
            <WarningCircle aria-hidden="true" size={18} weight="fill" />
          ) : (
            <CheckCircle aria-hidden="true" size={18} weight="fill" />
          )}
          <strong>{attentionCount}</strong>{' '}
          {attentionCount === 1 ? 'needs attention' : 'need attention'}
        </span>
      </div>

      <aside className="live-map-rail" aria-label="Live journey selection">
        <div className="map-rail-heading">
          <div>
            <p className="eyebrow">Live operations</p>
            <span className={`feed-state ${connectionState}`}>
              {connectionState === 'connected'
                ? `Live · updated ${relativeTime(lastUpdatedAt, now)}`
                : connectionState === 'refreshing'
                  ? 'Connecting'
                  : 'Updates delayed'}
            </span>
          </div>
        </div>

        <label className="map-search-field">
          <MagnifyingGlass aria-hidden="true" size={18} />
          <span className="sr-only">Search journeys or members</span>
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search journeys or members"
            type="search"
            value={query}
          />
        </label>

        <div className="map-filter-row">
          <button
            aria-pressed={!attentionOnly}
            className={!attentionOnly ? 'active' : ''}
            onClick={() => setAttentionOnly(false)}
            type="button"
          >
            All live
            <CaretDown aria-hidden="true" size={13} weight="bold" />
          </button>
          <button
            aria-pressed={attentionOnly}
            className={attentionOnly ? 'active attention' : 'attention'}
            onClick={() => setAttentionOnly((current) => !current)}
            type="button"
          >
            Attention
            {attentionCount > 0 ? <strong>{attentionCount}</strong> : null}
          </button>
        </div>

        <div className="map-list-heading">
          <span>Live journeys</span>
          <strong>{filteredJourneys.length}</strong>
        </div>

        <div className="map-journey-list">
          {filteredJourneys.map((item) => {
            const members = Object.values(item.snapshot.participants);
            const status = journeyStatus(item, now);
            const selected = selectedJourneyId === item.journey.id;
            return (
              <button
                className={`map-journey-card ${selected ? 'selected' : ''}`}
                key={item.journey.id}
                onClick={() => selectJourney(item.journey.id)}
                type="button"
              >
                <span className="map-journey-copy">
                  <strong>{item.journey.name}</strong>
                  <em>
                    {item.snapshot.destinationAddress ??
                      item.journey.destinationAddress ??
                      'Destination not set'}
                  </em>
                  <small>
                    <UsersThree aria-hidden="true" size={15} />
                    {members.length}{' '}
                    {members.length === 1 ? 'member' : 'members'}
                    <Clock aria-hidden="true" size={15} />
                    {status.latestTimestamp
                      ? relativeTime(status.latestTimestamp, now)
                      : 'No location yet'}
                  </small>
                </span>
                <span
                  className={`journey-health ${
                    status.attentionCount > 0 ? 'attention' : 'reporting'
                  }`}
                >
                  {status.attentionCount > 0 ? 'Attention' : 'On track'}
                  {status.attentionCount > 0 ? (
                    <b>{status.attentionCount}</b>
                  ) : null}
                </span>
                <ArrowRight aria-hidden="true" size={17} weight="bold" />
              </button>
            );
          })}
        </div>

        {filteredJourneys.length === 0 ? (
          <div className="map-empty-state">
            <MapPin aria-hidden="true" size={26} />
            <strong>
              {journeys.length === 0 ? 'No live journeys' : 'No matches'}
            </strong>
            <p>
              {journeys.length === 0
                ? 'Active journeys will appear when a connected mobile team member starts one.'
                : 'Try another search or show all live journeys.'}
            </p>
            {journeys.length > 0 ? (
              <button
                onClick={() => {
                  setQuery('');
                  setAttentionOnly(false);
                }}
                type="button"
              >
                Clear filters
              </button>
            ) : null}
          </div>
        ) : null}

        <button
          className="map-show-all"
          onClick={() => selectJourney()}
          type="button"
        >
          Fit all live journeys
          <Crosshair aria-hidden="true" size={17} />
        </button>
      </aside>

      {selectedJourney ? (
        <aside
          className="journey-detail-drawer"
          aria-label="Selected journey details"
        >
          <section className="journey-glance-card">
            <button
              aria-label="Close journey details"
              className="drawer-close"
              onClick={() => setSelectedJourneyId(undefined)}
              type="button"
            >
              <X aria-hidden="true" size={20} />
            </button>

            <p className="eyebrow">Live journey</p>
            <h2>{selectedJourney.journey.name}</h2>
            <div
              className={`drawer-attention ${
                selectedStatus?.attentionCount ? 'active' : 'healthy'
              }`}
            >
              {selectedStatus?.attentionCount ? (
                <WarningCircle aria-hidden="true" size={20} weight="fill" />
              ) : (
                <CheckCircle aria-hidden="true" size={20} weight="fill" />
              )}
              <span>
                <strong>
                  {selectedStatus?.attentionCount
                    ? 'Attention required'
                    : 'Reporting normally'}
                </strong>
                <small>
                  {selectedStatus?.attentionCount
                    ? `${selectedStatus.attentionCount} ${
                        selectedStatus.attentionCount === 1
                          ? 'member has'
                          : 'members have'
                      } delayed location data.`
                    : 'All visible members are updating normally.'}
                </small>
              </span>
            </div>

            <dl className="journey-detail-facts">
              <div>
                <dt>Status</dt>
                <dd>
                  {selectedStatus?.attentionCount ? 'Attention' : 'In progress'}
                </dd>
              </div>
              <div>
                <dt>Destination</dt>
                <dd>
                  {selectedJourney.snapshot.destinationAddress ??
                    selectedJourney.journey.destinationAddress ??
                    'Not set'}
                </dd>
              </div>
              <div>
                <dt>Visible members</dt>
                <dd>
                  {Object.keys(selectedJourney.snapshot.participants).length}
                </dd>
              </div>
            </dl>
          </section>

          <section className="journey-team-card">
            <div className="drawer-section-heading">
              <span>Team members</span>
              <strong>
                {Object.keys(selectedJourney.snapshot.participants).length}
              </strong>
            </div>
            <div className="drawer-member-list">
              {Object.values(selectedJourney.snapshot.participants).map(
                (member) => {
                  const state = locationState(member, now);
                  return (
                    <button
                      className={
                        activeMember?.participantId === member.participantId
                          ? 'selected'
                          : ''
                      }
                      key={member.participantId}
                      onClick={() => selectParticipant(member)}
                      type="button"
                    >
                      <span className={`member-signal ${state}`} />
                      <span>
                        <strong>{member.displayName}</strong>
                        <small>
                          {state === 'reporting'
                            ? 'Reporting'
                            : state === 'delayed'
                              ? 'Location delayed'
                              : 'Offline'}
                        </small>
                      </span>
                      <span>
                        <strong>
                          {member.speed === undefined
                            ? '—'
                            : `${Math.round(member.speed * 3.6)} km/h`}
                        </strong>
                        <small>{relativeTime(recordedAt(member), now)}</small>
                      </span>
                    </button>
                  );
                },
              )}
            </div>
          </section>

          {activeMember ? (
            <div className={`member-telemetry ${memberState}`}>
              <div className="member-telemetry-title">
                <span>
                  {memberState === 'reporting' ? (
                    <Radio aria-hidden="true" size={18} weight="fill" />
                  ) : memberState === 'delayed' ? (
                    <Clock aria-hidden="true" size={18} weight="fill" />
                  ) : (
                    <WifiSlash aria-hidden="true" size={18} weight="fill" />
                  )}
                  Selected member
                </span>
                <strong>{activeMember.displayName}</strong>
              </div>
              <div className="telemetry-grid">
                <span>
                  <small>Last location</small>
                  <strong>{relativeTime(recordedAt(activeMember), now)}</strong>
                </span>
                <span>
                  <small>Speed</small>
                  <strong>{speed === undefined ? '—' : `${speed} km/h`}</strong>
                </span>
                <span>
                  <small>Movement</small>
                  <strong>
                    {activeMember.metadata?.isMoving ? 'Moving' : 'Stopped'}
                  </strong>
                </span>
                <span>
                  <small>Mobile battery</small>
                  <strong>
                    <BatteryMedium aria-hidden="true" size={17} />
                    {batteryPercent === undefined ? '—' : `${batteryPercent}%`}
                  </strong>
                </span>
              </div>
            </div>
          ) : null}

          <button
            className="drawer-primary-action"
            onClick={() => {
              if (activeMember) selectParticipant(activeMember);
              else selectJourney(selectedJourney.journey.id);
            }}
            type="button"
          >
            <NavigationArrow aria-hidden="true" size={18} weight="fill" />
            Focus on map
          </button>
        </aside>
      ) : null}

      <div className="map-state-legend" aria-label="Map status legend">
        <span>
          <CheckCircle aria-hidden="true" size={18} weight="fill" />
          <strong>Reporting</strong>
          <small>Live and on track</small>
        </span>
        <span>
          <Clock aria-hidden="true" size={18} weight="fill" />
          <strong>Location delayed</strong>
          <small>Last update over 30 sec</small>
        </span>
        <span>
          <WifiSlash aria-hidden="true" size={18} weight="fill" />
          <strong>Offline</strong>
          <small>No recent signal</small>
        </span>
        <span>
          <MapPin aria-hidden="true" size={18} weight="fill" />
          <strong>Destination</strong>
          <small>Journey endpoint</small>
        </span>
      </div>
    </section>
  );
}
