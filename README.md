# ระบบบริหารจัดการเอกสารอิเล็กทรอนิกส์ (E-Document Management System)

ส่วนการโยธา ฝ่ายสาธารณูปโภค สำนักช่าง เทศบาลนครระยอง

- หน้าเว็บ + API อยู่บน **Cloudflare Workers** → `https://edms.rayongcity.workers.dev`
- ตัวไฟล์ (ส่วนใหญ่เป็น PDF) เก็บใน **Google Drive** ของบัญชีส่วนกลาง (โฟลเดอร์ `เอกสารส่วนการโยธา สำนักช่าง`)
- รายละเอียดเอกสาร โฟลเดอร์ ผู้ใช้ ประวัติ เก็บใน **Google Sheet** ชื่อ `EDMS ข้อมูลระบบ` (ระบบสร้างให้เองในโฟลเดอร์หลัก) → **AppSheet ต่อชีตนี้ได้โดยตรง**
- ล็อกอินด้วยชื่อผู้ใช้/รหัสผ่าน มี 2 สิทธิ์: ผู้ดูแลระบบ และผู้ใช้ทั่วไป

## ติดตั้งครั้งแรก (ทำครั้งเดียว ประมาณ 30 นาที)

ต้องมี Node.js 20 ขึ้นไป และเปิดโฟลเดอร์โปรเจคนี้ในหน้าต่างคำสั่ง

### 1) ตั้งค่า Google Cloud (ใช้บัญชี Google ส่วนกลาง เจ้าของโฟลเดอร์เอกสาร)

1. เข้า https://console.cloud.google.com → สร้างโปรเจคใหม่ (ชื่ออะไรก็ได้ เช่น `edms-rayong`)
2. เมนู **APIs & Services → Library** → เปิดใช้ **Google Drive API** และ **Google Sheets API**
3. เมนู **OAuth consent screen** → User type **External** → กรอกชื่อแอปและอีเมล → ที่ Scopes ไม่ต้องเพิ่มอะไร
4. **สำคัญ:** กด **Publish app** ให้สถานะเป็น **In production** (ถ้าค้างที่ Testing ตัวเชื่อมต่อจะหมดอายุทุก 7 วัน)
5. เมนู **Credentials → Create credentials → OAuth client ID** → ชนิด **Desktop app** → จด **Client ID** และ **Client secret**

### 2) ขอ refresh token

```bash
npm install
npm run token -- <CLIENT_ID> <CLIENT_SECRET>
```

เปิดลิงก์ที่โปรแกรมแสดง ล็อกอินด้วยบัญชีส่วนกลาง กด "อนุญาต" แล้วจะได้ refresh token ในหน้าต่างคำสั่ง

### 3) ตั้งค่าลับบน Cloudflare

```bash
npx wrangler login
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GOOGLE_REFRESH_TOKEN
npx wrangler secret put SESSION_SECRET      # ข้อความสุ่มยาว ๆ อย่างน้อย 32 ตัว
npx wrangler secret put SETUP_KEY           # รหัสใช้ครั้งแรกตอนตั้งค่าระบบ (จดไว้)
```

สร้างข้อความสุ่มสำหรับ `SESSION_SECRET`: `node -e "console.log(crypto.randomUUID()+crypto.randomUUID())"`

> ถ้ายังไม่ได้ตั้ง `workers.dev` subdomain ของบัญชี Cloudflare ครั้งแรกที่ deploy ระบบจะถาม ให้ตั้งเป็น `rayongcity` เพื่อได้ที่อยู่ `edms.rayongcity.workers.dev`

### 4) นำขึ้นใช้งาน

```bash
npm run deploy
```

### 5) ตั้งค่าเริ่มต้นของระบบ (สร้างชีต + ผู้ดูแลคนแรก + นำไฟล์เดิมใน Drive เข้าระบบ)

PowerShell (Windows):

```powershell
Invoke-RestMethod -Method Post -Uri https://edms.rayongcity.workers.dev/api/setup `
  -Headers @{ "X-Setup-Key" = "<SETUP_KEY ที่ตั้งไว้>" } -ContentType "application/json" `
  -Body '{"admin_username":"admin","admin_password":"<รหัสผ่านผู้ดูแล อย่างน้อย 8 ตัว>","admin_name":"ผู้ดูแลระบบ"}'
```

macOS / Linux:

```bash
curl -X POST https://edms.rayongcity.workers.dev/api/setup \
  -H "X-Setup-Key: <SETUP_KEY>" -H "Content-Type: application/json" \
  -d '{"admin_username":"admin","admin_password":"<รหัสผ่านผู้ดูแล>","admin_name":"ผู้ดูแลระบบ"}'
```

ผลลัพธ์จะบอกลิงก์ Google Sheet และจำนวนโฟลเดอร์/ไฟล์ที่นำเข้า เรียกซ้ำได้ ไม่ทำของเดิมซ้ำ

