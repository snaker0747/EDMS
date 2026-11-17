// ทดสอบการเพิ่มคอลัมน์ "ลำดับ" ให้ฐานข้อมูล D1 เดิมที่สร้างไว้ก่อนอัปเดต (ข้อมูลเดิมต้องไม่หาย)
import assert from 'node:assert/strict';
import { createD1 } from './d1-mock.mjs';
import { migrateColumns, SCHEMA, ddl, ord } from '../src/db.js';

const DB = createD1();
// สร้างตารางแบบเก่า (ไม่มี sort_order) แล้วใส่ข้อมูล
for (const sql of ddl()) {
  const old = sql.replace(/, "sort_order" TEXT NOT NULL DEFAULT ''/g, '');
  await DB.prepare(old).run();
}
await DB.prepare(`INSERT INTO "folders" ("id","name","parent_id") VALUES ('f1','เก่า','ROOT')`).run();
await DB.prepare(`INSERT INTO "docs" ("id","title") VALUES ('d1','เอกสารเก่า')`).run();
let info = (await DB.prepare('PRAGMA table_info("docs")').all()).results.map((r) => r.name);
assert.ok(!info.includes('sort_order'), 'ตารางเก่าไม่มีคอลัมน์');
await migrateColumns({ DB });
await migrateColumns({ DB }); // รันซ้ำต้องไม่พัง
for (const key of ['docs', 'folders']) {
  info = (await DB.prepare(`PRAGMA table_info("${key}")`).all()).results.map((r) => r.name);
  assert.ok(info.includes('sort_order'), `${key} มี sort_order หลังย้ายคอลัมน์`);
}
const f = (await DB.prepare(`SELECT * FROM "folders" WHERE id='f1'`).all()).results[0];
assert.equal(f.name, 'เก่า');
assert.equal(f.sort_order, '');
assert.equal(ord(f.sort_order), null);
assert.equal(ord('3'), 3);
assert.ok(SCHEMA.docs.cols.some(([k]) => k === 'sort_order'));
console.log('✔ migrate ผ่าน: เพิ่มคอลัมน์ลำดับให้ตารางเดิม ข้อมูลเดิมอยู่ครบ รันซ้ำได้');
