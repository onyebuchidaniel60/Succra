import { NextResponse } from 'next/server';
import { getDemoState, runDemoAction } from '@/lib/demo/orchestrator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    const state = await getDemoState();
    return NextResponse.json({ ok: true, state });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Demo initialization failed.' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = (await request.json()) as { action?: unknown };
    if (typeof body.action !== 'string') {
      return NextResponse.json({ ok: false, error: 'action is required.' }, { status: 400 });
    }
    const state = await runDemoAction(body.action);
    return NextResponse.json({ ok: true, state });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Demo action failed.' },
      { status: 500 }
    );
  }
}
