-- =====================================================
-- ระบบจัดตารางสอนอัตโนมัติ วิทยาลัยการอาชีพปัตตานี
-- Database Schema for SQLite
-- =====================================================

-- เปิดใช้งาน Foreign Keys
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- =====================================================
-- 1. ตารางผู้ใช้งาน (Users)
-- =====================================================
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    email TEXT,
    role TEXT NOT NULL CHECK(role IN ('admin', 'academic', 'teacher', 'student')),
    teacher_id INTEGER,
    student_group_id INTEGER,
    is_active INTEGER NOT NULL DEFAULT 1,
    last_login TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE SET NULL,
    FOREIGN KEY (student_group_id) REFERENCES student_groups(id) ON DELETE SET NULL
);

-- =====================================================
-- 2. ตารางปีการศึกษา (Academic Years)
-- =====================================================
CREATE TABLE IF NOT EXISTS academic_years (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    year INTEGER NOT NULL,
    is_current INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_academic_years_year ON academic_years(year);

-- =====================================================
-- 3. ตารางภาคเรียน (Semesters)
-- =====================================================
CREATE TABLE IF NOT EXISTS semesters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    academic_year_id INTEGER NOT NULL,
    semester_number INTEGER NOT NULL CHECK(semester_number IN (1, 2, 3)),
    name TEXT NOT NULL,
    start_date TEXT,
    end_date TEXT,
    is_current INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE CASCADE,
    UNIQUE(academic_year_id, semester_number)
);

-- =====================================================
-- 4. ตารางแผนกวิชา (Departments)
-- =====================================================
CREATE TABLE IF NOT EXISTS departments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- =====================================================
-- 5. ตารางหลักสูตร (Programs)
-- =====================================================
CREATE TABLE IF NOT EXISTS programs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    level TEXT NOT NULL CHECK(level IN ('ปวช.', 'ปวส.')),
    department_id INTEGER NOT NULL,
    duration_years INTEGER NOT NULL DEFAULT 3,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE RESTRICT
);

-- =====================================================
-- 6. ตารางกลุ่มเรียน (Student Groups)
-- =====================================================
CREATE TABLE IF NOT EXISTS student_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    program_id INTEGER NOT NULL,
    year_level INTEGER NOT NULL CHECK(year_level BETWEEN 1 AND 4),
    group_number INTEGER NOT NULL DEFAULT 1,
    student_count INTEGER NOT NULL DEFAULT 0,
    semester_id INTEGER NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE RESTRICT,
    FOREIGN KEY (semester_id) REFERENCES semesters(id) ON DELETE RESTRICT,
    UNIQUE(code, semester_id)
);

-- =====================================================
-- 7. ตารางครูผู้สอน (Teachers)
-- =====================================================
CREATE TABLE IF NOT EXISTS teachers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id TEXT NOT NULL UNIQUE,
    prefix TEXT NOT NULL DEFAULT '',
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    department_id INTEGER,
    position TEXT,
    phone TEXT,
    email TEXT,
    max_hours_per_week INTEGER NOT NULL DEFAULT 20,
    max_hours_per_day INTEGER NOT NULL DEFAULT 6,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL
);

-- =====================================================
-- 8. ตารางรายวิชา (Subjects)
-- =====================================================
CREATE TABLE IF NOT EXISTS subjects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    short_name TEXT,
    credits REAL NOT NULL DEFAULT 0,
    theory_hours INTEGER NOT NULL DEFAULT 0,
    practice_hours INTEGER NOT NULL DEFAULT 0,
    total_hours INTEGER NOT NULL DEFAULT 0,
    subject_type TEXT NOT NULL DEFAULT 'ทฤษฎี' CHECK(subject_type IN ('ทฤษฎี', 'ปฏิบัติ', 'ทฤษฎีและปฏิบัติ')),
    requires_lab INTEGER NOT NULL DEFAULT 0,
    department_id INTEGER,
    program_id INTEGER,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
    FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_subjects_code ON subjects(code);

-- =====================================================
-- 9. ตารางห้องเรียน (Classrooms)
-- =====================================================
CREATE TABLE IF NOT EXISTS classrooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    building TEXT,
    floor INTEGER,
    capacity INTEGER NOT NULL DEFAULT 40,
    room_type TEXT NOT NULL DEFAULT 'ห้องเรียน' CHECK(room_type IN ('ห้องเรียน', 'ห้องปฏิบัติการ', 'โรงฝึกงาน', 'ห้องคอมพิวเตอร์', 'อื่นๆ')),
    department_id INTEGER,
    facilities TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL
);

-- =====================================================
-- 10. ตารางคาบเรียน (Time Slots)
-- =====================================================
CREATE TABLE IF NOT EXISTS time_slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day_of_week INTEGER NOT NULL CHECK(day_of_week BETWEEN 1 AND 7),
    day_name TEXT NOT NULL,
    period_number INTEGER NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    slot_type TEXT NOT NULL DEFAULT 'เรียน' CHECK(slot_type IN ('เรียน', 'พัก', 'กิจกรรม', 'โฮมรูม')),
    is_active INTEGER NOT NULL DEFAULT 1,
    semester_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (semester_id) REFERENCES semesters(id) ON DELETE CASCADE,
    UNIQUE(day_of_week, period_number, semester_id)
);
CREATE INDEX IF NOT EXISTS idx_time_slots_day ON time_slots(day_of_week);

