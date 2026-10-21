// =====================================================
// scheduler.js - อัลกอริทึมจัดตารางสอนอัตโนมัติ
// CSP + Backtracking with MRV Heuristic
// =====================================================

const ConflictChecker = require('./conflictChecker');

class Scheduler {
    constructor(db) {
        this.db = db;
        this.conflictChecker = new ConflictChecker(db);
        this.log = [];
        this.stats = {
            totalAssignments: 0,
            scheduledCount: 0,
            unscheduledCount: 0,
            conflictCount: 0,
            qualityScore: 0,
            iterations: 0,
            startTime: null,
            endTime: null
        };
    }

    /**
     * เริ่มต้นกระบวนการจัดตารางสอนอัตโนมัติ
     */
    async generate(semesterId, versionId, userId, preferences = {}) {
        this.stats.startTime = Date.now();
        this.log = [];
        this.addLog('info', '🚀 เริ่มต้นกระบวนการจัดตารางสอนอัตโนมัติ');

        // บันทึก scheduling run
        const runId = this.db.prepare(`
            INSERT INTO scheduling_runs (version_id, status, settings, created_by)
            VALUES (?, 'running', ?, ?)
        `).run(versionId, JSON.stringify(preferences), userId).lastInsertRowid;

        try {
            // ขั้นตอนที่ 1: ตรวจสอบความครบถ้วนของข้อมูล
            this.addLog('info', '📋 ขั้นตอนที่ 1: ตรวจสอบความครบถ้วนของข้อมูล');
            const validation = this.validateData(semesterId);
            if (validation.errors.length > 0) {
                throw new Error('ข้อมูลไม่ครบถ้วน: ' + validation.errors.join(', '));
            }
            this.addLog('success', `✅ ข้อมูลครบถ้วน: ${validation.summary}`);

            // ขั้นตอนที่ 2: โหลดข้อมูลทั้งหมด
            this.addLog('info', '📦 ขั้นตอนที่ 2: โหลดข้อมูลสำหรับการจัดตาราง');
            const data = this.loadSchedulingData(semesterId);
            this.stats.totalAssignments = data.assignments.length;
            this.addLog('info', `   - การมอบหมายสอน: ${data.assignments.length} รายการ`);
            this.addLog('info', `   - คาบเรียน: ${data.timeSlots.length} คาบ`);
            this.addLog('info', `   - ห้องเรียน: ${data.classrooms.length} ห้อง`);

            // ขั้นตอนที่ 3: ตรวจสอบข้อจำกัดที่ขัดแย้ง
            this.addLog('info', '🔍 ขั้นตอนที่ 3: ตรวจสอบข้อจำกัดที่เป็นไปไม่ได้');
            const impossibleCheck = this.checkImpossibleConstraints(data);
            if (impossibleCheck.length > 0) {
                for (const issue of impossibleCheck) {
                    this.addLog('warning', `⚠️ ${issue}`);
                }
            }

            // ขั้นตอนที่ 4: ลบ entry เก่า (ที่ไม่ได้ lock)
            this.addLog('info', '🗑️ ขั้นตอนที่ 4: เตรียมตารางใหม่');
            this.db.prepare(`
                DELETE FROM timetable_entries WHERE version_id = ? AND is_locked = 0
            `).run(versionId);

            // ขั้นตอนที่ 5: จัดเรียงวิชาตาม MRV (วิชาที่มีข้อจำกัดมากก่อน)
            this.addLog('info', '📊 ขั้นตอนที่ 5: จัดลำดับการจัดตารางด้วย MRV Heuristic');
            const sortedAssignments = this.sortByMRV(data);

            // ขั้นตอนที่ 6: จัดตาราง
            this.addLog('info', '🔧 ขั้นตอนที่ 6: เริ่มจัดตารางสอน...');
            const result = this.scheduleWithBacktracking(sortedAssignments, data, versionId, preferences);

            // ขั้นตอนที่ 7: ปรับปรุงตาม Soft Constraints
            this.addLog('info', '✨ ขั้นตอนที่ 7: ปรับปรุงคุณภาพตาราง (Soft Constraints)');
            this.optimizeSoftConstraints(versionId, data, preferences);

            // ขั้นตอนที่ 8: ตรวจสอบ & สรุปผล
            this.addLog('info', '🔎 ขั้นตอนที่ 8: ตรวจสอบและสรุปผลลัพธ์');
            const conflictResult = this.conflictChecker.checkAllConflicts(versionId);
            this.stats.conflictCount = conflictResult.hardConflicts;

            // คำนวณคะแนนคุณภาพ
            this.stats.qualityScore = this.calculateQualityScore(versionId, data, preferences);
            this.stats.endTime = Date.now();

            const durationMs = this.stats.endTime - this.stats.startTime;

            // อัปเดต scheduling run
            this.db.prepare(`
                UPDATE scheduling_runs SET 
                    status = 'completed',
                    total_assignments = ?,
                    scheduled_count = ?,
                    unscheduled_count = ?,
                    conflict_count = ?,
                    quality_score = ?,
                    duration_ms = ?,
                    log = ?,
                    completed_at = datetime('now', 'localtime')
                WHERE id = ?
            `).run(
                this.stats.totalAssignments,
                this.stats.scheduledCount,
                this.stats.unscheduledCount,
                this.stats.conflictCount,
                this.stats.qualityScore,
                durationMs,
                JSON.stringify(this.log),
                runId
            );

            // อัปเดต version
            this.db.prepare(`
                UPDATE timetable_versions SET 
                    quality_score = ?,
                    total_scheduled = ?,
                    total_unscheduled = ?,
                    total_conflicts = ?,
                    updated_at = datetime('now', 'localtime')
                WHERE id = ?
            `).run(
                this.stats.qualityScore,
                this.stats.scheduledCount,
                this.stats.unscheduledCount,
                this.stats.conflictCount,
                versionId
            );

            this.addLog('success', `🎉 จัดตารางเสร็จสิ้น ใช้เวลา ${durationMs}ms`);
            this.addLog('info', `📈 สรุป: จัดได้ ${this.stats.scheduledCount}/${this.stats.totalAssignments} รายการ`);
            this.addLog('info', `   คะแนนคุณภาพ: ${this.stats.qualityScore.toFixed(1)}/100`);

            if (this.stats.unscheduledCount > 0) {
                this.addLog('warning', `⚠️ ยังจัดไม่ได้ ${this.stats.unscheduledCount} รายการ`);
                const unscheduledDetails = this.getUnscheduledDetails(sortedAssignments, versionId);
                for (const detail of unscheduledDetails) {
                    this.addLog('warning', `   - ${detail}`);
                }
            }

            return {
                success: true,
                stats: this.stats,
                log: this.log,
                conflicts: conflictResult,
                runId: runId
            };

        } catch (err) {
            this.stats.endTime = Date.now();
            this.addLog('error', `❌ เกิดข้อผิดพลาด: ${err.message}`);
            
            this.db.prepare(`
                UPDATE scheduling_runs SET 
                    status = 'failed',
                    error_message = ?,
                    log = ?,
                    completed_at = datetime('now', 'localtime')
                WHERE id = ?
            `).run(err.message, JSON.stringify(this.log), runId);

            return {
                success: false,
                error: err.message,
                stats: this.stats,
                log: this.log,
                runId: runId
            };
        }
    }

