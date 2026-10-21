// =====================================================
// exportService.js - บริการส่งออก Excel และ PDF
// =====================================================
const ExcelJS = require('exceljs');
const PdfPrinter = require('pdfmake');

const DAY_NAMES = ['', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์'];

class ExportService {
    constructor(db) {
        this.db = db;
    }

    /**
     * ส่งออกตารางสอนเป็น Excel
     */
    async exportTimetableExcel(versionId, filterType, filterId) {
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'ระบบจัดตารางสอน วิทยาลัยการอาชีพปัตตานี';
        workbook.created = new Date();

        const collegeName = this.db.prepare(
            "SELECT setting_value FROM system_settings WHERE setting_key = 'college_name'"
        ).get()?.setting_value || 'วิทยาลัยการอาชีพปัตตานี';

        const version = this.db.prepare(`
            SELECT tv.*, s.name as semester_name, ay.year
            FROM timetable_versions tv
            JOIN semesters s ON tv.semester_id = s.id
            JOIN academic_years ay ON s.academic_year_id = ay.id
            WHERE tv.id = ?
        `).get(versionId);

        const entries = this._getTimetableEntries(versionId, filterType, filterId);
        const timeSlots = this._getTimeSlots(version.semester_id);
        const days = [...new Set(timeSlots.map(ts => ts.day_of_week))].sort();
        const periods = [...new Set(timeSlots.map(ts => ts.period_number))].sort((a,b) => a-b);

        let title = '';
        if (filterType === 'teacher') {
            const teacher = this.db.prepare('SELECT * FROM teachers WHERE id = ?').get(filterId);
            title = `ตารางสอน - ${teacher?.prefix || ''}${teacher?.first_name} ${teacher?.last_name}`;
        } else if (filterType === 'group') {
            const group = this.db.prepare('SELECT * FROM student_groups WHERE id = ?').get(filterId);
            title = `ตารางเรียน - ${group?.name}`;
        } else if (filterType === 'room') {
            const room = this.db.prepare('SELECT * FROM classrooms WHERE id = ?').get(filterId);
            title = `ตารางห้อง - ${room?.name}`;
        } else {
            title = 'ตารางสอนทั้งหมด';
        }

        const ws = workbook.addWorksheet(title.substring(0, 31));

        // Header
        ws.mergeCells(1, 1, 1, periods.length + 1);
        const headerCell = ws.getCell(1, 1);
        headerCell.value = collegeName;
        headerCell.font = { size: 14, bold: true };
        headerCell.alignment = { horizontal: 'center' };

        ws.mergeCells(2, 1, 2, periods.length + 1);
        const subHeader = ws.getCell(2, 1);
        subHeader.value = `${title} | ${version?.semester_name || ''} ปีการศึกษา ${version?.year || ''}`;
        subHeader.font = { size: 12 };
        subHeader.alignment = { horizontal: 'center' };

        // Column headers (periods)
        ws.getCell(4, 1).value = 'วัน / คาบ';
        ws.getCell(4, 1).font = { bold: true };
        ws.getCell(4, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B3A5C' } };
        ws.getCell(4, 1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        ws.getColumn(1).width = 15;

        for (let i = 0; i < periods.length; i++) {
            const ts = timeSlots.find(t => t.period_number === periods[i]);
            const cell = ws.getCell(4, i + 2);
            cell.value = `คาบ ${periods[i]}\n${ts?.start_time || ''}-${ts?.end_time || ''}`;
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B3A5C' } };
            cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
            ws.getColumn(i + 2).width = 20;
        }

        // Data rows
        let row = 5;
        for (const day of days) {
            const dayCell = ws.getCell(row, 1);
            dayCell.value = DAY_NAMES[day];
            dayCell.font = { bold: true };
            dayCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF4' } };
            dayCell.alignment = { vertical: 'middle' };

            for (let i = 0; i < periods.length; i++) {
                const slotEntries = entries.filter(e => 
                    e.day_of_week === day && e.period_number === periods[i]
                );
                
                const cell = ws.getCell(row, i + 2);
                if (slotEntries.length > 0) {
                    const texts = slotEntries.map(e => {
                        let text = `${e.subject_code}\n${e.subject_name}`;
                        if (filterType !== 'teacher') text += `\n${e.teacher_name}`;
                        if (filterType !== 'room') text += `\n${e.classroom_name}`;
                        if (filterType !== 'group') text += `\n${e.group_name}`;
                        return text;
                    });
                    cell.value = texts.join('\n---\n');
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F7FF' } };
                }
                cell.alignment = { wrapText: true, vertical: 'top' };
                cell.border = {
                    top: { style: 'thin' },
                    left: { style: 'thin' },
                    bottom: { style: 'thin' },
                    right: { style: 'thin' }
                };
            }
            ws.getRow(row).height = 60;
            row++;
        }

        return workbook;
    }

    /**
     * ส่งออกตารางสอนเป็น PDF
     */
    async exportTimetablePdf(versionId, filterType, filterId) {
        const collegeName = this.db.prepare(
            "SELECT setting_value FROM system_settings WHERE setting_key = 'college_name'"
        ).get()?.setting_value || 'วิทยาลัยการอาชีพปัตตานี';

        const version = this.db.prepare(`
            SELECT tv.*, s.name as semester_name, ay.year
            FROM timetable_versions tv
            JOIN semesters s ON tv.semester_id = s.id
            JOIN academic_years ay ON s.academic_year_id = ay.id
            WHERE tv.id = ?
        `).get(versionId);

        const entries = this._getTimetableEntries(versionId, filterType, filterId);
        const timeSlots = this._getTimeSlots(version.semester_id);
        const days = [...new Set(timeSlots.map(ts => ts.day_of_week))].sort();
        const periods = [...new Set(timeSlots.map(ts => ts.period_number))].sort((a,b) => a-b);

        let title = '';
        if (filterType === 'teacher') {
            const teacher = this.db.prepare('SELECT * FROM teachers WHERE id = ?').get(filterId);
            title = `ตารางสอน - ${teacher?.prefix || ''}${teacher?.first_name} ${teacher?.last_name}`;
        } else if (filterType === 'group') {
            const group = this.db.prepare('SELECT * FROM student_groups WHERE id = ?').get(filterId);
            title = `ตารางเรียน - ${group?.name}`;
        } else if (filterType === 'room') {
            const room = this.db.prepare('SELECT * FROM classrooms WHERE id = ?').get(filterId);
            title = `ตารางห้อง - ${room?.name}`;
        } else {
            title = 'ตารางสอนทั้งหมด';
        }

        // สร้างตาราง
        const tableHeaders = [
            { text: 'วัน/คาบ', style: 'tableHeader' },
            ...periods.map(p => {
                const ts = timeSlots.find(t => t.period_number === p);
                return { text: `คาบ ${p}\n${ts?.start_time || ''}-${ts?.end_time || ''}`, style: 'tableHeader' };
            })
        ];

        const tableBody = [tableHeaders];
        for (const day of days) {
            const row = [{ text: DAY_NAMES[day], style: 'dayCell' }];
            for (const period of periods) {
                const slotEntries = entries.filter(e => 
                    e.day_of_week === day && e.period_number === period
                );
                if (slotEntries.length > 0) {
                    const text = slotEntries.map(e => {
                        let t = `${e.subject_code} ${e.subject_name}`;
                        if (filterType !== 'teacher') t += `\n${e.teacher_name}`;
                        if (filterType !== 'room') t += `\nห้อง ${e.classroom_name}`;
                        return t;
                    }).join('\n');
                    row.push({ text, style: 'tableCell', fontSize: 7 });
                } else {
                    row.push({ text: '', style: 'tableCell' });
                }
            }
            tableBody.push(row);
        }

        const docDefinition = {
            pageSize: 'A4',
            pageOrientation: 'landscape',
            pageMargins: [20, 20, 20, 20],
            defaultStyle: { font: 'Helvetica', fontSize: 9 },
            content: [
                { text: collegeName, style: 'header' },
                { text: `${title} | ${version?.semester_name || ''} ปีการศึกษา ${version?.year || ''}`, style: 'subheader' },
                { text: ' ', margin: [0, 5] },
                {
                    table: {
                        headerRows: 1,
                        widths: [60, ...periods.map(() => '*')],
                        body: tableBody
                    },
                    layout: {
                        fillColor: function(rowIndex) {
                            return (rowIndex === 0) ? '#1B3A5C' : null;
                        }
                    }
                }
            ],
            styles: {
                header: { fontSize: 14, bold: true, alignment: 'center', margin: [0, 0, 0, 5] },
                subheader: { fontSize: 11, alignment: 'center', margin: [0, 0, 0, 5] },
                tableHeader: { bold: true, fontSize: 8, color: 'white', alignment: 'center' },
                dayCell: { bold: true, fontSize: 9 },
                tableCell: { fontSize: 7 }
            }
        };

        return docDefinition;
    }

    createPdfStream(docDefinition) {
        const printer = new PdfPrinter({
            Helvetica: {
                normal: 'Helvetica',
                bold: 'Helvetica-Bold',
                italics: 'Helvetica-Oblique',
                bolditalics: 'Helvetica-BoldOblique'
            }
        });
        return printer.createPdfKitDocument(docDefinition);
    }

    /**
     * ส่งออกรายงานภาระสอนเป็น Excel
     */
    async exportTeacherWorkload(semesterId) {
        const workbook = new ExcelJS.Workbook();
        const ws = workbook.addWorksheet('ภาระงานสอน');

        const data = this.db.prepare(`
            SELECT t.employee_id, t.prefix, t.first_name, t.last_name,
                   d.name as department_name,
                   COUNT(DISTINCT ta.id) as total_assignments,
                   SUM(ta.hours_per_week) as total_hours,
                   t.max_hours_per_week
            FROM teachers t
            LEFT JOIN departments d ON t.department_id = d.id
            LEFT JOIN teaching_assignments ta ON ta.teacher_id = t.id AND ta.semester_id = ? AND ta.is_active = 1
            WHERE t.is_active = 1
            GROUP BY t.id
            ORDER BY d.name, t.last_name
        `).all(semesterId);

        ws.columns = [
            { header: 'รหัส', key: 'employee_id', width: 12 },
            { header: 'คำนำหน้า', key: 'prefix', width: 10 },
            { header: 'ชื่อ', key: 'first_name', width: 15 },
            { header: 'นามสกุล', key: 'last_name', width: 15 },
            { header: 'แผนก', key: 'department_name', width: 20 },
            { header: 'จำนวนวิชา', key: 'total_assignments', width: 12 },
            { header: 'ชม./สัปดาห์', key: 'total_hours', width: 13 },
            { header: 'สูงสุด', key: 'max_hours_per_week', width: 10 }
        ];

        // Style header
        ws.getRow(1).eachCell(cell => {
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B3A5C' } };
        });

        for (const row of data) {
            const r = ws.addRow(row);
            if ((row.total_hours || 0) > row.max_hours_per_week) {
                r.eachCell(cell => {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFCCCC' } };
                });
            }
        }

        return workbook;
    }

    /**
     * Import ข้อมูลจาก Excel
     */
    async importFromExcel(filePath, entityType) {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(filePath);
        const ws = workbook.worksheets[0];
        
        if (!ws) throw new Error('ไม่พบ worksheet ในไฟล์');

        const results = { success: 0, errors: [], total: 0 };
        const headers = [];
        
        ws.getRow(1).eachCell((cell, colNumber) => {
            headers[colNumber] = String(cell.value || '').trim().toLowerCase();
        });

        const requiredColumns = this._getRequiredColumns(entityType);
        const missingCols = requiredColumns.filter(col => !headers.includes(col));
        if (missingCols.length > 0) {
            throw new Error(`ไม่พบคอลัมน์ที่จำเป็น: ${missingCols.join(', ')}`);
        }

        ws.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return; // skip header
            results.total++;

            try {
                const rowData = {};
                row.eachCell((cell, colNumber) => {
                    if (headers[colNumber]) {
                        rowData[headers[colNumber]] = cell.value;
                    }
                });

                this._importRow(entityType, rowData, rowNumber);
                results.success++;
            } catch (err) {
                results.errors.push({ row: rowNumber, error: err.message });
            }
        });

        return results;
    }

    _getRequiredColumns(entityType) {
        const map = {
            teachers: ['รหัส', 'ชื่อ', 'นามสกุล'],
            subjects: ['รหัสวิชา', 'ชื่อวิชา'],
            classrooms: ['รหัสห้อง', 'ชื่อห้อง'],
            students: ['รหัสกลุ่ม', 'ชื่อกลุ่ม']
        };
        return map[entityType] || [];
    }

    _importRow(entityType, data, rowNumber) {
        switch (entityType) {
            case 'teachers':
                const existingTeacher = this.db.prepare(
                    'SELECT id FROM teachers WHERE employee_id = ?'
                ).get(data['รหัส']);
                if (existingTeacher) throw new Error(`รหัส ${data['รหัส']} มีอยู่แล้ว`);
                
                this.db.prepare(`
                    INSERT INTO teachers (employee_id, prefix, first_name, last_name, phone, email)
                    VALUES (?, ?, ?, ?, ?, ?)
                `).run(
                    data['รหัส'], data['คำนำหน้า'] || '', 
                    data['ชื่อ'], data['นามสกุล'],
                    data['โทรศัพท์'] || '', data['อีเมล'] || ''
                );
                break;

            case 'subjects':
                const existingSubject = this.db.prepare(
                    'SELECT id FROM subjects WHERE code = ?'
                ).get(data['รหัสวิชา']);
                if (existingSubject) throw new Error(`รหัสวิชา ${data['รหัสวิชา']} มีอยู่แล้ว`);
                
                this.db.prepare(`
                    INSERT INTO subjects (code, name, credits, theory_hours, practice_hours, total_hours, subject_type)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `).run(
                    data['รหัสวิชา'], data['ชื่อวิชา'],
                    data['หน่วยกิต'] || 0,
                    data['ชั่วโมงทฤษฎี'] || 0,
                    data['ชั่วโมงปฏิบัติ'] || 0,
                    (data['ชั่วโมงทฤษฎี'] || 0) + (data['ชั่วโมงปฏิบัติ'] || 0),
                    data['ประเภท'] || 'ทฤษฎี'
                );
                break;

            case 'classrooms':
                const existingRoom = this.db.prepare(
                    'SELECT id FROM classrooms WHERE code = ?'
                ).get(data['รหัสห้อง']);
                if (existingRoom) throw new Error(`รหัสห้อง ${data['รหัสห้อง']} มีอยู่แล้ว`);
                
                this.db.prepare(`
                    INSERT INTO classrooms (code, name, building, capacity, room_type)
                    VALUES (?, ?, ?, ?, ?)
                `).run(
                    data['รหัสห้อง'], data['ชื่อห้อง'],
                    data['อาคาร'] || '',
                    data['ความจุ'] || 40,
                    data['ประเภท'] || 'ห้องเรียน'
                );
                break;
        }
    }

    _getTimetableEntries(versionId, filterType, filterId) {
        let whereClause = '';
        const params = [versionId];

        if (filterType === 'teacher' && filterId) {
            whereClause = ' AND ta.teacher_id = ?';
            params.push(filterId);
        } else if (filterType === 'group' && filterId) {
            whereClause = ' AND ta.student_group_id = ?';
            params.push(filterId);
        } else if (filterType === 'room' && filterId) {
            whereClause = ' AND te.classroom_id = ?';
            params.push(filterId);
        }

        return this.db.prepare(`
            SELECT te.*, 
                   ts.day_of_week, ts.day_name, ts.period_number, ts.start_time, ts.end_time,
                   s.code as subject_code, s.name as subject_name, s.subject_type,
                   t.prefix as teacher_prefix, t.first_name || ' ' || t.last_name as teacher_name,
                   c.code as classroom_code, c.name as classroom_name,
                   sg.name as group_name,
                   d.name as department_name
            FROM timetable_entries te
            JOIN teaching_assignments ta ON te.teaching_assignment_id = ta.id
            JOIN time_slots ts ON te.time_slot_id = ts.id
            JOIN subjects s ON ta.subject_id = s.id
            JOIN teachers t ON ta.teacher_id = t.id
            JOIN classrooms c ON te.classroom_id = c.id
            JOIN student_groups sg ON ta.student_group_id = sg.id
            LEFT JOIN departments d ON t.department_id = d.id
            WHERE te.version_id = ? ${whereClause}
            ORDER BY ts.day_of_week, ts.period_number
        `).all(...params);
    }

    _getTimeSlots(semesterId) {
        return this.db.prepare(`
            SELECT DISTINCT period_number, day_of_week, start_time, end_time
            FROM time_slots
            WHERE (semester_id = ? OR semester_id IS NULL) AND is_active = 1 AND slot_type = 'เรียน'
            ORDER BY day_of_week, period_number
        `).all(semesterId);
    }
}

module.exports = ExportService;
