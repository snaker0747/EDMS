# ตั้งค่าและ deploy ระบบ EDMS ครั้งแรก  (คลิกขวาไฟล์นี้ > Run with PowerShell)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$Site = 'https://edms.rayongcity.workers.dev'
trap { Write-Host ("`nเกิดข้อผิดพลาด: " + $_) -ForegroundColor Red; Read-Host 'กด Enter เพื่อปิดหน้าต่าง'; exit 1 }

function Step($t) { Write-Host "`n=== $t ===" -ForegroundColor Cyan }
function Rand($n) {
  $b = New-Object byte[] $n
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  ([Convert]::ToBase64String($b)).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}
function Put-Secret($name, $value) {
  $value | npx wrangler secret put $name
  if ($LASTEXITCODE) { throw "ตั้งค่า $name ไม่สำเร็จ" }
}

if (-not (Test-Path oauth-client.txt)) { throw 'ไม่พบไฟล์ oauth-client.txt' }
$cfg = @{}
Get-Content oauth-client.txt | ForEach-Object { if ($_ -match '^(\w+)=(.+)$') { $cfg[$Matches[1]] = $Matches[2].Trim() } }

Step '1/6 ติดตั้งแพ็กเกจ'
npm install
if ($LASTEXITCODE) { throw 'npm install ไม่สำเร็จ' }

Step '2/6 ล็อกอิน Cloudflare ด้วยบัญชี snakernasa16@gmail.com'
$who = (npx wrangler whoami 2>&1 | Out-String)
if ($LASTEXITCODE -eq 0 -and $who -match '@') {
  Write-Host $who
  if ($who -notmatch 'snakernasa16@gmail\.com') {
    $a = Read-Host 'เครื่องนี้ล็อกอิน Cloudflare เป็นบัญชีอื่น ล็อกอินใหม่ด้วย snakernasa16@gmail.com ไหม (y/n)'
    if ($a -match '^[yY]') { npx wrangler logout; npx wrangler login; if ($LASTEXITCODE) { throw 'ล็อกอิน Cloudflare ไม่สำเร็จ' } }
  }
} else {
  Write-Host 'จะเปิดเบราว์เซอร์ ให้ล็อกอินด้วย snakernasa16@gmail.com แล้วกดอนุญาต'
  npx wrangler login
  if ($LASTEXITCODE) { throw 'ล็อกอิน Cloudflare ไม่สำเร็จ' }
}

Step '3/6 deploy ครั้งแรก'
npm run deploy
if ($LASTEXITCODE) { throw 'deploy ไม่สำเร็จ' }

Step '4/6 ขอ refresh token จาก Google (เบราว์เซอร์จะเปิดเอง ล็อกอินด้วย rayongcity.works@gmail.com)'
Write-Host 'ถ้าขึ้นว่า "Google hasn''t verified this app" ให้กด Advanced แล้วเลือก Go to ... (unsafe) จากนั้นกดอนุญาตทั้งหมด' -ForegroundColor Yellow
$script:refresh = $null
node scripts/get-refresh-token.mjs $cfg['CLIENT_ID'] $cfg['CLIENT_SECRET'] 2>&1 | ForEach-Object {
  $line = "$_".Trim()
  if ($line -match '^https://accounts\.google\.com/') { Start-Process $line; Write-Host '(เปิดหน้าอนุญาตสิทธิ์ให้แล้ว)' }
  elseif ($line -match '^1//[\w\-\.]+$') { $script:refresh = $line }
  elseif ($line) { Write-Host $line }
}
if (-not $script:refresh) { throw 'ไม่ได้ refresh token (ถ้าเพิ่งสร้าง client ให้รอ 5-10 นาทีแล้วรันใหม่)' }
Write-Host 'ได้ refresh token แล้ว' -ForegroundColor Green

Step '5/6 ตั้งค่าลับบน Cloudflare'
$setupKey = Rand 24
Put-Secret 'GOOGLE_CLIENT_ID' $cfg['CLIENT_ID']
Put-Secret 'GOOGLE_CLIENT_SECRET' $cfg['CLIENT_SECRET']
Put-Secret 'GOOGLE_REFRESH_TOKEN' $script:refresh
Put-Secret 'SESSION_SECRET' (Rand 48)
Put-Secret 'SETUP_KEY' $setupKey

Step '6/6 สร้างชีตฐานข้อมูลและผู้ดูแลระบบคนแรก'
$user = Read-Host 'ตั้งชื่อผู้ใช้ผู้ดูแลระบบ (ภาษาอังกฤษ เช่น admin)'
$name = Read-Host 'ชื่อที่แสดง (เช่น ผู้ดูแลระบบ)'
$sec = Read-Host 'ตั้งรหัสผ่าน (อย่างน้อย 8 ตัวอักษร)' -AsSecureString
$pass = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
$body = [Text.Encoding]::UTF8.GetBytes((@{ admin_username = $user; admin_password = $pass; admin_name = $name } | ConvertTo-Json))
$ok = $false
foreach ($i in 1..4) {
  try {
    $r = Invoke-RestMethod -Method Post -Uri "$Site/api/setup" -Headers @{ 'X-Setup-Key' = $setupKey } -ContentType 'application/json; charset=utf-8' -Body $body
    $r | ConvertTo-Json -Depth 5
    $ok = $true; break
  } catch {
    Write-Host ("ครั้งที่ $i ไม่สำเร็จ: " + $_.Exception.Message) -ForegroundColor Yellow
    Start-Sleep -Seconds 15
  }
}
if (-not $ok) { throw '/api/setup ไม่สำเร็จ (ถ้าเพิ่งสร้าง client ให้รอสักครู่แล้วรันสคริปต์ใหม่)' }

Remove-Item oauth-client.txt -Force
Write-Host "`nเสร็จแล้ว เปิด $Site แล้วล็อกอินด้วย $user ได้เลย" -ForegroundColor Green
Read-Host 'กด Enter เพื่อปิด'
