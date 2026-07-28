'use client';

import type {
  Feature,
  FeatureCollection,
  Point,
} from 'geojson';
import mapboxgl, { type GeoJSONSource, type Map as MapboxMap } from 'mapbox-gl';
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
  mapboxToken: string;
}

interface ParticipantProperties {
  journeyId: string;
  journeyName: string;
  participantId: string;
  displayName: string;
  heading: number;
  connectionState: string;
  stale: boolean;
}

interface DestinationProperties {
  journeyId: string;
  journeyName: string;
  label: string;
}

function participantFeatures(
  journeys: LiveJourney[],
): FeatureCollection<Point, ParticipantProperties> {
  const features: Array<Feature<Point, ParticipantProperties>> = [];
  const now = Date.now();

  for (const item of journeys) {
    for (const [participantId, location] of Object.entries(
      item.snapshot.participants,
    )) {
      const recordedAt = location.positionRecordedAt ?? location.timestamp;
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
          connectionState: location.connectionState ?? 'UNKNOWN',
          stale: now - recordedAt > 30_000,
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
          [
            location.location.longitude,
            location.location.latitude,
          ] as [number, number],
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

function focusMap(
  map: MapboxMap,
  journeys: LiveJourney[],
  journeyId?: string,
) {
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
  map.fitBounds(bounds, {
    padding: {
      top: 90,
      right: 60,
      bottom: window.innerWidth <= 720 ? 390 : 90,
      left: window.innerWidth <= 720 ? 60 : 390,
    },
    maxZoom: 15,
    duration: 900,
  });
}

function syncMapSources(map: MapboxMap, journeys: LiveJourney[]) {
  const participantSource = map.getSource(
    'live-participants',
  ) as GeoJSONSource | null;
  const destinationSource = map.getSource(
    'live-destinations',
  ) as GeoJSONSource | null;
  participantSource?.setData(participantFeatures(journeys));
  destinationSource?.setData(destinationFeatures(journeys));
}

export function LiveJourneyMap({
  initialJourneys,
  mapboxToken,
}: LiveJourneyMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const [journeys, setJourneys] = useState(initialJourneys);
  const [selectedJourneyId, setSelectedJourneyId] = useState<string>();
  const [lastUpdatedAt, setLastUpdatedAt] = useState(Date.now());
  const [connectionState, setConnectionState] = useState<
    'connected' | 'refreshing' | 'offline'
  >('connected');

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new mapboxgl.Map({
      accessToken: mapboxToken,
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [36.8219, -1.2921],
      zoom: 11,
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
        data: participantFeatures(initialJourneys),
      });
      map.addLayer({
        id: 'participant-halo',
        type: 'circle',
        source: 'live-participants',
        paint: {
          'circle-radius': 15,
          'circle-color': [
            'case',
            ['get', 'stale'],
            'rgba(232,216,184,0.10)',
            'rgba(230,57,70,0.15)',
          ],
          'circle-stroke-width': 1,
          'circle-stroke-color': [
            'case',
            ['get', 'stale'],
            'rgba(232,216,184,0.28)',
            'rgba(230,57,70,0.35)',
          ],
        },
      });
      map.addLayer({
        id: 'participant-dot',
        type: 'circle',
        source: 'live-participants',
        paint: {
          'circle-radius': 6,
          'circle-color': [
            'case',
            ['get', 'stale'],
            '#8d887f',
            ['==', ['get', 'connectionState'], 'CONNECTED'],
            '#53d98c',
            '#e63946',
          ],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#f8f5ef',
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
          'text-offset': [0, 1.6],
          'text-anchor': 'top',
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': '#f8f5ef',
          'text-halo-color': '#0b0f14',
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
          'circle-radius': 7,
          'circle-color': '#e8d8b8',
          'circle-stroke-width': 3,
          'circle-stroke-color': '#0b0f14',
        },
      });

      focusMap(map, initialJourneys);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [mapboxToken, initialJourneys]);

  useEffect(() => {
    async function refreshJourneys() {
      setConnectionState('refreshing');
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
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    syncMapSources(map, journeys);
  }, [journeys]);

  function selectJourney(journeyId?: string) {
    setSelectedJourneyId(journeyId);
    const map = mapRef.current;
    if (map) focusMap(map, journeys, journeyId);
  }

  const participantCount = journeys.reduce(
    (count, item) => count + Object.keys(item.snapshot.participants).length,
    0,
  );

  return (
    <section className="live-map-stage">
      <div className="live-map-canvas" ref={containerRef} />

      <aside className="live-map-rail">
        <div className="map-rail-heading">
          <div>
            <p className="eyebrow">Live operations</p>
            <h1>Journey map</h1>
          </div>
          <span className={`feed-state ${connectionState}`}>
            {connectionState}
          </span>
        </div>

        <div className="map-feed-summary">
          <span>
            <strong>{journeys.length}</strong> active journeys
          </span>
          <span>
            <strong>{participantCount}</strong> visible members
          </span>
        </div>

        <button
          className={`map-journey-card ${
            selectedJourneyId ? '' : 'selected'
          }`}
          onClick={() => selectJourney()}
          type="button"
        >
          <span className="journey-index">ALL</span>
          <span>
            <strong>Organization view</strong>
            <small>Fit every active team journey</small>
          </span>
        </button>

        <div className="map-journey-list">
          {journeys.map((item, index) => {
            const members = Object.values(item.snapshot.participants);
            const moving = members.filter(
              (member) => member.metadata?.isMoving,
            ).length;
            return (
              <button
                className={`map-journey-card ${
                  selectedJourneyId === item.journey.id ? 'selected' : ''
                }`}
                key={item.journey.id}
                onClick={() => selectJourney(item.journey.id)}
                type="button"
              >
                <span className="journey-index">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span>
                  <strong>{item.journey.name}</strong>
                  <small>
                    {members.length} members / {moving} moving
                  </small>
                  <em>
                    {item.snapshot.destinationAddress ??
                      item.journey.destinationAddress ??
                      'Destination pending'}
                  </em>
                </span>
              </button>
            );
          })}
        </div>

        {journeys.length === 0 ? (
          <div className="map-empty-state">
            <strong>No live journeys</strong>
            <p>Active team journeys will appear here automatically.</p>
          </div>
        ) : null}

        <footer className="map-rail-footer">
          Updated{' '}
          {new Intl.DateTimeFormat('en-KE', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          }).format(lastUpdatedAt)}
          <span>5 second refresh</span>
        </footer>
      </aside>
    </section>
  );
}
