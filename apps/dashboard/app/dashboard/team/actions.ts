'use server';

import { auth } from '@clerk/nextjs/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

interface ApiErrorPayload {
  message?: string | string[];
}

const apiBaseUrl = process.env.TULINK_API_URL ?? 'http://localhost:3000';

async function mutateOperatorApi(path: string, init: RequestInit) {
  const { getToken, orgId } = await auth();
  if (!orgId) {
    throw new Error('Select an organization first');
  }

  const token = await getToken();
  if (!token) {
    throw new Error('Your Clerk session has expired');
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | ApiErrorPayload
      | null;
    const message = Array.isArray(payload?.message)
      ? payload.message[0]
      : payload?.message;
    throw new Error(message ?? `Tulink API returned ${response.status}`);
  }
}

function requiredString(formData: FormData, key: string) {
  const value = formData.get(key);
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${key} is required`);
  }
  return value.trim();
}

function resultUrl(kind: 'notice' | 'error', message: string) {
  return `/dashboard/team?${kind}=${encodeURIComponent(message)}`;
}

export async function addTeamMember(formData: FormData) {
  try {
    const userId = requiredString(formData, 'userId');
    await mutateOperatorApi('/operator/team-members', {
      method: 'POST',
      body: JSON.stringify({ userId }),
    });
  } catch (error) {
    redirect(
      resultUrl(
        'error',
        error instanceof Error ? error.message : 'Unable to add team member',
      ),
    );
  }

  revalidatePath('/dashboard/team');
  redirect(resultUrl('notice', 'Tulink member added to this organization'));
}

export async function assignDelegate(formData: FormData) {
  try {
    const teamMemberId = requiredString(formData, 'teamMemberId');
    const clerkUserId = requiredString(formData, 'clerkUserId');
    await mutateOperatorApi(
      `/operator/team-members/${encodeURIComponent(teamMemberId)}/delegates`,
      {
        method: 'POST',
        body: JSON.stringify({ clerkUserId }),
      },
    );
  } catch (error) {
    redirect(
      resultUrl(
        'error',
        error instanceof Error ? error.message : 'Unable to assign delegate',
      ),
    );
  }

  revalidatePath('/dashboard/team');
  redirect(resultUrl('notice', 'Journey visibility delegated'));
}

export async function removeTeamMember(formData: FormData) {
  try {
    const teamMemberId = requiredString(formData, 'teamMemberId');
    await mutateOperatorApi(
      `/operator/team-members/${encodeURIComponent(teamMemberId)}`,
      { method: 'DELETE' },
    );
  } catch (error) {
    redirect(
      resultUrl(
        'error',
        error instanceof Error ? error.message : 'Unable to remove team member',
      ),
    );
  }

  revalidatePath('/dashboard/team');
  redirect(resultUrl('notice', 'Tulink member removed from this organization'));
}

export async function removeDelegate(formData: FormData) {
  try {
    const teamMemberId = requiredString(formData, 'teamMemberId');
    const clerkUserId = requiredString(formData, 'clerkUserId');
    await mutateOperatorApi(
      `/operator/team-members/${encodeURIComponent(
        teamMemberId,
      )}/delegates/${encodeURIComponent(clerkUserId)}`,
      { method: 'DELETE' },
    );
  } catch (error) {
    redirect(
      resultUrl(
        'error',
        error instanceof Error ? error.message : 'Unable to remove delegate',
      ),
    );
  }

  revalidatePath('/dashboard/team');
  redirect(resultUrl('notice', 'Delegated visibility removed'));
}
