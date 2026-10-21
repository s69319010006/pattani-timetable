// =====================================================
// reports.js - Routes สำหรับรายงาน การส่งออก และการนำเข้าข้อมูล
// =====================================================
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { requireAuth, requireRole, auditLog } = require('../middleware/authMiddleware');
const ExportService = require('../services/exportService');
const ConflictChecker = require('../services/conflictChecker');

// กำหนดโฟลเดอร์สำหรับอัปโหลดไฟล์ Excel
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext === '.xlsx' || ext === '.xls') {
            return cb(null, true);
        }
        cb(new Error('รองรับเฉพาะไฟล์ Excel (.xlsx, .xls) เท่านั้น'));
    }
});

module.exports = function(db) {
    const exportService = new ExportService(db);
    const conflictChecker = new ConflictChecker(db);
    const log = auditLog(db);

    // ==================== 1. รายงานภาระสอนครู (Teacher Workload) ====================
    router.get('/teacher-workload', requireAuth, (req, res) => {
        try {
            const { semester_id, department_id } = req.query;
            let query = `
                SELECT t.id, t.employee_id, t.prefix, t.first_name, t.last_name,
                       t.position, t.max_hours_per_week, t.max_hours_per_day,
                       d.name as department_name,
                       COUNT(DISTINCT ta.id) as total_assignments,
                       COALESCE(SUM(ta.hours_per_week), 0) as total_assigned_hours,
                       (
                           SELECT COUNT(te.id) 
                           FROM timetable_entries te 
                           JOIN teaching_assignments ta2 ON te.teaching_assignment_id = ta2.id
                           JOIN timetable_versions tv ON te.version_id = tv.id
                           WHERE ta2.teacher_id = t.id 
                             AND tv.semester_id = ?
                             AND (tv.status = 'published' OR tv.id = (
                                 SELECT id FROM timetable_versions WHERE semester_id = ? ORDER BY version_number DESC LIMIT 1
                             ))
                       ) as total_scheduled_hours
                FROM teachers t
                LEFT JOIN departments d ON t.department_id = d.id
                LEFT JOIN teaching_assignments ta ON ta.teacher_id = t.id AND ta.semester_id = ? AND ta.is_active = 1
                WHERE t.is_active = 1
            `;
            const params = [semester_id, semester_id, semester_id];

            if (department_id) {
                query += ' AND t.department_id = ?';
                params.push(department_id);
            }

            query += ' GROUP BY t.id ORDER BY d.name, t.first_name';
            const workload = db.prepare(query).all(...params);

            // คำนวณสรุป
            const summary = {
                totalTeachers: workload.length,
                overloadedTeachers: workload.filter(w => w.total_assigned_hours > w.max_hours_per_week).length,
                underloadedTeachers: workload.filter(w => w.total_assigned_hours < (w.max_hours_per_week * 0.5)).length,
                totalHours: workload.reduce((sum, w) => sum + w.total_assigned_hours, 0)
            };

            res.json({ summary, teachers: workload });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ==================== 2. รายงานการใช้ห้องเรียน (Classroom Utilization) ====================
    router.get('/classroom-utilization', requireAuth, (req, res) => {
        try {
            const { version_id, semester_id } = req.query;
            
            // หา versionId
            let vId = version_id;
            if (!vId && semester_id) {
                const ver = db.prepare(`
                    SELECT id FROM timetable_versions 
                    WHERE semester_id = ? AND status = 'published' 
                    LIMIT 1
                `).get(semester_id) || db.prepare(`
                    SELECT id FROM timetable_versions 
                    WHERE semester_id = ? 
                    ORDER BY version_number DESC LIMIT 1
                `).get(semester_id);
                if (ver) vId = ver.id;
            }

            if (!vId) {
                return res.status(400).json({ error: 'กรุณาระบุ version_id หรือ semester_id ที่มีตารางสอน' });
            }

            // คำนวณจำนวนคาบทั้งหมดในสัปดาห์
            const totalSlots = db.prepare(`
                SELECT COUNT(*) as count FROM time_slots 
                WHERE (semester_id = (SELECT semester_id FROM timetable_versions WHERE id = ?) OR semester_id IS NULL)
                  AND is_active = 1 AND slot_type = 'เรียน'
            `).get(vId).count || 40;

            const rooms = db.prepare(`
                SELECT c.id, c.code, c.name, c.building, c.floor, c.capacity, c.room_type,
                       d.name as department_name,
                       COUNT(te.id) as used_slots,
                       ROUND((COUNT(te.id) * 100.0) / ?, 1) as utilization_rate
                FROM classrooms c
                LEFT JOIN departments d ON c.department_id = d.id
                LEFT JOIN timetable_entries te ON te.classroom_id = c.id AND te.version_id = ?
                WHERE c.is_active = 1
                GROUP BY c.id
                ORDER BY utilization_rate DESC, c.code
            `).all(totalSlots, vId);

            res.json({
                versionId: vId,
                totalSlotsPerWeek: totalSlots,
                classrooms: rooms
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ==================== 3. รายงานวิชาที่ยังจัดไม่ได้ (Unscheduled Subjects) ====================
    router.get('/unscheduled-subjects', requireAuth, (req, res) => {
        try {
            const { version_id } = req.query;
            if (!version_id) return res.status(400).json({ error: 'กรุณาระบุ version_id' });

            const version = db.prepare('SELECT semester_id FROM timetable_versions WHERE id = ?').get(version_id);
            if (!version) return res.status(404).json({ error: 'ไม่พบเวอร์ชันตาราง' });

            // ดึง assignments ทั้งหมดในเทอม
            const assignments = db.prepare(`
                SELECT ta.id, ta.hours_per_week, ta.notes,
                       s.code as subject_code, s.name as subject_name, s.subject_type, s.requires_lab,
                       t.prefix as teacher_prefix, t.first_name as teacher_first_name, t.last_name as teacher_last_name,
                       sg.name as group_name, sg.student_count,
                       COALESCE(entry_stat.scheduled_count, 0) as scheduled_count
                FROM teaching_assignments ta
                JOIN subjects s ON ta.subject_id = s.id
                JOIN teachers t ON ta.teacher_id = t.id
                JOIN student_groups sg ON ta.student_group_id = sg.id
                LEFT JOIN (
                    SELECT teaching_assignment_id, COUNT(*) as scheduled_count
                    FROM timetable_entries
                    WHERE version_id = ?
                    GROUP BY teaching_assignment_id
                ) entry_stat ON entry_stat.teaching_assignment_id = ta.id
                WHERE ta.semester_id = ? AND ta.is_active = 1
                ORDER BY s.code, sg.name
            `).all(version_id, version.semester_id);

            const unscheduled = [];
            for (const a of assignments) {
                if (a.scheduled_count < a.hours_per_week) {
                    unscheduled.push({
                        ...a,
                        missingHours: a.hours_per_week - a.scheduled_count,
                        possibleReason: a.requires_lab ? 'ต้องการห้องปฏิบัติการพิเศษ' : 'คาบเวลาว่างของครูหรือกลุ่มเรียนอาจจำกัด'
                    });
                }
            }

            res.json({
                totalAssignments: assignments.length,
                fullyScheduled: assignments.length - unscheduled.length,
                unscheduledCount: unscheduled.length,
                items: unscheduled
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ==================== 4. รายงานข้อขัดแย้ง (Conflicts Report) ====================
    router.get('/conflicts', requireAuth, (req, res) => {
        try {
            const { version_id } = req.query;
            if (!version_id) return res.status(400).json({ error: 'กรุณาระบุ version_id' });

            const conflicts = conflictChecker.checkAllConflicts(version_id);
            res.json(conflicts);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ==================== 5. ส่งออก Excel ตารางสอน ====================
    router.get('/export/timetable/excel', requireAuth, async (req, res) => {
        try {
            const { version_id, filter_type, filter_id } = req.query;
            if (!version_id) return res.status(400).json({ error: 'กรุณาระบุ version_id' });

            const workbook = await exportService.exportTimetableExcel(version_id, filter_type, filter_id);
            
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename=timetable-${version_id}.xlsx`);

            await workbook.xlsx.write(res);
            res.end();
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ==================== 6. ส่งออก PDF ตารางสอน ====================
    router.get('/export/timetable/pdf', requireAuth, async (req, res) => {
        try {
            const { version_id, filter_type, filter_id } = req.query;
            if (!version_id) return res.status(400).json({ error: 'กรุณาระบุ version_id' });

            const docDefinition = await exportService.exportTimetablePdf(version_id, filter_type, filter_id);
            const pdfDoc = exportService.createPdfStream(docDefinition);

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `inline; filename=timetable-${version_id}.pdf`);

            pdfDoc.pipe(res);
            pdfDoc.end();
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ==================== 7. ส่งออก Excel รายงานภาระสอน ====================
    router.get('/export/teacher-workload/excel', requireAuth, async (req, res) => {
        try {
            const { semester_id } = req.query;
            if (!semester_id) return res.status(400).json({ error: 'กรุณาระบุ semester_id' });

            const workbook = await exportService.exportTeacherWorkload(semester_id);
            
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename=teacher-workload-${semester_id}.xlsx`);

            await workbook.xlsx.write(res);
            res.end();
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ==================== 8. นำเข้าข้อมูลจาก Excel (Import Excel) ====================
    router.post('/import/:entityType', requireRole('admin', 'academic'), upload.single('file'), async (req, res) => {
        try {
            const { entityType } = req.params;
            if (!['teachers', 'subjects', 'classrooms', 'students'].includes(entityType)) {
                return res.status(400).json({ error: 'ประเภทข้อมูลที่นำเข้าไม่ถูกต้อง' });
            }

            if (!req.file) {
                return res.status(400).json({ error: 'กรุณาแนบไฟล์ Excel' });
            }

            const results = await exportService.importFromExcel(req.file.path, entityType);

            // ลบไฟล์ชั่วคราว
            try { fs.unlinkSync(req.file.path); } catch (e) {}

            log(req.session.user.id, 'import_excel', entityType, null, null, {
                total: results.total,
                success: results.success,
                errorCount: results.errors.length
            });

            res.json({
                success: true,
                message: `นำเข้าข้อมูลสำเร็จ ${results.success}/${results.total} รายการ`,
                results
            });
        } catch (err) {
            if (req.file && fs.existsSync(req.file.path)) {
                try { fs.unlinkSync(req.file.path); } catch (e) {}
            }
            res.status(400).json({ error: err.message });
        }
    });

    return router;
};