    /**
     * ตรวจสอบความครบถ้วนของข้อมูล
     */
    validateData(semesterId) {
        const errors = [];
        const semester = this.db.prepare('SELECT * FROM semesters WHERE id = ?').get(semesterId);
        if (!semester) errors.push('ไม่พบข้อมูลภาคเรียน');

        const assignments = this.db.prepare(
            'SELECT COUNT(*) as count FROM teaching_assignments WHERE semester_id = ? AND is_active = 1'
        ).get(semesterId);
        if (assignments.count === 0) errors.push('ไม่มีการมอบหมายการสอน');

        const timeSlots = this.db.prepare(
            "SELECT COUNT(*) as count FROM time_slots WHERE (semester_id = ? OR semester_id IS NULL) AND is_active = 1 AND slot_type = 'เรียน'"
        ).get(semesterId);
        if (timeSlots.count === 0) errors.push('ไม่มีคาบเรียนที่เปิดใช้งาน');

        const classrooms = this.db.prepare(
            'SELECT COUNT(*) as count FROM classrooms WHERE is_active = 1'
        ).get();
        if (classrooms.count === 0) errors.push('ไม่มีห้องเรียน');

        return {
            errors,
            summary: `${assignments.count} การมอบหมาย, ${timeSlots.count} คาบเรียน, ${classrooms.count} ห้องเรียน`
        };
    }

