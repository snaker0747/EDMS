// ขอ refresh token ของบัญชี Google ส่วนกลาง (รันครั้งเดียวบนเครื่องของคุณ)
// วิธีใช้:  node scripts/get-refresh-token.mjs <CLIENT_ID> <CLIENT_SECRET>
import http from 'node:http';

const [clientId, clientSecret] = process.argv.slice(2);
if (!clientId || !clientSecret) {
  console.error('วิธีใช้: node scripts/get-refresh-token.mjs <CLIENT_ID> <CLIENT_SECRET>');
  process.exit(1);
}
const PORT = 53682;
const redirect = `http://localhost:${PORT}`;
const scope = ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets'].join(' ');
const authUrl =
  'https://accounts.google.com/o/oauth2/v2/auth?' +
  new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: 'code', scope, access_type: 'offline', prompt: 'consent' });

console.log('\n1) เปิดลิงก์นี้ในเบราว์เซอร์ แล้วล็อกอินด้วยบัญชี Google ส่วนกลาง (เจ้าของโฟลเดอร์เอกสาร):\n');
console.log(authUrl + '\n');
console.log('2) กด "อนุญาต" (หากขึ้นว่าแอปยังไม่ได้รับการยืนยัน ให้เลือก ขั้นสูง > ไปที่ ... (ไม่ปลอดภัย))\n');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, redirect);
  const code = url.searchParams.get('code');
  if (!code) {
    res.end('รอรหัสอนุญาต…');
    return;
  }
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirect, grant_type: 'authorization_code' }),
    });
    const data = await r.json();
    if (!data.refresh_token) throw new Error(JSON.stringify(data));
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<meta charset="utf-8"><h2>สำเร็จ กลับไปดูที่หน้าต่างคำสั่งได้เลย</h2>');
    console.log('\n✔ ได้ refresh token แล้ว (เก็บเป็นความลับ อย่าส่งต่อหรือใส่ในไฟล์โค้ด):\n');
    console.log(data.refresh_token + '\n');
    console.log('นำไปตั้งค่าด้วยคำสั่ง:  npx wrangler secret put GOOGLE_REFRESH_TOKEN\n');
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('ผิดพลาด: ' + e.message);
    console.error('ผิดพลาด:', e.message);
  }
  server.close();
});
server.listen(PORT, () => console.log(`กำลังรอรหัสอนุญาตที่ ${redirect} …`));