จากนั้นเปิด https://edms.rayongcity.workers.dev ล็อกอินด้วยผู้ดูแลที่ตั้งไว้ → เมนู **ผู้ใช้งาน** เพื่อเพิ่มเจ้าหน้าที่คนอื่น

## การใช้งานประจำวัน

| ต้องการ | ทำที่ไหน |
|---|---|
| อัปโหลดจากคอมพิวเตอร์ | เมนู **อัปโหลด** → ลากไฟล์มาวาง |
| อัปโหลดจากมือถือ | เมนู **อัปโหลด** → **ถ่ายจากกล้องมือถือ** ถ่ายทีละหน้า แล้ว **รวมเป็น PDF** |
| สร้าง/ย้าย/เปลี่ยนชื่อ/ลบโฟลเดอร์ | เมนู **จัดการโฟลเดอร์** (ใน Google Drive เปลี่ยนตามอัตโนมัติ) |
| เพิ่มช่องรายละเอียด/ประเภทเอกสาร | เมนู **จัดการโฟลเดอร์** (ผู้ดูแลเท่านั้น) |
| นำไฟล์ที่ใส่ใน Drive โดยตรงเข้าระบบ | **จัดการโฟลเดอร์ → ซิงก์จาก Google Drive** |

สิทธิ์: ผู้ดูแลระบบจัดการได้ทุกอย่าง · ผู้ใช้ทั่วไปดู/ค้นหา/อัปโหลด/สร้างโฟลเดอร์ และแก้ไขเอกสารที่ตนเองอัปโหลด

เปิดบนมือถือแล้วเลือก "เพิ่มไปยังหน้าจอหลัก" จะใช้งานเหมือนแอปได้

## เชื่อมต่อ AppSheet

สร้างแอปใน AppSheet จาก Google Sheet **EDMS ข้อมูลระบบ** (แท็บ `เอกสาร`, `โฟลเดอร์`) ใช้บัญชี Google ส่วนกลางเดียวกัน
อย่าแก้หรือลบหัวคอลัมน์แถวแรกของแต่ละแท็บ และอย่าแก้แท็บ `ผู้ใช้` (มีรหัสผ่านที่เข้ารหัสแล้ว) ควรให้ AppSheet อ่านอย่างเดียว หรือเพิ่มข้อมูลผ่านเว็บเพื่อให้ไฟล์ใน Drive กับรายการตรงกัน

## ข้อจำกัดที่ควรรู้

- ไฟล์ใหญ่สุด 40 MB ต่อไฟล์ (ปรับ `MAX_UPLOAD_MB` ใน `wrangler.toml` ได้ แต่ Workers จำกัดการส่งข้อมูลต่อครั้งที่ 100 MB)
- รายละเอียดเก็บใน Google Sheet เหมาะกับหลักหมื่นรายการ หากข้อมูลโตกว่านี้มากค่อยย้ายไป Cloudflare D1
- การปิดผู้ใช้/เปลี่ยนสิทธิ์มีผลภายใน 30 วินาที
- ล็อกอินหมดอายุใน 12 ชั่วโมง ใส่รหัสผิด 6 ครั้งจะถูกพักการล็อกอิน 5 นาที
- ลิงก์เอกสารที่ส่งต่อให้คนอื่น ผู้รับต้องล็อกอินระบบก่อนจึงเปิดได้ (ไม่ต้องมีสิทธิ์ใน Google Drive)
- เอกสารที่ลบจะไปอยู่ถังขยะของ Google Drive กู้คืนได้ 30 วัน

## โครงสร้างโปรเจค

```
wrangler.toml        ตั้งค่า Cloudflare (ชื่อ edms, โฟลเดอร์หลัก, ขนาดไฟล์สูงสุด)
src/index.js         ตัวจัดเส้นทาง API + ตรวจสิทธิ์ + กัน CSRF
src/auth.js          เข้ารหัสรหัสผ่าน (PBKDF2) และคุกกี้ล็อกอิน
src/google.js        เรียก Google Drive / Sheets
src/db.js            ใช้ Google Sheet เป็นฐานข้อมูล (5 แท็บ: เอกสาร โฟลเดอร์ ตั้งค่า ผู้ใช้ ประวัติ)
src/routes/*.js      เอกสาร โฟลเดอร์ ผู้ใช้ ตั้งค่า ตั้งค่าเริ่มต้น/ซิงก์
public/              หน้าเว็บ 6 หน้า (ล็อกอิน คลังเอกสาร อัปโหลด รายละเอียด โฟลเดอร์ ผู้ใช้) ฟอนต์ Google Sans
scripts/             สคริปต์ขอ refresh token
test/                ทดสอบอัตโนมัติด้วย Google จำลอง (npm test)
```

## พัฒนา/ทดสอบ

```bash
npm test                      # ทดสอบ API 37 ขั้น ด้วย Google จำลอง
node test/dev-server.mjs      # เปิดเว็บทดลองที่ http://localhost:8787 (ข้อมูลจำลอง admin / Passw0rd!x)
```