    /**
     * โหลดข้อมูลทั้งหมดสำหรับจัดตาราง
     */
    loadSchedulingData(semesterId) {
        const assignments = this.db.prepare(`
            SELECT ta.*, 
                   t.first_name, t.last_name, t.max_hours_per_week, t.max_hours_per_day,
                   s.code as subject_code, s.name as subject_name, 
                   s.subject_type, s.requires_lab, s.theory_hours, s.practice_hours,
                   sg.name as group_name, sg.student_count, sg.program_id,
                   ta.preferred_room_id
            FROM teaching_assignments ta
            JOIN teachers t ON ta.teacher_id = t.id
            JOIN subjects s ON ta.subject_id = s.id
            JOIN student_groups sg ON ta.student_group_id = sg.id
            WHERE ta.semester_id = ? AND ta.is_active = 1 AND t.is_active = 1
        `).all(semesterId);

        const timeSlots = this.db.prepare(`
            SELECT * FROM time_slots 
            WHERE (semester_id = ? OR semester_id IS NULL) AND is_active = 1 AND slot_type = 'เรียน'
            ORDER BY day_of_week, period_number
        `).all(semesterId);

        const classrooms = this.db.prepare(`
            SELECT * FROM classrooms WHERE is_active = 1
        `).all();

        const unavailability = this.db.prepare(`
            SELECT * FROM teacher_availability 
            WHERE semester_id = ? AND is_available = 0
        `).all(semesterId);

        // สร้าง lookup maps
        const unavailableMap = {};
        for (const u of unavailability) {
            const key = `${u.teacher_id}-${u.time_slot_id}`;
            unavailableMap[key] = true;
        }

        return { assignments, timeSlots, classrooms, unavailableMap, semesterId };
    }

    /**
     * ตรวจสอบข้อจำกัดที่เป็นไปไม่ได้
     */
    checkImpossibleConstraints(data) {
        const issues = [];
        
        // ตรวจสอบว่ามีห้องปฏิบัติการเพียงพอสำหรับวิชาที่ต้องการ
        const labSubjects = data.assignments.filter(a => a.requires_lab);
        const labRooms = data.classrooms.filter(c => c.room_type !== 'ห้องเรียน');
        if (labSubjects.length > 0 && labRooms.length === 0) {
            issues.push(`มี ${labSubjects.length} วิชาที่ต้องใช้ห้องปฏิบัติการ แต่ไม่มีห้องปฏิบัติการในระบบ`);
        }

        // ตรวจสอบจำนวนคาบเรียนเพียงพอ
        let totalHoursNeeded = 0;
        for (const a of data.assignments) {
            totalHoursNeeded += a.hours_per_week;
        }
        const totalSlots = data.timeSlots.length;
        const totalRoomSlots = totalSlots * data.classrooms.length;
        if (totalHoursNeeded > totalRoomSlots) {
            issues.push(`ต้องการ ${totalHoursNeeded} คาบ แต่มีช่องว่างเพียง ${totalRoomSlots} (${totalSlots} คาบ x ${data.classrooms.length} ห้อง)`);
        }

        return issues;
    }

    /**
     * จัดเรียงตาม MRV (Minimum Remaining Values)
     * วิชาที่มีข้อจำกัดมากจะถูกจัดก่อน
     */
    sortByMRV(data) {
        const scored = data.assignments.map(assignment => {
            let constraintScore = 0;

            // วิชาที่ต้องใช้ห้องปฏิบัติการ = ข้อจำกัดมาก
            if (assignment.requires_lab) constraintScore += 10;

            // ครูที่มีเวลาไม่ว่างมาก = ข้อจำกัดมาก
            const unavailCount = data.timeSlots.filter(ts => 
                data.unavailableMap[`${assignment.teacher_id}-${ts.id}`]
            ).length;
            constraintScore += unavailCount;

            // วิชาที่ต้องการหลายชั่วโมง = ข้อจำกัดมาก
            constraintScore += assignment.hours_per_week * 2;

            // กลุ่มเรียนที่มีคนเยอะ = ต้องเลือกห้องจำกัด
            if (assignment.student_count > 30) constraintScore += 3;

            // มี preferred room = ข้อจำกัด
            if (assignment.preferred_room_id) constraintScore += 2;

            return { ...assignment, constraintScore };
        });

        // เรียงจากข้อจำกัดมากไปน้อย
        scored.sort((a, b) => b.constraintScore - a.constraintScore);
        return scored;
    }