-- =====================================================
-- 11. ตารางช่วงเวลาที่ครูไม่ว่าง (Teacher Availability)
-- =====================================================
CREATE TABLE IF NOT EXISTS teacher_availability (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_id INTEGER NOT NULL,
    time_slot_id INTEGER NOT NULL,
    is_available INTEGER NOT NULL DEFAULT 0,
    reason TEXT,
    semester_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE,
    FOREIGN KEY (time_slot_id) REFERENCES time_slots(id) ON DELETE CASCADE,
    FOREIGN KEY (semester_id) REFERENCES semesters(id) ON DELETE CASCADE,
    UNIQUE(teacher_id, time_slot_id, semester_id)
);

-- =====================================================
-- 12. ตารางมอบหมายการสอน (Teaching Assignments)
-- =====================================================
CREATE TABLE IF NOT EXISTS teaching_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_id INTEGER NOT NULL,
    subject_id INTEGER NOT NULL,
    student_group_id INTEGER NOT NULL,
    semester_id INTEGER NOT NULL,
    hours_per_week INTEGER NOT NULL DEFAULT 1,
    preferred_room_id INTEGER,
    notes TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE,
    FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
    FOREIGN KEY (student_group_id) REFERENCES student_groups(id) ON DELETE CASCADE,
    FOREIGN KEY (semester_id) REFERENCES semesters(id) ON DELETE CASCADE,
    FOREIGN KEY (preferred_room_id) REFERENCES classrooms(id) ON DELETE SET NULL,
    UNIQUE(teacher_id, subject_id, student_group_id, semester_id)
);

-- =====================================================
-- 13. ตารางเวอร์ชันตารางสอน (Timetable Versions)
-- =====================================================
CREATE TABLE IF NOT EXISTS timetable_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    semester_id INTEGER NOT NULL,
    version_number INTEGER NOT NULL DEFAULT 1,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'review', 'approved', 'published', 'archived')),
    quality_score REAL,
    total_scheduled INTEGER DEFAULT 0,
    total_unscheduled INTEGER DEFAULT 0,
    total_conflicts INTEGER DEFAULT 0,
    notes TEXT,
    created_by INTEGER,
    approved_by INTEGER,
    published_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (semester_id) REFERENCES semesters(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE(semester_id, version_number)
);

-- =====================================================
-- 14. ตารางสอน (Timetable Entries)
-- =====================================================
CREATE TABLE IF NOT EXISTS timetable_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version_id INTEGER NOT NULL,
    teaching_assignment_id INTEGER NOT NULL,
    time_slot_id INTEGER NOT NULL,
    classroom_id INTEGER NOT NULL,
    is_locked INTEGER NOT NULL DEFAULT 0,
    is_manual INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (version_id) REFERENCES timetable_versions(id) ON DELETE CASCADE,
    FOREIGN KEY (teaching_assignment_id) REFERENCES teaching_assignments(id) ON DELETE CASCADE,
    FOREIGN KEY (time_slot_id) REFERENCES time_slots(id) ON DELETE CASCADE,
    FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_timetable_version ON timetable_entries(version_id);
CREATE INDEX IF NOT EXISTS idx_timetable_timeslot ON timetable_entries(time_slot_id);
CREATE INDEX IF NOT EXISTS idx_timetable_classroom ON timetable_entries(classroom_id);
CREATE INDEX IF NOT EXISTS idx_timetable_assignment ON timetable_entries(teaching_assignment_id);

-- =====================================================
-- 15. ตารางบันทึกการจัดตาราง (Scheduling Runs)
-- =====================================================
CREATE TABLE IF NOT EXISTS scheduling_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running', 'completed', 'failed', 'cancelled')),
    algorithm TEXT DEFAULT 'CSP-Backtracking',
    total_assignments INTEGER DEFAULT 0,
    scheduled_count INTEGER DEFAULT 0,
    unscheduled_count INTEGER DEFAULT 0,
    conflict_count INTEGER DEFAULT 0,
    quality_score REAL DEFAULT 0,
    duration_ms INTEGER DEFAULT 0,
    log TEXT,
    error_message TEXT,
    settings TEXT,
    started_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    completed_at TEXT,
    created_by INTEGER,
    FOREIGN KEY (version_id) REFERENCES timetable_versions(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- =====================================================
-- 16. ตารางบันทึกการแก้ไข (Audit Logs)
-- =====================================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id INTEGER,
    old_value TEXT,
    new_value TEXT,
    ip_address TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);

-- =====================================================
-- 17. ตารางการตั้งค่าระบบ (System Settings)
-- =====================================================
CREATE TABLE IF NOT EXISTS system_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    setting_key TEXT NOT NULL UNIQUE,
    setting_value TEXT,
    description TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- =====================================================
-- 18. ตารางการตั้งค่า Soft Constraints (Scheduling Preferences)
-- =====================================================
CREATE TABLE IF NOT EXISTS scheduling_preferences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    semester_id INTEGER NOT NULL,
    preference_key TEXT NOT NULL,
    preference_value REAL NOT NULL DEFAULT 1.0,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (semester_id) REFERENCES semesters(id) ON DELETE CASCADE,
    UNIQUE(semester_id, preference_key)
);

-- =====================================================
-- 19. ตารางคำขอเปลี่ยนตาราง (Schedule Change Requests)
-- =====================================================
CREATE TABLE IF NOT EXISTS schedule_change_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_id INTEGER NOT NULL,
    version_id INTEGER NOT NULL,
    timetable_entry_id INTEGER,
    request_type TEXT NOT NULL CHECK(request_type IN ('swap', 'move', 'cancel', 'other')),
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
    response_note TEXT,
    responded_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE,
    FOREIGN KEY (version_id) REFERENCES timetable_versions(id) ON DELETE CASCADE,
    FOREIGN KEY (timetable_entry_id) REFERENCES timetable_entries(id) ON DELETE SET NULL,
    FOREIGN KEY (responded_by) REFERENCES users(id) ON DELETE SET NULL
);
