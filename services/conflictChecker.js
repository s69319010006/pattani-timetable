// =====================================================
// conflictChecker.js - ตรวจสอบความขัดแย้งของตารางสอน
// =====================================================

class ConflictChecker {
    constructor(db) {
        this.db = db;
    }

    /**
     * ตรวจสอบทุกข้อขัดแย้งในเวอร์ชันตาราง
     */
    checkAllConflicts(versionId) {
        const conflicts = [];
        
        conflicts.push(...this.checkTeacherConflicts(versionId));
        conflicts.push(...this.checkRoomConflicts(versionId));
        conflicts.push(...this.checkGroupConflicts(versionId));
        conflicts.push(...this.checkAvailabilityConflicts(versionId));
        conflicts.push(...this.checkCapacityConflicts(versionId));
        conflicts.push(...this.checkLabRequirementConflicts(versionId));
        
        return {
            totalConflicts: conflicts.length,
            hardConflicts: conflicts.filter(c => c.severity === 'hard').length,
            softConflicts: conflicts.filter(c => c.severity === 'soft').length,
            conflicts: conflicts
        };
    }

    /**
     * ตรวจสอบครูสอนซ้อนเวลา
     */
    checkTeacherConflicts(versionId) {
        const conflicts = [];
        const entries = this.db.prepare(`
            SELECT te.id, te.time_slot_id, ta.teacher_id,
                   t.first_name || ' ' || t.last_name as teacher_name,
                   s.code as subject_code, s.name as subject_name,
                   ts.day_name, ts.period_number, ts.start_time, ts.end_time,
                   sg.name as group_name
            FROM timetable_entries te
            JOIN teaching_assignments ta ON te.teaching_assignment_id = ta.id
            JOIN teachers t ON ta.teacher_id = t.id
            JOIN subjects s ON ta.subject_id = s.id
            JOIN time_slots ts ON te.time_slot_id = ts.id
            JOIN student_groups sg ON ta.student_group_id = sg.id
            WHERE te.version_id = ?
            ORDER BY ta.teacher_id, ts.day_of_week, ts.period_number
        `).all(versionId);

        // จัดกลุ่มตามครูและเวลา
        const teacherSlots = {};
        for (const entry of entries) {
            const key = `${entry.teacher_id}-${entry.time_slot_id}`;
            if (!teacherSlots[key]) {
                teacherSlots[key] = [];
            }
            teacherSlots[key].push(entry);
        }

        for (const [key, group] of Object.entries(teacherSlots)) {
            if (group.length > 1) {
                conflicts.push({
                    type: 'teacher_conflict',
                    severity: 'hard',
                    message: `ครู ${group[0].teacher_name} สอนซ้อนเวลา ${group[0].day_name} คาบ ${group[0].period_number} (${group[0].start_time}-${group[0].end_time})`,
                    details: group.map(e => `${e.subject_code} ${e.subject_name} (${e.group_name})`),
                    entryIds: group.map(e => e.id)
                });
            }
        }
        return conflicts;
    }

    /**
     * ตรวจสอบห้องเรียนซ้ำ
     */
    checkRoomConflicts(versionId) {
        const conflicts = [];
        const entries = this.db.prepare(`
            SELECT te.id, te.time_slot_id, te.classroom_id,
                   c.name as classroom_name, c.code as classroom_code,
                   s.code as subject_code, s.name as subject_name,
                   t.first_name || ' ' || t.last_name as teacher_name,
                   ts.day_name, ts.period_number, ts.start_time, ts.end_time,
                   sg.name as group_name
            FROM timetable_entries te
            JOIN teaching_assignments ta ON te.teaching_assignment_id = ta.id
            JOIN classrooms c ON te.classroom_id = c.id
            JOIN subjects s ON ta.subject_id = s.id
            JOIN teachers t ON ta.teacher_id = t.id
            JOIN time_slots ts ON te.time_slot_id = ts.id
            JOIN student_groups sg ON ta.student_group_id = sg.id
            WHERE te.version_id = ?
            ORDER BY te.classroom_id, ts.day_of_week, ts.period_number
        `).all(versionId);

        const roomSlots = {};
        for (const entry of entries) {
            const key = `${entry.classroom_id}-${entry.time_slot_id}`;
            if (!roomSlots[key]) {
                roomSlots[key] = [];
            }
            roomSlots[key].push(entry);
        }

        for (const [key, group] of Object.entries(roomSlots)) {
            if (group.length > 1) {
                conflicts.push({
                    type: 'room_conflict',
                    severity: 'hard',
                    message: `ห้อง ${group[0].classroom_name} ถูกใช้ซ้ำ ${group[0].day_name} คาบ ${group[0].period_number} (${group[0].start_time}-${group[0].end_time})`,
                    details: group.map(e => `${e.subject_code} - ${e.teacher_name} (${e.group_name})`),
                    entryIds: group.map(e => e.id)
                });
            }
        }
        return conflicts;
    }

