// =====================================================
// subjects.js - Routes จัดการรายวิชา
// =====================================================
const express = require('express');
const router = express.Router();
const { requireAuth, requireRole, auditLog } = require('../middleware/authMiddleware');

module.exports = function(db) {
    const log = auditLog(db);

    // ดึงรายวิชาทั้งหมด
    router.get('/', requireAuth, (req, res) => {
        try {
            const { department_id, program_id, search, type } = req.query;
            let query = `
                SELECT s.*, d.name as department_name, p.name as program_name
                FROM subjects s
                LEFT JOIN departments d ON s.department_id = d.id
                LEFT JOIN programs p ON s.program_id = p.id
                WHERE s.is_active = 1
            `;
            const params = [];

            if (department_id) { query += ' AND s.department_id = ?'; params.push(department_id); }
            if (program_id) { query += ' AND s.program_id = ?'; params.push(program_id); }
            if (type) { query += ' AND s.subject_type = ?'; params.push(type); }
            if (search) {
                query += ' AND (s.code LIKE ? OR s.name LIKE ?)';
                params.push(`%${search}%`, `%${search}%`);
            }

            query += ' ORDER BY s.code';
            res.json(db.prepare(query).all(...params));
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.get('/:id', requireAuth, (req, res) => {
        try {
            const subject = db.prepare(`
                SELECT s.*, d.name as department_name, p.name as program_name
                FROM subjects s
                LEFT JOIN departments d ON s.department_id = d.id
                LEFT JOIN programs p ON s.program_id = p.id
                WHERE s.id = ?
            `).get(req.params.id);
            if (!subject) return res.status(404).json({ error: 'ไม่พบรายวิชา' });
            res.json(subject);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.post('/', requireRole('admin', 'academic'), (req, res) => {
        try {
            const { code, name, short_name, credits, theory_hours, practice_hours, subject_type, requires_lab, department_id, program_id } = req.body;
            if (!code || !name) {
                return res.status(400).json({ error: 'กรุณากรอกรหัสวิชาและชื่อวิชา' });
            }

            const total_hours = (parseInt(theory_hours) || 0) + (parseInt(practice_hours) || 0);
            const result = db.prepare(`
                INSERT INTO subjects (code, name, short_name, credits, theory_hours, practice_hours, total_hours, subject_type, requires_lab, department_id, program_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(code, name, short_name || '', credits || 0, theory_hours || 0, practice_hours || 0, total_hours, subject_type || 'ทฤษฎี', requires_lab ? 1 : 0, department_id || null, program_id || null);

            log(req.session.user.id, 'create', 'subjects', result.lastInsertRowid, null, req.body);
            res.json({ success: true, id: result.lastInsertRowid });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.put('/:id', requireRole('admin', 'academic'), (req, res) => {
        try {
            const { code, name, short_name, credits, theory_hours, practice_hours, subject_type, requires_lab, department_id, program_id, is_active } = req.body;
            const old = db.prepare('SELECT * FROM subjects WHERE id = ?').get(req.params.id);
            if (!old) return res.status(404).json({ error: 'ไม่พบรายวิชา' });

            const total_hours = (parseInt(theory_hours) || 0) + (parseInt(practice_hours) || 0);
            db.prepare(`
                UPDATE subjects SET code=?, name=?, short_name=?, credits=?, theory_hours=?, practice_hours=?, total_hours=?, subject_type=?, requires_lab=?, department_id=?, program_id=?, is_active=?, updated_at=datetime('now','localtime')
                WHERE id = ?
            `).run(code, name, short_name || '', credits || 0, theory_hours || 0, practice_hours || 0, total_hours, subject_type || 'ทฤษฎี', requires_lab ? 1 : 0, department_id || null, program_id || null, is_active !== undefined ? (is_active ? 1 : 0) : 1, req.params.id);

            log(req.session.user.id, 'update', 'subjects', req.params.id, old, req.body);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.delete('/:id', requireRole('admin'), (req, res) => {
        try {
            const assignments = db.prepare('SELECT COUNT(*) as cnt FROM teaching_assignments WHERE subject_id = ?').get(req.params.id);
            if (assignments.cnt > 0) {
                return res.status(400).json({ error: 'ไม่สามารถลบได้ วิชานี้ยังมีการมอบหมายสอนอยู่' });
            }
            db.prepare('DELETE FROM subjects WHERE id = ?').run(req.params.id);
            log(req.session.user.id, 'delete', 'subjects', req.params.id, null, null);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    return router;
};
