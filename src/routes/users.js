import { HttpError, json, nowIso, clampStr } from '../util.js';
import { hashPassword, verifyPassword, signSession, sessionCookie, REMEMBER_SECONDS, SESSION_SECONDS, passwordProblem } from '../auth.js';
import { getUsers, findUser, appendRow, updateRow, isActive, logHistory } from '../db.js';

const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;
const ROLES = ['admin', 'user'];

export const me = (u) => ({ username: u.username, display_name: u.display_name, role: u.role });

// ป้องกันการเดารหัสผ่าน (นับในหน่วยความจำของ Worker ตัวนั้น ๆ)
const fails = new Map();
const MAX_FAILS = 6;
const LOCK_MS = 5 * 60 * 1000;

export async function login(c, _p, request) {
  const body = await request.json().catch(() => ({}));
  const username = clampStr(body.username, 60).toLowerCase();
  const password = typeof body.password === 'string' ? body.password.slice(0, 200) : '';
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  const key = `${ip}|${username}`;
  const f = fails.get(key);
  if (f && f.n >= MAX_FAILS && f.until > Date.now()) {
    throw new HttpError(429, 'ลองผิดหลายครั้งเกินไป กรุณารอ 5 นาทีแล้วลองใหม่');
  }
  const user = username ? await findUser(c, username) : null;
  // คำนวณแฮชทุกครั้งแม้ไม่พบผู้ใช้ เพื่อไม่ให้เดาชื่อผู้ใช้จากเวลาตอบกลับ
  const ok = await verifyPassword(password, user?.password_hash || 'pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  if (!user || !ok || !isActive(user)) {
    const n = (f && f.until > Date.now() ? f.n : 0) + 1;
    fails.set(key, { n, until: Date.now() + LOCK_MS });
    throw new HttpError(401, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  }
  fails.delete(key);
  const secs = body.remember === true ? REMEMBER_SECONDS : SESSION_SECONDS;
  const token = await signSession(c.env, user.username, secs);
  c.user = me(user);
  logHistory(c, 'เข้าสู่ระบบ', user.username, user.display_name);
  return json({ user: me(user) }, 200, { 'set-cookie': sessionCookie(token, secs) });
}

export async function logout() {
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0) });
}

export async function changePassword(c, _p, request) {
  const body = await request.json().catch(() => ({}));
  const row = await findUser(c, c.user.username);
  if (!(await verifyPassword(String(body.current || ''), row.password_hash))) {
    throw new HttpError(400, 'รหัสผ่านปัจจุบันไม่ถูกต้อง');
  }
  const problem = passwordProblem(body.next);
  if (problem) throw new HttpError(400, problem);
  await updateRow(c, 'users', row, { password_hash: await hashPassword(body.next) });
  logHistory(c, 'เปลี่ยนรหัสผ่านของตนเอง', row.username, row.display_name);
  return json({ ok: true });
}

export async function listUsers(c) {
  const rows = await getUsers(c);
  return json({
    users: rows.map((u) => ({
      username: u.username,
      display_name: u.display_name,
      role: u.role,
      active: isActive(u),
      created_at: u.created_at,
    })),
  });
}

export async function createUser(c, _p, request) {
  const body = await request.json().catch(() => ({}));
  const username = clampStr(body.username, 30).toLowerCase();
  if (!USERNAME_RE.test(username)) throw new HttpError(400, 'ชื่อผู้ใช้ใช้ได้เฉพาะ a-z 0-9 . _ - ยาว 3-30 ตัว');
  const display = clampStr(body.display_name, 80);
  if (!display) throw new HttpError(400, 'กรุณากรอกชื่อที่แสดง');
  const role = ROLES.includes(body.role) ? body.role : 'user';
  const problem = passwordProblem(body.password);
  if (problem) throw new HttpError(400, problem);
  if (await findUser(c, username)) throw new HttpError(409, 'มีชื่อผู้ใช้นี้อยู่แล้ว');
  await appendRow(c, 'users', {
    username,
    display_name: display,
    role,
    password_hash: await hashPassword(body.password),
    active: 'true',
    created_at: nowIso(),
  });
  logHistory(c, 'เพิ่มผู้ใช้', username, display, `สิทธิ์ ${role}`);
  return json({ ok: true }, 201);
}

export async function updateUser(c, { username }, request) {
  const body = await request.json().catch(() => ({}));
  const row = await findUser(c, username);
  if (!row) throw new HttpError(404, 'ไม่พบผู้ใช้');
  const patch = {};
  if ('display_name' in body) {
    patch.display_name = clampStr(body.display_name, 80);
    if (!patch.display_name) throw new HttpError(400, 'กรุณากรอกชื่อที่แสดง');
  }
  if ('role' in body) {
    if (!ROLES.includes(body.role)) throw new HttpError(400, 'สิทธิ์ไม่ถูกต้อง');
    patch.role = body.role;
  }
  if ('active' in body) patch.active = body.active ? 'true' : 'false';
  if (body.password) {
    const problem = passwordProblem(body.password);
    if (problem) throw new HttpError(400, problem);
    patch.password_hash = await hashPassword(body.password);
  }
  // กันผู้ดูแลล็อกตัวเองออก / ไม่เหลือผู้ดูแลที่ใช้งานอยู่
  const demoting = (patch.role && patch.role !== 'admin') || patch.active === 'false';
  if (demoting && row.role === 'admin') {
    const others = (await getUsers(c)).filter((u) => u.role === 'admin' && isActive(u) && u.username !== row.username);
    if (!others.length) throw new HttpError(400, 'ต้องมีผู้ดูแลระบบที่ใช้งานอยู่อย่างน้อย 1 คน');
  }
  await updateRow(c, 'users', row, patch);
  const what = Object.keys(patch).map((k) => (k === 'password_hash' ? 'รีเซ็ตรหัสผ่าน' : k)).join(', ');
  logHistory(c, 'แก้ไขผู้ใช้', row.username, row.display_name, what);
  return json({ ok: true });
}
