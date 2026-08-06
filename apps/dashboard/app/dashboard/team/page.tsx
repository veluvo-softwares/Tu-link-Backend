import { clerkClient } from '@clerk/nextjs/server';
import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import {
  addTeamMember,
  assignDelegate,
  removeDelegate,
} from './actions';
import { RemoveTeamMemberForm } from './remove-team-member-form';
import { operatorFetch } from '../../operator-api';

interface ApiEnvelope<T> {
  data: T;
}

interface OperatorAccess {
  organizationId: string;
  role: string;
  canManage: boolean;
  scope: 'organization' | 'delegated';
}

interface OperatorSession {
  access: OperatorAccess;
}

interface TeamMember {
  id: string;
  userId: string;
  displayName: string;
  email: string;
  status: string;
  createdAt: string;
  delegateClerkUserIds: string[];
}

interface UserSearchResult {
  uid: string;
  email: string;
  displayName: string;
}

interface DashboardMember {
  userId: string;
  displayName: string;
  identifier: string;
  role: string;
}

interface TeamPageProps {
  searchParams: Promise<{
    q?: string;
    notice?: string;
    error?: string;
  }>;
}

async function operatorGet<T>(path: string, token: string): Promise<T> {
  const response = await operatorFetch(path, token);
  if (!response.ok) {
    throw new Error(`Tulink API returned ${response.status}`);
  }
  const payload = (await response.json()) as ApiEnvelope<T>;
  return payload.data;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

function roleLabel(role: string) {
  return role.replace(/^org:/, '').replace(/^\w/, (letter) =>
    letter.toUpperCase(),
  );
}

export default async function TeamPage({ searchParams }: TeamPageProps) {
  await auth.protect();
  const [{ q = '', notice, error }, clerkAuth] = await Promise.all([
    searchParams,
    auth(),
  ]);

  if (!clerkAuth.orgId) {
    return (
      <main className="dashboard-shell">
        <section className="tulink-panel empty-state">
          <p className="eyebrow">Organization required</p>
          <h1>Select an organization to manage its team.</h1>
        </section>
      </main>
    );
  }

  const token = await clerkAuth.getToken();
  if (!token) {
    return (
      <main className="dashboard-shell">
        <section className="tulink-panel empty-state">
          <p className="eyebrow">Session required</p>
          <h1>Your operator session could not be verified</h1>
          <p>Please sign in again to continue.</p>
        </section>
      </main>
    );
  }

  let session: OperatorSession;
  let teamMembers: TeamMember[];
  let searchResults: UserSearchResult[] = [];
  let dashboardMembers: DashboardMember[] = [];
  let organizationName = 'Active organization';
  let apiLoadError = '';
  let clerkLoadError = '';

  try {
    [session, teamMembers] = await Promise.all([
      operatorGet<OperatorSession>('/operator/session', token),
      operatorGet<TeamMember[]>('/operator/team-members', token),
    ]);

    if (session.access.canManage && q.trim().length >= 2) {
      searchResults = await operatorGet<UserSearchResult[]>(
        `/operator/users/search?q=${encodeURIComponent(q.trim())}`,
        token,
      );
    }
  } catch {
    session = {
      access: {
        organizationId: '',
        role: clerkAuth.orgRole ?? 'org:member',
        canManage: clerkAuth.orgRole === 'org:admin',
        scope:
          clerkAuth.orgRole === 'org:admin' ? 'organization' : 'delegated',
      },
    };
    teamMembers = [];
    apiLoadError =
      'Team data could not be loaded. Confirm the API and Clerk backend configuration.';
  }

  try {
    const client = await clerkClient();
    const [organization, memberships] = await Promise.all([
      client.organizations.getOrganization({
        organizationId: clerkAuth.orgId,
      }),
      client.organizations.getOrganizationMembershipList({
        organizationId: clerkAuth.orgId,
        limit: 100,
      }),
    ]);
    organizationName = organization.name;
    dashboardMembers = memberships.data.flatMap((membership) => {
      const user = membership.publicUserData;
      if (!user) return [];
      const fullName = [user.firstName, user.lastName]
        .filter(Boolean)
        .join(' ');
      return [
        {
          userId: user.userId,
          displayName: fullName || user.identifier,
          identifier: user.identifier,
          role: membership.role,
        },
      ];
    });
  } catch {
    clerkLoadError =
      'Clerk organization members could not be loaded. Check the dashboard Clerk configuration.';
  }

  const loadError = apiLoadError || clerkLoadError;
  const canManage = apiLoadError
    ? clerkAuth.orgRole === 'org:admin'
    : session.access.canManage;
  const assignedUserIds = new Set(teamMembers.map((member) => member.userId));
  const memberByClerkId = new Map(
    dashboardMembers.map((member) => [member.userId, member]),
  );

  return (
    <main className="dashboard-shell team-shell">
      <section className="dashboard-content">
        <div className="team-hero">
          <div>
            <p className="eyebrow">Organization directory</p>
            <h1>Team &amp; access</h1>
            <p className="hero-copy">
              Control who operates the dashboard and which {organizationName}{' '}
              journeys each person is responsible for.
            </p>
          </div>
          <div className="access-stamp">
            <span>{roleLabel(session.access.role)}</span>
            <strong>
              {session.access.scope === 'organization'
                ? 'Organization-wide'
                : 'Delegated view'}
            </strong>
            {canManage ? (
              <a className="team-add-cta" href="#add-mobile-member">
                Add mobile member
              </a>
            ) : null}
          </div>
        </div>

        {notice ? <div className="notice-banner">{notice}</div> : null}
        {error || loadError ? (
          <div className="api-warning">{error || loadError}</div>
        ) : null}

        <div className="team-metric-grid">
          <article className="tulink-panel team-metric">
            <span>Dashboard members</span>
            <strong>{dashboardMembers.length}</strong>
            <p>Clerk-authenticated operators</p>
          </article>
          <article className="tulink-panel team-metric">
            <span>Tulink members</span>
            <strong>{teamMembers.length}</strong>
            <p>Mobile users attributed to this team</p>
          </article>
          <article className="tulink-panel team-metric accent">
            <span>Your visibility</span>
            <strong>
              {session.access.scope === 'organization'
                ? 'All'
                : teamMembers.length}
            </strong>
            <p>
              {session.access.scope === 'organization'
                ? 'Every organization journey'
                : 'Assigned mobile members'}
            </p>
          </article>
        </div>

        <div className="team-layout">
          <section className="tulink-panel team-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Dashboard access</p>
                <h2>Organization operators</h2>
              </div>
              {canManage ? (
                <Link className="text-link" href="/organization-profile">
                  Invite or change roles
                </Link>
              ) : null}
            </div>

            <div className="operator-roster">
              {dashboardMembers.map((member) => (
                <article className="operator-person" key={member.userId}>
                  <span className="person-avatar">
                    {initials(member.displayName)}
                  </span>
                  <div>
                    <strong>{member.displayName}</strong>
                    <span>{member.identifier}</span>
                  </div>
                  <em>{roleLabel(member.role)}</em>
                </article>
              ))}
              {dashboardMembers.length === 0 ? (
                <p className="muted-copy">No Clerk members were returned.</p>
              ) : null}
            </div>
          </section>

          {canManage ? (
            <aside
              className="tulink-panel member-search-panel"
              id="add-mobile-member"
            >
              <p className="eyebrow">Add from Tulink</p>
              <h2>Add a mobile member</h2>
              <p className="muted-copy">
                Search by the name or email used in the Tulink app.
              </p>
              {apiLoadError ? (
                <p className="member-search-status">
                  Connect the Tulink API to enable member search.
                </p>
              ) : null}
              <form className="member-search" method="get">
                <label htmlFor="team-search">Name or email</label>
                <div>
                  <input
                    defaultValue={q}
                    disabled={Boolean(apiLoadError)}
                    id="team-search"
                    minLength={2}
                    name="q"
                    placeholder="e.g. njeri@company.com"
                    required
                  />
                  <button
                    className="tulink-button"
                    disabled={Boolean(apiLoadError)}
                    type="submit"
                  >
                    Search
                  </button>
                </div>
              </form>

              {q.trim().length >= 2 ? (
                <div className="search-results">
                  {searchResults.map((result) => {
                    const assigned = assignedUserIds.has(result.uid);
                    return (
                      <article key={result.uid}>
                        <div>
                          <strong>{result.displayName}</strong>
                          <span>{result.email}</span>
                        </div>
                        <form action={addTeamMember}>
                          <input name="userId" type="hidden" value={result.uid} />
                          <button
                            className="compact-button"
                            disabled={assigned}
                            type="submit"
                          >
                            {assigned ? 'Added' : 'Add'}
                          </button>
                        </form>
                      </article>
                    );
                  })}
                  {searchResults.length === 0 ? (
                    <p className="muted-copy">
                      No matching Tulink users found.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </aside>
          ) : null}
        </div>

        <section className="tulink-panel mobile-team-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Journey ownership</p>
              <h2>Tulink mobile team</h2>
            </div>
            <span>{teamMembers.length} visible</span>
          </div>

          {teamMembers.length === 0 ? (
            <div className="empty-state">
              <h3>No mobile members connected yet</h3>
              <p>
                Organization journeys appear after an admin adds a Tulink app
                user to this team.
              </p>
              {canManage ? (
                <a
                  className="tulink-button empty-state-action"
                  href="#add-mobile-member"
                >
                  Add your first member
                </a>
              ) : null}
            </div>
          ) : (
            <div className="mobile-member-list">
              {teamMembers.map((member) => (
                <article className="mobile-member" key={member.id}>
                  <div className="member-identity">
                    <span className="person-avatar mobile">
                      {initials(member.displayName)}
                    </span>
                    <div>
                      <h3>{member.displayName}</h3>
                      <p>{member.email}</p>
                    </div>
                    {canManage ? (
                      <RemoveTeamMemberForm
                        displayName={member.displayName}
                        teamMemberId={member.id}
                      />
                    ) : null}
                  </div>

                  <div className="delegation-zone">
                    <span className="delegation-label">Visible to</span>
                    <div className="delegate-chips">
                      {member.delegateClerkUserIds.map((clerkUserId) => {
                        const delegate = memberByClerkId.get(clerkUserId);
                        return (
                          <span className="delegate-chip" key={clerkUserId}>
                            {delegate?.displayName ?? clerkUserId}
                            {canManage ? (
                              <form action={removeDelegate}>
                                <input
                                  name="teamMemberId"
                                  type="hidden"
                                  value={member.id}
                                />
                                <input
                                  name="clerkUserId"
                                  type="hidden"
                                  value={clerkUserId}
                                />
                                <button
                                  aria-label={`Remove ${
                                    delegate?.displayName ?? 'delegate'
                                  }`}
                                  type="submit"
                                >
                                  x
                                </button>
                              </form>
                            ) : null}
                          </span>
                        );
                      })}
                      {member.delegateClerkUserIds.length === 0 ? (
                        <span className="open-visibility">
                          Admins only until delegated
                        </span>
                      ) : null}
                    </div>

                    {canManage && dashboardMembers.length > 0 ? (
                      <form className="delegate-form" action={assignDelegate}>
                        <input
                          name="teamMemberId"
                          type="hidden"
                          value={member.id}
                        />
                        <select
                          aria-label={`Delegate ${member.displayName}`}
                          name="clerkUserId"
                          required
                        >
                          <option value="">Assign operator...</option>
                          {dashboardMembers
                            .filter(
                              (operator) =>
                                !member.delegateClerkUserIds.includes(
                                  operator.userId,
                                ),
                            )
                            .map((operator) => (
                              <option
                                key={operator.userId}
                                value={operator.userId}
                              >
                                {operator.displayName} /{' '}
                                {roleLabel(operator.role)}
                              </option>
                            ))}
                        </select>
                        <button className="compact-button" type="submit">
                          Assign
                        </button>
                      </form>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