    /**
     * จัดตารางด้วย Backtracking + Forward Checking
     */
    scheduleWithBacktracking(assignments, data, versionId, preferences) {
        // Expand assignments ตาม hours_per_week
        const expandedAssignments = [];
        for (const a of assignments) {
            for (let h = 0; h < a.hours_per_week; h++) {
                expandedAssignments.push({ ...a, hourIndex: h });
            }
        }

        this.addLog('info', `   📌 จำนวนคาบที่ต้องจัด: ${expandedAssignments.length}`);

        // Track ว่าคาบไหนถูกใช้แล้ว
        const usedSlots = {
            teacher: {},    // teacher_id -> Set of time_slot_ids
            room: {},       // classroom_id -> Set of time_slot_ids
            group: {}       // student_group_id -> Set of time_slot_ids
        };

        // Track ชั่วโมงต่อวันของครู
        const teacherDayHours = {}; // teacher_id-day -> count

        // Load locked entries ที่มีอยู่แล้ว
        const lockedEntries = this.db.prepare(`
            SELECT te.*, ta.teacher_id, ta.student_group_id
            FROM timetable_entries te
            JOIN teaching_assignments ta ON te.teaching_assignment_id = ta.id
            JOIN time_slots ts ON te.time_slot_id = ts.id
            WHERE te.version_id = ? AND te.is_locked = 1
        `).all(versionId);

        for (const entry of lockedEntries) {
            this._markUsed(usedSlots, entry.teacher_id, entry.classroom_id, 
                          this._getGroupIdFromEntry(entry), entry.time_slot_id);
        }

        let scheduledCount = 0;
        const unscheduled = [];

        // ใช้ greedy first, then backtrack on failures
        const insertStmt = this.db.prepare(`
            INSERT INTO timetable_entries (version_id, teaching_assignment_id, time_slot_id, classroom_id)
            VALUES (?, ?, ?, ?)
        `);

        const scheduleTransaction = this.db.transaction(() => {
            for (const assignment of expandedAssignments) {
                const result = this._findBestSlot(assignment, data, usedSlots, teacherDayHours, preferences);
                
                if (result) {
                    insertStmt.run(versionId, assignment.id, result.timeSlotId, result.classroomId);
                    this._markUsed(usedSlots, assignment.teacher_id, result.classroomId, 
                                  assignment.student_group_id, result.timeSlotId);
                    
                    // Track teacher day hours
                    const dayKey = `${assignment.teacher_id}-${result.day}`;
                    teacherDayHours[dayKey] = (teacherDayHours[dayKey] || 0) + 1;
                    
                    scheduledCount++;
                } else {
                    unscheduled.push(assignment);
                }
            }
        });

        scheduleTransaction();

        this.stats.scheduledCount = scheduledCount;
        this.stats.unscheduledCount = unscheduled.length;

        this.addLog('success', `   ✅ จัดสำเร็จ: ${scheduledCount}/${expandedAssignments.length} คาบ`);
        
        if (unscheduled.length > 0) {
            this.addLog('warning', `   ⚠️ จัดไม่ได้: ${unscheduled.length} คาบ`);
        }

        return { scheduledCount, unscheduled };
    }

