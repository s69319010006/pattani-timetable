// =====================================================
// classrooms.js - Routes จัดการห้องเรียน
// =====================================================
const express = require('express');
const router = express.Router();
const { requireAuth, requireRole, auditLog } = require('../middleware/authMiddleware');

module.exports = function(db) {
    const log = auditLog(db);

    router.get('/', requireAuth, (req, res) => {
        try {
            const { type, department_id, search } = req.query;
            let query = `
                SELECT c.*, d.name as department_name
                FROM classrooms c
                LEFT JOIN departments d ON c.department_id = d.id
                WHERE c.is_active = 1
            `;
            const params = [];
            if (type) { query += ' AND c.room_type = ?'; params.push(type); }
            if (department_id) { query += ' AND c.department_id = ?'; params.push(department_id); }
            if (search) { query += ' AND (c.code LIKE ? OR c.name LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
            query += ' ORDER BY c.building, c.code';
            res.json(db.prepare(query).all(...params));
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.get('/:id', requireAuth, (req, res) => {
        try {
            const room = db.prepare('SELECT c.*, d.name as department_name FROM classrooms c LEFT JOIN departments d ON c.department_id = d.id WHERE c.id = ?').get(req.params.id);
            if (!room) return res.status(404).json({ error: 'ไม่พบห้องเรียน' });
            res.json(room);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.post('/', requireRole('admin', 'academic'), (req, res) => {
        try {
            const { code, name, building, floor, capacity, room_type, department_id, facilities } = req.body;
            if (!code || !name) return res.status(400).json({ error: 'กรุณากรอกรหัสและชื่อห้อง' });

            const existing = db.prepare('SELECT id FROM classrooms WHERE code = ?').get(code);
            if (existing) return res.status(400).json({ error: 'รหัสห้องนี้มีอยู่แล้ว' });

            const result = db.prepare(`
                INSERT INTO classrooms (code, name, building, floor, capacity, room_type, department_id, facilities)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(code, name, building || '', floor || null, capacity || 40, room_type || 'ห้องเรียน', department_id || null, facilities || '');

            log(req.session.user.id, 'create', 'classrooms', result.lastInsertRowid, null, req.body);
            res.json({ success: true, id: result.lastInsertRowid });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.put('/:id', requireRole('admin', 'academic'), (req, res) => {
        try {
            const { code, name, building, floor, capacity, room_type, department_id, facilities, is_active } = req.body;
            const old = db.prepare('SELECT * FROM classrooms WHERE id = ?').get(req.params.id);
            if (!old) return res.status(404).json({ error: 'ไม่พบห้องเรียน' });

            db.prepare(`
                UPDATE classrooms SET code=?, name=?, building=?, floor=?, capacity=?, room_type=?, department_id=?, facilities=?, is_active=?, updated_at=datetime('now','localtime')
                WHERE id = ?
            `).run(code, name, building || '', floor || null, capacity || 40, room_type || 'ห้องเรียน', department_id || null, facilities || '', is_active !== undefined ? (is_active ? 1 : 0) : 1, req.params.id);

            log(req.session.user.id, 'update', 'classrooms', req.params.id, old, req.body);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.delete('/:id', requireRole('admin'), (req, res) => {
        try {
            const entries = db.prepare('SELECT COUNT(*) as cnt FROM timetable_entries WHERE classroom_id = ?').get(req.params.id);
            if (entries.cnt > 0) return res.status(400).json({ error: 'ห้องเรียนนี้มีในตารางสอนอยู่' });
            db.prepare('DELETE FROM classrooms WHERE id = ?').run(req.params.id);
            log(req.session.user.id, 'delete', 'classrooms', req.params.id, null, null);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    return router;
};
