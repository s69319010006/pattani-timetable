// =====================================================
// routes/groups.js - Routes จัดการกลุ่มเรียนและระดับชั้น
// วิทยาลัยการอาชีพปัตตานี
// =====================================================
const express = require('express');
const router = express.Router();
const { requireAuth, requireRole, auditLog } = require('../middleware/authMiddleware');

module.exports = function(db) {
    const log = auditLog(db);

    // 1. ดึงข้อมูลกลุ่มเรียนทั้งหมด (พร้อมตัวกรอง)
    router.get('/', requireAuth, (req, res) => {
        try {
            const { semester_id, program_id, year_level, level, search } = req.query;
            let query = `
                SELECT sg.*, p.name as program_name, p.code as program_code, p.level,
                       d.name as department_name, s.name as semester_name, ay.year as academic_year
                FROM student_groups sg
                JOIN programs p ON sg.program_id = p.id
                LEFT JOIN departments d ON p.department_id = d.id
                LEFT JOIN semesters s ON sg.semester_id = s.id
                LEFT JOIN academic_years ay ON s.academic_year_id = ay.id
                WHERE sg.is_active = 1
            `;
            const params = [];

            if (semester_id) {
                query += ' AND sg.semester_id = ?';
                params.push(semester_id);
            }
            if (program_id) {
                query += ' AND sg.program_id = ?';
                params.push(program_id);
            }
            if (year_level) {
                query += ' AND sg.year_level = ?';
                params.push(year_level);
            }
            if (level) {
                query += ' AND p.level = ?';
                params.push(level);
            }
            if (search) {
                query += ' AND (sg.code LIKE ? OR sg.name LIKE ? OR p.name LIKE ?)';
                params.push(`%${search}%`, `%${search}%`, `%${search}%`);
            }

            query += ' ORDER BY p.level, p.name, sg.year_level, sg.group_number';
            const groups = db.prepare(query).all(...params);
            res.json(groups);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // 2. สรุปสถิติกลุ่มเรียนและระดับชั้น
    router.get('/stats', requireAuth, (req, res) => {
        try {
            const { semester_id } = req.query;
            let semCondition = '';
            const params = [];
            if (semester_id) {
                semCondition = ' AND sg.semester_id = ?';
                params.push(semester_id);
            }

            const total = db.prepare(`
                SELECT 
                    COUNT(sg.id) as total_groups,
                    COALESCE(SUM(sg.student_count), 0) as total_students,
                    COUNT(CASE WHEN p.level = 'ปวช.' THEN 1 END) as vc_groups,
                    COALESCE(SUM(CASE WHEN p.level = 'ปวช.' THEN sg.student_count ELSE 0 END), 0) as vc_students,
                    COUNT(CASE WHEN p.level = 'ปวส.' THEN 1 END) as dip_groups,
                    COALESCE(SUM(CASE WHEN p.level = 'ปวส.' THEN sg.student_count ELSE 0 END), 0) as dip_students
                FROM student_groups sg
                JOIN programs p ON sg.program_id = p.id
                WHERE sg.is_active = 1 ${semCondition}
            `).get(...params);

            const programCount = db.prepare('SELECT COUNT(*) as cnt FROM programs WHERE is_active = 1').get().cnt;

            res.json({
                totalGroups: total.total_groups || 0,
                totalStudents: total.total_students || 0,
                vcGroups: total.vc_groups || 0,
                vcStudents: total.vc_students || 0,
                dipGroups: total.dip_groups || 0,
                dipStudents: total.dip_students || 0,
                totalPrograms: programCount || 0
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // 3. ดึงข้อมูลสาขาวิชาและระดับชั้น (Programs & Levels)
    router.get('/programs', requireAuth, (req, res) => {
        try {
            const programs = db.prepare(`
                SELECT p.*, d.name as department_name,
                    (SELECT COUNT(*) FROM student_groups sg WHERE sg.program_id = p.id AND sg.is_active = 1) as group_count
                FROM programs p 
                LEFT JOIN departments d ON p.department_id = d.id 
                WHERE p.is_active = 1 
                ORDER BY p.level, p.name
            `).all();
            res.json(programs);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // 4. เพิ่มสาขาวิชา
    router.post('/programs', requireRole('admin', 'academic'), (req, res) => {
        try {
            const { code, name, level, department_id, duration_years } = req.body;
            if (!code || !name || !level) return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบ' });
            
            const existing = db.prepare('SELECT id FROM programs WHERE code = ?').get(code);
            if (existing) return res.status(400).json({ error: 'รหัสสาขาวิชานี้มีอยู่แล้ว' });

            const result = db.prepare('INSERT INTO programs (code, name, level, department_id, duration_years) VALUES (?, ?, ?, ?, ?)')
                .run(code, name, level, department_id || null, duration_years || (level === 'ปวช.' ? 3 : 2));
            log(req.session.user.id, 'create', 'programs', result.lastInsertRowid, null, req.body);
            res.json({ success: true, id: result.lastInsertRowid });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // 5. แก้ไขสาขาวิชา
    router.put('/programs/:id', requireRole('admin', 'academic'), (req, res) => {
        try {
            const { code, name, level, department_id, duration_years, is_active } = req.body;
            const old = db.prepare('SELECT * FROM programs WHERE id = ?').get(req.params.id);
            if (!old) return res.status(404).json({ error: 'ไม่พบข้อมูลสาขาวิชา' });

            db.prepare("UPDATE programs SET code=?, name=?, level=?, department_id=?, duration_years=?, is_active=?, updated_at=datetime('now','localtime') WHERE id=?")
                .run(code, name, level, department_id || null, duration_years || 3, is_active !== undefined ? (is_active ? 1 : 0) : 1, req.params.id);
            log(req.session.user.id, 'update', 'programs', req.params.id, old, req.body);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // 6. ลบสาขาวิชา
    router.delete('/programs/:id', requireRole('admin'), (req, res) => {
        try {
            const hasGroups = db.prepare('SELECT COUNT(*) as cnt FROM student_groups WHERE program_id = ?').get(req.params.id);
            if (hasGroups.cnt > 0) {
                return res.status(400).json({ error: 'ไม่สามารถลบสาขาวิชานี้ได้ เนื่องจากมีกลุ่มเรียนที่ใช้งานอยู่' });
            }
            db.prepare('DELETE FROM programs WHERE id = ?').run(req.params.id);
            log(req.session.user.id, 'delete', 'programs', req.params.id, null, null);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // 7. ดึงข้อมูลกลุ่มเรียนเดี่ยว
    router.get('/:id', requireAuth, (req, res) => {
        try {
            const group = db.prepare(`
                SELECT sg.*, p.name as program_name, p.code as program_code, p.level,
                       d.name as department_name, s.name as semester_name
                FROM student_groups sg
                JOIN programs p ON sg.program_id = p.id
                LEFT JOIN departments d ON p.department_id = d.id
                LEFT JOIN semesters s ON sg.semester_id = s.id
                WHERE sg.id = ?
            `).get(req.params.id);
            if (!group) return res.status(404).json({ error: 'ไม่พบกลุ่มเรียน' });
            res.json(group);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // 8. เพิ่มกลุ่มเรียนใหม่
    router.post('/', requireRole('admin', 'academic'), (req, res) => {
        try {
            let { code, name, program_id, year_level, group_number, student_count, semester_id } = req.body;
            if (!code || !name || !program_id) {
                return res.status(400).json({ error: 'กรุณากรอกรหัสกลุ่ม ชื่อกลุ่ม และสาขาวิชาให้ครบถ้วน' });
            }

            // ถ้าไม่ได้ส่ง semester_id ให้ดึงภาคเรียนปัจจุบัน
            if (!semester_id) {
                const cur = db.prepare('SELECT id FROM semesters WHERE is_current = 1 LIMIT 1').get();
                if (cur) semester_id = cur.id;
            }

            if (!semester_id) {
                return res.status(400).json({ error: 'ไม่พบข้อมูลภาคเรียน' });
            }

            // ตรวจสอบความซ้ำซ้อนของรหัสกลุ่มในภาคเรียนเดียวกัน
            const existing = db.prepare('SELECT id FROM student_groups WHERE code = ? AND semester_id = ?').get(code, semester_id);
            if (existing) {
                return res.status(400).json({ error: `รหัสกลุ่มเรียน ${code} มีอยู่ในภาคเรียนนี้แล้ว` });
            }

            const result = db.prepare(`
                INSERT INTO student_groups (code, name, program_id, year_level, group_number, student_count, semester_id)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(
                code.trim(),
                name.trim(),
                parseInt(program_id),
                parseInt(year_level) || 1,
                parseInt(group_number) || 1,
                parseInt(student_count) || 0,
                parseInt(semester_id)
            );

            log(req.session.user.id, 'create', 'student_groups', result.lastInsertRowid, null, req.body);
            res.json({ success: true, id: result.lastInsertRowid });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // 9. แก้ไขกลุ่มเรียน
    router.put('/:id', requireRole('admin', 'academic'), (req, res) => {
        try {
            const { code, name, program_id, year_level, group_number, student_count, semester_id, is_active } = req.body;
            const old = db.prepare('SELECT * FROM student_groups WHERE id = ?').get(req.params.id);
            if (!old) return res.status(404).json({ error: 'ไม่พบกลุ่มเรียน' });

            const targetSemesterId = semester_id || old.semester_id;

            // ตรวจสอบกรณีเปลี่ยนรหัสแล้วซ้ำกับกลุ่มอื่นในภาคเรียนเดียวกัน
            if (code && code !== old.code) {
                const existing = db.prepare('SELECT id FROM student_groups WHERE code = ? AND semester_id = ? AND id != ?')
                    .get(code, targetSemesterId, req.params.id);
                if (existing) {
                    return res.status(400).json({ error: `รหัสกลุ่มเรียน ${code} มีอยู่ในภาคเรียนนี้แล้ว` });
                }
            }

            db.prepare(`
                UPDATE student_groups 
                SET code = COALESCE(?, code),
                    name = COALESCE(?, name),
                    program_id = COALESCE(?, program_id),
                    year_level = COALESCE(?, year_level),
                    group_number = COALESCE(?, group_number),
                    student_count = COALESCE(?, student_count),
                    semester_id = COALESCE(?, semester_id),
                    is_active = ?,
                    updated_at = datetime('now','localtime')
                WHERE id = ?
            `).run(
                code ? code.trim() : null,
                name ? name.trim() : null,
                program_id ? parseInt(program_id) : null,
                year_level ? parseInt(year_level) : null,
                group_number ? parseInt(group_number) : null,
                student_count !== undefined ? parseInt(student_count) : null,
                targetSemesterId ? parseInt(targetSemesterId) : null,
                is_active !== undefined ? (is_active ? 1 : 0) : 1,
                req.params.id
            );

            log(req.session.user.id, 'update', 'student_groups', req.params.id, old, req.body);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // 10. ลบกลุ่มเรียน
    router.delete('/:id', requireRole('admin'), (req, res) => {
        try {
            const old = db.prepare('SELECT * FROM student_groups WHERE id = ?').get(req.params.id);
            if (!old) return res.status(404).json({ error: 'ไม่พบกลุ่มเรียน' });

            // ตรวจสอบว่ามีการนำกลุ่มเรียนนี้ไปใส่ตารางสอนแล้วหรือไม่
            const assigned = db.prepare(`
                SELECT COUNT(*) as cnt 
                FROM teaching_assignments ta
                JOIN timetable_entries te ON te.teaching_assignment_id = ta.id
                WHERE ta.student_group_id = ?
            `).get(req.params.id);

            if (assigned && assigned.cnt > 0) {
                return res.status(400).json({ 
                    error: `ไม่สามารถลบกลุ่มเรียนนี้ได้ เนื่องจากมีตารางสอนถูกจัดไว้แล้ว ${assigned.cnt} คาบ (กรุณาล้างคาบในตารางสอนก่อน)` 
                });
            }

            db.prepare('DELETE FROM student_groups WHERE id = ?').run(req.params.id);
            log(req.session.user.id, 'delete', 'student_groups', req.params.id, old, null);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    return router;
};
