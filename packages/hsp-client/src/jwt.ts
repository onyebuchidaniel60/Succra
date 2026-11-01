import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';

type JwtPayload = Record<string, unknown>;

function base64Url(value: string | Uint8Array): string {
  return Buffer.from(value).toString('base64url');
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function normaliseHex(value: string): string {
  return value.startsWith('0x') ? value.slice(2) : value;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Signs an ES256K JWT. ES256K uses secp256k1 with SHA-256, which Node's
 * WebCrypto does not support; @noble/curves supplies the primitive viem
 * uses internally. The signature is compact r||s (64 bytes).
 */
export function signJwtES256K(payload: JwtPayload, privateKeyHex: string, kid: string): string {
  const privateKey = normaliseHex(privateKeyHex);
  if (!/^[0-9a-f]{64}$/i.test(privateKey)) {
    throw new Error('ES256K private key must be 32-byte hex.');
  }

  const issuedAt = nowSeconds();
  const body: JwtPayload = { iat: issuedAt, ...payload };
  if (typeof body['exp'] !== 'number') {
    body['exp'] = issuedAt + 300;
  }

  const header = { alg: 'ES256K', typ: 'JWT', kid };
  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(body))}`;
  const digest = sha256(utf8ToBytes(signingInput));
  const signature = secp256k1.sign(digest, privateKey, { prehash: false, lowS: true });
  return `${signingInput}.${base64Url(signature.toBytes('compact'))}`;
}

/** Verifies an ES256K JWT signature and time claims. Fails closed. */
export function verifyJwtES256K(token: string, publicKeyHex: string): boolean {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const [headerPart, payloadPart, signaturePart] = parts;
    if (!headerPart || !payloadPart || !signaturePart) return false;

    const header = JSON.parse(decodeBase64Url(headerPart)) as { alg?: unknown };
    if (header.alg !== 'ES256K') return false;

    const payload = JSON.parse(decodeBase64Url(payloadPart)) as Record<string, unknown>;
    const now = nowSeconds();
    if (typeof payload['exp'] === 'number' && payload['exp'] <= now) return false;
    if (typeof payload['nbf'] === 'number' && payload['nbf'] > now) return false;

    const signingInput = `${headerPart}.${payloadPart}`;
    const digest = sha256(utf8ToBytes(signingInput));
    const signature = Buffer.from(signaturePart, 'base64url');
    if (signature.length !== 64) return false;

    const publicKey = normaliseHex(publicKeyHex);
    if (!/^[0-9a-f]{66}$|^[0-9a-f]{130}$/i.test(publicKey)) return false;
    return secp256k1.verify(signature, digest, hexToBytes(publicKey), {
      prehash: false,
      lowS: true,
    });
  } catch {
    return false;
  }
}

/** Exposed for tests and key setup; returns uncompressed public key hex. */
export function publicKeyFromPrivateKey(privateKeyHex: string): string {
  return bytesToHex(secp256k1.getPublicKey(normaliseHex(privateKeyHex), false));
}
