// =====================================================
// test-conflicts.js - Automated Tests สำหรับระบบตรวจสอบข้อขัดแย้ง
// =====================================================
const assert = require('assert');
const { getDb } = require('../database/database');
const ConflictChecker = require('../services/conflictChecker');

function runTests() {
    console.log('🧪 กำลังทดสอบ ConflictChecker (ระบบตรวจสอบข้อขัดแย้ง)...');
    const db = getDb();
    const checker = new ConflictChecker(db);

    // สร้าง test version ชั่วคราว
    const semester = db.prepare('SELECT id FROM semesters WHERE is_current = 1 LIMIT 1').get();
    assert(semester, 'ต้องมีข้อมูลภาคเรียน');

    const testVersion = db.prepare(`
        INSERT INTO timetable_versions (semester_id, version_number, name, status, notes)
        VALUES (?, 999, 'Test Conflict Version', 'draft', 'Version สำหรับทดสอบข้อขัดแย้ง')
    `).run(semester.id);
    const versionId = testVersion.lastInsertRowid;

    try {
        const slots = db.prepare('SELECT id FROM time_slots WHERE semester_id = ? LIMIT 5').all(semester.id);
        const rooms = db.prepare('SELECT id, room_type FROM classrooms').all();
        const normalRoom = rooms.find(r => r.room_type === 'ห้องเรียน');
        const labRoom = rooms.find(r => r.room_type !== 'ห้องเรียน');
        const assignments = db.prepare(`
            SELECT ta.*, s.requires_lab 
            FROM teaching_assignments ta
            JOIN subjects s ON ta.subject_id = s.id
            WHERE ta.semester_id = ?
        `).all(semester.id);

        assert(slots.length >= 2, 'ต้องมี time slots อย่างน้อย 2 ช่อง');
        assert(assignments.length >= 2, 'ต้องมี assignments อย่างน้อย 2 รายการ');

        // ----------------------------------------------------
        // Test 1: ครูคนเดียวกันชนเวลา (Teacher Conflict)
        // ----------------------------------------------------
        console.log('  ▸ Test 1: ทดสอบครูคนเดียวกันสอนซ้อนเวลา...');
        let teacherAss1 = null, teacherAss2 = null;
        for (const a1 of assignments) {
            const match = assignments.find(a2 => a2.id !== a1.id && a2.teacher_id === a1.teacher_id);
            if (match) {
                teacherAss1 = a1;
                teacherAss2 = match;
                break;
            }
        }
        assert(teacherAss1 && teacherAss2, 'ต้องมีครูที่ได้รับการมอบหมายสอนอย่างน้อย 2 วิชา/กลุ่ม');

        db.prepare('INSERT INTO timetable_entries (version_id, teaching_assignment_id, time_slot_id, classroom_id) VALUES (?, ?, ?, ?)')
            .run(versionId, teacherAss1.id, slots[0].id, rooms[0].id);
        db.prepare('INSERT INTO timetable_entries (version_id, teaching_assignment_id, time_slot_id, classroom_id) VALUES (?, ?, ?, ?)')
            .run(versionId, teacherAss2.id, slots[0].id, rooms[1].id);

        const teacherConflicts = checker.checkTeacherConflicts(versionId);
        assert(teacherConflicts.length > 0, 'ต้องตรวจพบข้อขัดแย้งครูสอนซ้อนเวลา');
        assert.strictEqual(teacherConflicts[0].severity, 'hard', 'ต้องเป็น Hard Conflict');
        console.log('    ✅ ผ่าน: ตรวจพบครูสอนซ้อนเวลาถูกต้อง');

        // เคลียร์ entries
        db.prepare('DELETE FROM timetable_entries WHERE version_id = ?').run(versionId);

        // ----------------------------------------------------
        // Test 2: ห้องเรียนถูกใช้ซ้ำ (Room Conflict)
        // ----------------------------------------------------
        console.log('  ▸ Test 2: ทดสอบห้องเรียนถูกใช้ซ้อนเวลา...');
        db.prepare('INSERT INTO timetable_entries (version_id, teaching_assignment_id, time_slot_id, classroom_id) VALUES (?, ?, ?, ?)')
            .run(versionId, assignments[0].id, slots[0].id, rooms[0].id);
        db.prepare('INSERT INTO timetable_entries (version_id, teaching_assignment_id, time_slot_id, classroom_id) VALUES (?, ?, ?, ?)')
            .run(versionId, assignments[1].id, slots[0].id, rooms[0].id);

        const roomConflicts = checker.checkRoomConflicts(versionId);
        assert(roomConflicts.length > 0, 'ต้องตรวจพบข้อขัดแย้งห้องเรียนซ้อน');
        assert.strictEqual(roomConflicts[0].severity, 'hard', 'ต้องเป็น Hard Conflict');
        console.log('    ✅ ผ่าน: ตรวจพบห้องเรียนชนกันถูกต้อง');

        // เคลียร์ entries
        db.prepare('DELETE FROM timetable_entries WHERE version_id = ?').run(versionId);

        // ----------------------------------------------------
        // Test 3: กลุ่มเรียนชนกัน (Group Conflict)
        // ----------------------------------------------------
        console.log('  ▸ Test 3: ทดสอบกลุ่มเรียนเรียนซ้อนเวลา...');
        const sameGroupAss = assignments.filter(a => a.student_group_id === assignments[0].student_group_id);
        if (sameGroupAss.length >= 2) {
            db.prepare('INSERT INTO timetable_entries (version_id, teaching_assignment_id, time_slot_id, classroom_id) VALUES (?, ?, ?, ?)')
                .run(versionId, sameGroupAss[0].id, slots[0].id, rooms[0].id);
            db.prepare('INSERT INTO timetable_entries (version_id, teaching_assignment_id, time_slot_id, classroom_id) VALUES (?, ?, ?, ?)')
                .run(versionId, sameGroupAss[1].id, slots[0].id, rooms[1].id);

            const groupConflicts = checker.checkGroupConflicts(versionId);
            assert(groupConflicts.length > 0, 'ต้องตรวจพบข้อขัดแย้งกลุ่มเรียนซ้อน');
            console.log('    ✅ ผ่าน: ตรวจพบกลุ่มเรียนชนกันถูกต้อง');
        }

        // เคลียร์ entries
        db.prepare('DELETE FROM timetable_entries WHERE version_id = ?').run(versionId);

        // ----------------------------------------------------
        // Test 4: วิชาปฏิบัติถูกจัดในห้องเรียนปกติ (Lab Requirement Conflict)
        // ----------------------------------------------------
        console.log('  ▸ Test 4: ทดสอบวิชาปฏิบัติถูกจัดในห้องเรียนปกติ...');
        const labAss = assignments.find(a => a.requires_lab === 1);
        if (labAss && normalRoom) {
            db.prepare('INSERT INTO timetable_entries (version_id, teaching_assignment_id, time_slot_id, classroom_id) VALUES (?, ?, ?, ?)')
                .run(versionId, labAss.id, slots[0].id, normalRoom.id);

            const labConflicts = checker.checkLabRequirementConflicts(versionId);
            assert(labConflicts.length > 0, 'ต้องตรวจพบข้อขัดแย้งห้องปฏิบัติการ');
            console.log('    ✅ ผ่าน: ตรวจพบวิชาปฏิบัติต้องการห้องปฏิบัติการถูกต้อง');
        }

        console.log('🎉 การทดสอบ ConflictChecker ผ่านทั้งหมด 100%!');
    } finally {
        // ลบข้อมูลทดสอบ
        db.prepare('DELETE FROM timetable_entries WHERE version_id = ?').run(versionId);
        db.prepare('DELETE FROM timetable_versions WHERE id = ?').run(versionId);
    }
}

if (require.main === module) {
    runTests();
}

module.exports = runTests;
