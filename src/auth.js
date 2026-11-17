// ล็อกอินด้วยชื่อผู้ใช้/รหัสผ่าน: เก็บรหัสผ่านแบบ PBKDF2 และใช้คุกกี้ลงนามด้วย HMAC
import { b64uEncode, b64uDecode, timingSafeEqual, HttpError } from './util.js';

const enc = new TextEncoder();
const ITERATIONS = 100000; // ค่าสูงสุดที่ Cloudflare Workers รองรับ
export const COOKIE = 'edms_session';
export const SESSION_SECONDS = 12 * 60 * 60;

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${b64uEncode(salt)}$${b64uEncode(hash)}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = parseInt(parts[1], 10);
  if (!iterations || iterations > 100000) return false;
  const hash = await pbkdf2(password, b64uDecode(parts[2]), iterations);
  return timingSafeEqual(hash, b64uDecode(parts[3]));
}

async function hmacKey(env) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 16) {
    throw new HttpError(500, 'ยังไม่ได้ตั้งค่า SESSION_SECRET');
  }
  return crypto.subtle.importKey('raw', enc.encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

export async function signSession(env, username) {
  const payload = b64uEncode(enc.encode(JSON.stringify({ u: username, exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS })));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env), enc.encode(payload));
  return `${payload}.${b64uEncode(sig)}`;
}

// คืนชื่อผู้ใช้ถ้าคุกกี้ถูกต้องและยังไม่หมดอายุ
export async function readSession(env, request) {
  const cookie = request.headers.get('cookie') || '';
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(cookie);
  if (!m) return null;
  const [payload, sig] = m[1].split('.');
  if (!payload || !sig) return null;
  let ok = false;
  try {
    ok = await crypto.subtle.verify('HMAC', await hmacKey(env), b64uDecode(sig), enc.encode(payload));
  } catch {
    return null;
  }
  if (!ok) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(b64uDecode(payload)));
    if (!data.u || data.exp < Date.now() / 1000) return null;
    return data.u;
  } catch {
    return null;
  }
}

export function sessionCookie(token, maxAge = SESSION_SECONDS) {
  return `${COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

export function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร';
  if (pw.length > 100) return 'รหัสผ่านยาวเกินไป';
  return null;
}
