// =====================================================
// database.js - การเชื่อมต่อและจัดการฐานข้อมูล SQLite
// =====================================================
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');

const DB_PATH = path.join(__dirname, 'school.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

let db;

/**
 * เปิดการเชื่อมต่อฐานข้อมูล
 */
function getDb() {
    if (!db) {
        db = new Database(DB_PATH);
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');
        db.pragma('busy_timeout = 5000');
    }
    return db;
}

/**
 * สร้างตารางฐานข้อมูลจาก schema.sql
 */
function initializeDatabase() {
    const database = getDb();
    
    console.log('🔧 กำลังสร้างฐานข้อมูล...');
    
    // อ่านและรัน schema
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
    database.exec(schema);
    
    console.log('✅ สร้างตารางฐานข้อมูลสำเร็จ');
    
    // สร้าง Admin เริ่มต้นถ้ายังไม่มี
    createDefaultAdmin(database);
    
    // สร้างการตั้งค่าเริ่มต้น
    createDefaultSettings(database);
    
    return database;
}

/**
 * สร้างบัญชี Admin เริ่มต้น
 */
function createDefaultAdmin(database) {
    const existingAdmin = database.prepare(
        'SELECT id FROM users WHERE username = ?'
    ).get('admin');
    
    if (!existingAdmin) {
        const passwordHash = bcrypt.hashSync('admin1234', 10);
        database.prepare(`
            INSERT INTO users (username, password_hash, full_name, email, role)
            VALUES (?, ?, ?, ?, ?)
        `).run('admin', passwordHash, 'ผู้ดูแลระบบ', 'admin@pattani.ac.th', 'admin');
        
        console.log('👤 สร้างบัญชีผู้ดูแลระบบเริ่มต้น:');
        console.log('   Username: admin');
        console.log('   Password: admin1234');
        console.log('   ⚠️  กรุณาเปลี่ยนรหัสผ่านหลังเข้าสู่ระบบครั้งแรก');
    }
}

/**
 * สร้างการตั้งค่าเริ่มต้น
 */
function createDefaultSettings(database) {
    const settings = [
        { key: 'college_name', value: 'วิทยาลัยการอาชีพปัตตานี', desc: 'ชื่อสถานศึกษา' },
        { key: 'college_name_en', value: 'Pattani Industrial and Community Education College', desc: 'ชื่อสถานศึกษา (ภาษาอังกฤษ)' },
        { key: 'periods_per_day', value: '8', desc: 'จำนวนคาบเรียนต่อวัน' },
        { key: 'period_duration_minutes', value: '60', desc: 'ระยะเวลาแต่ละคาบ (นาที)' },
        { key: 'school_start_time', value: '08:00', desc: 'เวลาเริ่มเรียน' },
        { key: 'school_end_time', value: '16:00', desc: 'เวลาเลิกเรียน' },
        { key: 'break_after_period', value: '4', desc: 'พักเที่ยงหลังคาบที่' },
        { key: 'break_duration_minutes', value: '60', desc: 'ระยะเวลาพักเที่ยง (นาที)' },
        { key: 'working_days', value: '1,2,3,4,5', desc: 'วันทำการ (1=จันทร์, 5=ศุกร์)' },
        { key: 'max_consecutive_periods', value: '3', desc: 'จำนวนคาบสูงสุดที่สอนต่อเนื่อง' },
        { key: 'teacher_max_hours_default', value: '20', desc: 'ชั่วโมงสอนสูงสุดต่อสัปดาห์ (ค่าเริ่มต้น)' },
    ];
    
    const insert = database.prepare(`
        INSERT OR IGNORE INTO system_settings (setting_key, setting_value, description)
        VALUES (?, ?, ?)
    `);
    
    const insertMany = database.transaction((items) => {
        for (const item of items) {
            insert.run(item.key, item.value, item.desc);
        }
    });
    
    insertMany(settings);
}

/**
 * ปิดการเชื่อมต่อฐานข้อมูล
 */
function closeDb() {
    if (db) {
        db.close();
        db = null;
        console.log('🔒 ปิดฐานข้อมูลเรียบร้อย');
    }
}

module.exports = {
    getDb,
    initializeDatabase,
    closeDb,
    DB_PATH
};