    /**
     * ตรวจสอบกลุ่มเรียนชนกัน
     */
    checkGroupConflicts(versionId) {
        const conflicts = [];
        const entries = this.db.prepare(`
            SELECT te.id, te.time_slot_id, ta.student_group_id,
                   sg.name as group_name,
                   s.code as subject_code, s.name as subject_name,
                   t.first_name || ' ' || t.last_name as teacher_name,
                   ts.day_name, ts.period_number
            FROM timetable_entries te
            JOIN teaching_assignments ta ON te.teaching_assignment_id = ta.id
            JOIN student_groups sg ON ta.student_group_id = sg.id
            JOIN subjects s ON ta.subject_id = s.id
            JOIN teachers t ON ta.teacher_id = t.id
            JOIN time_slots ts ON te.time_slot_id = ts.id
            WHERE te.version_id = ?
            ORDER BY ta.student_group_id, ts.day_of_week, ts.period_number
        `).all(versionId);

        const groupSlots = {};
        for (const entry of entries) {
            const key = `${entry.student_group_id}-${entry.time_slot_id}`;
            if (!groupSlots[key]) {
                groupSlots[key] = [];
            }
            groupSlots[key].push(entry);
        }

        for (const [key, group] of Object.entries(groupSlots)) {
            if (group.length > 1) {
                conflicts.push({
                    type: 'group_conflict',
                    severity: 'hard',
                    message: `กลุ่มเรียน ${group[0].group_name} เรียนซ้อนกัน ${group[0].day_name} คาบ ${group[0].period_number}`,
                    details: group.map(e => `${e.subject_code} ${e.subject_name} (${e.teacher_name})`),
                    entryIds: group.map(e => e.id)
                });
            }
        }
        return conflicts;
    }

    /**
     * ตรวจสอบครูถูกจัดในเวลาที่ไม่ว่าง
     */
    checkAvailabilityConflicts(versionId) {
        const conflicts = [];
        const entries = this.db.prepare(`
            SELECT te.id, ta.teacher_id,
                   t.first_name || ' ' || t.last_name as teacher_name,
                   s.code as subject_code, s.name as subject_name,
                   ts.day_name, ts.period_number,
                   tav.reason
            FROM timetable_entries te
            JOIN teaching_assignments ta ON te.teaching_assignment_id = ta.id
            JOIN teachers t ON ta.teacher_id = t.id
            JOIN subjects s ON ta.subject_id = s.id
            JOIN time_slots ts ON te.time_slot_id = ts.id
            JOIN teacher_availability tav ON tav.teacher_id = ta.teacher_id 
                AND tav.time_slot_id = te.time_slot_id
                AND tav.is_available = 0
            WHERE te.version_id = ?
        `).all(versionId);

        for (const entry of entries) {
            conflicts.push({
                type: 'availability_conflict',
                severity: 'hard',
                message: `ครู ${entry.teacher_name} ถูกจัดสอน ${entry.subject_code} ใน ${entry.day_name} คาบ ${entry.period_number} แต่ระบุว่าไม่ว่าง`,
                details: [entry.reason || 'ไม่ระบุเหตุผล'],
                entryIds: [entry.id]
            });
        }
        return conflicts;
    }

