'use client';

import { useState } from 'react';
import {
  durationGroup,
  durationGroups,
  durationSeconds,
  formatDuration,
  reportDate,
  type JourneyReport,
} from '../../journey-reports';

export function ReportsBrowser({ journeys }: { journeys: JourneyReport[] }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [group, setGroup] = useState('all');
  const filtered = journeys.filter(
    (journey) =>
      (status === 'all' || journey.status === status) &&
      (group === 'all' || durationGroup(journey) === group) &&
      `${journey.name} ${journey.destinationName ?? ''} ${journey.destinationAddress ?? ''}`
        .toLowerCase()
        .includes(query.toLowerCase().trim()),
  );
  const completed = filtered.filter(
    (journey) => journey.status === 'COMPLETED',
  );
  const measured = completed
    .map(durationSeconds)
    .filter((value): value is number => value !== null);
  return (
    <main className="dashboard-shell">
      <section className="dashboard-content report-content">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Journey reporting</p>
            <h2>Every journey, in focus</h2>
            <p>
              View or download a PDF record. All times are East Africa Time
              (UTC+3).
            </p>
          </div>
        </div>
        <div className="report-stats" aria-live="polite">
          <article className="tulink-panel">
            <span>Matching journeys</span>
            <strong>{filtered.length}</strong>
          </article>
          <article className="tulink-panel">
            <span>Completed</span>
            <strong>{completed.length}</strong>
          </article>
          <article className="tulink-panel">
            <span>Average completed duration</span>
            <strong>
              {formatDuration(
                measured.length
                  ? measured.reduce((a, b) => a + b, 0) / measured.length
                  : null,
              )}
            </strong>
            <small>{measured.length} with recorded start and end times</small>
          </article>
        </div>
        <section
          className="tulink-panel report-filters"
          aria-label="Filter reports"
        >
          <label>
            Search journeys
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Journey or destination"
              type="search"
            />
          </label>
          <label>
            Status
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="all">All statuses</option>
              {['PENDING', 'ACTIVE', 'COMPLETED', 'CANCELLED'].map((value) => (
                <option key={value} value={value}>
                  {value[0] + value.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </label>
          <label>
            Duration
            <select
              value={group}
              onChange={(event) => setGroup(event.target.value)}
            >
              <option value="all">All durations</option>
              {durationGroups.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
        </section>
        <p className="report-help">
          Duration uses recorded start and end times. Ongoing journeys are not
          included in duration averages.
        </p>
        {filtered.length === 0 ? (
          <section className="tulink-panel empty-state">
            <h3>
              {journeys.length
                ? 'No journeys match these filters'
                : 'No journey reports yet'}
            </h3>
            <p>
              {journeys.length
                ? 'Try another search, status, or duration.'
                : 'Journeys appear here when they are attributed to this organization.'}
            </p>
            {journeys.length > 0 && (
              <button
                className="tulink-button tulink-button-ghost"
                onClick={() => {
                  setQuery('');
                  setStatus('all');
                  setGroup('all');
                }}
              >
                Clear filters
              </button>
            )}
          </section>
        ) : (
          durationGroups.map((label) => {
            const items = filtered.filter(
              (journey) => durationGroup(journey) === label,
            );
            if (!items.length) return null;
            return (
              <section className="tulink-panel report-group" key={label}>
                <div className="section-heading">
                  <h3>{label}</h3>
                  <span>
                    {items.length} {items.length === 1 ? 'journey' : 'journeys'}
                  </span>
                </div>
                <div className="journey-list">
                  {items.map((journey) => {
                    const url = `/api/operator/journey-reports/${encodeURIComponent(journey.id)}`;
                    return (
                      <article className="report-row" key={journey.id}>
                        <div className="report-identity">
                          <h4>{journey.name}</h4>
                          <p>
                            {journey.destinationName ??
                              journey.destinationAddress ??
                              'Destination not recorded'}
                          </p>
                          <small>
                            {journey.startTime
                              ? `Started ${reportDate(journey.startTime)}`
                              : `Created ${reportDate(journey.createdAt)}`}
                          </small>
                        </div>
                        <div className="report-meta">
                          <span>{journey.status}</span>
                          <strong>
                            {formatDuration(durationSeconds(journey))}
                          </strong>
                        </div>
                        <div className="report-actions">
                          <a
                            className="tulink-button tulink-button-ghost"
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`View PDF for ${journey.name} (opens in new tab)`}
                          >
                            View PDF
                          </a>
                          <a
                            className="tulink-button"
                            href={`${url}?download=1`}
                            aria-label={`Download PDF for ${journey.name}`}
                          >
                            Download
                          </a>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })
        )}
      </section>
    </main>
  );
}