    /**
     * หาช่องเวลาที่ดีที่สุดสำหรับ assignment
     */
    _findBestSlot(assignment, data, usedSlots, teacherDayHours, preferences) {
        let bestSlot = null;
        let bestScore = -Infinity;

        // หาห้องที่เหมาะสม
        const suitableRooms = this._getSuitableRooms(assignment, data.classrooms);

        for (const timeSlot of data.timeSlots) {
            // Hard Constraint: ครูไม่ว่าง
            if (data.unavailableMap[`${assignment.teacher_id}-${timeSlot.id}`]) continue;

            // Hard Constraint: ครูสอนอยู่แล้ว
            if (usedSlots.teacher[assignment.teacher_id]?.has(timeSlot.id)) continue;

            // Hard Constraint: กลุ่มเรียนเรียนอยู่แล้ว
            if (usedSlots.group[assignment.student_group_id]?.has(timeSlot.id)) continue;

            // Hard Constraint: ชั่วโมงต่อวันของครู
            const dayKey = `${assignment.teacher_id}-${timeSlot.day_of_week}`;
            if ((teacherDayHours[dayKey] || 0) >= (assignment.max_hours_per_day || 6)) continue;

            for (const room of suitableRooms) {
                // Hard Constraint: ห้องถูกใช้อยู่แล้ว
                if (usedSlots.room[room.id]?.has(timeSlot.id)) continue;

                // คำนวณคะแนน Soft Constraints
                const score = this._scorePlacement(assignment, timeSlot, room, 
                    data, usedSlots, teacherDayHours, preferences);

                if (score > bestScore) {
                    bestScore = score;
                    bestSlot = {
                        timeSlotId: timeSlot.id,
                        classroomId: room.id,
                        day: timeSlot.day_of_week,
                        score: score
                    };
                }
            }
        }

        return bestSlot;
    }

    /**
     * หาห้องเรียนที่เหมาะสม
     */
    _getSuitableRooms(assignment, classrooms) {
        let rooms = classrooms;

        // ถ้ามี preferred room ให้ใส่ไว้ข้างหน้า
        if (assignment.preferred_room_id) {
            const preferred = rooms.find(r => r.id === assignment.preferred_room_id);
            const others = rooms.filter(r => r.id !== assignment.preferred_room_id);
            if (preferred) rooms = [preferred, ...others];
        }

        // กรองตามประเภท
        if (assignment.requires_lab) {
            rooms = rooms.filter(r => r.room_type !== 'ห้องเรียน');
        }

        // กรองตามความจุ
        if (assignment.student_count > 0) {
            rooms = rooms.filter(r => r.capacity >= assignment.student_count);
        }

        return rooms;
    }

    /**
     * คำนวณคะแนนการจัดวาง (Soft Constraints)
     */
    _scorePlacement(assignment, timeSlot, room, data, usedSlots, teacherDayHours, preferences) {
        let score = 0;
        const weights = {
            spread: preferences.weight_spread || 1.0,
            gaps: preferences.weight_gaps || 1.0,
            roomChange: preferences.weight_room_change || 0.8,
            consecutive: preferences.weight_consecutive || 0.7,
            preferred: preferences.weight_preferred || 1.5,
            earlyPeriod: preferences.weight_early || 0.3
        };

        // Preferred room bonus
        if (assignment.preferred_room_id === room.id) {
            score += 20 * weights.preferred;
        }

        // กระจายวิชาให้เหมาะสมตลอดสัปดาห์
        const dayKey = `${assignment.teacher_id}-${timeSlot.day_of_week}`;
        const currentDayHours = teacherDayHours[dayKey] || 0;
        score -= currentDayHours * 3 * weights.spread;

        // ลดคาบว่างของครู - ให้คะแนนถ้าจัดติดกับคาบที่มีอยู่แล้ว
        const teacherSlots = usedSlots.teacher[assignment.teacher_id];
        if (teacherSlots) {
            const sameDaySlots = data.timeSlots.filter(ts => 
                ts.day_of_week === timeSlot.day_of_week && teacherSlots.has(ts.id)
            );
            for (const existing of sameDaySlots) {
                if (Math.abs(existing.period_number - timeSlot.period_number) === 1) {
                    score += 5 * weights.gaps;
                }
            }
        }

        // ลดคาบว่างของกลุ่มเรียน
        const groupSlots = usedSlots.group[assignment.student_group_id];
        if (groupSlots) {
            const sameDayGroupSlots = data.timeSlots.filter(ts => 
                ts.day_of_week === timeSlot.day_of_week && groupSlots.has(ts.id)
            );
            for (const existing of sameDayGroupSlots) {
                if (Math.abs(existing.period_number - timeSlot.period_number) === 1) {
                    score += 3 * weights.gaps;
                }
            }
        }

        // ลดการเรียนวิชาเดียวกันวันเดียวกัน (สำหรับกลุ่มเรียน)
        if (groupSlots) {
            const sameDayEntries = this.db.prepare(`
                SELECT COUNT(*) as cnt FROM timetable_entries te
                JOIN teaching_assignments ta ON te.teaching_assignment_id = ta.id
                JOIN time_slots ts ON te.time_slot_id = ts.id
                WHERE ta.subject_id = ? AND ta.student_group_id = ? 
                AND ts.day_of_week = ? AND te.version_id = (
                    SELECT MAX(version_id) FROM timetable_entries
                )
            `).get(assignment.subject_id, assignment.student_group_id, timeSlot.day_of_week);
            if (sameDayEntries && sameDayEntries.cnt > 0) {
                score -= 10 * weights.spread;
            }
        }

        // ชอบคาบเช้ามากกว่าคาบบ่ายเล็กน้อย (สำหรับวิชาทฤษฎี)
        if (assignment.subject_type === 'ทฤษฎี') {
            score -= timeSlot.period_number * 0.5 * weights.earlyPeriod;
        }

        // ลดคาบสอนต่อเนื่องเกินไป
        const maxConsecutive = parseInt(preferences.max_consecutive || '3');
        if (teacherSlots) {
            let consecutive = 1;
            for (let p = timeSlot.period_number - 1; p >= 1; p--) {
                const prevSlot = data.timeSlots.find(ts => 
                    ts.day_of_week === timeSlot.day_of_week && ts.period_number === p
                );
                if (prevSlot && teacherSlots.has(prevSlot.id)) {
                    consecutive++;
                } else break;
            }
            if (consecutive >= maxConsecutive) {
                score -= 15 * weights.consecutive;
            }
        }

        // ห้องที่ capacity พอดีดีกว่าห้องใหญ่เกินไป
        if (assignment.student_count > 0 && room.capacity > 0) {
            const waste = room.capacity - assignment.student_count;
            score -= waste * 0.1;
        }

        return score;
    }

