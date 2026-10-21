// =====================================================
// assignments.js - Routes จัดการการมอบหมายการสอน,
// แผนกวิชา, หลักสูตร, กลุ่มเรียน, คาบเรียน, ภาคเรียน
// =====================================================
const express = require('express');
const router = express.Router();
const { requireAuth, requireRole, auditLog } = require('../middleware/authMiddleware');

module.exports = function(db) {
    const log = auditLog(db);

    // =============== แผนกวิชา (Departments) ===============
    router.get('/departments', requireAuth, (req, res) => {
        try {
            res.json(db.prepare('SELECT * FROM departments WHERE is_active = 1 ORDER BY name').all());
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    router.post('/departments', requireRole('admin'), (req, res) => {
        try {
            const { code, name, description } = req.body;
            if (!code || !name) return res.status(400).json({ error: 'กรุณากรอกรหัสและชื่อแผนก' });
            const result = db.prepare('INSERT INTO departments (code, name, description) VALUES (?, ?, ?)').run(code, name, description || '');
            log(req.session.user.id, 'create', 'departments', result.lastInsertRowid, null, req.body);
            res.json({ success: true, id: result.lastInsertRowid });
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    router.put('/departments/:id', requireRole('admin'), (req, res) => {
        try {
            const { code, name, description, is_active } = req.body;
            db.prepare("UPDATE departments SET code=?, name=?, description=?, is_active=?, updated_at=datetime('now','localtime') WHERE id=?")
                .run(code, name, description || '', is_active !== undefined ? (is_active ? 1 : 0) : 1, req.params.id);
            res.json({ success: true });
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    router.delete('/departments/:id', requireRole('admin'), (req, res) => {
        try {
            const refs = db.prepare('SELECT COUNT(*) as cnt FROM teachers WHERE department_id = ?').get(req.params.id);
            if (refs.cnt > 0) return res.status(400).json({ error: 'แผนกนี้ยังมีครูสังกัดอยู่' });
            db.prepare('DELETE FROM departments WHERE id = ?').run(req.params.id);
            res.json({ success: true });
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // =============== หลักสูตร (Programs) ===============
    router.get('/programs', requireAuth, (req, res) => {
        try {
            res.json(db.prepare(`
                SELECT p.*, d.name as department_name 
                FROM programs p 
                LEFT JOIN departments d ON p.department_id = d.id 
                WHERE p.is_active = 1 ORDER BY p.level, p.name
            `).all());
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    router.post('/programs', requireRole('admin', 'academic'), (req, res) => {
        try {
            const { code, name, level, department_id, duration_years } = req.body;
            if (!code || !name || !level) return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบ' });
            const result = db.prepare('INSERT INTO programs (code, name, level, department_id, duration_years) VALUES (?, ?, ?, ?, ?)')
                .run(code, name, level, department_id, duration_years || 3);
            res.json({ success: true, id: result.lastInsertRowid });
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    router.put('/programs/:id', requireRole('admin', 'academic'), (req, res) => {
        try {
            const { code, name, level, department_id, duration_years, is_active } = req.body;
            db.prepare("UPDATE programs SET code=?, name=?, level=?, department_id=?, duration_years=?, is_active=?, updated_at=datetime('now','localtime') WHERE id=?")
                .run(code, name, level, department_id, duration_years || 3, is_active !== undefined ? (is_active ? 1 : 0) : 1, req.params.id);
            res.json({ success: true });
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    router.delete('/programs/:id', requireRole('admin'), (req, res) => {
        try {
            db.prepare('DELETE FROM programs WHERE id = ?').run(req.params.id);
            res.json({ success: true });
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // =============== ปีการศึกษา (Academic Years) ===============
    router.get('/academic-years', requireAuth, (req, res) => {
        try {
            res.json(db.prepare('SELECT * FROM academic_years ORDER BY year DESC').all());
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    router.post('/academic-years', requireRole('admin'), (req, res) => {
        try {
            const { year, is_current } = req.body;
            if (!year) return res.status(400).json({ error: 'กรุณาระบุปีการศึกษา' });
            if (is_current) db.prepare('UPDATE academic_years SET is_current = 0').run();
            const result = db.prepare('INSERT INTO academic_years (year, is_current) VALUES (?, ?)').run(year, is_current ? 1 : 0);
            res.json({ success: true, id: result.lastInsertRowid });
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    router.put('/academic-years/:id', requireRole('admin'), (req, res) => {
        try {
            const { year, is_current } = req.body;
            if (is_current) db.prepare('UPDATE academic_years SET is_current = 0').run();
            db.prepare("UPDATE academic_years SET year=?, is_current=?, updated_at=datetime('now','localtime') WHERE id=?")
                .run(year, is_current ? 1 : 0, req.params.id);
            res.json({ success: true });
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    router.delete('/academic-years/:id', requireRole('admin'), (req, res) => {
        try {
            db.prepare('DELETE FROM academic_years WHERE id = ?').run(req.params.id);
            res.json({ success: true });
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // =============== ภาคเรียน (Semesters) ===============
    router.get('/semesters', requireAuth, (req, res) => {
        try {
            const { academic_year_id } = req.query;
            let query = `SELECT s.*, ay.year FROM semesters s JOIN academic_years ay ON s.academic_year_id = ay.id`;
            const params = [];
            if (academic_year_id) { query += ' WHERE s.academic_year_id = ?'; params.push(academic_year_id); }
            query += ' ORDER BY ay.year DESC, s.semester_number';
            res.json(db.prepare(query).all(...params));
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    router.get('/semesters/current', requireAuth, (req, res) => {
        try {
            const semester = db.prepare(`
                SELECT s.*, ay.year FROM semesters s 
                JOIN academic_years ay ON s.academic_year_id = ay.id 
                WHERE s.is_current = 1 LIMIT 1
            `).get();
            if (!semester) return res.status(404).json({ error: 'ไม่พบภาคเรียนปัจจุบัน' });
            res.json(semester);
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    router.post('/semesters', requireRole('admin'), (req, res) => {
        try {
            const { academic_year_id, semester_number, name, start_date, end_date, is_current } = req.body;
            if (!academic_year_id || !semester_number || !name) return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบ' });
            if (is_current) db.prepare('UPDATE semesters SET is_current = 0').run();
            const result = db.prepare('INSERT INTO semesters (academic_year_id, semester_number, name, start_date, end_date, is_current) VALUES (?, ?, ?, ?, ?, ?)')
                .run(academic_year_id, semester_number, name, start_date || null, end_date || null, is_current ? 1 : 0);
            res.json({ success: true, id: result.lastInsertRowid });
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    router.put('/semesters/:id', requireRole('admin'), (req, res) => {
        try {
            const { academic_year_id, semester_number, name, start_date, end_date, is_current } = req.body;
            if (is_current) db.prepare('UPDATE semesters SET is_current = 0').run();
            db.prepare("UPDATE semesters SET academic_year_id=?, semester_number=?, name=?, start_date=?, end_date=?, is_current=?, updated_at=datetime('now','localtime') WHERE id=?")
                .run(academic_year_id, semester_number, name, start_date || null, end_date || null, is_current ? 1 : 0, req.params.id);
            res.json({ success: true });
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // =============== กลุ่มเรียน (Student Groups) ===============
    router.get('/student-groups', requireAuth, (req, res) => {
        try {
            const { semester_id, program_id } = req.query;
            let query = `
                SELECT sg.*, p.name as program_name, p.level, d.name as department_name
                FROM student_groups sg
                JOIN programs p ON sg.program_id = p.id
                LEFT JOIN departments d ON p.department_id = d.id
                WHERE sg.is_active = 1
            `;
            const params = [];
            if (semester_id) { query += ' AND sg.semester_id = ?'; params.push(semester_id); }
            if (program_id) { query += ' AND sg.program_id = ?'; params.push(program_id); }
            query += ' ORDER BY p.level, p.name, sg.year_level, sg.group_number';
            res.json(db.prepare(query).all(...params));
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    router.post('/student-groups', requireRole('admin', 'academic'), (req, res) => {
        try {
            const { code, name, program_id, year_level, group_number, student_count, semester_id } = req.body;
            if (!code || !name || !program_id || !semester_id) return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบ' });
            const result = db.prepare('INSERT INTO student_groups (code, name, program_id, year_level, group_number, student_count, semester_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
                .run(code, name, program_id, year_level || 1, group_number || 1, student_count || 0, semester_id);
            res.json({ success: true, id: result.lastInsertRowid });
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    router.put('/student-groups/:id', requireRole('admin', 'academic'), (req, res) => {
        try {
            const { code, name, program_id, year_level, group_number, student_count, semester_id, is_active } = req.body;
            db.prepare("UPDATE student_groups SET code=?, name=?, program_id=?, year_level=?, group_number=?, student_count=?, semester_id=?, is_active=?, updated_at=datetime('now','localtime') WHERE id=?")
                .run(code, name, program_id, year_level || 1, group_number || 1, student_count || 0, semester_id, is_active !== undefined ? (is_active ? 1 : 0) : 1, req.params.id);
            res.json({ success: true });
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    router.delete('/student-groups/:id', requireRole('admin'), (req, res) => {
        try {
            db.prepare('DELETE FROM student_groups WHERE id = ?').run(req.params.id);
            res.json({ success: true });
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // =============== คาบเรียน (Time Slots) ===============
    router.get('/time-slots', requireAuth, (req, res) => {
        try {
            const { semester_id } = req.query;
            let query = 'SELECT * FROM time_slots WHERE 1=1';
            const params = [];
            if (semester_id) { query += ' AND (semester_id = ? OR semester_id IS NULL)'; params.push(semester_id); }
            query += ' ORDER BY day_of_week, period_number';
            res.json(db.prepare(query).all(...params));
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    router.post('/time-slots/generate', requireRole('admin'), (req, res) => {
        try {
            const { semester_id, days, periods_per_day, start_time, period_duration, break_after, break_duration } = req.body;
            if (!semester_id) return res.status(400).json({ error: 'กรุณาเลือกภาคเรียน' });

            const dayNames = ['', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์'];
            const workDays = (days || '1,2,3,4,5').split(',').map(Number);
            const numPeriods = periods_per_day || 8;
            const startHour = parseInt((start_time || '08:00').split(':')[0]);
            const startMin = parseInt((start_time || '08:00').split(':')[1]);
            const duration = period_duration || 60;
            const breakAfterPeriod = break_after || 4;
            const breakDuration = break_duration || 60;

            // ลบคาบเก่า
            db.prepare('DELETE FROM time_slots WHERE semester_id = ?').run(semester_id);

            const insert = db.prepare(`
                INSERT INTO time_slots (day_of_week, day_name, period_number, start_time, end_time, slot_type, semester_id)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);

            const insertAll = db.transaction(() => {
                for (const day of workDays) {
                    let currentMinutes = startHour * 60 + startMin;
                    for (let p = 1; p <= numPeriods; p++) {
                        const sH = Math.floor(currentMinutes / 60);
                        const sM = currentMinutes % 60;
                        const eMinutes = currentMinutes + duration;
                        const eH = Math.floor(eMinutes / 60);
                        const eM = eMinutes % 60;

                        const startStr = `${String(sH).padStart(2,'0')}:${String(sM).padStart(2,'0')}`;
                        const endStr = `${String(eH).padStart(2,'0')}:${String(eM).padStart(2,'0')}`;

                        insert.run(day, dayNames[day], p, startStr, endStr, 'เรียน', semester_id);

                        currentMinutes = eMinutes;
                        if (p === breakAfterPeriod) {
                            // เพิ่มคาบพัก
                            const bsH = Math.floor(currentMinutes / 60);
                            const bsM = currentMinutes % 60;
                            const beMinutes = currentMinutes + breakDuration;
                            const beH = Math.floor(beMinutes / 60);
                            const beM = beMinutes % 60;
                            const bStartStr = `${String(bsH).padStart(2,'0')}:${String(bsM).padStart(2,'0')}`;
                            const bEndStr = `${String(beH).padStart(2,'0')}:${String(beM).padStart(2,'0')}`;
                            insert.run(day, dayNames[day], 0, bStartStr, bEndStr, 'พัก', semester_id);
                            currentMinutes = beMinutes;
                        }
                    }
                }
            });

            insertAll();
            const count = db.prepare("SELECT COUNT(*) as cnt FROM time_slots WHERE semester_id = ? AND slot_type = 'เรียน'").get(semester_id);
            res.json({ success: true, message: `สร้างคาบเรียน ${count.cnt} คาบสำเร็จ` });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.put('/time-slots/:id', requireRole('admin'), (req, res) => {
        try {
            const { is_active, slot_type, start_time, end_time } = req.body;
            db.prepare('UPDATE time_slots SET is_active=?, slot_type=?, start_time=?, end_time=? WHERE id=?')
                .run(is_active !== undefined ? (is_active ? 1 : 0) : 1, slot_type || 'เรียน', start_time, end_time, req.params.id);
            res.json({ success: true });
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // =============== ช่วงเวลาไม่ว่าง (Teacher Availability) ===============
    router.get('/availability', requireAuth, (req, res) => {
        try {
            const { teacher_id, semester_id } = req.query;
            let query = `
                SELECT ta.*, t.first_name, t.last_name, ts.day_name, ts.period_number, ts.start_time, ts.end_time
                FROM teacher_availability ta
                JOIN teachers t ON ta.teacher_id = t.id
                JOIN time_slots ts ON ta.time_slot_id = ts.id
                WHERE ta.is_available = 0
            `;
            const params = [];
            if (teacher_id) { query += ' AND ta.teacher_id = ?'; params.push(teacher_id); }
            if (semester_id) { query += ' AND ta.semester_id = ?'; params.push(semester_id); }
            query += ' ORDER BY t.first_name, ts.day_of_week, ts.period_number';
            res.json(db.prepare(query).all(...params));
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    router.post('/availability', requireAuth, (req, res) => {
        try {
            const { teacher_id, time_slot_id, semester_id, reason } = req.body;
            // ครูสามารถบันทึกของตัวเอง หรือ admin/academic บันทึกได้
            if (req.session.user.role === 'teacher' && req.session.user.teacher_id !== parseInt(teacher_id)) {
                return res.status(403).json({ error: 'ไม่มีสิทธิ์' });
            }
            db.prepare(`
                INSERT OR REPLACE INTO teacher_availability (teacher_id, time_slot_id, semester_id, is_available, reason)
                VALUES (?, ?, ?, 0, ?)
            `).run(teacher_id, time_slot_id, semester_id, reason || '');
            res.json({ success: true });
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    router.post('/availability/bulk', requireAuth, (req, res) => {
        try {
            const { teacher_id, semester_id, slots, reason } = req.body;
            if (req.session.user.role === 'teacher' && req.session.user.teacher_id !== parseInt(teacher_id)) {
                return res.status(403).json({ error: 'ไม่มีสิทธิ์' });
            }
            // ลบรายการเก่าก่อน
            db.prepare('DELETE FROM teacher_availability WHERE teacher_id = ? AND semester_id = ?')
                .run(teacher_id, semester_id);

            const insert = db.prepare('INSERT INTO teacher_availability (teacher_id, time_slot_id, semester_id, is_available, reason) VALUES (?, ?, ?, 0, ?)');
            const insertAll = db.transaction(() => {
                for (const slotId of (slots || [])) {
                    insert.run(teacher_id, slotId, semester_id, reason || '');
                }
            });
            insertAll();
            res.json({ success: true, count: (slots || []).length });
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    router.delete('/availability/:id', requireAuth, (req, res) => {
        try {
            db.prepare('DELETE FROM teacher_availability WHERE id = ?').run(req.params.id);
            res.json({ success: true });
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // =============== การมอบหมายการสอน (Teaching Assignments) ===============
    router.get('/teaching-assignments', requireAuth, (req, res) => {
        try {
            const { semester_id, teacher_id, department_id } = req.query;
            let query = `
                SELECT ta.*, 
                       t.employee_id, t.prefix as teacher_prefix, t.first_name as teacher_first_name, t.last_name as teacher_last_name,
                       s.code as subject_code, s.name as subject_name, s.subject_type, s.requires_lab,
                       sg.name as group_name, sg.student_count,
                       c.name as preferred_room_name,
                       d.name as department_name
                FROM teaching_assignments ta
                JOIN teachers t ON ta.teacher_id = t.id
                JOIN subjects s ON ta.subject_id = s.id
                JOIN student_groups sg ON ta.student_group_id = sg.id
                LEFT JOIN classrooms c ON ta.preferred_room_id = c.id
                LEFT JOIN departments d ON t.department_id = d.id
                WHERE ta.is_active = 1
            `;
            const params = [];
            if (semester_id) { query += ' AND ta.semester_id = ?'; params.push(semester_id); }
            if (teacher_id) { query += ' AND ta.teacher_id = ?'; params.push(teacher_id); }
            if (department_id) { query += ' AND t.department_id = ?'; params.push(department_id); }
            query += ' ORDER BY t.first_name, s.code';
            res.json(db.prepare(query).all(...params));
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    router.post('/teaching-assignments', requireRole('admin', 'academic'), (req, res) => {
        try {
            const { teacher_id, subject_id, student_group_id, semester_id, hours_per_week, preferred_room_id, notes } = req.body;
            if (!teacher_id || !subject_id || !student_group_id || !semester_id) {
                return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบ' });
            }

            // ตรวจสอบซ้ำ
            const existing = db.prepare(
                'SELECT id FROM teaching_assignments WHERE teacher_id=? AND subject_id=? AND student_group_id=? AND semester_id=?'
            ).get(teacher_id, subject_id, student_group_id, semester_id);
            if (existing) return res.status(400).json({ error: 'การมอบหมายนี้มีอยู่แล้ว' });

            const result = db.prepare(`
                INSERT INTO teaching_assignments (teacher_id, subject_id, student_group_id, semester_id, hours_per_week, preferred_room_id, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(teacher_id, subject_id, student_group_id, semester_id, hours_per_week || 1, preferred_room_id || null, notes || '');

            log(req.session.user.id, 'create', 'teaching_assignments', result.lastInsertRowid, null, req.body);
            res.json({ success: true, id: result.lastInsertRowid });
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    router.put('/teaching-assignments/:id', requireRole('admin', 'academic'), (req, res) => {
        try {
            const { teacher_id, subject_id, student_group_id, semester_id, hours_per_week, preferred_room_id, notes, is_active } = req.body;
            db.prepare(`
                UPDATE teaching_assignments SET teacher_id=?, subject_id=?, student_group_id=?, semester_id=?, hours_per_week=?, preferred_room_id=?, notes=?, is_active=?, updated_at=datetime('now','localtime')
                WHERE id = ?
            `).run(teacher_id, subject_id, student_group_id, semester_id, hours_per_week || 1, preferred_room_id || null, notes || '', is_active !== undefined ? (is_active ? 1 : 0) : 1, req.params.id);
            res.json({ success: true });
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    router.delete('/teaching-assignments/:id', requireRole('admin', 'academic'), (req, res) => {
        try {
            db.prepare('DELETE FROM teaching_assignments WHERE id = ?').run(req.params.id);
            res.json({ success: true });
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // =============== การตั้งค่าระบบ (System Settings) ===============
    router.get('/settings', requireAuth, (req, res) => {
        try {
            res.json(db.prepare('SELECT * FROM system_settings ORDER BY id').all());
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    router.put('/settings', requireRole('admin'), (req, res) => {
        try {
            const { settings } = req.body;
            const update = db.prepare("UPDATE system_settings SET setting_value = ?, updated_at = datetime('now','localtime') WHERE setting_key = ?");
            const updateAll = db.transaction(() => {
                for (const [key, value] of Object.entries(settings || {})) {
                    update.run(String(value), key);
                }
            });
            updateAll();
            res.json({ success: true });
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // =============== Dashboard Statistics ===============
    router.get('/dashboard', requireAuth, (req, res) => {
        try {
            const currentSemester = db.prepare(`
                SELECT s.*, ay.year FROM semesters s 
                JOIN academic_years ay ON s.academic_year_id = ay.id 
                WHERE s.is_current = 1 LIMIT 1
            `).get();

            const stats = {
                semester: currentSemester,
                teachers: db.prepare('SELECT COUNT(*) as count FROM teachers WHERE is_active = 1').get().count,
                subjects: db.prepare('SELECT COUNT(*) as count FROM subjects WHERE is_active = 1').get().count,
                classrooms: db.prepare('SELECT COUNT(*) as count FROM classrooms WHERE is_active = 1').get().count,
                studentGroups: currentSemester ? db.prepare('SELECT COUNT(*) as count FROM student_groups WHERE is_active = 1 AND semester_id = ?').get(currentSemester.id).count : 0,
                assignments: currentSemester ? db.prepare('SELECT COUNT(*) as count FROM teaching_assignments WHERE is_active = 1 AND semester_id = ?').get(currentSemester.id).count : 0,
                versions: currentSemester ? db.prepare('SELECT * FROM timetable_versions WHERE semester_id = ? ORDER BY version_number DESC').all(currentSemester.id) : [],
                publishedVersion: currentSemester ? db.prepare("SELECT * FROM timetable_versions WHERE semester_id = ? AND status = 'published' LIMIT 1").get(currentSemester.id) : null,
                recentLogs: db.prepare(`
                    SELECT al.*, u.full_name as user_name 
                    FROM audit_logs al 
                    LEFT JOIN users u ON al.user_id = u.id 
                    ORDER BY al.created_at DESC LIMIT 10
                `).all()
            };

            // department breakdown
            stats.departmentStats = db.prepare(`
                SELECT d.name, 
                    COUNT(DISTINCT t.id) as teacher_count,
                    COUNT(DISTINCT s.id) as subject_count
                FROM departments d
                LEFT JOIN teachers t ON t.department_id = d.id AND t.is_active = 1
                LEFT JOIN subjects s ON s.department_id = d.id AND s.is_active = 1
                WHERE d.is_active = 1
                GROUP BY d.id
            `).all();

            res.json(stats);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    return router;
};
