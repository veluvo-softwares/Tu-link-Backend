import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const apiBaseUrl = process.env.TULINK_API_URL ?? 'http://localhost:3000';

export async function GET() {
  const { getToken, orgId } = await auth();
  if (!orgId) {
    return NextResponse.json(
      { message: 'Active organization required' },
      { status: 401 },
    );
  }

  const token = await getToken();
  if (!token) {
    return NextResponse.json(
      { message: 'Clerk session required' },
      { status: 401 },
    );
  }

  const response = await fetch(`${apiBaseUrl}/operator/live-journeys`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  const body = await response.text();

  return new NextResponse(body, {
    status: response.status,
    headers: {
      'Content-Type':
        response.headers.get('content-type') ?? 'application/json',
    },
  });
}
