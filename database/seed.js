// =====================================================
// seed.js - สร้างข้อมูลจริงและตรงตามโครงสร้าง
// วิทยาลัยการอาชีพปัตตานี (Pattani Industrial and Community Education College)
// อ้างอิงจากเว็บไซต์ทางการ www.ptnicec.ac.th
// =====================================================
const { getDb, initializeDatabase, closeDb } = require('./database');
const bcrypt = require('bcrypt');

function runSeed() {
    console.log('🌱 เริ่มต้นการนำเข้าข้อมูลบุคลากรและรายวิชาจาก www.ptnicec.ac.th...');
    const db = initializeDatabase();

    const seedTx = db.transaction(() => {
        // ================= 1. ผู้ใช้งานระบบ (Users) =================
        const passAcademic = bcrypt.hashSync('academic1234', 10);
        const passTeacher = bcrypt.hashSync('teacher1234', 10);

        db.prepare(`
            INSERT OR IGNORE INTO users (username, password_hash, full_name, email, role)
            VALUES (?, ?, ?, ?, ?)
        `).run('academic', passAcademic, 'ฝ่ายวิชาการ วิทยาลัยการอาชีพปัตตานี', 'academic@ptnicec.ac.th', 'academic');

        // ================= 2. ปีการศึกษา & ภาคเรียน =================
        db.prepare(`
            INSERT OR IGNORE INTO academic_years (year, is_current)
            VALUES (2567, 1)
        `).run();
        const academicYear = db.prepare('SELECT id FROM academic_years WHERE year = 2567').get();

        db.prepare('UPDATE semesters SET is_current = 0').run();
        db.prepare(`
            INSERT OR IGNORE INTO semesters (academic_year_id, semester_number, name, start_date, end_date, is_current)
            VALUES (?, 1, 'ภาคเรียนที่ 1/2567', '2024-05-15', '2024-10-15', 1)
        `).run(academicYear.id);
        const currentSemester = db.prepare('SELECT id FROM semesters WHERE academic_year_id = ? AND semester_number = 1').get(academicYear.id);

        db.prepare(`
            INSERT OR IGNORE INTO semesters (academic_year_id, semester_number, name, start_date, end_date, is_current)
            VALUES (?, 2, 'ภาคเรียนที่ 2/2567', '2024-11-01', '2025-03-31', 0)
        `).run(academicYear.id);

        // ================= 3. แผนกวิชาจริงจาก www.ptnicec.ac.th =================
        const departments = [
            { code: 'AUTO', name: 'แผนกวิชาช่างยนต์', desc: 'สาขาวิชาช่างยนต์และเครื่องกล วิทยาลัยการอาชีพปัตตานี' },
            { code: 'ELEC', name: 'แผนกวิชาช่างไฟฟ้ากำลัง', desc: 'สาขาวิชาช่างไฟฟ้ากำลัง วิทยาลัยการอาชีพปัตตานี' },
            { code: 'MECH', name: 'แผนกวิชาช่างกลโรงงาน', desc: 'สาขาวิชาช่างกลโรงงาน วิทยาลัยการอาชีพปัตตานี' },
            { code: 'ETRON', name: 'แผนกวิชาช่างอิเล็กทรอนิกส์', desc: 'สาขาวิชาช่างอิเล็กทรอนิกส์ วิทยาลัยการอาชีพปัตตานี' },
            { code: 'IT', name: 'แผนกวิชาเทคโนโลยีสารสนเทศ', desc: 'สาขาวิชาเทคโนโลยีสารสนเทศและดิจิทัล' },
            { code: 'ACCT', name: 'แผนกวิชาการบัญชี', desc: 'สาขาวิชาการบัญชีและการเงิน' },
            { code: 'FOOD', name: 'แผนกวิชาอาหารและโภชนาการ', desc: 'สาขาวิชาอาหารและโภชนาการ วิทยาลัยการอาชีพปัตตานี' },
            { code: 'FASHION', name: 'แผนกวิชาเทคโนโลยีแฟชั่นและเครื่องแต่งกาย', desc: 'สาขาวิชาเทคโนโลยีแฟชั่นและเครื่องแต่งกาย' },
            { code: 'GEN', name: 'แผนกวิชาสามัญ-สัมพันธ์', desc: 'หมวดวิชาสามัญศึกษา ภาษาไทย ภาษาอังกฤษ วิทย์-คณิต' }
        ];

        const insertDept = db.prepare(`
            INSERT OR REPLACE INTO departments (code, name, description) VALUES (?, ?, ?)
        `);
        for (const d of departments) {
            insertDept.run(d.code, d.name, d.desc);
        }

        const deptMap = {};
        for (const row of db.prepare('SELECT id, code FROM departments').all()) {
            deptMap[row.code] = row.id;
        }

        // ================= 4. หลักสูตรจริง (Programs) =================
        const programs = [
            { code: 'P-AUTO-3', name: 'ช่างยนต์', level: 'ปวช.', dept: 'AUTO', dur: 3 },
            { code: 'P-ELEC-3', name: 'ช่างไฟฟ้ากำลัง', level: 'ปวช.', dept: 'ELEC', dur: 3 },
            { code: 'P-MECH-3', name: 'ช่างกลโรงงาน', level: 'ปวช.', dept: 'MECH', dur: 3 },
            { code: 'P-ETRON-3', name: 'ช่างอิเล็กทรอนิกส์', level: 'ปวช.', dept: 'ETRON', dur: 3 },
            { code: 'P-IT-3', name: 'เทคโนโลยีสารสนเทศ', level: 'ปวช.', dept: 'IT', dur: 3 },
            { code: 'P-ACCT-3', name: 'การบัญชี', level: 'ปวช.', dept: 'ACCT', dur: 3 },
            { code: 'P-FOOD-3', name: 'อาหารและโภชนาการ', level: 'ปวช.', dept: 'FOOD', dur: 3 },
            { code: 'P-FASHION-3', name: 'เทคโนโลยีแฟชั่นและเครื่องแต่งกาย', level: 'ปวช.', dept: 'FASHION', dur: 3 },
            { code: 'S-IT-2', name: 'เทคโนโลยีธุรกิจดิจิทัล', level: 'ปวส.', dept: 'IT', dur: 2 },
            { code: 'S-AUTO-2', name: 'เทคนิคเครื่องกล', level: 'ปวส.', dept: 'AUTO', dur: 2 }
        ];

        const insertProg = db.prepare(`
            INSERT OR REPLACE INTO programs (code, name, level, department_id, duration_years)
            VALUES (?, ?, ?, ?, ?)
        `);
        for (const p of programs) {
            insertProg.run(p.code, p.name, p.level, deptMap[p.dept], p.dur);
        }

        const progMap = {};
        for (const row of db.prepare('SELECT id, code FROM programs').all()) {
            progMap[row.code] = row.id;
        }

        // ================= 5. กลุ่มเรียน (Student Groups) =================
        const groups = [
            { code: 'ชย.67.1', name: 'ปวช.1 ช่างยนต์ กลุ่ม 1', prog: 'P-AUTO-3', yl: 1, gn: 1, count: 32 },
            { code: 'ชฟ.67.1', name: 'ปวช.1 ช่างไฟฟ้ากำลัง กลุ่ม 1', prog: 'P-ELEC-3', yl: 1, gn: 1, count: 28 },
            { code: 'ชก.67.1', name: 'ปวช.1 ช่างกลโรงงาน กลุ่ม 1', prog: 'P-MECH-3', yl: 1, gn: 1, count: 25 },
            { code: 'ชอ.67.1', name: 'ปวช.1 ช่างอิเล็กทรอนิกส์ กลุ่ม 1', prog: 'P-ETRON-3', yl: 1, gn: 1, count: 24 },
            { code: 'ทส.67.1', name: 'ปวช.1 เทคโนโลยีสารสนเทศ กลุ่ม 1', prog: 'P-IT-3', yl: 1, gn: 1, count: 30 },
            { code: 'บช.67.1', name: 'ปวช.1 การบัญชี กลุ่ม 1', prog: 'P-ACCT-3', yl: 1, gn: 1, count: 35 },
            { code: 'อภ.67.1', name: 'ปวช.1 อาหารและโภชนาการ กลุ่ม 1', prog: 'P-FOOD-3', yl: 1, gn: 1, count: 25 },
            { code: 'ทส.66.1', name: 'ปวช.2 เทคโนโลยีสารสนเทศ กลุ่ม 1', prog: 'P-IT-3', yl: 2, gn: 1, count: 28 }
        ];

        const insertGroup = db.prepare(`
            INSERT OR REPLACE INTO student_groups (code, name, program_id, year_level, group_number, student_count, semester_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        for (const g of groups) {
            insertGroup.run(g.code, g.name, progMap[g.prog], g.yl, g.gn, g.count, currentSemester.id);
        }

        const groupMap = {};
        for (const row of db.prepare('SELECT id, code FROM student_groups WHERE semester_id = ?').all(currentSemester.id)) {
            groupMap[row.code] = row.id;
        }

        // ================= 6. รายนามครูและอาจารย์จริงจาก www.ptnicec.ac.th =================
        const teachers = [
            // แผนกช่างยนต์
            { empId: 'PTN-001', prefix: 'นาย', fname: 'นราธร', lname: 'โอชาอัมพวัน', dept: 'AUTO', pos: 'ครู / หัวหน้าสาขาวิชาช่างยนต์', maxH: 20, maxD: 6, email: 'narathorn@ptnicec.ac.th', uname: 'narathorn' },
            { empId: 'PTN-002', prefix: 'นาย', fname: 'กูดิง', lname: 'เสะอุเซ็ง', dept: 'AUTO', pos: 'พนักงานราชการ (ครูช่างยนต์)', maxH: 22, maxD: 6, email: 'kuding@ptnicec.ac.th', uname: 'kuding' },
            
            // แผนกช่างไฟฟ้ากำลัง
            { empId: 'PTN-003', prefix: 'นาย', fname: 'ธวัชชัย', lname: 'สุขสันติดิลก', dept: 'ELEC', pos: 'ครูชำนาญการ / ช่างไฟฟ้ากำลัง', maxH: 20, maxD: 6, email: 'thawatchai@ptnicec.ac.th', uname: 'thawatchai' },
            { empId: 'PTN-004', prefix: 'นาย', fname: 'อภิมุข', lname: 'พงศ์สมบูรณ์', dept: 'ELEC', pos: 'ครู / ช่างไฟฟ้ากำลัง', maxH: 20, maxD: 6, email: 'apimuk@ptnicec.ac.th', uname: 'apimuk' },
            { empId: 'PTN-005', prefix: 'นาย', fname: 'พงษ์ศักดิ์', lname: 'วารีบริสุทธิ์', dept: 'ELEC', pos: 'พนักงานราชการ (ครูไฟฟ้า)', maxH: 20, maxD: 6, email: 'pongsak@ptnicec.ac.th', uname: 'pongsak' },

            // แผนกเทคโนโลยีสารสนเทศ
            { empId: 'PTN-006', prefix: 'นาย', fname: 'ธีระ', lname: 'บินกาเซ็ม', dept: 'IT', pos: 'ครู / หัวหน้าสาขาวิชาเทคโนโลยีสารสนเทศ', maxH: 18, maxD: 6, email: 'theera@ptnicec.ac.th', uname: 'theera' },
            { empId: 'PTN-007', prefix: 'นางสาว', fname: 'ฮาวาณี', lname: 'ดอเลาะ', dept: 'IT', pos: 'ครู / หัวหน้างานวิจัยและนวัตกรรม', maxH: 20, maxD: 6, email: 'hawanee@ptnicec.ac.th', uname: 'hawanee' },

            // แผนกการบัญชี
            { empId: 'PTN-008', prefix: 'นางสาว', fname: 'เกษรา', lname: 'พรหมแก้ว', dept: 'ACCT', pos: 'ครู / หัวหน้าสาขาวิชาการบัญชี', maxH: 20, maxD: 6, email: 'kedsara@ptnicec.ac.th', uname: 'kedsara' },
            { empId: 'PTN-009', prefix: 'นางสาว', fname: 'นาตยา', lname: 'วัชรพลางกูร', dept: 'ACCT', pos: 'ครู / สาขาวิชาการบัญชี', maxH: 20, maxD: 6, email: 'nattaya@ptnicec.ac.th', uname: 'nattaya' },

            // แผนกช่างกลโรงงาน
            { empId: 'PTN-010', prefix: 'นาย', fname: 'ประยุทธ', lname: 'โอสถวิสุทธ์', dept: 'MECH', pos: 'ครู / ช่างกลโรงงาน', maxH: 22, maxD: 6, email: 'prayuth@ptnicec.ac.th', uname: 'prayuth' },

            // แผนกช่างอิเล็กทรอนิกส์
            { empId: 'PTN-011', prefix: 'นาย', fname: 'สันติภาพ', lname: 'มะสะ', dept: 'ETRON', pos: 'ครู / หัวหน้าสาขาวิชาช่างอิเล็กทรอนิกส์', maxH: 20, maxD: 6, email: 'santiphap@ptnicec.ac.th', uname: 'santiphap' },

            // แผนกอาหารและโภชนาการ
            { empId: 'PTN-012', prefix: 'นางสาว', fname: 'ศลิษา', lname: 'ศรีสุข', dept: 'FOOD', pos: 'ครู / หัวหน้าสาขาอาหารและโภชนาการ', maxH: 20, maxD: 6, email: 'salisa@ptnicec.ac.th', uname: 'salisa' },

            // แผนกสามัญ-สัมพันธ์
            { empId: 'PTN-013', prefix: 'นาง', fname: 'ตอฮีเราะห์', lname: 'หะยีแวนาแว', dept: 'GEN', pos: 'ครู / หัวหน้าแผนกวิชาสามัญ-สัมพันธ์', maxH: 24, maxD: 6, email: 'toheerah@ptnicec.ac.th', uname: 'toheerah' },
            { empId: 'PTN-014', prefix: 'นางสาว', fname: 'อาฟรีดา', lname: 'ดรอแม', dept: 'GEN', pos: 'ครู (หมวดภาษาไทยและภาษาอังกฤษ)', maxH: 24, maxD: 6, email: 'afrida@ptnicec.ac.th', uname: 'afrida' }
        ];

        const insertTeacher = db.prepare(`
            INSERT OR REPLACE INTO teachers (employee_id, prefix, first_name, last_name, department_id, position, max_hours_per_week, max_hours_per_day, email)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const t of teachers) {
            insertTeacher.run(t.empId, t.prefix, t.fname, t.lname, deptMap[t.dept], t.pos, t.maxH, t.maxD, t.email);
        }

        const teacherMap = {};
        for (const row of db.prepare('SELECT id, employee_id FROM teachers').all()) {
            teacherMap[row.employee_id] = row.id;
        }

        // ผูก user สำหรับล็อกอินของครู
        for (const t of teachers) {
            db.prepare(`
                INSERT OR IGNORE INTO users (username, password_hash, full_name, email, role, teacher_id)
                VALUES (?, ?, ?, ?, 'teacher', ?)
            `).run(t.uname, passTeacher, `${t.prefix}${t.fname} ${t.lname}`, t.email, teacherMap[t.empId]);
        }

        // ================= 7. ห้องเรียนและโรงฝึกงาน (Classrooms) =================
        const classrooms = [
            { code: 'R101', name: 'ห้องเรียนทฤษฎี 101', bld: 'อาคารเรียน 1', fl: 1, cap: 45, type: 'ห้องเรียน', dept: 'GEN' },
            { code: 'R102', name: 'ห้องเรียนทฤษฎี 102', bld: 'อาคารเรียน 1', fl: 1, cap: 45, type: 'ห้องเรียน', dept: 'GEN' },
            { code: 'R201', name: 'ห้องปฏิบัติการคอมพิวเตอร์และสารสนเทศ', bld: 'อาคารวิทยบริการ', fl: 2, cap: 35, type: 'ห้องคอมพิวเตอร์', dept: 'IT' },
            { code: 'R202', name: 'ห้องปฏิบัติการพัฒนาโปรแกรมและดิจิทัล', bld: 'อาคารวิทยบริการ', fl: 2, cap: 35, type: 'ห้องคอมพิวเตอร์', dept: 'IT' },
            { code: 'WS-AUTO', name: 'โรงฝึกงานช่างยนต์และเครื่องกล', bld: 'อาคารปฏิบัติการช่างยนต์', fl: 1, cap: 40, type: 'โรงฝึกงาน', dept: 'AUTO' },
            { code: 'WS-ELEC', name: 'โรงฝึกงานช่างไฟฟ้าและควบคุม', bld: 'อาคารปฏิบัติการช่างไฟฟ้า', fl: 1, cap: 40, type: 'โรงฝึกงาน', dept: 'ELEC' },
            { code: 'WS-MECH', name: 'โรงฝึกงานช่างกลโรงงาน', bld: 'อาคารปฏิบัติการช่างกล', fl: 1, cap: 35, type: 'โรงฝึกงาน', dept: 'MECH' },
            { code: 'LAB-ETRON', name: 'ห้องปฏิบัติการอิเล็กทรอนิกส์', bld: 'อาคารปฏิบัติการช่างอิเล็กทรอนิกส์', fl: 2, cap: 35, type: 'ห้องปฏิบัติการ', dept: 'ETRON' },
            { code: 'LAB-ACCT', name: 'ห้องปฏิบัติการจำลองการบัญชีและภาษี', bld: 'อาคารบริหารธุรกิจ', fl: 3, cap: 40, type: 'ห้องปฏิบัติการ', dept: 'ACCT' },
            { code: 'LAB-FOOD', name: 'ห้องปฏิบัติการอาหารและโภชนาการ', bld: 'อาคารคหกรรมศาสตร์', fl: 1, cap: 30, type: 'ห้องปฏิบัติการ', dept: 'FOOD' }
        ];

        const insertRoom = db.prepare(`
            INSERT OR REPLACE INTO classrooms (code, name, building, floor, capacity, room_type, department_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        for (const r of classrooms) {
            insertRoom.run(r.code, r.name, r.bld, r.fl, r.cap, r.type, deptMap[r.dept]);
        }

        const roomMap = {};
        for (const row of db.prepare('SELECT id, code FROM classrooms').all()) {
            roomMap[row.code] = row.id;
        }

        // ================= 8. คาบเรียน (Time Slots) =================
        const dayNames = ['', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์'];
        const periodTimes = [
            { p: 1, start: '08:30', end: '09:30' },
            { p: 2, start: '09:30', end: '10:30' },
            { p: 3, start: '10:30', end: '11:30' },
            { p: 4, start: '11:30', end: '12:30' },
            { p: 5, start: '13:30', end: '14:30' },
            { p: 6, start: '14:30', end: '15:30' },
            { p: 7, start: '15:30', end: '16:30' },
            { p: 8, start: '16:30', end: '17:30' }
        ];

        db.prepare('DELETE FROM time_slots WHERE semester_id = ?').run(currentSemester.id);
        const insertSlot = db.prepare(`
            INSERT INTO time_slots (day_of_week, day_name, period_number, start_time, end_time, slot_type, semester_id)
            VALUES (?, ?, ?, ?, ?, 'เรียน', ?)
        `);

        for (let day = 1; day <= 5; day++) {
            for (const pt of periodTimes) {
                insertSlot.run(day, dayNames[day], pt.p, pt.start, pt.end, currentSemester.id);
            }
        }

        // ================= 9. รายวิชาตามหลักสูตรวิทยาลัยการอาชีพปัตตานี =================
        const subjects = [
            // หมวดวิชาสามัญ-สัมพันธ์
            { code: '20000-1101', name: 'ภาษาไทยพื้นฐาน', short: 'ไทยพื้นฐาน', cred: 2, th: 2, pr: 0, type: 'ทฤษฎี', lab: 0, dept: 'GEN' },
            { code: '20000-1201', name: 'ภาษาอังกฤษเพื่อการสื่อสาร', short: 'อังกฤษสื่อสาร', cred: 2, th: 2, pr: 0, type: 'ทฤษฎี', lab: 0, dept: 'GEN' },
            { code: '20000-1401', name: 'คณิตศาสตร์พื้นฐานอาชีพ', short: 'คณิตอาชีพ', cred: 2, th: 2, pr: 0, type: 'ทฤษฎี', lab: 0, dept: 'GEN' },
            
            // ช่างยนต์
            { code: '20101-2001', name: 'งานเครื่องยนต์แก๊สโซลีน', short: 'แก๊สโซลีน', cred: 3, th: 1, pr: 4, type: 'ปฏิบัติ', lab: 1, dept: 'AUTO' },
            { code: '20101-2002', name: 'งานเครื่องยนต์ดีเซล', short: 'ดีเซล', cred: 3, th: 1, pr: 4, type: 'ปฏิบัติ', lab: 1, dept: 'AUTO' },

            // ช่างไฟฟ้ากำลัง
            { code: '20104-2001', name: 'วงจรไฟฟ้ากระแสตรง', short: 'วงจรไฟฟ้า DC', cred: 3, th: 1, pr: 4, type: 'ปฏิบัติ', lab: 1, dept: 'ELEC' },
            { code: '20104-2002', name: 'การติดตั้งไฟฟ้าในอาคาร', short: 'ติดตั้งไฟฟ้า', cred: 3, th: 1, pr: 4, type: 'ปฏิบัติ', lab: 1, dept: 'ELEC' },

            // ช่างกลโรงงาน
            { code: '20102-2001', name: 'งานเครื่องมือกลเบื้องต้น', short: 'เครื่องมือกล', cred: 3, th: 1, pr: 4, type: 'ปฏิบัติ', lab: 1, dept: 'MECH' },

            // ช่างอิเล็กทรอนิกส์
            { code: '20105-2001', name: 'อุปกรณ์อิเล็กทรอนิกส์และวงจร', short: 'อุปกรณ์อิเล็กฯ', cred: 3, th: 1, pr: 4, type: 'ปฏิบัติ', lab: 1, dept: 'ETRON' },

            // เทคโนโลยีสารสนเทศ
            { code: '21901-2001', name: 'การเขียนโปรแกรมคอมพิวเตอร์', short: 'เขียนโปรแกรม', cred: 3, th: 1, pr: 3, type: 'ปฏิบัติ', lab: 1, dept: 'IT' },
            { code: '21901-2002', name: 'ระบบจัดการฐานข้อมูล', short: 'ระบบฐานข้อมูล', cred: 3, th: 2, pr: 2, type: 'ทฤษฎีและปฏิบัติ', lab: 1, dept: 'IT' },

            // การบัญชี
            { code: '20201-2001', name: 'การบัญชีเบื้องต้น 1', short: 'บัญชีเบื้องต้น 1', cred: 3, th: 2, pr: 2, type: 'ทฤษฎีและปฏิบัติ', lab: 0, dept: 'ACCT' },
            { code: '20201-2002', name: 'การบัญชีเบื้องต้น 2', short: 'บัญชีเบื้องต้น 2', cred: 3, th: 2, pr: 2, type: 'ทฤษฎีและปฏิบัติ', lab: 0, dept: 'ACCT' },

            // อาหารและโภชนาการ
            { code: '20404-2001', name: 'หลักการเตรียมและการประกอบอาหาร', short: 'เตรียมอาหาร', cred: 3, th: 1, pr: 4, type: 'ปฏิบัติ', lab: 1, dept: 'FOOD' }
        ];

        const insertSubj = db.prepare(`
            INSERT OR REPLACE INTO subjects (code, name, short_name, credits, theory_hours, practice_hours, total_hours, subject_type, requires_lab, department_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const s of subjects) {
            insertSubj.run(s.code, s.name, s.short, s.cred, s.th, s.pr, s.th + s.pr, s.type, s.lab, deptMap[s.dept]);
        }

        const subjMap = {};
        for (const row of db.prepare('SELECT id, code FROM subjects').all()) {
            subjMap[row.code] = row.id;
        }

        // ================= 10. ช่วงเวลาไม่ว่างของครู (Teacher Availability) =================
        // ครูที่เป็นมุสลิม มีภารกิจประกอบศาสนกิจวันศุกร์ (ละหมาดญุมอะฮ์) บ่ายวันศุกร์ คาบ 5-6
        const fridayAfternoonSlots = db.prepare(`
            SELECT id FROM time_slots 
            WHERE semester_id = ? AND day_of_week = 5 AND period_number IN (5, 6)
        `).all(currentSemester.id);

        const insertAvail = db.prepare(`
            INSERT OR REPLACE INTO teacher_availability (teacher_id, time_slot_id, semester_id, is_available, reason)
            VALUES (?, ?, ?, 0, ?)
        `);

        // ครูที่ไปละหมาดวันศุกร์
        const fridayPrayerTeachers = ['PTN-001', 'PTN-002', 'PTN-004', 'PTN-006', 'PTN-007', 'PTN-011', 'PTN-013', 'PTN-014'];
        for (const tCode of fridayPrayerTeachers) {
            if (teacherMap[tCode]) {
                for (const slot of fridayAfternoonSlots) {
                    insertAvail.run(teacherMap[tCode], slot.id, currentSemester.id, 'ประกอบศาสนกิจวันศุกร์ (ละหมาดญุมอะฮ์)');
                }
            }
        }

        // ================= 11. มอบหมายการสอน (Teaching Assignments) =================
        const assignments = [
            // ชย.67.1 (ปวช.1 ช่างยนต์)
            { teacher: 'PTN-001', subj: '20101-2001', grp: 'ชย.67.1', hours: 4, room: 'WS-AUTO', notes: 'ครูนราธร ปฏิบัติการเครื่องยนต์' },
            { teacher: 'PTN-013', subj: '20000-1101', grp: 'ชย.67.1', hours: 2, room: 'R101', notes: 'ครูตอฮีเราะห์ ภาษาไทย' },
            { teacher: 'PTN-014', subj: '20000-1201', grp: 'ชย.67.1', hours: 2, room: 'R101', notes: 'ครูอาฟรีดา ภาษาอังกฤษ' },

            // ชฟ.67.1 (ปวช.1 ช่างไฟฟ้ากำลัง)
            { teacher: 'PTN-003', subj: '20104-2001', grp: 'ชฟ.67.1', hours: 4, room: 'WS-ELEC', notes: 'ครูธวัชชัย วงจรไฟฟ้า DC' },
            { teacher: 'PTN-004', subj: '20104-2002', grp: 'ชฟ.67.1', hours: 4, room: 'WS-ELEC', notes: 'ครูอภิมุข ติดตั้งไฟฟ้า' },
            { teacher: 'PTN-013', subj: '20000-1101', grp: 'ชฟ.67.1', hours: 2, room: 'R102', notes: 'ครูตอฮีเราะห์ ภาษาไทย' },

            // ชก.67.1 (ปวช.1 ช่างกลโรงงาน)
            { teacher: 'PTN-010', subj: '20102-2001', grp: 'ชก.67.1', hours: 4, room: 'WS-MECH', notes: 'ครูประยุทธ เครื่องมือกล' },
            { teacher: 'PTN-014', subj: '20000-1201', grp: 'ชก.67.1', hours: 2, room: 'R102', notes: 'ครูอาฟรีดา ภาษาอังกฤษ' },

            // ชอ.67.1 (ปวช.1 ช่างอิเล็กทรอนิกส์)
            { teacher: 'PTN-011', subj: '20105-2001', grp: 'ชอ.67.1', hours: 4, room: 'LAB-ETRON', notes: 'ครูสันติภาพ อิเล็กทรอนิกส์' },
            { teacher: 'PTN-013', subj: '20000-1101', grp: 'ชอ.67.1', hours: 2, room: 'R101', notes: 'ครูตอฮีเราะห์ ภาษาไทย' },

            // ทส.67.1 (ปวช.1 เทคโนโลยีสารสนเทศ)
            { teacher: 'PTN-006', subj: '21901-2001', grp: 'ทส.67.1', hours: 4, room: 'R201', notes: 'ครูธีระ เขียนโปรแกรมคอมพิวเตอร์' },
            { teacher: 'PTN-007', subj: '21901-2002', grp: 'ทส.67.1', hours: 4, room: 'R202', notes: 'ครูฮาวาณี ระบบฐานข้อมูล' },
            { teacher: 'PTN-014', subj: '20000-1201', grp: 'ทส.67.1', hours: 2, room: 'R101', notes: 'ครูอาฟรีดา ภาษาอังกฤษ' },

            // บช.67.1 (ปวช.1 การบัญชี)
            { teacher: 'PTN-008', subj: '20201-2001', grp: 'บช.67.1', hours: 4, room: 'LAB-ACCT', notes: 'ครูเกษรา การบัญชีเบื้องต้น 1' },
            { teacher: 'PTN-009', subj: '20201-2002', grp: 'บช.67.1', hours: 4, room: 'LAB-ACCT', notes: 'ครูนาตยา การบัญชีเบื้องต้น 2' },
            { teacher: 'PTN-013', subj: '20000-1101', grp: 'บช.67.1', hours: 2, room: 'R102', notes: 'ครูตอฮีเราะห์ ภาษาไทย' },

            // อภ.67.1 (ปวช.1 อาหารและโภชนาการ)
            { teacher: 'PTN-012', subj: '20404-2001', grp: 'อภ.67.1', hours: 4, room: 'LAB-FOOD', notes: 'ครูศลิษา การเตรียมอาหาร' },
            { teacher: 'PTN-014', subj: '20000-1201', grp: 'อภ.67.1', hours: 2, room: 'R102', notes: 'ครูอาฟรีดา ภาษาอังกฤษ' },

            // ทส.66.1 (ปวช.2 เทคโนโลยีสารสนเทศ)
            { teacher: 'PTN-006', subj: '21901-2002', grp: 'ทส.66.1', hours: 4, room: 'R201', notes: 'ครูธีระ ฐานข้อมูลขั้นสูง' },
            { teacher: 'PTN-007', subj: '21901-2001', grp: 'ทส.66.1', hours: 4, room: 'R202', notes: 'ครูฮาวาณี การเขียนโปรแกรมประยุกต์' }
        ];

        db.prepare('DELETE FROM teaching_assignments WHERE semester_id = ?').run(currentSemester.id);
        const insertAssign = db.prepare(`
            INSERT INTO teaching_assignments (teacher_id, subject_id, student_group_id, semester_id, hours_per_week, preferred_room_id, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        for (const a of assignments) {
            insertAssign.run(
                teacherMap[a.teacher],
                subjMap[a.subj],
                groupMap[a.grp],
                currentSemester.id,
                a.hours,
                a.room ? roomMap[a.room] : null,
                a.notes
            );
        }

        // ================= 12. อัปเดตตารางสอนฉบับร่างเริ่มต้น (Draft Version 1) =================
        const existingVer = db.prepare('SELECT id FROM timetable_versions WHERE semester_id = ? AND version_number = 1').get(currentSemester.id);
        if (!existingVer) {
            const adminUser = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
            db.prepare(`
                INSERT INTO timetable_versions (semester_id, version_number, name, status, notes, created_by)
                VALUES (?, 1, 'ตารางสอน ภาคเรียนที่ 1/2567 (ข้อมูลจริง วอศ.ปัตตานี)', 'draft', 'อ้างอิงรายชื่อบุคลากรและหลักสูตรจาก www.ptnicec.ac.th', ?)
            `).run(currentSemester.id, adminUser?.id || 1);
        } else {
            db.prepare(`
                UPDATE timetable_versions 
                SET name = 'ตารางสอน ภาคเรียนที่ 1/2567 (ข้อมูลจริง วอศ.ปัตตานี)',
                    notes = 'อ้างอิงรายชื่อบุคลากรและหลักสูตรจาก www.ptnicec.ac.th'
                WHERE id = ?
            `).run(existingVer.id);
        }

        console.log('✅ นำเข้าข้อมูลบุคลากรและรายวิชาจาก www.ptnicec.ac.th สำเร็จเรียบร้อย');
    });

    seedTx();
    closeDb();
}

if (require.main === module) {
    runSeed();
}

module.exports = runSeed;