    /**
     * ตรวจสอบความจุห้องเรียน
     */
    checkCapacityConflicts(versionId) {
        const conflicts = [];
        const entries = this.db.prepare(`
            SELECT te.id, c.name as classroom_name, c.capacity,
                   sg.name as group_name, sg.student_count,
                   s.name as subject_name,
                   ts.day_name, ts.period_number
            FROM timetable_entries te
            JOIN teaching_assignments ta ON te.teaching_assignment_id = ta.id
            JOIN classrooms c ON te.classroom_id = c.id
            JOIN student_groups sg ON ta.student_group_id = sg.id
            JOIN subjects s ON ta.subject_id = s.id
            JOIN time_slots ts ON te.time_slot_id = ts.id
            WHERE te.version_id = ? AND sg.student_count > c.capacity
        `).all(versionId);

        for (const entry of entries) {
            conflicts.push({
                type: 'capacity_conflict',
                severity: 'soft',
                message: `ห้อง ${entry.classroom_name} (จุ ${entry.capacity} คน) ไม่เพียงพอสำหรับ ${entry.group_name} (${entry.student_count} คน)`,
                details: [`${entry.subject_name} - ${entry.day_name} คาบ ${entry.period_number}`],
                entryIds: [entry.id]
            });
        }
        return conflicts;
    }

    /**
     * ตรวจสอบวิชาปฏิบัติได้ห้องที่เหมาะสม
     */
    checkLabRequirementConflicts(versionId) {
        const conflicts = [];
        const entries = this.db.prepare(`
            SELECT te.id, s.name as subject_name, s.code as subject_code,
                   c.name as classroom_name, c.room_type,
                   ts.day_name, ts.period_number,
                   sg.name as group_name
            FROM timetable_entries te
            JOIN teaching_assignments ta ON te.teaching_assignment_id = ta.id
            JOIN subjects s ON ta.subject_id = s.id
            JOIN classrooms c ON te.classroom_id = c.id
            JOIN time_slots ts ON te.time_slot_id = ts.id
            JOIN student_groups sg ON ta.student_group_id = sg.id
            WHERE te.version_id = ? AND s.requires_lab = 1 AND c.room_type = 'ห้องเรียน'
        `).all(versionId);

        for (const entry of entries) {
            conflicts.push({
                type: 'lab_requirement_conflict',
                severity: 'hard',
                message: `วิชา ${entry.subject_code} ${entry.subject_name} ต้องใช้ห้องปฏิบัติการ แต่ถูกจัดในห้องเรียนปกติ (${entry.classroom_name})`,
                details: [`${entry.group_name} - ${entry.day_name} คาบ ${entry.period_number}`],
                entryIds: [entry.id]
            });
        }
        return conflicts;
    }

