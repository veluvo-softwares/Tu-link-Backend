import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { operatorFetch } from '../../../operator-api';

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

  let response: Response;
  try {
    response = await operatorFetch('/operator/live-journeys', token);
  } catch {
    return NextResponse.json(
      { message: 'Operator API unavailable' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const body = await response.text();

  return new NextResponse(body, {
    status: response.status,
    headers: {
      'Content-Type':
        response.headers.get('content-type') ?? 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}
