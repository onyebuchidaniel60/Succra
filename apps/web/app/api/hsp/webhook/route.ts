// POST /api/hsp/webhook — HSP settlement webhook receiver.
import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { handleHspWebhook } from '@/lib/gateway/hsp-webhook';
import { createWebhookChain, createWebhookPersistence } from '@/lib/gateway/hsp-webhook-production';
import { admin } from '@/lib/supabase';

export async function POST(request: Request): Promise<NextResponse> {
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return apiError(400, 'INVALID_BODY', 'Webhook body could not be read.');
  }

  const secret = process.env.HSP_WEBHOOK_SECRET;
  if (!secret) {
    return apiError(500, 'WEBHOOK_CONFIG', 'Webhook verification is not configured.');
  }
  const signature =
    request.headers.get('x-hsp-signature') ?? request.headers.get('x-succra-hmac') ?? '';

  try {
    const result = await handleHspWebhook({
      rawBody,
      signature,
      secret,
      persistence: createWebhookPersistence(admin()),
      chain: createWebhookChain(),
    });
    return NextResponse.json(result.json, { status: result.status });
  } catch {
    return apiError(500, 'WEBHOOK_FAILED', 'The webhook could not be processed.');
  }
}
