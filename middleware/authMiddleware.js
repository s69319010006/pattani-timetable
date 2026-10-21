// =====================================================
// authMiddleware.js - Middleware ตรวจสอบสิทธิ์
// =====================================================

/**
 * ตรวจสอบว่าผู้ใช้เข้าสู่ระบบแล้ว
 */
function requireAuth(req, res, next) {
    if (req.session && req.session.user) {
        return next();
    }
    if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });
    }
    return res.redirect('/login.html');
}

/**
 * ตรวจสอบบทบาท
 */
function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.session || !req.session.user) {
            if (req.xhr || req.headers.accept?.includes('application/json')) {
                return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });
            }
            return res.redirect('/login.html');
        }
        
        if (!roles.includes(req.session.user.role)) {
            if (req.xhr || req.headers.accept?.includes('application/json')) {
                return res.status(403).json({ error: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' });
            }
            return res.status(403).send('ไม่มีสิทธิ์เข้าถึง');
        }
        
        return next();
    };
}

/**
 * ตรวจสอบว่าเป็น Admin หรือ Academic
 */
function requireAdminOrAcademic(req, res, next) {
    return requireRole('admin', 'academic')(req, res, next);
}

/**
 * เพิ่มข้อมูล user ลงใน response locals
 */
function addUserToLocals(req, res, next) {
    res.locals.user = req.session?.user || null;
    next();
}

/**
 * บันทึก audit log
 */
function auditLog(db) {
    return (userId, action, entityType, entityId, oldValue, newValue) => {
        try {
            db.prepare(`
                INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_value, new_value)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(userId, action, entityType, entityId,
                oldValue ? JSON.stringify(oldValue) : null,
                newValue ? JSON.stringify(newValue) : null
            );
        } catch (err) {
            console.error('Audit log error:', err.message);
        }
    };
}

module.exports = {
    requireAuth,
    requireRole,
    requireAdminOrAcademic,
    addUserToLocals,
    auditLog
};
