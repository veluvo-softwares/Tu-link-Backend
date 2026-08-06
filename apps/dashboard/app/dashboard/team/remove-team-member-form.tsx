'use client';

import { removeTeamMember } from './actions';

interface RemoveTeamMemberFormProps {
  displayName: string;
  teamMemberId: string;
}

export function RemoveTeamMemberForm({
  displayName,
  teamMemberId,
}: RemoveTeamMemberFormProps) {
  function confirmRemoval() {
    return window.confirm(
      `Remove ${displayName} from this organization? Their future journeys will no longer be attributed to this team.`,
    );
  }

  return (
    <form action={removeTeamMember}>
      <input name="teamMemberId" type="hidden" value={teamMemberId} />
      <button
        aria-label={`Remove ${displayName} from organization`}
        className="member-remove-button"
        formAction={removeTeamMember}
        onClick={(event) => {
          if (!confirmRemoval()) event.preventDefault();
        }}
        type="submit"
      >
        Remove
      </button>
    </form>
  );
}
