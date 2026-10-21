// =====================================================
// app.js - Client-Side Common Library & Utilities
// ระบบจัดตารางสอนอัตโนมัติ วิทยาลัยการอาชีพปัตตานี
// =====================================================

const API_BASE = '/api';

let currentUser = null;

/**
 * ฟังก์ชันเรียกใช้งาน API ฝั่ง Backend
 */
async function apiCall(endpoint, options = {}) {
    const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;
    const defaultHeaders = {};

    if (!(options.body instanceof FormData)) {
        defaultHeaders['Content-Type'] = 'application/json';
    }

    const config = {
        ...options,
        headers: {
            ...defaultHeaders,
            ...options.headers
        }
    };

    if (config.body && typeof config.body === 'object' && !(config.body instanceof FormData)) {
        config.body = JSON.stringify(config.body);
    }

    try {
        const response = await fetch(url, config);
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            if (response.status === 401 && !window.location.pathname.endsWith('index.html') && window.location.pathname !== '/') {
                window.location.href = '/index.html';
                return;
            }
            throw new Error(data.error || `เกิดข้อผิดพลาด (${response.status})`);
        }

        return data;
    } catch (err) {
        console.error(`API Error [${url}]:`, err);
        throw err;
    }
}

/**
 * แสดง Toast แจ้งเตือนสวยงาม
 */
function showToast(message, type = 'info') {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icons = {
        success: '✅',
        error: '❌',
        warning: '⚠️',
        info: 'ℹ️'
    };

    toast.innerHTML = `
        <span style="font-size: 16px;">${icons[type] || 'ℹ️'}</span>
        <span>${message}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

/**
 * ตรวจสอบสถานะการเข้าสู่ระบบและอัปเดต UI Sidebar
 */
async function checkAuth() {
    try {
        const data = await apiCall('/auth/me');
        if (data && data.user) {
            currentUser = data.user;
            updateUserUI(currentUser);
            return currentUser;
        }
    } catch (err) {
        if (!window.location.pathname.endsWith('index.html') && window.location.pathname !== '/') {
            window.location.href = '/index.html';
        }
    }
    return null;
}

/**
 * อัปเดตข้อมูลผู้ใช้ในแถบเมนู
 */
function updateUserUI(user) {
    const nameEl = document.getElementById('sidebarUserName');
    const roleEl = document.getElementById('sidebarUserRole');
    const avatarEl = document.getElementById('sidebarUserAvatar');

    const roleNames = {
        admin: 'ผู้ดูแลระบบ',
        academic: 'ฝ่ายวิชาการ',
        teacher: 'ครูผู้สอน',
        student: 'นักเรียน/นักศึกษา'
    };

    if (nameEl) nameEl.textContent = user.full_name || user.username;
    if (roleEl) roleEl.textContent = roleNames[user.role] || user.role;
    if (avatarEl) {
        const initial = (user.full_name || user.username).charAt(0).toUpperCase();
        avatarEl.textContent = initial;
    }

    // ซ่อนเมนูที่ไม่ได้รับอนุญาต
    if (user.role === 'teacher' || user.role === 'student') {
        document.querySelectorAll('.role-admin-only').forEach(el => el.style.display = 'none');
    }
}

/**
 * ออกจากระบบ
 */
async function handleLogout() {
    if (confirm('คุณต้องการออกจากระบบใช่หรือไม่?')) {
        try {
            await apiCall('/auth/logout', { method: 'POST' });
        } catch (e) {}
        window.location.href = '/index.html';
    }
}

/**
 * หน้าต่างยืนยันการดำเนินการ (Confirm Dialog)
 */
function showConfirmDialog(title, message, onConfirm, isDanger = false) {
    const existing = document.getElementById('confirmModal');
    if (existing) existing.remove();

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop show';
    backdrop.id = 'confirmModal';

    backdrop.innerHTML = `
        <div class="modal-content" style="max-width: 440px;">
            <div class="modal-header">
                <h3>${title}</h3>
                <button class="modal-close" onclick="this.closest('.modal-backdrop').remove()">✕</button>
            </div>
            <div class="modal-body">
                <p style="color: #475569; font-size: 15px;">${message}</p>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="this.closest('.modal-backdrop').remove()">ยกเลิก</button>
                <button class="btn ${isDanger ? 'btn-danger' : 'btn-primary'}" id="confirmDialogBtn">ยืนยัน</button>
            </div>
        </div>
    `;

    document.body.appendChild(backdrop);

    document.getElementById('confirmDialogBtn').onclick = () => {
        backdrop.remove();
        if (typeof onConfirm === 'function') onConfirm();
    };
}

/**
 * ดึงข้อมูลภาคเรียนปัจจุบัน
 */
async function loadCurrentSemester() {
    try {
        const semester = await apiCall('/assignments/semesters/current');
        const badge = document.getElementById('currentSemesterBadge');
        if (badge && semester) {
            badge.innerHTML = `📅 ${semester.name} (ปีการศึกษา ${semester.year})`;
        }
        return semester;
    } catch (e) {
        return null;
    }
}

// ผูก Event Listener เมื่อ DOM โหลดเสร็จ
document.addEventListener('DOMContentLoaded', () => {
    // อัปเดต Active Sidebar Link
    const currentPath = window.location.pathname;
    document.querySelectorAll('.sidebar-menu a').forEach(link => {
        const href = link.getAttribute('href');
        if (href && (currentPath.endsWith(href) || (currentPath === '/' && href === 'dashboard.html'))) {
            link.classList.add('active');
        } else {
            link.classList.remove('active');
        }
    });

    // ปุ่มออกจากระบบ
    const logoutBtn = document.getElementById('btnLogout');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }
});
