import { NextResponse } from 'next/server';
import {
  createOwnerChallenge,
  DemoAuthError,
  verifyOwnerChallenge,
} from '@/lib/demo/auth';
import { demoOwnerAddress } from '@/lib/demo/orchestrator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CORS = {
  'Access-Control-Allow-Origin': process.env.DEMO_ALLOWED_ORIGIN ?? '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
  'Cache-Control': 'no-store',
};

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const SIGNATURE_PATTERN = /^0x(?:[0-9a-fA-F]{128}|[0-9a-fA-F]{130})$/;

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: CORS });
}

export function OPTIONS(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/** Public deployer address; useful only for deciding whether to offer unlock. */
export function GET(): NextResponse {
  return json({ ok: true, owner: demoOwnerAddress() });
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: { address?: unknown; signature?: unknown };
  try {
    body = (await request.json()) as { address?: unknown; signature?: unknown };
  } catch {
    return json({ ok: false, error: 'Request body must be JSON.' }, 400);
  }
  if (typeof body.address !== 'string' || !ADDRESS_PATTERN.test(body.address)) {
    return json({ ok: false, error: 'A valid wallet address is required.' }, 400);
  }

  try {
    if (body.signature === undefined) {
      const challenge = createOwnerChallenge(body.address);
      return json({ ok: true, ...challenge });
    }
    if (typeof body.signature !== 'string' || !SIGNATURE_PATTERN.test(body.signature)) {
      return json({ ok: false, error: 'A valid signature is required.' }, 400);
    }
    const session = await verifyOwnerChallenge(body.address, body.signature);
    return json({ ok: true, ...session });
  } catch (error) {
    if (error instanceof DemoAuthError) {
      if (error.code === 'NOT_OWNER') {
        return json(
          { ok: false, code: error.code, error: 'This wallet does not own private missions.' },
          403
        );
      }
      return json(
        {
          ok: false,
          code: error.code,
          error:
            error.code === 'CHALLENGE_EXPIRED'
              ? 'The signature challenge expired. Request a new one.'
              : 'Wallet signature rejected.',
        },
        401
      );
    }
    return json({ ok: false, error: 'Wallet verification failed.' }, 500);
  }
}
