// =====================================================
// server.js - Main Express Entry Point
// ระบบจัดตารางสอนอัตโนมัติ วิทยาลัยการอาชีพปัตตานี
// Pattani Industrial and Community Education College
// =====================================================
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');

const { initializeDatabase, getDb, DB_PATH } = require('./database/database');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'pattani-timetable-secret-2024';

// 1. เริ่มต้นฐานข้อมูล SQLite และ Seed ข้อมูลเบื้องต้น
console.log('🚀 กำลังเริ่มต้นระบบจัดตารางสอนอัตโนมัติ วิทยาลัยการอาชีพปัตตานี...');
const db = initializeDatabase();

// ตรวจสอบว่ามีข้อมูลจำลองหรือไม่ ถ้ายังไม่มีให้ seed อัตโนมัติ
const teacherCount = db.prepare('SELECT COUNT(*) as cnt FROM teachers').get().cnt;
if (teacherCount === 0) {
    console.log('📦 ตรวจพบฐานข้อมูลว่างเปล่า กำลังเตรียมข้อมูลเริ่มต้นของวิทยาลัยการอาชีพปัตตานี...');
    const runSeed = require('./database/seed');
    runSeed();
}

// 2. Middlewares พื้นฐาน
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 3. จัดการ Session (ใช้ connect-sqlite3 เพื่อความคงทนของ session)
let sessionStore;
try {
    const SQLiteStore = require('connect-sqlite3')(session);
    sessionStore = new SQLiteStore({
        db: 'sessions.db',
        dir: path.join(__dirname, 'database')
    });
} catch (e) {
    console.warn('⚠️ ไม่สามารถใช้ SQLiteStore ได้ จะใช้ MemoryStore ชั่วคราว:', e.message);
}

app.use(session({
    store: sessionStore,
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 1000 * 60 * 60 * 24, // 24 ชั่วโมง
        httpOnly: true,
        secure: false // true หากใช้ HTTPS
    }
}));

// 4. ให้บริการไฟล์ Static (Frontend UI)
app.use(express.static(path.join(__dirname, 'public')));

// 5. เชื่อมต่อ API Routes
app.use('/api/auth', require('./routes/auth')(db));
app.use('/api/teachers', require('./routes/teachers')(db));
app.use('/api/subjects', require('./routes/subjects')(db));
app.use('/api/classrooms', require('./routes/classrooms')(db));
app.use('/api/assignments', require('./routes/assignments')(db));
app.use('/api/groups', require('./routes/groups')(db));
app.use('/api/timetable', require('./routes/timetable')(db));
app.use('/api/reports', require('./routes/reports')(db));

// 6. Route เสริมสำหรับส่งไฟล์หน้าเว็บ HTML โดยตรง
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 7. จัดการ Error Middleware
app.use((err, req, res, next) => {
    console.error('💥 Unhandled Error:', err);
    res.status(err.status || 500).json({
        error: err.message || 'เกิดข้อผิดพลาดในระบบ'
    });
});

// 8. เริ่มต้น Server
const server = app.listen(PORT, () => {
    console.log('=====================================================');
    console.log(`🏫 ระบบจัดตารางสอนอัตโนมัติ วิทยาลัยการอาชีพปัตตานี พร้อมทำงานแล้ว!`);
    console.log(`🌐 เข้าใช้งานได้ที่: http://localhost:${PORT}`);
    console.log(`👤 บัญชีเริ่มต้น: admin / admin1234`);
    console.log(`📚 ภาคเรียนปัจจุบัน: 1/2567`);
    console.log('=====================================================');
});

// Graceful Shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 กำลังปิดระบบ...');
    server.close(() => {
        const { closeDb } = require('./database/database');
        closeDb();
        console.log('👋 ระบบปิดเรียบร้อยแล้ว');
        process.exit(0);
    });
});
