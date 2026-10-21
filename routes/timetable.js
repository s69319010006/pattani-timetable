// =====================================================
// timetable.js - Routes จัดการเวอร์ชันตาราง ตารางสอน และการจัดตารางอัตโนมัติ
// =====================================================
const express = require('express');
const router = express.Router();
const { requireAuth, requireRole, auditLog } = require('../middleware/authMiddleware');
const Scheduler = require('../services/scheduler');
const ConflictChecker = require('../services/conflictChecker');

module.exports = function(db) {
    const log = auditLog(db);
    const scheduler = new Scheduler(db);
    const conflictChecker = new ConflictChecker(db);

    // ==================== เวอร์ชันตาราง (Timetable Versions) ====================
    
    // ดึงรายการเวอร์ชันทั้งหมด (กรองตาม semester_id ได้)
    router.get('/versions', requireAuth, (req, res) => {
        try {
            const { semester_id } = req.query;
            let query = `
                SELECT tv.*, s.name as semester_name, ay.year as academic_year,
                       u1.full_name as creator_name, u2.full_name as approver_name
                FROM timetable_versions tv
                JOIN semesters s ON tv.semester_id = s.id
                JOIN academic_years ay ON s.academic_year_id = ay.id
                LEFT JOIN users u1 ON tv.created_by = u1.id
                LEFT JOIN users u2 ON tv.approved_by = u2.id
                WHERE 1=1
            `;
            const params = [];
            if (semester_id) {
                query += ' AND tv.semester_id = ?';
                params.push(semester_id);
            }
            query += ' ORDER BY s.id DESC, tv.version_number DESC';
            const versions = db.prepare(query).all(...params);
            res.json(versions);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ดึงรายละเอียดเวอร์ชันเดียว
    router.get('/versions/:id', requireAuth, (req, res) => {
        try {
            const version = db.prepare(`
                SELECT tv.*, s.name as semester_name, ay.year as academic_year,
                       u1.full_name as creator_name, u2.full_name as approver_name
                FROM timetable_versions tv
                JOIN semesters s ON tv.semester_id = s.id
                JOIN academic_years ay ON s.academic_year_id = ay.id
                LEFT JOIN users u1 ON tv.created_by = u1.id
                LEFT JOIN users u2 ON tv.approved_by = u2.id
                WHERE tv.id = ?
            `).get(req.params.id);

            if (!version) return res.status(404).json({ error: 'ไม่พบเวอร์ชันตารางที่ระบุ' });

            // สถิติ entries
            const entryCount = db.prepare('SELECT COUNT(*) as count FROM timetable_entries WHERE version_id = ?').get(req.params.id);
            version.total_entries = entryCount.count;

            res.json(version);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // สร้างเวอร์ชันตารางใหม่ (ฉบับร่าง)
    router.post('/versions', requireRole('admin', 'academic'), (req, res) => {
        try {
            const { semester_id, name, notes } = req.body;
            if (!semester_id || !name) {
                return res.status(400).json({ error: 'กรุณากรอกภาคเรียนและชื่อเวอร์ชัน' });
            }

            // หาหมายเลขเวอร์ชันถัดไป
            const maxVer = db.prepare('SELECT MAX(version_number) as max_v FROM timetable_versions WHERE semester_id = ?').get(semester_id);
            const nextVersion = (maxVer?.max_v || 0) + 1;

            const result = db.prepare(`
                INSERT INTO timetable_versions (semester_id, version_number, name, status, notes, created_by)
                VALUES (?, ?, ?, 'draft', ?, ?)
            `).run(semester_id, nextVersion, name, notes || '', req.session.user.id);

            log(req.session.user.id, 'create', 'timetable_versions', result.lastInsertRowid, null, {
                semester_id, version_number: nextVersion, name
            });

            res.json({
                success: true,
                id: result.lastInsertRowid,
                version_number: nextVersion,
                message: `สร้างเวอร์ชันที่ ${nextVersion} สำเร็จ`
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // คัดลอกเวอร์ชัน (Duplicate Version)
    router.post('/versions/:id/duplicate', requireRole('admin', 'academic'), (req, res) => {
        try {
            const sourceVersion = db.prepare('SELECT * FROM timetable_versions WHERE id = ?').get(req.params.id);
            if (!sourceVersion) return res.status(404).json({ error: 'ไม่พบเวอร์ชันต้นฉบับ' });

            const maxVer = db.prepare('SELECT MAX(version_number) as max_v FROM timetable_versions WHERE semester_id = ?').get(sourceVersion.semester_id);
            const nextVersion = (maxVer?.max_v || 0) + 1;
            const newName = `${sourceVersion.name} (สำเนา v${nextVersion})`;

            const duplicateTx = db.transaction(() => {
                const newVersionResult = db.prepare(`
                    INSERT INTO timetable_versions (semester_id, version_number, name, status, notes, quality_score, total_scheduled, total_unscheduled, total_conflicts, created_by)
                    VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)
                `).run(
                    sourceVersion.semester_id,
                    nextVersion,
                    newName,
                    `คัดลอกมาจากเวอร์ชัน ${sourceVersion.version_number}`,
                    sourceVersion.quality_score,
                    sourceVersion.total_scheduled,
                    sourceVersion.total_unscheduled,
                    sourceVersion.total_conflicts,
                    req.session.user.id
                );

                const newVersionId = newVersionResult.lastInsertRowid;

                // คัดลอก entries ทั้งหมด
                const entries = db.prepare('SELECT * FROM timetable_entries WHERE version_id = ?').all(sourceVersion.id);
                const insertEntry = db.prepare(`
                    INSERT INTO timetable_entries (version_id, teaching_assignment_id, time_slot_id, classroom_id, is_locked, is_manual)
                    VALUES (?, ?, ?, ?, ?, ?)
                `);

                for (const e of entries) {
                    insertEntry.run(newVersionId, e.teaching_assignment_id, e.time_slot_id, e.classroom_id, e.is_locked, e.is_manual);
                }

                return newVersionId;
            });

            const newVersionId = duplicateTx();
            log(req.session.user.id, 'duplicate', 'timetable_versions', newVersionId, null, { sourceId: sourceVersion.id });

            res.json({
                success: true,
                id: newVersionId,
                message: `คัดลอกเป็นเวอร์ชันใหม่เรียบร้อยแล้ว`
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ปรับปรุงข้อมูลเวอร์ชัน (ชื่อ, บันทึก, สถานะ)
    router.put('/versions/:id', requireRole('admin', 'academic'), (req, res) => {
        try {
            const { name, notes, status } = req.body;
            const current = db.prepare('SELECT * FROM timetable_versions WHERE id = ?').get(req.params.id);
            if (!current) return res.status(404).json({ error: 'ไม่พบเวอร์ชันที่ต้องการแก้ไข' });

            // ห้ามเปลี่ยนสถานะถ้าไม่ใช่ published flow
            db.prepare(`
                UPDATE timetable_versions 
                SET name = COALESCE(?, name),
                    notes = COALESCE(?, notes),
                    status = COALESCE(?, status),
                    updated_at = datetime('now', 'localtime')
                WHERE id = ?
            `).run(name, notes, status, req.params.id);

            log(req.session.user.id, 'update', 'timetable_versions', req.params.id, current, req.body);
            res.json({ success: true, message: 'บันทึกข้อมูลเรียบร้อยแล้ว' });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // เผยแพร่ตารางสอน (Publish Version) - เวอร์ชันอื่นที่ published อยู่จะถูกเปลี่ยนเป็น archived
    router.post('/versions/:id/publish', requireRole('admin', 'academic'), (req, res) => {
        try {
            const version = db.prepare('SELECT * FROM timetable_versions WHERE id = ?').get(req.params.id);
            if (!version) return res.status(404).json({ error: 'ไม่พบเวอร์ชันที่ต้องการเผยแพร่' });

            // ตรวจสอบข้อขัดแย้งก่อนเผยแพร่
            const conflicts = conflictChecker.checkAllConflicts(version.id);
            if (conflicts.hardConflicts > 0) {
                return res.status(400).json({
                    error: `ไม่สามารถเผยแพร่ได้เนื่องจากมีข้อขัดแย้งขั้นรุนแรง (Hard Conflict) อยู่ ${conflicts.hardConflicts} รายการ`,
                    conflicts: conflicts.conflicts
                });
            }

            const publishTx = db.transaction(() => {
                // เปลี่ยนสถานะเวอร์ชันที่เคยเผยแพร่อยู่ในภาคเรียนนี้ให้เป็น archived
                db.prepare(`
                    UPDATE timetable_versions 
                    SET status = 'archived', updated_at = datetime('now', 'localtime')
                    WHERE semester_id = ? AND status = 'published' AND id != ?
                `).run(version.semester_id, version.id);

                // ตั้งเวอร์ชันนี้เป็น published
                db.prepare(`
                    UPDATE timetable_versions 
                    SET status = 'published',
                        approved_by = ?,
                        published_at = datetime('now', 'localtime'),
                        updated_at = datetime('now', 'localtime')
                    WHERE id = ?
                `).run(req.session.user.id, version.id);
            });

            publishTx();
            log(req.session.user.id, 'publish', 'timetable_versions', version.id, null, { name: version.name });

            res.json({
                success: true,
                message: `เผยแพร่ตารางสอน "${version.name}" เรียบร้อยแล้ว`
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ลบเวอร์ชันตาราง
    router.delete('/versions/:id', requireRole('admin'), (req, res) => {
        try {
            const version = db.prepare('SELECT * FROM timetable_versions WHERE id = ?').get(req.params.id);
            if (!version) return res.status(404).json({ error: 'ไม่พบเวอร์ชันที่ต้องการลบ' });
            if (version.status === 'published') {
                return res.status(400).json({ error: 'ห้ามลบตารางสอนที่อยู่ในสถานะ "เผยแพร่แล้ว" (กรุณาเปลี่ยนสถานะก่อน)' });
            }

            db.prepare('DELETE FROM timetable_versions WHERE id = ?').run(req.params.id);
            log(req.session.user.id, 'delete', 'timetable_versions', req.params.id, version, null);

            res.json({ success: true, message: 'ลบเวอร์ชันตารางสอนเรียบร้อยแล้ว' });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ==================== รายการตารางสอน (Timetable Entries) ====================

    // ดึง entries สำหรับแสดงในตาราง (รองรับ filter ตามครู, กลุ่มเรียน, ห้องเรียน)
    router.get('/entries', requireAuth, (req, res) => {
        try {
            const { version_id, teacher_id, student_group_id, classroom_id, day_of_week } = req.query;
            if (!version_id) {
                return res.status(400).json({ error: 'กรุณาระบุ version_id' });
            }

            let query = `
                SELECT te.id, te.version_id, te.time_slot_id, te.classroom_id, te.is_locked, te.is_manual,
                       ta.id as teaching_assignment_id, ta.hours_per_week,
                       t.id as teacher_id, t.prefix as teacher_prefix, t.first_name as teacher_first_name, t.last_name as teacher_last_name,
                       s.id as subject_id, s.code as subject_code, s.name as subject_name, s.short_name as subject_short_name,
                       s.subject_type, s.requires_lab, s.credits,
                       sg.id as student_group_id, sg.code as group_code, sg.name as group_name, sg.student_count,
                       c.code as classroom_code, c.name as classroom_name, c.room_type, c.building, c.floor,
                       ts.day_of_week, ts.day_name, ts.period_number, ts.start_time, ts.end_time, ts.slot_type
                FROM timetable_entries te
                JOIN teaching_assignments ta ON te.teaching_assignment_id = ta.id
                JOIN teachers t ON ta.teacher_id = t.id
                JOIN subjects s ON ta.subject_id = s.id
                JOIN student_groups sg ON ta.student_group_id = sg.id
                JOIN classrooms c ON te.classroom_id = c.id
                JOIN time_slots ts ON te.time_slot_id = ts.id
                WHERE te.version_id = ?
            `;
            const params = [version_id];

            if (teacher_id) {
                query += ' AND ta.teacher_id = ?';
                params.push(teacher_id);
            }
            if (student_group_id) {
                query += ' AND ta.student_group_id = ?';
                params.push(student_group_id);
            }
            if (classroom_id) {
                query += ' AND te.classroom_id = ?';
                params.push(classroom_id);
            }
            if (day_of_week) {
                query += ' AND ts.day_of_week = ?';
                params.push(day_of_week);
            }

            query += ' ORDER BY ts.day_of_week, ts.period_number';
            const entries = db.prepare(query).all(...params);
            res.json(entries);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ตรวจสอบความขัดแย้งก่อนวางคาบ (Pre-check conflict preview)
    router.post('/check-slot', requireAuth, (req, res) => {
        try {
            const { version_id, time_slot_id, classroom_id, teacher_id, student_group_id, exclude_entry_id } = req.body;
            if (!version_id || !time_slot_id || !classroom_id || !teacher_id || !student_group_id) {
                return res.status(400).json({ error: 'ข้อมูลไม่ครบถ้วนสำหรับการตรวจสอบ' });
            }

            const conflicts = conflictChecker.checkSingleEntryConflicts(
                version_id, time_slot_id, classroom_id, teacher_id, student_group_id, exclude_entry_id || null
            );

            // ตรวจความไม่ว่างของครูเพิ่มเติม
            const unavail = db.prepare(`
                SELECT tav.*, ts.day_name, ts.period_number 
                FROM teacher_availability tav
                JOIN time_slots ts ON tav.time_slot_id = ts.id
                WHERE tav.teacher_id = ? AND tav.time_slot_id = ? AND tav.is_available = 0
            `).get(teacher_id, time_slot_id);

            if (unavail) {
                conflicts.push({
                    type: 'teacher_unavailability',
                    severity: 'hard',
                    message: `ครูระบุว่าไม่ว่างในคาบนี้ (${unavail.reason || 'ไม่ระบุเหตุผล'})`
                });
            }

            res.json({
                hasConflict: conflicts.length > 0,
                conflicts
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // เพิ่ม Entry ด้วยตนเอง (Manual Placement)
    router.post('/entries', requireRole('admin', 'academic'), (req, res) => {
        try {
            const { version_id, teaching_assignment_id, time_slot_id, classroom_id, force } = req.body;
            if (!version_id || !teaching_assignment_id || !time_slot_id || !classroom_id) {
                return res.status(400).json({ error: 'ข้อมูลไม่ครบถ้วน' });
            }

            const assignment = db.prepare('SELECT * FROM teaching_assignments WHERE id = ?').get(teaching_assignment_id);
            if (!assignment) return res.status(404).json({ error: 'ไม่พบการมอบหมายการสอน' });

            // ตรวจสอบข้อขัดแย้ง
            const conflicts = conflictChecker.checkSingleEntryConflicts(
                version_id, time_slot_id, classroom_id, assignment.teacher_id, assignment.student_group_id
            );

            if (conflicts.length > 0 && !force) {
                return res.status(409).json({
                    error: 'เกิดข้อขัดแย้งในช่องเวลานี้',
                    conflicts
                });
            }

            const result = db.prepare(`
                INSERT INTO timetable_entries (version_id, teaching_assignment_id, time_slot_id, classroom_id, is_manual)
                VALUES (?, ?, ?, ?, 1)
            `).run(version_id, teaching_assignment_id, time_slot_id, classroom_id);

            // อัปเดตสถิติเวอร์ชัน
            const scheduledCount = db.prepare('SELECT COUNT(*) as cnt FROM timetable_entries WHERE version_id = ?').get(version_id).cnt;
            db.prepare("UPDATE timetable_versions SET total_scheduled = ?, updated_at = datetime('now','localtime') WHERE id = ?")
                .run(scheduledCount, version_id);

            res.json({
                success: true,
                id: result.lastInsertRowid,
                message: 'บันทึกคาบสอนเรียบร้อยแล้ว'
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // แก้ไข/ย้าย Entry (Manual Move / Edit)
    router.put('/entries/:id', requireRole('admin', 'academic'), (req, res) => {
        try {
            const { time_slot_id, classroom_id, force } = req.body;
            const entry = db.prepare(`
                SELECT te.*, ta.teacher_id, ta.student_group_id
                FROM timetable_entries te
                JOIN teaching_assignments ta ON te.teaching_assignment_id = ta.id
                WHERE te.id = ?
            `).get(req.params.id);

            if (!entry) return res.status(404).json({ error: 'ไม่พบคาบสอนที่ต้องการย้าย' });
            if (entry.is_locked) {
                return res.status(400).json({ error: 'คาบสอนนี้ถูกล็อกไว้ กรุณาปลดล็อกก่อนแก้ไข' });
            }

            const targetTimeSlot = time_slot_id || entry.time_slot_id;
            const targetClassroom = classroom_id || entry.classroom_id;

            // ตรวจสอบข้อขัดแย้ง
            const conflicts = conflictChecker.checkSingleEntryConflicts(
                entry.version_id, targetTimeSlot, targetClassroom, entry.teacher_id, entry.student_group_id, entry.id
            );

            // เงื่อนไขเด็ดขาด: หากครูไม่ว่าง ห้ามย้ายเด็ดขาด (Strict Prohibition - No Force Allowed)
            const unavailConflict = conflicts.find(c => c.type === 'teacher_unavailability');
            if (unavailConflict) {
                return res.status(403).json({
                    error: `⛔ ไม่อนุญาตให้ย้ายเด็ดขาด! ${unavailConflict.message}`,
                    is_unavailability: true,
                    conflicts
                });
            }

            if (conflicts.length > 0 && !force) {
                return res.status(409).json({
                    error: 'เกิดข้อขัดแย้งในช่องเวลาใหม่',
                    conflicts
                });
            }

            db.prepare(`
                UPDATE timetable_entries 
                SET time_slot_id = ?, classroom_id = ?, is_manual = 1, updated_at = datetime('now', 'localtime')
                WHERE id = ?
            `).run(targetTimeSlot, targetClassroom, req.params.id);

            res.json({ success: true, message: 'ย้ายคาบสอนเรียบร้อยแล้ว' });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // สลับ หรือ ล็อก/ปลดล็อก Entry
    router.post('/entries/:id/lock', requireRole('admin', 'academic'), (req, res) => {
        try {
            const entry = db.prepare('SELECT is_locked FROM timetable_entries WHERE id = ?').get(req.params.id);
            if (!entry) return res.status(404).json({ error: 'ไม่พบคาบสอน' });

            const newLock = entry.is_locked ? 0 : 1;
            db.prepare("UPDATE timetable_entries SET is_locked = ?, updated_at = datetime('now','localtime') WHERE id = ?")
                .run(newLock, req.params.id);

            res.json({ success: true, is_locked: newLock, message: newLock ? 'ล็อกคาบนี้แล้ว' : 'ปลดล็อกคาบนี้แล้ว' });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ลบ Entry เดียว
    router.delete('/entries/:id', requireRole('admin', 'academic'), (req, res) => {
        try {
            const entry = db.prepare('SELECT version_id, is_locked FROM timetable_entries WHERE id = ?').get(req.params.id);
            if (!entry) return res.status(404).json({ error: 'ไม่พบคาบสอน' });
            if (entry.is_locked) return res.status(400).json({ error: 'คาบสอนถูกล็อกอยู่ ไม่สามารถลบได้' });

            db.prepare('DELETE FROM timetable_entries WHERE id = ?').run(req.params.id);

            // อัปเดตสถิติ
            const count = db.prepare('SELECT COUNT(*) as cnt FROM timetable_entries WHERE version_id = ?').get(entry.version_id).cnt;
            db.prepare('UPDATE timetable_versions SET total_scheduled = ? WHERE id = ?').run(count, entry.version_id);

            res.json({ success: true, message: 'ลบคาบสอนเรียบร้อยแล้ว' });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ล้าง Entry ทั้งหมดในเวอร์ชัน (ยกเว้นที่ล็อกไว้)
    router.delete('/versions/:id/entries', requireRole('admin', 'academic'), (req, res) => {
        try {
            const result = db.prepare('DELETE FROM timetable_entries WHERE version_id = ? AND is_locked = 0').run(req.params.id);
            const remaining = db.prepare('SELECT COUNT(*) as cnt FROM timetable_entries WHERE version_id = ?').get(req.params.id).cnt;
            db.prepare("UPDATE timetable_versions SET total_scheduled = ?, updated_at = datetime('now','localtime') WHERE id = ?")
                .run(remaining, req.params.id);

            res.json({
                success: true,
                deletedCount: result.changes,
                message: `ลบคาบสอนที่ไม่ได้ล็อกจำนวน ${result.changes} คาบสำเร็จ`
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ==================== อัลกอริทึมจัดตารางอัตโนมัติ (Auto Scheduling) ====================

    // สั่งให้ระบบเริ่มจัดตารางสอนอัตโนมัติ
    router.post('/generate', requireRole('admin', 'academic'), async (req, res) => {
        try {
            const { semester_id, version_id, preferences } = req.body;
            if (!semester_id || !version_id) {
                return res.status(400).json({ error: 'กรุณาระบุ semester_id และ version_id' });
            }

            const version = db.prepare('SELECT * FROM timetable_versions WHERE id = ?').get(version_id);
            if (!version) return res.status(404).json({ error: 'ไม่พบเวอร์ชันตาราง' });
            if (version.status === 'published') {
                return res.status(400).json({ error: 'ไม่สามารถจัดตารางทับเวอร์ชันที่เผยแพร่แล้วได้ กรุณาสร้างฉบับร่างใหม่' });
            }

            // รันอัลกอริทึม
            const result = await scheduler.generate(semester_id, version_id, req.session.user.id, preferences || {});

            log(req.session.user.id, 'generate_timetable', 'timetable_versions', version_id, null, {
                scheduledCount: result.stats?.scheduledCount,
                qualityScore: result.stats?.qualityScore
            });

            res.json(result);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ตรวจสอบประวัติ / ผลลัพธ์ของ Scheduling Run
    router.get('/runs/:id', requireAuth, (req, res) => {
        try {
            const run = db.prepare(`
                SELECT sr.*, u.full_name as creator_name
                FROM scheduling_runs sr
                LEFT JOIN users u ON sr.created_by = u.id
                WHERE sr.id = ?
            `).get(req.params.id);

            if (!run) return res.status(404).json({ error: 'ไม่พบบันทึกการจัดตาราง' });
            if (run.log) {
                try { run.log = JSON.parse(run.log); } catch(e) {}
            }
            if (run.settings) {
                try { run.settings = JSON.parse(run.settings); } catch(e) {}
            }

            res.json(run);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ตรวจสอบความขัดแย้งทั้งหมดของเวอร์ชัน
    router.get('/conflicts/:versionId', requireAuth, (req, res) => {
        try {
            const report = conflictChecker.checkAllConflicts(req.params.versionId);
            res.json(report);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    return router;
};
