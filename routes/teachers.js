// =====================================================
// teachers.js - Routes จัดการข้อมูลครู
// =====================================================
const express = require('express');
const router = express.Router();
const { requireAuth, requireRole, auditLog } = require('../middleware/authMiddleware');

module.exports = function(db) {
    const log = auditLog(db);

    // ดึงรายชื่อครูทั้งหมด
    router.get('/', requireAuth, (req, res) => {
        try {
            const { department_id, search, active } = req.query;
            let query = `
                SELECT t.*, d.name as department_name, d.code as department_code
                FROM teachers t
                LEFT JOIN departments d ON t.department_id = d.id
                WHERE 1=1
            `;
            const params = [];

            if (department_id) {
                query += ' AND t.department_id = ?';
                params.push(department_id);
            }
            if (active !== undefined) {
                query += ' AND t.is_active = ?';
                params.push(active === 'true' ? 1 : 0);
            }
            if (search) {
                query += ' AND (t.first_name LIKE ? OR t.last_name LIKE ? OR t.employee_id LIKE ?)';
                params.push(`%${search}%`, `%${search}%`, `%${search}%`);
            }

            query += ' ORDER BY t.first_name, t.last_name';
            res.json(db.prepare(query).all(...params));
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ดึงข้อมูลครูคนเดียว
    router.get('/:id', requireAuth, (req, res) => {
        try {
            const teacher = db.prepare(`
                SELECT t.*, d.name as department_name
                FROM teachers t
                LEFT JOIN departments d ON t.department_id = d.id
                WHERE t.id = ?
            `).get(req.params.id);
            if (!teacher) return res.status(404).json({ error: 'ไม่พบข้อมูลครู' });
            res.json(teacher);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // เพิ่มครูใหม่
    router.post('/', requireRole('admin', 'academic'), (req, res) => {
        try {
            const { employee_id, prefix, first_name, last_name, department_id, position, phone, email, max_hours_per_week, max_hours_per_day } = req.body;
            
            if (!employee_id || !first_name || !last_name) {
                return res.status(400).json({ error: 'กรุณากรอกรหัส ชื่อ และนามสกุล' });
            }

            const existing = db.prepare('SELECT id FROM teachers WHERE employee_id = ?').get(employee_id);
            if (existing) {
                return res.status(400).json({ error: 'รหัสครูนี้มีอยู่แล้ว' });
            }

            const result = db.prepare(`
                INSERT INTO teachers (employee_id, prefix, first_name, last_name, department_id, position, phone, email, max_hours_per_week, max_hours_per_day)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(employee_id, prefix || '', first_name, last_name, department_id || null, position || '', phone || '', email || '', max_hours_per_week || 20, max_hours_per_day || 6);

            log(req.session.user.id, 'create', 'teachers', result.lastInsertRowid, null, req.body);
            res.json({ success: true, id: result.lastInsertRowid });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // แก้ไขข้อมูลครู
    router.put('/:id', requireRole('admin', 'academic'), (req, res) => {
        try {
            const { employee_id, prefix, first_name, last_name, department_id, position, phone, email, max_hours_per_week, max_hours_per_day, is_active } = req.body;
            const old = db.prepare('SELECT * FROM teachers WHERE id = ?').get(req.params.id);
            if (!old) return res.status(404).json({ error: 'ไม่พบข้อมูลครู' });

            db.prepare(`
                UPDATE teachers SET employee_id = ?, prefix = ?, first_name = ?, last_name = ?,
                department_id = ?, position = ?, phone = ?, email = ?,
                max_hours_per_week = ?, max_hours_per_day = ?, is_active = ?,
                updated_at = datetime('now', 'localtime')
                WHERE id = ?
            `).run(employee_id, prefix || '', first_name, last_name, department_id || null, position || '', phone || '', email || '', max_hours_per_week || 20, max_hours_per_day || 6, is_active !== undefined ? (is_active ? 1 : 0) : 1, req.params.id);

            log(req.session.user.id, 'update', 'teachers', req.params.id, old, req.body);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ลบครู
    router.delete('/:id', requireRole('admin'), (req, res) => {
        try {
            const assignments = db.prepare('SELECT COUNT(*) as cnt FROM teaching_assignments WHERE teacher_id = ?').get(req.params.id);
            if (assignments.cnt > 0) {
                return res.status(400).json({ error: 'ไม่สามารถลบได้ ครูยังมีการมอบหมายสอนอยู่' });
            }
            db.prepare('DELETE FROM teachers WHERE id = ?').run(req.params.id);
            log(req.session.user.id, 'delete', 'teachers', req.params.id, null, null);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ดึงภาระสอนของครู
    router.get('/:id/workload', requireAuth, (req, res) => {
        try {
            const semesterId = req.query.semester_id;
            let query = `
                SELECT ta.*, s.code as subject_code, s.name as subject_name,
                       sg.name as group_name, sg.student_count
                FROM teaching_assignments ta
                JOIN subjects s ON ta.subject_id = s.id
                JOIN student_groups sg ON ta.student_group_id = sg.id
                WHERE ta.teacher_id = ? AND ta.is_active = 1
            `;
            const params = [req.params.id];
            if (semesterId) {
                query += ' AND ta.semester_id = ?';
                params.push(semesterId);
            }
            res.json(db.prepare(query).all(...params));
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    return router;
};
