'use client';

import type { FormEvent } from 'react';
import { removeTeamMember } from './actions';

interface RemoveTeamMemberFormProps {
  displayName: string;
  teamMemberId: string;
}

export function RemoveTeamMemberForm({
  displayName,
  teamMemberId,
}: RemoveTeamMemberFormProps) {
  function confirmRemoval(event: FormEvent<HTMLFormElement>) {
    if (
      !window.confirm(
        `Remove ${displayName} from this organization? Their future journeys will no longer be attributed to this team.`,
      )
    ) {
      event.preventDefault();
    }
  }

  return (
    <form action={removeTeamMember} onSubmit={confirmRemoval}>
      <input name="teamMemberId" type="hidden" value={teamMemberId} />
      <button className="member-remove-button" type="submit">
        Remove
      </button>
    </form>
  );
}
