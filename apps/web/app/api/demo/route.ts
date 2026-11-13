import { NextResponse } from 'next/server';
import { parseUnits } from 'viem';
import { hasOwnerSession } from '@/lib/demo/auth';
import {
  emptyDemoState,
  getDemoState,
  isDemoOwner,
  runDemoAction,
} from '@/lib/demo/orchestrator';
import { saveDemoSnapshot } from '@/lib/db/neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CORS = {
  'Access-Control-Allow-Origin': process.env.DEMO_ALLOWED_ORIGIN ?? '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'content-type,authorization',
  'Cache-Control': 'no-store',
};

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: CORS });
}

export function OPTIONS(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const url = new URL(request.url);
    const owner = url.searchParams.get('owner');
    const demo = url.searchParams.get('demo') === 'true';

    // The public simulation is explicitly opt-in and contains no per-wallet
    // data beyond the deployed demo missions.
    if (demo) {
      const state = await getDemoState();
      await saveDemoSnapshot(state).catch(() => undefined);
      return json({ ok: true, state });
    }

    // No owner or a non-owner wallet receives a clean, empty dashboard.
    if (!owner || !isDemoOwner(owner)) {
      return json({ ok: true, state: emptyDemoState(owner) });
    }

    // The deployer address is public; it is not a credential. Private state
    // requires the short-lived token issued after a wallet signature.
    if (!hasOwnerSession(request.headers.get('authorization'))) {
      return json(
        {
          ok: false,
          code: 'OWNER_AUTH_REQUIRED',
          error: 'Verify the owner wallet to view private mission state.',
        },
        401
      );
    }

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
    const url = new URL(request.url);
    const owner = url.searchParams.get('owner');
    const demo = url.searchParams.get('demo') === 'true';

    // Public demo actions are opt-in. Owner-scoped actions require both the
    // owner address and a valid signature-derived bearer token.
    if (!demo) {
      if (
        !owner ||
        !isDemoOwner(owner) ||
        !hasOwnerSession(request.headers.get('authorization'))
      ) {
        return json(
          {
            ok: false,
            code: 'OWNER_AUTH_REQUIRED',
            error: 'Verify the owner wallet before running mission actions.',
          },
          403
        );
      }
    }

    const body = (await request.json()) as {
      action?: unknown;
      amount?: unknown;
      token?: unknown;
    };
    if (typeof body.action !== 'string') {
      return json({ ok: false, error: 'action is required.' }, 400);
    }

    const isDeposit = body.action === 'deposit' || body.action === 'deposit-usdg';
    let depositToken: 'usdg' | 'wif' = 'usdg';
    if (body.action === 'deposit') {
      if (body.token !== 'usdg' && body.token !== 'wif') {
        return json({ ok: false, error: 'token must be usdg or wif.' }, 400);
      }
      depositToken = body.token;
    } else if (body.token !== undefined && (body.action !== 'deposit-usdg' || body.token !== 'usdg')) {
      return json(
        { ok: false, error: 'token is only supported for the deposit action.' },
        400
      );
    }

    let amountAtomic: bigint | undefined;
    if (body.amount !== undefined || body.action === 'deposit') {
      if (!isDeposit) {
        return json(
          { ok: false, error: 'amount is only supported for deposit actions.' },
          400
        );
      }
      if (body.amount === undefined) {
        return json({ ok: false, error: 'amount is required for deposit.' }, 400);
      }
      const decimals = depositToken === 'usdg' ? 6 : 18;
      const pattern = new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`);
      if (typeof body.amount !== 'string' || !pattern.test(body.amount)) {
        return json(
          {
            ok: false,
            error: `amount must be a positive ${depositToken.toUpperCase()} value with at most ${decimals} decimals.`,
          },
          400
        );
      }
      try {
        amountAtomic = parseUnits(body.amount, decimals);
      } catch {
        return json(
          { ok: false, error: `amount is not a valid ${depositToken.toUpperCase()} value.` },
          400
        );
      }
      if (amountAtomic <= 0n) {
        return json({ ok: false, error: 'amount must be greater than zero.' }, 400);
      }
    }

    const state = await runDemoAction(body.action, {
      amountAtomic,
      token: body.action === 'deposit' ? depositToken : undefined,
    });
    await saveDemoSnapshot(state).catch(() => undefined);
    return json({ ok: true, state });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof Error ? error.message : 'Demo action failed.' },
      500
    );
  }
}
