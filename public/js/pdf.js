// รวมรูปถ่ายหลายหน้าเป็นไฟล์ PDF ในเบราว์เซอร์ (ไม่ต้องพึ่งไลบรารีภายนอก)
const A4 = [595.28, 841.89];

async function toJpeg(file, maxSide = 2200, quality = 0.82) {
  let bmp;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error(`อ่านรูป "${file.name || 'ภาพ'}" ไม่ได้ (รองรับ JPG/PNG/WebP)`);
  }
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const hgt = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = hgt;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, hgt);
  ctx.drawImage(bmp, 0, 0, w, hgt);
  bmp.close?.();
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
  if (!blob) throw new Error('แปลงรูปไม่สำเร็จ');
  return { bytes: new Uint8Array(await blob.arrayBuffer()), w, h: hgt };
}

export async function imagesToPdf(files, onProgress) {
  const pages = [];
  for (let i = 0; i < files.length; i++) {
    pages.push(await toJpeg(files[i]));
    onProgress?.(i + 1, files.length);
  }
  const enc = new TextEncoder();
  const chunks = [];
  const offsets = [];
  let len = 0;
  const push = (d) => {
    const u = typeof d === 'string' ? enc.encode(d) : d;
    chunks.push(u);
    len += u.length;
  };
  const begin = (n) => {
    offsets[n] = len;
    push(`${n} 0 obj\n`);
  };
  push(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // %PDF-1.4 + ไบต์ไบนารี

  const total = 2 + pages.length * 3;
  begin(1);
  push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  begin(2);
  push(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] >>\nendobj\n`);

  pages.forEach((p, i) => {
    const landscape = p.w > p.h;
    const [pw, ph] = landscape ? [A4[1], A4[0]] : A4;
    const s = Math.min(pw / p.w, ph / p.h);
    const dw = p.w * s, dh = p.h * s;
    const x = (pw - dw) / 2, y = (ph - dh) / 2;
    const pageN = 3 + i * 3, contN = pageN + 1, imgN = pageN + 2;
    begin(pageN);
    push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw.toFixed(2)} ${ph.toFixed(2)}] /Resources << /XObject << /Im0 ${imgN} 0 R >> >> /Contents ${contN} 0 R >>\nendobj\n`);
    const content = `q ${dw.toFixed(2)} 0 0 ${dh.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im0 Do Q`;
    begin(contN);
    push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
    begin(imgN);
    push(`<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.bytes.length} >>\nstream\n`);
    push(p.bytes);
    push('\nendstream\nendobj\n');
  });

  const xrefAt = len;
  let xref = `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= total; n++) xref += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);
  return new Blob(chunks, { type: 'application/pdf' });
}
