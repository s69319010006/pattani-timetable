// =====================================================
// test-scheduler.js - Automated Tests สำหรับระบบจัดตารางสอนอัตโนมัติ (CSP)
// =====================================================
const assert = require('assert');
const { getDb } = require('../database/database');
const Scheduler = require('../services/scheduler');
const ConflictChecker = require('../services/conflictChecker');

async function runTests() {
    console.log('🧪 กำลังทดสอบ Scheduler (อัลกอริทึมจัดตารางสอนอัตโนมัติ CSP)...');
    const db = getDb();
    const scheduler = new Scheduler(db);
    const checker = new ConflictChecker(db);

    const semester = db.prepare('SELECT id FROM semesters WHERE is_current = 1 LIMIT 1').get();
    assert(semester, 'ต้องมีข้อมูลภาคเรียน');

    const admin = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
    assert(admin, 'ต้องมีข้อมูล admin');

    // สร้าง test version
    const testVersion = db.prepare(`
        INSERT INTO timetable_versions (semester_id, version_number, name, status, notes)
        VALUES (?, 998, 'Test Auto Scheduler Version', 'draft', 'Version สำหรับทดสอบจัดตาราง')
    `).run(semester.id);
    const versionId = testVersion.lastInsertRowid;

    try {
        // ----------------------------------------------------
        // Test 1: ทดสอบการจัดตารางอัตโนมัติรอบแรก
        // ----------------------------------------------------
        console.log('  ▸ Test 1: รันอัลกอริทึมจัดตารางอัตโนมัติ...');
        const result = await scheduler.generate(semester.id, versionId, admin.id, {
            weight_spread: 1.0,
            weight_gaps: 1.0,
            optimization_iterations: 20
        });

        assert.strictEqual(result.success, true, 'การจัดตารางต้องสำเร็จ');
        assert(result.stats.scheduledCount > 0, `ต้องจัดได้มากกว่า 0 คาบ (จัดได้ ${result.stats.scheduledCount})`);
        console.log(`    ✅ จัดสำเร็จ ${result.stats.scheduledCount} คาบ`);

        // ----------------------------------------------------
        // Test 2: ตรวจสอบว่าไม่มีข้อขัดแย้งขั้นรุนแรง (0 Hard Conflicts)
        // ----------------------------------------------------
        console.log('  ▸ Test 2: ตรวจสอบความถูกต้องของ Hard Constraints (Zero Conflict)...');
        const conflictReport = checker.checkAllConflicts(versionId);
        assert.strictEqual(conflictReport.hardConflicts, 0, `ต้องไม่มี Hard Conflict เลย (พบ ${conflictReport.hardConflicts})`);
        console.log('    ✅ ผ่าน: ไม่มีข้อขัดแย้งขั้นรุนแรง (0 Hard Conflicts)');

        // ----------------------------------------------------
        // Test 3: ทดสอบการล็อกคาบ (Lock Entry) แล้วจัดใหม่
        // ----------------------------------------------------
        console.log('  ▸ Test 3: ทดสอบการคงสถานะคาบที่ถูกล็อก (Lock Entry)...');
        const firstEntry = db.prepare('SELECT id, time_slot_id, classroom_id FROM timetable_entries WHERE version_id = ? LIMIT 1').get(versionId);
        assert(firstEntry, 'ต้องมี entry อย่างน้อย 1 รายการ');

        // ล็อก entry นี้
        db.prepare('UPDATE timetable_entries SET is_locked = 1 WHERE id = ?').run(firstEntry.id);

        // รันจัดตารางใหม่อีกครั้ง
        await scheduler.generate(semester.id, versionId, admin.id, {});

        // ตรวจสอบว่า entry ที่ถูกล็อกยังอยู่ที่เดิม
        const entryAfter = db.prepare('SELECT id, time_slot_id, classroom_id, is_locked FROM timetable_entries WHERE id = ?').get(firstEntry.id);
        assert(entryAfter, 'Entry ที่ล็อกต้องไม่ถูกลบ');
        assert.strictEqual(entryAfter.is_locked, 1, 'ต้องยังคงมีสถานะถูกล็อก');
        assert.strictEqual(entryAfter.time_slot_id, firstEntry.time_slot_id, 'ต้องอยู่ใน time slot เดิม');
        assert.strictEqual(entryAfter.classroom_id, firstEntry.classroom_id, 'ต้องอยู่ในห้องเรียนเดิม');
        console.log('    ✅ ผ่าน: คาบที่ล็อกไว้คงอยู่ตำแหน่งเดิมถูกต้อง');

        // ----------------------------------------------------
        // Test 4: ตรวจสอบคะแนนคุณภาพ (Quality Score)
        // ----------------------------------------------------
        console.log('  ▸ Test 4: ตรวจสอบคะแนนคุณภาพ (Quality Score)...');
        const versionRecord = db.prepare('SELECT quality_score FROM timetable_versions WHERE id = ?').get(versionId);
        assert(versionRecord.quality_score > 0, `คะแนนคุณภาพต้องมากกว่า 0 (ได้ ${versionRecord.quality_score})`);
        console.log(`    ✅ ผ่าน: คะแนนคุณภาพคำนวณได้ ${versionRecord.quality_score.toFixed(1)}/100`);

        console.log('🎉 การทดสอบ Scheduler ผ่านทั้งหมด 100%!');
    } finally {
        db.prepare('DELETE FROM timetable_entries WHERE version_id = ?').run(versionId);
        db.prepare('DELETE FROM timetable_versions WHERE id = ?').run(versionId);
    }
}

if (require.main === module) {
    runTests().catch(err => {
        console.error('❌ ข้อผิดพลาดในการทดสอบ:', err);
        process.exit(1);
    });
}

module.exports = runTests;
