// เรียก Google Drive / Google Sheets ด้วยบัญชีส่วนกลาง (OAuth refresh token)
import { HttpError } from './util.js';

let tokenCache = { token: null, exp: 0 };

export async function accessToken(env) {
  if (tokenCache.token && tokenCache.exp > Date.now() + 60_000) return tokenCache.token;
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REFRESH_TOKEN) {
    throw new HttpError(500, 'ยังไม่ได้ตั้งค่าการเชื่อมต่อ Google (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN)');
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    console.error('google token error', res.status, JSON.stringify(data));
    throw new HttpError(502, 'เชื่อมต่อบัญชี Google ส่วนกลางไม่ได้ (ตรวจสอบ refresh token)');
  }
  tokenCache = { token: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 };
  return tokenCache.token;
}

export function resetTokenCache() {
  tokenCache = { token: null, exp: 0 };
}

// เรียก API พร้อมแนบ token ลองใหม่ 1 ครั้งเมื่อ token หมดอายุหรือ Google ตอบ 429/5xx
export async function gfetch(env, url, init = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await accessToken(env);
    const headers = new Headers(init.headers || {});
    headers.set('authorization', `Bearer ${token}`);
    const res = await fetch(url, { ...init, headers });
    if (res.status === 401 && attempt === 0) {
      resetTokenCache();
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && attempt === 0 && !(init.body instanceof ReadableStream)) {
      await new Promise((r) => setTimeout(r, 600));
      continue;
    }
    return res;
  }
  throw new HttpError(502, 'เรียก Google ไม่สำเร็จ');
}

async function gjson(env, url, init) {
  const res = await gfetch(env, url, init);
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* ไม่ใช่ JSON */
  }
  if (!res.ok) {
    console.error('google api error', res.status, url, text.slice(0, 500));
    const reason = data?.error?.message || text.slice(0, 200);
    if (res.status === 404) throw new HttpError(404, 'ไม่พบรายการในที่เก็บไฟล์');
    if (res.status === 403) throw new HttpError(502, `Google ไม่อนุญาตการเข้าถึง: ${reason}`);
    throw new HttpError(502, `Google ตอบกลับผิดพลาด (${res.status}): ${reason}`);
  }
  return data;
}

const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
const FILE_FIELDS = 'id,name,mimeType,size,parents,createdTime,modifiedTime,webViewLink,trashed';

// ---------- Drive ----------
export const driveGet = (env, id, fields = FILE_FIELDS) =>
  gjson(env, `${DRIVE}/files/${encodeURIComponent(id)}?fields=${encodeURIComponent(fields)}`);

export async function driveList(env, q) {
  const out = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({
      q,
      pageSize: '1000',
      fields: `nextPageToken,files(${FILE_FIELDS})`,
      orderBy: 'name',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const data = await gjson(env, `${DRIVE}/files?${params}`);
    out.push(...(data.files || []));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return out;
}

export const driveCreateFolder = (env, name, parentId) =>
  gjson(env, `${DRIVE}/files?fields=${encodeURIComponent(FILE_FIELDS)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  });

export function drivePatch(env, id, body, { addParents, removeParents } = {}) {
  const params = new URLSearchParams({ fields: FILE_FIELDS });
  if (addParents) params.set('addParents', addParents);
  if (removeParents) params.set('removeParents', removeParents);
  return gjson(env, `${DRIVE}/files/${encodeURIComponent(id)}?${params}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// อัปโหลดแบบ resumable: ขอ session ก่อน แล้วส่งไฟล์ทั้งก้อน
async function resumableUpload(env, { method, url, metadata, mime, bytes }) {
  const init = await gfetch(env, url, {
    method,
    headers: {
      'content-type': 'application/json; charset=UTF-8',
      'x-upload-content-type': mime,
      'x-upload-content-length': String(bytes.byteLength),
    },
    body: JSON.stringify(metadata),
  });
  if (!init.ok) {
    console.error('upload init error', init.status, (await init.text()).slice(0, 300));
    throw new HttpError(502, 'เริ่มอัปโหลดไฟล์ไม่สำเร็จ');
  }
  const location = init.headers.get('location');
  if (!location) throw new HttpError(502, 'ที่เก็บไฟล์ไม่ส่งที่อยู่สำหรับอัปโหลด');
  const put = await gfetch(env, location, {
    method: 'PUT',
    headers: { 'content-type': mime },
    body: bytes,
  });
  const text = await put.text();
  if (!put.ok) {
    console.error('upload put error', put.status, text.slice(0, 300));
    throw new HttpError(502, 'ส่งไฟล์ไม่สำเร็จ');
  }
  return JSON.parse(text);
}

export const driveUploadNew = (env, { name, parentId, mime, bytes }) =>
  resumableUpload(env, {
    method: 'POST',
    url: `${UPLOAD}/files?uploadType=resumable&fields=${encodeURIComponent(FILE_FIELDS)}`,
    metadata: { name, parents: [parentId] },
    mime,
    bytes,
  });

export const driveUploadReplace = (env, id, { name, mime, bytes }) =>
  resumableUpload(env, {
    method: 'PATCH',
    url: `${UPLOAD}/files/${encodeURIComponent(id)}?uploadType=resumable&fields=${encodeURIComponent(FILE_FIELDS)}`,
    metadata: { name },
    mime,
    bytes,
  });

export const driveDownload = (env, id, range) =>
  gfetch(env, `${DRIVE}/files/${encodeURIComponent(id)}?alt=media`, {
    headers: range ? { range } : {},
  });

// ---------- Sheets ----------
export const sheetsCreate = (env, title) =>
  gjson(env, SHEETS, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ properties: { title, locale: 'th_TH', timeZone: 'Asia/Bangkok' } }),
  });

export const sheetsMeta = (env, id) =>
  gjson(env, `${SHEETS}/${id}?fields=sheets.properties(sheetId,title,gridProperties)`);

export const sheetsBatch = (env, id, requests) =>
  gjson(env, `${SHEETS}/${id}:batchUpdate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requests }),
  });

export const sheetsGet = (env, id, range) =>
  gjson(
    env,
    `${SHEETS}/${id}/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS`
  );

// อ่านหลายแท็บในคำขอเดียว (เร็วกว่าอ่านทีละแท็บมาก)
export const sheetsBatchGet = (env, id, ranges) =>
  gjson(
    env,
    `${SHEETS}/${id}/values:batchGet?valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS&${ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join('&')}`
  );

export const sheetsBatchUpdateValues = (env, id, data) =>
  gjson(env, `${SHEETS}/${id}/values:batchUpdate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ valueInputOption: 'RAW', data: data.map((d) => ({ range: d.range, majorDimension: 'ROWS', values: d.values })) }),
  });

export const sheetsUpdate = (env, id, range, values) =>
  gjson(env, `${SHEETS}/${id}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ range, majorDimension: 'ROWS', values }),
  });

export const sheetsAppend = (env, id, range, values) =>
  gjson(
    env,
    `${SHEETS}/${id}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ majorDimension: 'ROWS', values }),
    }
  );
