import { randomBytes, createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const token = (bytes = 24) => randomBytes(bytes).toString('base64url');
export const shortId = () => randomBytes(6).toString('base64url');
export const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex');

export function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const bad = (m) => new HttpError(400, m);

export const hmac = (secret, msg) => createHmac('sha256', String(secret)).update(String(msg)).digest('hex');
