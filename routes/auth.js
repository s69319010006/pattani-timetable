// =====================================================
// auth.js - Routes สำหรับการเข้าสู่ระบบและจัดการผู้ใช้
// =====================================================
const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const { requireAuth, requireRole, auditLog } = require('../middleware/authMiddleware');

module.exports = function(db) {
    const log = auditLog(db);

    // เข้าสู่ระบบ
    router.post('/login', (req, res) => {
        try {
            const { username, password } = req.body;
            if (!username || !password) {
                return res.status(400).json({ error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' });
            }

            const user = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username);
            if (!user) {
                return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
            }

            const validPassword = bcrypt.compareSync(password, user.password_hash);
            if (!validPassword) {
                return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
            }

            // อัปเดต last login
            db.prepare("UPDATE users SET last_login = datetime('now', 'localtime') WHERE id = ?").run(user.id);

            req.session.user = {
                id: user.id,
                username: user.username,
                full_name: user.full_name,
                role: user.role,
                teacher_id: user.teacher_id,
                student_group_id: user.student_group_id
            };

            log(user.id, 'login', 'users', user.id, null, null);

            res.json({
                success: true,
                user: req.session.user
            });
        } catch (err) {
            res.status(500).json({ error: 'เกิดข้อผิดพลาด: ' + err.message });
        }
    });

    // ออกจากระบบ
    router.post('/logout', (req, res) => {
        if (req.session.user) {
            log(req.session.user.id, 'logout', 'users', req.session.user.id, null, null);
        }
        req.session.destroy();
        res.json({ success: true });
    });

    // ตรวจสอบสถานะเข้าสู่ระบบ
    router.get('/me', (req, res) => {
        if (req.session && req.session.user) {
            res.json({ user: req.session.user });
        } else {
            res.status(401).json({ error: 'ยังไม่ได้เข้าสู่ระบบ' });
        }
    });

    // เปลี่ยนรหัสผ่าน
    router.post('/change-password', requireAuth, (req, res) => {
        try {
            const { currentPassword, newPassword } = req.body;
            if (!currentPassword || !newPassword) {
                return res.status(400).json({ error: 'กรุณากรอกรหัสผ่านให้ครบ' });
            }
            if (newPassword.length < 6) {
                return res.status(400).json({ error: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร' });
            }

            const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
            if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
                return res.status(400).json({ error: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' });
            }

            const hash = bcrypt.hashSync(newPassword, 10);
            db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now', 'localtime') WHERE id = ?")
                .run(hash, user.id);

            log(user.id, 'change_password', 'users', user.id, null, null);
            res.json({ success: true, message: 'เปลี่ยนรหัสผ่านสำเร็จ' });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ===== จัดการผู้ใช้ (Admin เท่านั้น) =====

    // ดึงรายชื่อผู้ใช้ทั้งหมด
    router.get('/users', requireRole('admin'), (req, res) => {
        try {
            const users = db.prepare(`
                SELECT u.id, u.username, u.full_name, u.email, u.role, u.is_active, 
                       u.last_login, u.created_at, u.teacher_id, u.student_group_id,
                       t.first_name as teacher_first_name, t.last_name as teacher_last_name
                FROM users u
                LEFT JOIN teachers t ON u.teacher_id = t.id
                ORDER BY u.role, u.full_name
            `).all();
            res.json(users);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // สร้างผู้ใช้ใหม่
    router.post('/users', requireRole('admin'), (req, res) => {
        try {
            const { username, password, full_name, email, role, teacher_id, student_group_id } = req.body;
            
            if (!username || !password || !full_name || !role) {
                return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบ' });
            }

            const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
            if (existing) {
                return res.status(400).json({ error: 'ชื่อผู้ใช้นี้มีอยู่แล้ว' });
            }

            const hash = bcrypt.hashSync(password, 10);
            const result = db.prepare(`
                INSERT INTO users (username, password_hash, full_name, email, role, teacher_id, student_group_id)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(username, hash, full_name, email || null, role, teacher_id || null, student_group_id || null);

            log(req.session.user.id, 'create', 'users', result.lastInsertRowid, null, { username, role });
            res.json({ success: true, id: result.lastInsertRowid });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // แก้ไขผู้ใช้
    router.put('/users/:id', requireRole('admin'), (req, res) => {
        try {
            const { full_name, email, role, is_active, teacher_id, student_group_id, password } = req.body;
            const userId = req.params.id;

            const old = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
            if (!old) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });

            let query = `UPDATE users SET full_name = ?, email = ?, role = ?, is_active = ?,
                         teacher_id = ?, student_group_id = ?, updated_at = datetime('now', 'localtime')`;
            let params = [full_name, email, role, is_active ? 1 : 0, teacher_id || null, student_group_id || null];

            if (password) {
                query += ', password_hash = ?';
                params.push(bcrypt.hashSync(password, 10));
            }

            query += ' WHERE id = ?';
            params.push(userId);

            db.prepare(query).run(...params);
            log(req.session.user.id, 'update', 'users', userId, old, req.body);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ลบผู้ใช้
    router.delete('/users/:id', requireRole('admin'), (req, res) => {
        try {
            const userId = req.params.id;
            if (parseInt(userId) === req.session.user.id) {
                return res.status(400).json({ error: 'ไม่สามารถลบบัญชีตนเองได้' });
            }
            db.prepare('DELETE FROM users WHERE id = ?').run(userId);
            log(req.session.user.id, 'delete', 'users', userId, null, null);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    return router;
};