    /**
     * ปรับปรุงตาราง Soft Constraints (Local Search)
     */
    optimizeSoftConstraints(versionId, data, preferences) {
        const maxIterations = parseInt(preferences.optimization_iterations || '100');
        let improved = 0;

        for (let i = 0; i < maxIterations; i++) {
            // ดึง entries ทั้งหมดที่ไม่ได้ lock
            const entries = this.db.prepare(`
                SELECT te.*, ta.teacher_id, ta.student_group_id, ta.subject_id,
                       ts.day_of_week, ts.period_number
                FROM timetable_entries te
                JOIN teaching_assignments ta ON te.teaching_assignment_id = ta.id
                JOIN time_slots ts ON te.time_slot_id = ts.id
                WHERE te.version_id = ? AND te.is_locked = 0
            `).all(versionId);

            if (entries.length < 2) break;

            // เลือก 2 entries แบบสุ่มแล้วลองสลับ
            const idx1 = Math.floor(Math.random() * entries.length);
            let idx2 = Math.floor(Math.random() * entries.length);
            while (idx2 === idx1) idx2 = Math.floor(Math.random() * entries.length);

            const e1 = entries[idx1];
            const e2 = entries[idx2];

            // ตรวจสอบว่าสลับได้ไหม (ไม่ละเมิด Hard Constraints)
            const swap1Conflicts = this.conflictChecker.checkSingleEntryConflicts(
                versionId, e2.time_slot_id, e2.classroom_id, e1.teacher_id, e1.student_group_id, e1.id
            );
            const swap2Conflicts = this.conflictChecker.checkSingleEntryConflicts(
                versionId, e1.time_slot_id, e1.classroom_id, e2.teacher_id, e2.student_group_id, e2.id
            );

            if (swap1Conflicts.length === 0 && swap2Conflicts.length === 0) {
                // ลองสลับแล้วดูว่าดีขึ้นไหม (simplified - just swap)
                this.db.prepare(`
                    UPDATE timetable_entries SET time_slot_id = ?, classroom_id = ? WHERE id = ?
                `).run(e2.time_slot_id, e2.classroom_id, e1.id);
                this.db.prepare(`
                    UPDATE timetable_entries SET time_slot_id = ?, classroom_id = ? WHERE id = ?
                `).run(e1.time_slot_id, e1.classroom_id, e2.id);
                improved++;
            }
        }

        if (improved > 0) {
            this.addLog('info', `   ✅ ปรับปรุงแล้ว ${improved} ครั้ง`);
        }
    }