    /**
     * ตรวจสอบข้อขัดแย้งสำหรับ entry เดียว (ใช้ตอน manual edit)
     */
    checkSingleEntryConflicts(versionId, timeSlotId, classroomId, teacherId, studentGroupId, excludeEntryId = null) {
        const conflicts = [];
        
        let excludeClause = '';
        const params = [versionId, timeSlotId];
        if (excludeEntryId) {
            excludeClause = ' AND te.id != ?';
            params.push(excludeEntryId);
        }

        // ตรวจสอบความไม่ว่างของครู (Teacher Unavailability - ห้ามเด็ดขาด)
        const unavail = this.db.prepare(`
            SELECT tav.reason, ts.day_name, ts.period_number,
                   t.first_name || ' ' || t.last_name as teacher_name
            FROM teacher_availability tav
            JOIN time_slots ts ON tav.time_slot_id = ts.id
            JOIN teachers t ON tav.teacher_id = t.id
            WHERE tav.teacher_id = ? AND tav.time_slot_id = ? AND tav.is_available = 0
        `).get(teacherId, timeSlotId);

        if (unavail) {
            conflicts.push({
                type: 'teacher_unavailability',
                severity: 'hard',
                is_unavailability: true,
                message: `ครู ${unavail.teacher_name} ระบุว่าไม่ว่างใน ${unavail.day_name} คาบ ${unavail.period_number} (${unavail.reason || 'ติดภารกิจ/ละหมาดวันศุกร์'})`
            });
        }

        // ตรวจครูชน
        const teacherConflict = this.db.prepare(`
            SELECT te.id, s.name as subject_name, sg.name as group_name
            FROM timetable_entries te
            JOIN teaching_assignments ta ON te.teaching_assignment_id = ta.id
            JOIN subjects s ON ta.subject_id = s.id
            JOIN student_groups sg ON ta.student_group_id = sg.id
            WHERE te.version_id = ? AND te.time_slot_id = ? ${excludeClause}
            AND ta.teacher_id = ?
        `).all(...params, teacherId);

        if (teacherConflict.length > 0) {
            conflicts.push({
                type: 'teacher_conflict',
                severity: 'hard',
                message: `ครูสอนซ้อนเวลากับ ${teacherConflict.map(c => `${c.subject_name} (${c.group_name})`).join(', ')}`
            });
        }

        // ตรวจห้องชน
        const roomConflict = this.db.prepare(`
            SELECT te.id, s.name as subject_name, sg.name as group_name
            FROM timetable_entries te
            JOIN teaching_assignments ta ON te.teaching_assignment_id = ta.id
            JOIN subjects s ON ta.subject_id = s.id
            JOIN student_groups sg ON ta.student_group_id = sg.id
            WHERE te.version_id = ? AND te.time_slot_id = ? ${excludeClause}
            AND te.classroom_id = ?
        `).all(...params, classroomId);

        if (roomConflict.length > 0) {
            conflicts.push({
                type: 'room_conflict',
                severity: 'hard',
                message: `ห้องเรียนถูกใช้แล้วโดย ${roomConflict.map(c => `${c.subject_name} (${c.group_name})`).join(', ')}`
            });
        }

        // ตรวจกลุ่มเรียนชน
        const groupConflict = this.db.prepare(`
            SELECT te.id, s.name as subject_name
            FROM timetable_entries te
            JOIN teaching_assignments ta ON te.teaching_assignment_id = ta.id
            JOIN subjects s ON ta.subject_id = s.id
            WHERE te.version_id = ? AND te.time_slot_id = ? ${excludeClause}
            AND ta.student_group_id = ?
        `).all(...params, studentGroupId);

        if (groupConflict.length > 0) {
            conflicts.push({
                type: 'group_conflict',
                severity: 'hard',
                message: `กลุ่มเรียนเรียนซ้อนเวลากับ ${groupConflict.map(c => c.subject_name).join(', ')}`
            });
        }

        // ตรวจความต้องการห้องปฏิบัติการ (Lab Requirement)
        const room = this.db.prepare('SELECT name, room_type, capacity FROM classrooms WHERE id = ?').get(classroomId);
        const assignment = this.db.prepare(`
            SELECT s.code as subject_code, s.name as subject_name, s.requires_lab, sg.student_count, sg.name as group_name
            FROM teaching_assignments ta
            JOIN subjects s ON ta.subject_id = s.id
            JOIN student_groups sg ON ta.student_group_id = sg.id
            WHERE ta.teacher_id = ? AND ta.student_group_id = ?
        `).get(teacherId, studentGroupId);

        if (room && assignment) {
            if (assignment.requires_lab === 1 && room.room_type === 'ห้องเรียน') {
                conflicts.push({
                    type: 'lab_requirement_conflict',
                    severity: 'hard',
                    message: `วิชา ${assignment.subject_code} ${assignment.subject_name} ต้องใช้ห้องปฏิบัติการ/โรงฝึกงาน แต่ห้อง ${room.name} เป็นห้องเรียนปกติ`
                });
            }

            if (assignment.student_count > room.capacity) {
                conflicts.push({
                    type: 'capacity_conflict',
                    severity: 'soft',
                    message: `ห้อง ${room.name} (จุได้ ${room.capacity} คน) ไม่เพียงพอสำหรับ ${assignment.group_name} (${assignment.student_count} คน)`
                });
            }
        }

        return conflicts;
    }
}

module.exports = ConflictChecker;
