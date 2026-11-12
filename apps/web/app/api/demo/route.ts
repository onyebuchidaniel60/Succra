import { NextResponse } from 'next/server';
import { getDemoState, runDemoAction } from '@/lib/demo/orchestrator';
import { saveDemoSnapshot } from '@/lib/db/neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CORS = {
  'Access-Control-Allow-Origin': process.env.DEMO_ALLOWED_ORIGIN ?? '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
  'Cache-Control': 'no-store',
};

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: CORS });
}

export function OPTIONS(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(): Promise<NextResponse> {
  try {
    const state = await getDemoState();
    await saveDemoSnapshot(state).catch(() => undefined);
    return json({ ok: true, state });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof Error ? error.message : 'Demo initialization failed.' },
      500
    );
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = (await request.json()) as { action?: unknown };
    if (typeof body.action !== 'string') {
      return json({ ok: false, error: 'action is required.' }, 400);
    }
    const state = await runDemoAction(body.action);
    await saveDemoSnapshot(state).catch(() => undefined);
    return json({ ok: true, state });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof Error ? error.message : 'Demo action failed.' },
      500
    );
  }
}