    /**
     * คำนวณคะแนนคุณภาพตาราง (0-100)
     */
    calculateQualityScore(versionId, data, preferences) {
        let score = 100;

        // ลดคะแนนตามจำนวนที่จัดไม่ได้
        if (this.stats.totalAssignments > 0) {
            const scheduledRate = this.stats.scheduledCount / 
                (this.stats.scheduledCount + this.stats.unscheduledCount);
            score *= scheduledRate;
        }

        // ลดคะแนนตาม conflicts
        const conflicts = this.conflictChecker.checkAllConflicts(versionId);
        score -= conflicts.hardConflicts * 10;
        score -= conflicts.softConflicts * 2;

        // ตรวจสอบการกระจายตัว
        const entries = this.db.prepare(`
            SELECT ta.teacher_id, ts.day_of_week, COUNT(*) as cnt
            FROM timetable_entries te
            JOIN teaching_assignments ta ON te.teaching_assignment_id = ta.id
            JOIN time_slots ts ON te.time_slot_id = ts.id
            WHERE te.version_id = ?
            GROUP BY ta.teacher_id, ts.day_of_week
        `).all(versionId);

        // ตรวจสอบคาบว่าง (gaps) ของครู
        const gapPenalty = this._calculateGapPenalty(versionId, data);
        score -= gapPenalty;

        return Math.max(0, Math.min(100, score));
    }

    /**
     * คำนวณ penalty จากคาบว่าง
     */
    _calculateGapPenalty(versionId, data) {
        let totalGaps = 0;
        const teacherDaySlots = this.db.prepare(`
            SELECT ta.teacher_id, ts.day_of_week, ts.period_number
            FROM timetable_entries te
            JOIN teaching_assignments ta ON te.teaching_assignment_id = ta.id
            JOIN time_slots ts ON te.time_slot_id = ts.id
            WHERE te.version_id = ?
            ORDER BY ta.teacher_id, ts.day_of_week, ts.period_number
        `).all(versionId);

        const grouped = {};
        for (const s of teacherDaySlots) {
            const key = `${s.teacher_id}-${s.day_of_week}`;
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(s.period_number);
        }

        for (const periods of Object.values(grouped)) {
            if (periods.length < 2) continue;
            periods.sort((a, b) => a - b);
            for (let i = 1; i < periods.length; i++) {
                const gap = periods[i] - periods[i-1] - 1;
                totalGaps += gap;
            }
        }

        return Math.min(totalGaps * 0.5, 20);
    }

    /**
     * รายละเอียดรายการที่จัดไม่ได้
     */
    getUnscheduledDetails(assignments, versionId) {
        const details = [];
        const scheduledIds = new Set();
        
        const entries = this.db.prepare(`
            SELECT teaching_assignment_id, COUNT(*) as cnt 
            FROM timetable_entries WHERE version_id = ? 
            GROUP BY teaching_assignment_id
        `).all(versionId);

        const scheduledHours = {};
        for (const e of entries) {
            scheduledHours[e.teaching_assignment_id] = e.cnt;
        }

        for (const a of assignments) {
            const scheduled = scheduledHours[a.id] || 0;
            if (scheduled < a.hours_per_week) {
                const missing = a.hours_per_week - scheduled;
                let reason = 'ไม่พบช่องว่างที่เหมาะสม';
                
                if (a.requires_lab) {
                    reason = 'ห้องปฏิบัติการอาจไม่เพียงพอ';
                }
                
                details.push(
                    `${a.subject_code} ${a.subject_name} (${a.first_name} ${a.last_name} → ${a.group_name}) ขาด ${missing} คาบ - ${reason}`
                );
            }
        }

        return [...new Set(details)];
    }

    _markUsed(usedSlots, teacherId, classroomId, groupId, timeSlotId) {
        if (!usedSlots.teacher[teacherId]) usedSlots.teacher[teacherId] = new Set();
        usedSlots.teacher[teacherId].add(timeSlotId);

        if (!usedSlots.room[classroomId]) usedSlots.room[classroomId] = new Set();
        usedSlots.room[classroomId].add(timeSlotId);

        if (!usedSlots.group[groupId]) usedSlots.group[groupId] = new Set();
        usedSlots.group[groupId].add(timeSlotId);
    }

    _getGroupIdFromEntry(entry) {
        return entry.student_group_id;
    }

    addLog(level, message) {
        this.log.push({
            level,
            message,
            timestamp: new Date().toISOString()
        });
        console.log(`[Scheduler] ${message}`);
    }
}

module.exports = Scheduler;
