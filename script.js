// ======================================
// 📌 القسم 1: قاعدة البيانات والمتغيرات العامة والأدوات المساعدة الأساسية
// ======================================

// ══════════════════════
// 1.1 الهيكل الافتراضي لقاعدة البيانات
// ══════════════════════
const DEFAULT_DB = {
    profile: { name: "المستخدم", role: "رائد أعمال", email: "", phone: "", address: "", bio: "", pic: null, shopName: "" },
    contacts: [],
    transactions: [],
    reminders: [],
    products: [],
    categories: [],
    productMovements: [],
    invoices: [],
    vault: [],
    expenses: [],
    settings: { 
        currency: 'ج.م', 
        autoSave: false, 
        autoSaveTime: 86400, 
        lastAutoSave: 0, 
        totalsMode: 'active', 
        pinLock: { enabled: false, hash: null }, 
        lastBackupTime: 0, 
        lastBackupReminder: null,
        staff: { enabled: false, users: [] }
    } 
};

let db = JSON.parse(localStorage.getItem('WEALTH_OS_PRO')) || {};

// التأكد من بناء كافة الحقول الفرعية لضمان عمل دفتر الديون بسلامة
if(!db.profile) db.profile = DEFAULT_DB.profile;
if(!db.settings) db.settings = DEFAULT_DB.settings;
if(!db.contacts) db.contacts = [];
if(!db.transactions) db.transactions = [];
if(!db.reminders) db.reminders = [];
if(!db.vault) db.vault = [];
if(!db.settings.totalsMode) db.settings.totalsMode = 'active';

// ══════════════════════
// 1.2 المتغيرات العامة لبرنامج الديون
// ══════════════════════
let currentContactId = null;
let currentTxId = null;
let currentReceipt = null;
let receiptDeleted = false;
let currentContactView = 'active';
let currentDebtTab = 'contacts';
let currentAgingFilterBucket = null;
let debtPlanStrategy = 'snowball';
let reminderContactId = null;
let currentPDFData = null;
let currentPDFTitle = 'document';
let notifQueue = [];
let notifShowing = false;
let currentNotifAction = null;
let notifiedReminderIds = new Set();
let pendingDelete = null;
let pendingDeleteTimer = null;
let confirmState = null;
let calcExpression = '';
let csvImportMode = 'transactions';
const UNDO_MS = 5000;

// ══════════════════════
// 1.3 الأدوات المساعدة الأساسية
// ══════════════════════

// ------------------------------------------
// دالة 1.3.1: round2 — تقريب الأرقام لخانتين عشريتين بدقة
// ------------------------------------------
function round2(n) { 
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100; 
}

// ------------------------------------------
// دالة 1.3.2: formatMoney — تنسيق المبالغ مع عملة النظام
// ------------------------------------------
function formatMoney(n) {
    const val = round2(n);
    const curr = (db.settings && db.settings.currency) ? db.settings.currency : 'ج.م';
    return `${val.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${curr}`;
}

// ------------------------------------------
// دالة 1.3.3: getTodayStr — جلب تاريخ اليوم بصيغة YYYY-MM-DD
// ------------------------------------------
function getTodayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ------------------------------------------
// دالة 1.3.4: toLocalInput — تحويل التاريخ لصيغة حقول الإدخال
// ------------------------------------------
function toLocalInput(d) {
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
}

// ------------------------------------------
// دالة 1.3.5: hashPin — تشفير الرمز السري للدخول
// ------------------------------------------
function hashPin(pin) { 
    let h = 5381; 
    for(let i = 0; i < pin.length; i++){ h = ((h << 5) + h) + pin.charCodeAt(i); } 
    return String(h); 
}

// ------------------------------------------
// دالة 1.3.6: timeAgoStr — تحويل التوقيت لصيغة منذ متى
// ------------------------------------------
function timeAgoStr(timestamp) {
    const days = Math.floor((Date.now() - timestamp) / 86400000);
    if(days <= 0) return 'اليوم';
    if(days === 1) return 'أمس';
    if(days < 30) return `منذ ${days} يوم`;
    const months = Math.floor(days / 30);
    if(months < 12) return `منذ ${months} شهر`;
    const years = Math.floor(months / 12);
    return years === 1 ? 'منذ سنة' : `منذ ${years} سنة`;
}

// ------------------------------------------
// دالة 1.3.7: isCustomer — التحقق من أن الطرف عميل
// ------------------------------------------
function isCustomer(c) { 
    return !c.type || c.type === 'customer'; 
}

// ------------------------------------------
// دالة 1.3.8: saveDb — حفظ قاعدة البيانات وتحديث شاشات الديون المفتوحة
// ------------------------------------------
function saveDb() { 
    localStorage.setItem('WEALTH_OS_PRO', JSON.stringify(db)); 
    
    const debtsView = document.getElementById('debt-main-view');
    if(debtsView && debtsView.style.display !== 'none') {
        renderContacts();
        calculateTotals();
        updateDebtTabBadges();
    }
    const ledgerView = document.getElementById('debt-ledger-view');
    if(ledgerView && ledgerView.style.display !== 'none' && currentContactId) {
        renderTransactions();
    }
}

// ------------------------------------------
// دالة 1.3.9: getLocalDatetime — التاريخ والوقت الحالي لصيغة الحقول
// ------------------------------------------
function getLocalDatetime() { 
    return toLocalInput(new Date()); 
}

// ------------------------------------------
// دالة 1.3.10: getShopName — جلب اسم المنشأة أو الاسم الافتراضي
// ------------------------------------------
function getShopName() {
    return (db.profile && db.profile.shopName && db.profile.shopName.trim()) 
        ? db.profile.shopName.trim() 
        : 'منظومة الثراء الشاملة';
}

// ------------------------------------------
// دالة 1.3.11: playTransactionDing — نغمة صوتية تفاعلية عند حفظ المعاملة
// ------------------------------------------
function playTransactionDing() {
    try {
        const audioEl = document.getElementById('audio-transaction-ding');
        if(audioEl) {
            audioEl.currentTime = 0;
            const p = audioEl.play();
            if(p && typeof p.catch === 'function') {
                p.catch(() => playSynthesizedDing());
            }
            return;
        }
        playSynthesizedDing();
    } catch(e) {
        playSynthesizedDing();
    }
}

function playSynthesizedDing() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        if (ctx.state === 'suspended') ctx.resume();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1046.5, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1567.98, ctx.currentTime + 0.08);
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.36);
    } catch(e) {}
}


// ======================================
// 📌 القسم 2: معالجة الصور والتخزين المحلي للصور (IndexedDB)
// ======================================

// ══════════════════════
// 2.1 ثوابت وحالة قاعدة الصور
// ══════════════════════
const IDB_NAME = "WealthOS_DB";
const IDB_STORE = "receipts";
let receiptDB;

// ══════════════════════
// 2.2 دوال إدارة تخزين وقراءة الصور
// ══════════════════════

// ------------------------------------------
// دالة 2.2.1: compressImage — ضغط صور الإيصالات لتقليل الحجم
// ------------------------------------------
function compressImage(srcData, maxWidth = 800, quality = 0.7) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = function() {
            let canvas = document.createElement('canvas');
            let width = img.width, height = img.height;
            if (width > maxWidth) {
                height = Math.round((height * maxWidth) / width);
                width = maxWidth;
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.src = srcData;
    });
}

// ------------------------------------------
// دالة 2.2.2: initReceiptDB — تهيئة قاعدة بيانات IndexedDB
// ------------------------------------------
function initReceiptDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(IDB_NAME, 2);
        request.onupgradeneeded = function(e) {
            const database = e.target.result;
            if (!database.objectStoreNames.contains(IDB_STORE)) {
                database.createObjectStore(IDB_STORE, { keyPath: "id" });
            }
        };
        request.onsuccess = function(e) { receiptDB = e.target.result; resolve(receiptDB); };
        request.onerror = function(e) { reject(e); };
    });
}

// ------------------------------------------
// دالة 2.2.3: idbPut — تخزين عنصر في IndexedDB
// ------------------------------------------
function idbPut(storeName, obj) {
    return new Promise(async (resolve, reject) => {
        const database = await initReceiptDB();
        const tx = database.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(obj);
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e);
    });
}

// ------------------------------------------
// دالة 2.2.4: idbGet — استرجاع صورة من IndexedDB
// ------------------------------------------
function idbGet(storeName, id) {
    return new Promise(async (resolve, reject) => {
        const database = await initReceiptDB();
        const tx = database.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).get(id);
        req.onsuccess = () => resolve(req.result ? req.result.data : null);
        req.onerror = (e) => reject(e);
    });
}

// ------------------------------------------
// دالة 2.2.5: idbDelete — حذف صورة من IndexedDB
// ------------------------------------------
function idbDelete(storeName, id) {
    return new Promise(async (resolve, reject) => {
        const database = await initReceiptDB();
        const tx = database.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e);
    });
}

// ------------------------------------------
// دالة 2.2.6: saveReceiptToDB — حفظ إيصال المعاملة
// ------------------------------------------
const saveReceiptToDB = (id, data) => idbPut(IDB_STORE, { id, data });

// ------------------------------------------
// دالة 2.2.7: getReceiptFromDB — قراءة إيصال المعاملة
// ------------------------------------------
const getReceiptFromDB = (id) => idbGet(IDB_STORE, id);

// ------------------------------------------
// دالة 2.2.8: deleteReceiptFromDB — حذف إيصال المعاملة
// ------------------------------------------
const deleteReceiptFromDB = (id) => idbDelete(IDB_STORE, id);


// ======================================
// 📌 القسم 3: واجهة المستخدم والتنقل (UI & Navigation)
// ======================================

// ══════════════════════
// 3.1 الواجهة الأساسية والقائمة الجانبية
// ══════════════════════

// ------------------------------------------
// دالة 3.1.1: toggleSidebar — فتح وقفل القائمة الجانبية
// ------------------------------------------
function toggleSidebar() { 
    document.getElementById('sidebar').classList.toggle('open'); 
    document.getElementById('sidebar-overlay').classList.toggle('show');
    document.body.classList.toggle('no-scroll');
}

// ------------------------------------------
// دالة 3.1.2: toggleTheme — تبديل المظهر الليلي والنهاري
// ------------------------------------------
function toggleTheme() { 
    document.documentElement.classList.toggle('light-theme');
    const isLight = document.documentElement.classList.contains('light-theme');
    localStorage.setItem('app_theme', isLight ? 'light' : 'dark');
    updateThemeIcon();
}

// ------------------------------------------
// دالة 3.1.3: updateThemeIcon — تحديث أيقونة الثيم في الهيدر
// ------------------------------------------
function updateThemeIcon() {
    const isLight = document.documentElement.classList.contains('light-theme');
    const icon = document.getElementById('theme-icon');
    if (icon) icon.className = isLight ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
}

// ------------------------------------------
// دالة 3.1.4: openModal — فتح أي نافذة منبثقة
// ------------------------------------------
function openModal(id) { 
    if(id === "debts-settings-modal") {
        updateDebtsSettingsUI();
    }
    const el = document.getElementById(id);
    if(el) el.classList.add("show"); 
}

// ------------------------------------------
// دالة 3.1.5: closeModal — إغلاق أي نافذة منبثقة
// ------------------------------------------
function closeModal(id) { 
    const el = document.getElementById(id);
    if(el) el.classList.remove('show'); 
}

// ------------------------------------------
// دالة 3.1.6: goToHub — الرجوع لشاشة الواجهة الرئيسية (Main Hub)
// ------------------------------------------
function goToHub() {
    window.location.href = '../index.html';
}

// ------------------------------------------
// دالة 3.1.7: contactSupport — فتح رسائل الواتساب للدعم والشكاوى
// ------------------------------------------
function contactSupport(number) {
    let phone = number.replace(/\D/g, '');
    if (phone.startsWith('0')) phone = '20' + phone.substring(1); 
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent('مرحباً، أحتاج مساعدة في دفتر الديون')}`, '_blank');
}

// ------------------------------------------
// دالة 3.1.8: togglePhoneVisibility — إظهار أو إخفاء رقم الهاتف بكشف الحساب
// ------------------------------------------
function togglePhoneVisibility() {
    const phoneEl = document.getElementById('ledger-phone');
    if(phoneEl) phoneEl.style.display = phoneEl.style.display === 'none' ? 'block' : 'none';
}


// ======================================
// 📌 القسم 4: إدارة العملاء والحسابات (Contacts & Accounts)
// ======================================

// ══════════════════════
// 4.1 إدارة بيانات وحسابات العملاء
// ══════════════════════

// ------------------------------------------
// دالة 4.1.1: openAddContactModal — فتح نافذة إضافة عميل جديد
// ------------------------------------------
function openAddContactModal() {
    document.getElementById('contact-modal-title').innerText = 'إضافة عميل جديد';
    document.getElementById('edit-contact-id').value = '';
    document.getElementById('edit-contact-name').value = '';
    document.getElementById('edit-contact-phone').value = '';
    document.getElementById('edit-contact-address').value = '';
    document.getElementById('edit-contact-notes').value = '';
    document.getElementById('edit-contact-ceiling').value = '';
    document.getElementById('edit-contact-due-date').value = '';
    document.getElementById('delete-contact-btn').style.display = 'none';
    const archBtn = document.getElementById('archive-contact-btn');
    if(archBtn) archBtn.style.display = 'none';
    openModal('contact-modal');
}

// ------------------------------------------
// دالة 4.1.2: openEditContactModal — فتح نافذة تعديل بيانات العميل
// ------------------------------------------
function openEditContactModal() {
    const c = db.contacts.find(c => c.id == currentContactId);
    if(!c) return;
    document.getElementById('contact-modal-title').innerText = 'تعديل بيانات العميل';
    document.getElementById('edit-contact-id').value = c.id;
    document.getElementById('edit-contact-name').value = c.name;
    document.getElementById('edit-contact-phone').value = c.phone || '';
    document.getElementById('edit-contact-address').value = c.address || '';
    document.getElementById('edit-contact-notes').value = c.notes || '';
    document.getElementById('edit-contact-ceiling').value = c.ceiling || '';
    document.getElementById('edit-contact-due-date').value = c.dueDate || '';
    document.getElementById('delete-contact-btn').style.display = 'block';
    const archBtn = document.getElementById('archive-contact-btn');
    if(archBtn) {
        archBtn.style.display = 'block';
        archBtn.innerHTML = c.archived ? '<i class="fa-solid fa-rotate-left"></i> استرجاع' : '<i class="fa-solid fa-box-archive"></i> أرشفة';
    }
    openModal('contact-modal');
}

// ------------------------------------------
// دالة 4.1.3: saveContactChanges — حفظ بيانات العميل في قاعدة البيانات
// ------------------------------------------
function saveContactChanges() {
    const id = document.getElementById('edit-contact-id').value;
    const name = document.getElementById('edit-contact-name').value.trim();
    const phone = document.getElementById('edit-contact-phone').value.trim();
    const address = document.getElementById('edit-contact-address').value.trim();
    const notes = document.getElementById('edit-contact-notes').value.trim();
    const ceiling = document.getElementById('edit-contact-ceiling').value;
    const dueDate = document.getElementById('edit-contact-due-date').value;
    
    if(!name) { alert('أدخل اسم العميل'); return; }

    const data = { 
        name, phone, address: address || '', notes: notes || '', 
        ceiling: ceiling ? Number(ceiling) : null, 
        dueDate: dueDate || null,
        type: 'customer'
    };

    if(id) {
        const idx = db.contacts.findIndex(c => c.id == id);
        if(idx !== -1) Object.assign(db.contacts[idx], data);
    } else {
        db.contacts.push({ id: Date.now(), archived: false, lastCeilingAlert: null, lastDueAlert: null, ...data });
    }
    
    saveDb();
    closeModal('contact-modal');
    
    if (currentContactId) {
        document.getElementById('ledger-name').innerHTML = name + ' <i class="fa-solid fa-pen fa-xs" style="color:var(--c-gold); cursor:pointer;" onclick="event.stopPropagation(); openEditContactModal()"></i>';
        document.getElementById('ledger-phone').innerText = `الهاتف: ${phone || 'لا يوجد'}`;
        renderLedgerInfo();
    }
    renderContacts();
}

// ------------------------------------------
// دالة 4.1.4: deleteContact — حذف العميل مع دعم التراجع (Undo) لمدة 5 ثوانٍ
// ------------------------------------------
function deleteContact(id) {
    closeModal('contact-modal');
    showConfirm('سيتم حذف العميل وجميع معاملاته نهائياً! هل أنت متأكد؟', async () => {
        const c = db.contacts.find(x => x.id == id);
        if(!c) return;
        const txs = db.transactions.filter(t => t.contactId == id);
        const receiptsToLoad = txs.filter(t => t.receipt).map(t => t.id);
        
        const receipts = {};
        for(const rid of receiptsToLoad) {
            receipts[rid] = await getReceiptFromDB(rid);
        }
        
        db.contacts = db.contacts.filter(x => x.id != id);
        db.transactions = db.transactions.filter(t => t.contactId != id);
        saveDb();
        backToDebtMain();
        
        registerUndo(
            `تم حذف العميل "${c.name}" (${txs.length} معاملة)`,
            { contact: c, transactions: txs, receipts },
            () => {
                db.contacts.push(c);
                db.transactions.push(...txs);
                saveDb();
                renderContacts();
                calculateTotals();
            },
            () => {
                txs.filter(t => t.receipt).forEach(t => deleteReceiptFromDB(t.id));
            }
        );
    }, () => {
        openEditContactModal();
    });
}

// ------------------------------------------
// دالة 4.1.5: toggleArchiveContact — أرشفة واسترجاع العميل
// ------------------------------------------
function toggleArchiveContact(id) {
    const c = db.contacts.find(x => x.id == id);
    if(!c) return;
    c.archived = !c.archived;
    saveDb();
    closeModal('contact-modal');
    if(c.archived) {
        showNotification('تمت الأرشفة', `تم نقل "${c.name}" إلى الأرشيف.`);
        if(currentContactId == id) backToDebtMain();
    } else {
        showNotification('تم الاسترجاع', `تم إرجاع "${c.name}" لقائمة العملاء النشطين.`);
    }
    renderContacts();
    calculateTotals();
}

// ------------------------------------------
// دالة 4.1.6: restoreContact — استرجاع العميل المؤرشف
// ------------------------------------------
function restoreContact(id) { 
    toggleArchiveContact(id); 
}

// ------------------------------------------
// دالة 4.1.7: getContactBalance — حساب صافي رصيد العميل
// ------------------------------------------
function getContactBalance(contactId) {
    let balance = 0;
    db.transactions.filter(t => t.contactId == contactId).forEach(t => {
        if(t.direction === 'in') balance += t.amount;  
        else if(t.direction === 'out') balance -= t.amount; 
    });
    return round2(balance);
}

// ------------------------------------------
// دالة 4.1.8: setContactView — تبديل عرض النشطين والأرشيف
// ------------------------------------------
function setContactView(view) { 
    currentContactView = view; 
    renderContacts(); 
}

// ------------------------------------------
// دالة 4.1.9: getLastTxDate — جلب تاريخ آخر حركة للعميل
// ------------------------------------------
function getLastTxDate(contactId) {
    const txs = db.transactions.filter(t => t.contactId == contactId);
    if(txs.length === 0) return 0;
    return Math.max(...txs.map(t => new Date(t.date).getTime()));
}

// ------------------------------------------
// دالة 4.1.10: getContactWarnIcons — توليد أيقونات التحذير لسقف الدين وتاريخ الاستحقاق
// ------------------------------------------
function getContactWarnIcons(c, balance) {
    let icons = '';
    if(balance < 0) {
        const debt = Math.abs(balance);
        if(c.ceiling && debt > Number(c.ceiling)) {
            icons += ' <i class="fa-solid fa-triangle-exclamation" style="color:var(--c-red); font-size:0.72rem;" title="تجاوز سقف الدين!"></i>';
        }
        if(c.dueDate) {
            const today0 = new Date(); today0.setHours(0,0,0,0);
            const due0 = new Date(c.dueDate); due0.setHours(0,0,0,0);
            const dDays = Math.ceil((due0 - today0) / 86400000);
            if(dDays < 0) {
                icons += ' <i class="fa-solid fa-calendar-xmark" style="color:var(--c-red); font-size:0.72rem;" title="تجاوز تاريخ الاستحقاق!"></i>';
            } else if(dDays <= 3) {
                icons += ' <i class="fa-solid fa-calendar-day" style="color:var(--c-gold); font-size:0.72rem;" title="الاستحقاق قريب!"></i>';
            }
        }
    }
    return icons;
}

// ------------------------------------------
// دالة 4.1.11: renderContacts — بناء وعرض قائمة العملاء بالأرصدة والفرز
// ------------------------------------------
function renderContacts() {
    const list = document.getElementById('contacts-list');
    if(!list) return;
    list.innerHTML = '';

    const customers = db.contacts.filter(c => isCustomer(c));
    
    const archivedCountEl = document.getElementById('archived-count');
    if(archivedCountEl) archivedCountEl.innerText = customers.filter(c => c.archived).length;
    const tabActive = document.getElementById('tab-active');
    const tabArchived = document.getElementById('tab-archived');
    if(tabActive) tabActive.classList.toggle('active', currentContactView === 'active');
    if(tabArchived) tabArchived.classList.toggle('active', currentContactView === 'archived');

    const searchTerm = (document.getElementById('search-contacts')?.value || '').toLowerCase();
    const filterVal = document.getElementById('contact-filter')?.value || 'all';
    const sortVal = document.getElementById('contact-sort')?.value || 'name';

    let filteredContacts = customers.filter(c => (currentContactView === 'archived' ? c.archived : !c.archived));
    filteredContacts = filteredContacts.filter(c => c.name.toLowerCase().includes(searchTerm) || (c.phone && c.phone.includes(searchTerm)));

    if(currentContactView === 'active') {
        filteredContacts = filteredContacts.filter(c => {
            const b = getContactBalance(c.id);
            if(filterVal === 'pos') return b > 0;
            if(filterVal === 'neg') return b < 0;
            if(filterVal === 'zero') return b === 0;
            return true;
        });
    }

    if(sortVal === 'debt') {
        filteredContacts.sort((a, b) => getContactBalance(a.id) - getContactBalance(b.id));
    } else if(sortVal === 'recent') {
        filteredContacts.sort((a, b) => getLastTxDate(b.id) - getLastTxDate(a.id));
    } else {
        filteredContacts.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    }

    if(filteredContacts.length === 0) {
        list.innerHTML = `<p class="sub-text" style="text-align:center; padding:20px;">${currentContactView === 'archived' ? 'لا يوجد عملاء في الأرشيف.' : 'لا يوجد عملاء مطابقين.'}</p>`;
        return;
    }

    filteredContacts.forEach(c => {
        const balance = getContactBalance(c.id);
        let balClass = 'pos', balText = `${formatMoney(balance)} (له)`, icon = 'fa-arrow-down'; 
        if(balance < 0) { balClass = 'neg'; balText = `${formatMoney(Math.abs(balance))} (عليه)`; icon = 'fa-arrow-up'; } 
        if(balance === 0) { balClass = 'zero'; balText = 'خالص'; icon = 'fa-check'; }
        
        const hasReminder = db.reminders.some(r => r.contactId == c.id && !r.done && new Date(r.date) <= new Date());
        const notifDot = hasReminder ? '<span class="notif-dot"></span>' : '';
        const warnIcons = currentContactView === 'active' ? getContactWarnIcons(c, balance) : '';
        const lastTs = getLastTxDate(c.id);
        const lastTxSmall = `<small style="font-size:0.65rem; color:var(--muted);">${lastTs ? 'آخر تعامل: ' + timeAgoStr(lastTs) : 'لا يوجد تعامل بعد'}</small>`;
        
        if(currentContactView === 'archived') {
            list.innerHTML += `
                <div class="ledger-row">
                    <div class="ledger-item archived-item" onclick="openContactTransactions(${c.id})">
                        <div class="ledger-info">
                            <strong><i class="fa-solid fa-box-archive" style="color:var(--muted); font-size:0.8rem;"></i> ${c.name}</strong>
                            ${lastTxSmall}
                        </div>
                        <div class="ledger-bal ${balClass}">
                            <i class="fa-solid ${icon}"></i> ${balText}
                        </div>
                    </div>
                    <button class="quick-add-box" style="background:var(--c-blue) !important;" onclick="event.stopPropagation(); restoreContact(${c.id})" title="استرجاع من الأرشيف">
                        <i class="fa-solid fa-rotate-left"></i>
                    </button>
                </div>
            `;
        } else {
            list.innerHTML += `
                <div class="ledger-row">
                    <button class="quick-add-box" onclick="event.stopPropagation(); quickAddTx(${c.id})">
                        <i class="fa-solid fa-plus"></i>
                    </button>
                    <div class="ledger-item" onclick="openContactTransactions(${c.id})">
                        <div class="ledger-info">
                            <strong>${notifDot} ${c.name}${warnIcons}</strong>
                            ${lastTxSmall}
                        </div>
                        <div class="ledger-bal ${balClass}">
                            <i class="fa-solid ${icon}"></i> ${balText}
                        </div>
                    </div>
                </div>
            `;
        }
    });
}

// ------------------------------------------
// دالة 4.1.12: searchContacts — البحث الفوري في العملاء
// ------------------------------------------
function searchContacts() { 
    renderContacts(); 
}

// ------------------------------------------
// دالة 4.1.13: calculateTotals — احتساب إجماليات ما لك وما عليك والصافي
// ------------------------------------------
function calculateTotals() {
    const mode = (db.settings && db.settings.totalsMode) || 'active';
    const allContacts = db.contacts.filter(c => isCustomer(c));
    const relevantContacts = allContacts.filter(c => mode === 'all' || !c.archived);
    const relevantIds = new Set(relevantContacts.map(c => String(c.id)));
    
    let totalIn = 0, totalOut = 0;
    db.transactions.forEach(t => {
        if(!relevantIds.has(String(t.contactId))) return;
        if(t.direction === 'in') totalIn += t.amount;
        else if(t.direction === 'out') totalOut += t.amount;
    });
    totalIn = round2(totalIn); 
    totalOut = round2(totalOut);
    
    const net = round2(totalIn - totalOut);
    const forMeEl = document.getElementById('total-for-me');
    const onMeEl = document.getElementById('total-on-me');
    const netEl = document.getElementById('total-net');
    
    if(forMeEl) forMeEl.innerText = formatMoney(totalIn);
    if(onMeEl) onMeEl.innerText = formatMoney(totalOut);
    if(netEl) {
        netEl.innerText = formatMoney(net);
        netEl.style.color = net >= 0 ? 'var(--c-green)' : 'var(--c-red)';
    }

    const clientsEl = document.getElementById('stat-clients');
    if(clientsEl) clientsEl.innerText = relevantContacts.length;
    
    const debts = relevantContacts.map(c => Math.abs(Math.min(0, getContactBalance(c.id)))).filter(d => d > 0);
    const maxEl = document.getElementById('stat-max-debt');
    if(maxEl) maxEl.innerText = debts.length ? formatMoney(Math.max(...debts)) : formatMoney(0);
    const avgEl = document.getElementById('stat-avg-debt');
    if(avgEl) avgEl.innerText = debts.length ? formatMoney(round2(debts.reduce((a, b) => a + b, 0) / debts.length)) : formatMoney(0);

    renderDebtsRatioDonut(totalIn, totalOut, net);
}

// ------------------------------------------
// دالة 4.1.14: openDebtChartModal — فتح نافذة أعلى المديونيات بيانيا
// ------------------------------------------
function openDebtChartModal() {
    const el = document.getElementById('debt-chart-modal-content');
    if(!el) return;
    const mode = (db.settings && db.settings.totalsMode) || 'active';
    const customers = db.contacts.filter(c => isCustomer(c) && (mode === 'all' || !c.archived));
    const list = customers
        .map(c => ({ name: c.name, debt: Math.abs(Math.min(0, getContactBalance(c.id))) }))
        .filter(x => x.debt > 0)
        .sort((a, b) => b.debt - a.debt)
        .slice(0, 5);
    
    if(list.length === 0) {
        el.innerHTML = '<p class="sub-text" style="text-align:center; padding:20px;">لا توجد مديونيات حالياً 🎉</p>';
    } else {
        const max = list[0].debt;
        el.innerHTML = `<p class="sub-text" style="text-align:center; margin-bottom:12px;">أعلى ${list.length} مديونيات</p>` + 
            list.map(x => `
            <div class="chart-row">
                <span class="chart-name">${x.name}</span>
                <div class="chart-bar-wrap"><div class="chart-bar" style="width:${Math.max(4, Math.round((x.debt / max) * 100))}%;"></div></div>
                <span class="chart-val">${formatMoney(x.debt)}</span>
            </div>
        `).join('');
    }
    openModal('debt-chart-modal');
}

// ------------------------------------------
// دالة 4.1.15: changeTotalsMode — تبديل وضع الإجماليات (النشطين فقط أو شامل الأرشيف)
// ------------------------------------------
function changeTotalsMode() {
    db.settings.totalsMode = document.getElementById('totals-mode').value;
    saveDb();
    calculateTotals();
}

// ======================================
// 📌 القسم 5: المعاملات المالية وكشف الحساب المفرد (Transactions & Ledger View)
// ======================================

// ══════════════════════
// 5.1 كشف حساب العميل والتنقل
// ══════════════════════

// ------------------------------------------
// دالة 5.1.1: openContactTransactions — فتح كشف الحساب التفصيلي لعميل محدد
// ------------------------------------------
function openContactTransactions(id) {
    currentContactId = id;
    const contact = db.contacts.find(c => c.id == id);
    if(!contact) return;

    document.getElementById('debt-main-view').style.display = 'none';
    document.getElementById('debt-ledger-view').style.display = 'block';
    document.getElementById('fabAddTx').style.display = 'flex';
    
    document.getElementById('ledger-name').innerHTML = contact.name + ' <i class="fa-solid fa-pen fa-xs" style="color:var(--c-gold); cursor:pointer;" onclick="event.stopPropagation(); openEditContactModal()"></i>';
    document.getElementById('ledger-phone').innerText = `الهاتف: ${contact.phone || 'لا يوجد'}`;
    document.getElementById('ledger-phone').style.display = 'none';
    
    db.reminders = db.reminders.filter(r => !(r.contactId == id && !r.done && new Date(r.date) <= new Date()));
    saveDb();
    renderContacts();
    renderLedgerInfo();
    renderTransactions();
}

// ------------------------------------------
// دالة 5.1.2: renderLedgerInfo — عرض تنبيهات سقف الدين والاستحقاق
// ------------------------------------------
function renderLedgerInfo() {
    const contact = db.contacts.find(c => c.id == currentContactId);
    const alertsEl = document.getElementById('ledger-alerts');
    const infoEl = document.getElementById('ledger-extra-info');
    if(!contact || !alertsEl || !infoEl) return;
    
    const balance = getContactBalance(contact.id);
    let alertsHtml = '', infoHtml = '';
    
    if(balance < 0 && contact.ceiling && Math.abs(balance) > Number(contact.ceiling)) {
        alertsHtml += `<div class="ledger-alert red"><i class="fa-solid fa-triangle-exclamation"></i> <span>تحذير: المديونية تجاوزت سقف الدين المحدد (${formatMoney(contact.ceiling)})!</span></div>`;
    }
    
    if(contact.dueDate) {
        const today = new Date(); today.setHours(0,0,0,0);
        const due = new Date(contact.dueDate); due.setHours(0,0,0,0);
        const days = Math.ceil((due - today) / 86400000);
        if(balance < 0 && days < 0) {
            alertsHtml += `<div class="ledger-alert red"><i class="fa-solid fa-calendar-xmark"></i> <span>تجاوز تاريخ الاستحقاق بمقدار ${Math.abs(days)} يوم ولم يتم السداد!</span></div>`;
        } else if(balance < 0 && days <= 3) {
            alertsHtml += `<div class="ledger-alert gold"><i class="fa-solid fa-calendar-day"></i> <span>تاريخ الاستحقاق ${days === 0 ? 'اليوم' : 'بعد ' + days + ' يوم'}!</span></div>`;
        }
        infoHtml += `<div><i class="fa-solid fa-calendar-check" style="color:var(--c-blue);"></i> تاريخ الاستحقاق: ${new Date(contact.dueDate).toLocaleDateString('ar-EG')}</div>`;
    }
    
    if(contact.address) infoHtml += `<div><i class="fa-solid fa-location-dot" style="color:var(--c-gold);"></i> العنوان: ${contact.address}</div>`;
    if(contact.notes) infoHtml += `<div><i class="fa-solid fa-note-sticky" style="color:var(--c-gold);"></i> ملاحظات: ${contact.notes}</div>`;
    if(contact.ceiling) infoHtml += `<div><i class="fa-solid fa-gauge-simple-high" style="color:var(--c-gold);"></i> سقف الدين: ${formatMoney(contact.ceiling)}</div>`;
    
    alertsEl.innerHTML = alertsHtml;
    infoEl.innerHTML = infoHtml ? `<div style="display:flex; flex-direction:column; gap:4px; font-size:0.78rem; color:var(--muted);">${infoHtml}</div>` : '';
}

// ------------------------------------------
// دالة 5.1.3: backToDebtMain — الرجوع لشاشة العملاء الرئيسية
// ------------------------------------------
function backToDebtMain() {
    currentContactId = null;
    document.getElementById('debt-main-view').style.display = 'block';
    document.getElementById('debt-ledger-view').style.display = 'none';
    document.getElementById('fabAddTx').style.display = 'none';
    renderContacts();
    calculateTotals();
}

// ------------------------------------------
// دالة 5.1.4: quickAddTx — فتح تسجيل معاملة مباشرة لعميل
// ------------------------------------------
function quickAddTx(id) {
    openContactTransactions(id);
    setTimeout(() => openTxModal(), 200);
}

// ══════════════════════
// 5.2 تسجيل وتعديل المعاملات وحركة الحساب
// ══════════════════════

// ------------------------------------------
// دالة 5.2.1: openTxModal — فتح نافذة تسجيل/تعديل معاملة مالية
// ------------------------------------------
async function openTxModal(txId = null) {
    if(isOwner() || !staffEnabled() || can('debts_tx_add')) {
        // مسموح
    } else {
        showNotification('غير مسموح ⛔', 'تسجيل وتعديل المعاملات يحتاج صلاحية — تواصل مع المالك.', 'fa-lock', 'var(--c-red)');
        return;
    }
    
    document.getElementById('tx-id').value = txId || '';
    currentReceipt = null; 
    receiptDeleted = false;
    document.getElementById('receipt-preview').style.display = 'none';
    document.querySelector('#receipt-preview img').src = "";
    document.getElementById('tx-receipt').value = '';
    
    let uniqueNotes = [...new Set(db.transactions.map(t => t.notes).filter(n => n && n.trim() !== ""))];
    document.getElementById('notes-datalist').innerHTML = uniqueNotes.map(n => `<option value="${n}">`).join('');
    
    if(txId) {
        const t = db.transactions.find(t => t.id == txId);
        document.getElementById('tx-modal-title').innerText = 'تعديل المعاملة';
        document.querySelector(`input[name="tx-direction"][value="${t.direction}"]`).checked = true;
        document.getElementById('tx-amount').value = t.amount;
        document.getElementById('tx-date').value = t.date ? t.date.substring(0,16) : getLocalDatetime();
        document.getElementById('tx-notes').value = t.notes;
        
        if(t.receipt) {
            let receiptData = t.receipt === true ? await getReceiptFromDB(txId) : t.receipt;
            if(receiptData) {
                currentReceipt = receiptData;
                document.querySelector('#receipt-preview img').src = receiptData;
                document.getElementById('receipt-preview').style.display = 'block';
            }
        }
    } else {
        document.getElementById('tx-modal-title').innerText = 'تسجيل عملية مالية';
        document.querySelector('input[name="tx-direction"][value="out"]').checked = true; 
        document.getElementById('tx-amount').value = '';
        document.getElementById('tx-date').value = getLocalDatetime();
        document.getElementById('tx-notes').value = '';
    }
    openModal('tx-modal');
}

// ------------------------------------------
// دالة 5.2.2: uploadReceipt — رفع إيصال مصور للمعاملة
// ------------------------------------------
async function uploadReceipt(e) {
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
        const compressed = await compressImage(ev.target.result, 800, 0.7);
        currentReceipt = compressed;
        receiptDeleted = false;
        document.querySelector('#receipt-preview img').src = currentReceipt;
        document.getElementById('receipt-preview').style.display = 'block';
    };
    reader.readAsDataURL(file);
}

// ------------------------------------------
// دالة 5.2.3: removeReceipt — إزالة الإيصال من المعاملة
// ------------------------------------------
function removeReceipt() {
    currentReceipt = null;
    receiptDeleted = true;
    document.querySelector('#receipt-preview img').src = "";
    document.getElementById('receipt-preview').style.display = 'none';
    document.getElementById('tx-receipt').value = '';
}

// ------------------------------------------
// دالة 5.2.4: saveTransaction — حفظ العملية وتحديث الخزنة ورصيد العميل
// ------------------------------------------
async function saveTransaction() {
    const txIdInput = document.getElementById('tx-id').value;
    const directionEl = document.querySelector('input[name="tx-direction"]:checked');
    if(!directionEl) { alert('اختر نوع المعاملة'); return; }
    
    const direction = directionEl.value;
    const amount = parseFloat(document.getElementById('tx-amount').value);
    const date = document.getElementById('tx-date').value;
    const notes = document.getElementById('tx-notes').value;

    if(!amount || amount <= 0) { alert('أدخل مبلغاً صحيحاً'); return; }

    if(txIdInput) {
        const idx = db.transactions.findIndex(t => t.id == txIdInput);
        if(idx !== -1) {
            const txId = Number(txIdInput);
            db.transactions[idx] = { id: txId, contactId: currentContactId, amount: round2(amount), direction, date, notes, receipt: db.transactions[idx].receipt };
            
            if(currentReceipt) {
                await saveReceiptToDB(txId, currentReceipt);
                db.transactions[idx].receipt = true;
            } else if (receiptDeleted) {
                await deleteReceiptFromDB(txId);
                db.transactions[idx].receipt = false;
            }
        }
    } else {
        const txId = Date.now();
        const newTx = { id: txId, contactId: currentContactId, amount: round2(amount), direction, date, notes, receipt: false };
        
        if(currentReceipt) {
            await saveReceiptToDB(txId, currentReceipt);
            newTx.receipt = true;
        }
        db.transactions.push(newTx);
        
        if(direction === 'in') {
            db.vault.push({ id: txId + 1, type: 'in', amount: round2(amount), date, notes: `سداد من عميل${notes ? ' — ' + notes : ''}`, auto: true, linkedTxId: txId });
        }
    }

    closeModal('tx-modal');
    saveDb();
    playTransactionDing();
}

// ------------------------------------------
// دالة 5.2.5: openTxDetails — فتح نافذة تفاصيل العملية المالية
// ------------------------------------------
async function openTxDetails(txId) {
    currentTxId = txId;
    const t = db.transactions.find(t => t.id == txId);
    if(!t) return;

    const typeText = t.direction === 'out' ? 'أعطيته مبلغ (عليه)' : 'أخذت منه (له)';
    const txColor = t.direction === 'out' ? 'var(--c-red)' : 'var(--c-green)';
    const formattedDate = new Date(t.date).toLocaleString('ar-EG');
    
    let receiptHtml = '';
    if(t.receipt) {
        receiptHtml = `<div style="margin-top:10px; text-align:center;"><img data-txid="${t.id}" class="receipt-thumb" alt="Receipt" style="max-width:120px; max-height:120px; border-radius:8px; border:1px solid var(--border); cursor:pointer;" onclick="viewReceiptImage(${t.id})"></div>`;
    }
    
    document.getElementById('tx-details-content').innerHTML = `
        <p style="margin-bottom: 10px;"><strong>النوع:</strong> <span style="color:${txColor}; font-weight:bold;">${typeText}</span></p>
        <p style="margin-bottom: 10px;"><strong>المبلغ:</strong> ${formatMoney(t.amount)}</p>
        <p style="margin-bottom: 10px;"><strong>التاريخ:</strong> ${formattedDate}</p>
        <p><strong>البيان:</strong> ${t.notes || 'لا يوجد'}</p>
        ${receiptHtml}
    `;
    
    if(t.receipt) {
        const receiptData = t.receipt === true ? await getReceiptFromDB(txId) : t.receipt;
        const img = document.querySelector('#tx-details-content .receipt-thumb');
        if(img && receiptData) img.src = receiptData;
    }
    
    openModal('tx-details-modal');
}

// ------------------------------------------
// دالة 5.2.6: viewReceiptImage — عارض صورة الإيصال مكبراً
// ------------------------------------------
async function viewReceiptImage(txId) {
    const t = db.transactions.find(t => t.id == txId);
    if(!t) return;
    const data = t.receipt === true ? await getReceiptFromDB(txId) : t.receipt;
    if(!data) { alert('الإيصال غير موجود'); return; }
    document.getElementById('image-viewer-img').src = data;
    openModal('image-viewer-modal');
}

// ------------------------------------------
// دالة 5.2.7: editTxFromDetails — الانتقال لتعديل المعاملة من التفاصيل
// ------------------------------------------
function editTxFromDetails() { 
    closeModal('tx-details-modal'); 
    openTxModal(currentTxId); 
}

// ------------------------------------------
// دالة 5.2.8: deleteTxFromDetails — حذف المعاملة مع دعم التراجع (Undo)
// ------------------------------------------
function deleteTxFromDetails() {
    if(isOwner() || !staffEnabled() || can('debts_tx_delete')) {
        // مسموح
    } else {
        showNotification('غير مسموح ⛔', 'حذف المعاملات يحتاج صلاحية — تواصل مع المالك.', 'fa-lock', 'var(--c-red)');
        return;
    }
    
    closeModal('tx-details-modal');
    showConfirm('هل تريد حذف هذه المعاملة؟', () => {
        const t = db.transactions.find(x => x.id == currentTxId);
        if(!t) return;
        const hadReceipt = !!t.receipt;
        
        db.transactions = db.transactions.filter(x => x.id != currentTxId);
        db.vault = db.vault.filter(v => v.linkedTxId != currentTxId);
        saveDb();
        
        registerUndo(
            `تم حذف معاملة بمبلغ ${formatMoney(t.amount)}`,
            { tx: t },
            () => {
                db.transactions.push(t);
                saveDb();
                if(currentContactId) renderTransactions();
                renderContacts();
                calculateTotals();
            },
            () => {
                if(hadReceipt) deleteReceiptFromDB(t.id);
            }
        );
    });
}

// ------------------------------------------
// دالة 5.2.9: renderTransactions — بناء جدول حركات المعاملات والرصيد التراكمي
// ------------------------------------------
function renderTransactions() {
    const list = document.getElementById('transactions-list');
    if(!list) return;
    const balance = getContactBalance(currentContactId);
    const balEl = document.getElementById('ledger-balance');
    
    let balText = balance > 0 ? `${formatMoney(balance)} (له)` : (balance < 0 ? `${formatMoney(Math.abs(balance))} (عليه)` : formatMoney(0));
    balEl.innerText = balText;
    balEl.style.color = balance > 0 ? 'var(--c-green)' : (balance < 0 ? 'var(--c-red)' : 'var(--muted)');

    let txs = db.transactions.filter(t => t.contactId == currentContactId).sort((a,b) => new Date(a.date) - new Date(b.date));
    let runningBal = 0;
    txs.forEach(t => {
        if(t.direction === 'in') runningBal = round2(runningBal + t.amount); 
        else if(t.direction === 'out') runningBal = round2(runningBal - t.amount); 
        t.runningBalance = runningBal;
    });
    txs.reverse();
    
    const searchTerm = (document.getElementById('search-tx')?.value || '').toLowerCase();
    const filteredTxs = txs.filter(t => {
        const typeText = t.direction === 'out' ? 'أعطيته عليه' : 'أخذت منه له';
        return (t.notes && t.notes.toLowerCase().includes(searchTerm)) || 
               t.amount.toString().includes(searchTerm) || 
               new Date(t.date).toLocaleString('ar-EG').includes(searchTerm) ||
               typeText.toLowerCase().includes(searchTerm);
    });
    
    if(filteredTxs.length === 0) {
        list.innerHTML = '<p class="sub-text" style="text-align:center; padding:20px;">لا توجد معاملات مطابقة.</p>';
    } else {
        list.innerHTML = '';
        filteredTxs.forEach(t => {
            const typeText = t.direction === 'out' ? 'أعطيته (عليه)' : 'أخذت منه (له)';
            const txClass = t.direction;
            const formattedDate = new Date(t.date).toLocaleString('ar-EG');
            let runBalText = t.runningBalance > 0 ? `${formatMoney(t.runningBalance)} (له)` : (t.runningBalance < 0 ? `${formatMoney(Math.abs(t.runningBalance))} (عليه)` : formatMoney(0));
            let runBalColor = t.runningBalance > 0 ? 'var(--c-green)' : (t.runningBalance < 0 ? 'var(--c-red)' : 'var(--muted)');
            let receiptIcon = t.receipt ? `<i class="fa-solid fa-paperclip" style="font-size:0.8rem; margin-right:5px; color:var(--c-gold);"></i>` : '';
            
            list.innerHTML += `
                <div class="tx-row ${txClass}" onclick="openTxDetails(${t.id})">
                    <div class="tx-info">
                        <small>${formattedDate}</small>
                        <span>${t.notes || typeText} ${receiptIcon}</span>
                    </div>
                    <div class="tx-val-group">
                        <span class="tx-val ${txClass}">${typeText} ${formatMoney(t.amount)}</span>
                        <span class="tx-running" style="color:${runBalColor};">الصافي: ${runBalText}</span>
                    </div>
                </div>
            `;
        });
    }
    renderLedgerInfo();
}

// ------------------------------------------
// دالة 5.2.10: searchTransactions — البحث في حركات المعاملات
// ------------------------------------------
function searchTransactions() { 
    renderTransactions(); 
}

// ------------------------------------------
// دالة 5.2.11: settleFullBalance — تسوية الرصيد كاملاً وتصفية الحساب
// ------------------------------------------
function settleFullBalance() {
    if(isOwner() || !staffEnabled() || can('debts_settle')) {
        // مسموح
    } else {
        showNotification('غير مسموح ⛔', 'التسوية الكاملة تحتاج صلاحية — تواصل مع المالك.', 'fa-lock', 'var(--c-red)');
        return;
    }
    
    const balance = getContactBalance(currentContactId);
    if(balance === 0) { showNotification('لا حاجة للتسوية', 'رصيد العميل خالص بالكامل.', 'fa-circle-info', 'var(--c-gold)'); return; }
    const amount = Math.abs(balance);
    const msg = balance < 0 
        ? `سيتم تسجيل سداد "أخذت منه (له)" بمبلغ ${formatMoney(amount)} لتصفية حساب العميل. متابعة؟`
        : `سيتم تسجيل سداد "أعطيته (عليه)" بمبلغ ${formatMoney(amount)} لتصفية حساب العميل. متابعة؟`;
    showConfirm(msg, () => {
        const direction = balance < 0 ? 'in' : 'out';
        const txId = Date.now();
        db.transactions.push({ id: txId, contactId: currentContactId, amount, direction, date: getLocalDatetime(), notes: 'سداد كامل', receipt: false });
        
        if(direction === 'in') {
            db.vault.push({ id: txId + 1, type: 'in', amount, date: getLocalDatetime(), notes: 'سداد دين من عميل (تسوية كاملة)', auto: true, linkedTxId: txId });
        }
        
        saveDb();
        playTransactionDing();
        showNotification('تمت التسوية', 'تم تصفية حساب العميل بالكامل.');
    });
}


// ======================================
// 📌 القسم 6: تبويبات برنامج الديون وأعمار الديون والديون المتعثرة
// ======================================

// ══════════════════════
// 6.1 التبديل بين التبويبات الأربعة
// ══════════════════════

// ------------------------------------------
// دالة 6.1.1: switchDebtTab — التبديل السلس بين التبويبات الأربعة
// ------------------------------------------
function switchDebtTab(tabKey) {
    currentDebtTab = tabKey;
    const tabs = ['contacts', 'totals', 'aging', 'defaulted'];
    
    tabs.forEach(t => {
        const btn = document.getElementById('debt-tab-btn-' + t);
        const panel = document.getElementById('debt-tab-content-' + t);
        if(btn) btn.classList.toggle('active', t === tabKey);
        if(panel) panel.classList.toggle('active', t === tabKey);
    });

    updateDebtTabBadges();

    if(tabKey === 'contacts') renderContacts();
    else if(tabKey === 'totals') calculateTotals();
    else if(tabKey === 'aging') renderDebtAgingSummary();
    else if(tabKey === 'defaulted') renderDefaultedDebtsList();
}

// ------------------------------------------
// دالة 6.1.2: updateDebtTabBadges — تحديث عدادات التبويبات الحية
// ------------------------------------------
function updateDebtTabBadges() {
    const contactsBadge = document.getElementById('debt-tab-badge-contacts');
    const defaultedBadge = document.getElementById('debt-tab-badge-defaulted');

    const activeContacts = (db.contacts || []).filter(c => !c.archived);
    if(contactsBadge) contactsBadge.innerText = activeContacts.length;

    let defCount = 0;
    activeContacts.forEach(c => {
        const bal = getContactBalance(c.id);
        if(bal >= 0) return;
        const start = getDebtStartDate(c.id);
        const days = start ? Math.floor((Date.now() - new Date(start).getTime()) / 86400000) : 0;
        if(days > 90) defCount++;
    });

    if(defaultedBadge) {
        defaultedBadge.innerText = defCount;
        defaultedBadge.style.display = defCount > 0 ? 'inline-block' : 'none';
    }
}

// ------------------------------------------
// دالة 6.1.3: getDebtStartDate — تحديد تاريخ بداية مديونية العميل الحالية
// ------------------------------------------
function getDebtStartDate(contactId) {
    const txs = db.transactions.filter(t => t.contactId == contactId).sort((a, b) => new Date(a.date) - new Date(b.date));
    let bal = 0, lastNonNegDate = null;
    txs.forEach(t => {
        bal = round2(bal + (t.direction === 'in' ? t.amount : -t.amount));
        if(bal >= 0) lastNonNegDate = t.date;
    });
    let startDate = null;
    for(const t of txs) {
        if(lastNonNegDate && new Date(t.date) <= new Date(lastNonNegDate)) continue;
        if(!startDate) { startDate = t.date; break; }
    }
    if(!startDate && txs.length) startDate = txs[0].date;
    return startDate;
}

// ------------------------------------------
// دالة 6.1.4: renderDebtAgingSummary — بناء ملخص أعمار الديون التفاعلي
// ------------------------------------------
function renderDebtAgingSummary() {
    const container = document.getElementById('debt-aging-chart-container');
    if(!container) return;

    const buckets = [
        { id: 'b30', label: 'أقل من 30 يوماً', sub: 'ديون حديثة', min: 0, max: 30, color: '#10b981', icon: 'fa-clock', items: [] },
        { id: 'b60', label: '31 إلى 60 يوماً', sub: 'ديون متوسطة', min: 31, max: 60, color: '#f59e0b', icon: 'fa-hourglass-half', items: [] },
        { id: 'b90', label: '61 إلى 90 يوماً', sub: 'ديون متأخرة', min: 61, max: 90, color: '#f97316', icon: 'fa-triangle-exclamation', items: [] },
        { id: 'b90plus', label: 'أكثر من 90 يوماً', sub: 'تحصيل حرج', min: 91, max: Infinity, color: '#ef4444', icon: 'fa-circle-exclamation', items: [] }
    ];

    let totalOverdueDebt = 0;
    (db.contacts || []).filter(c => !c.archived).forEach(c => {
        const bal = getContactBalance(c.id);
        if(bal >= 0) return;
        const debt = Math.abs(bal);
        totalOverdueDebt += debt;

        const start = getDebtStartDate(c.id);
        const days = start ? Math.max(1, Math.floor((Date.now() - new Date(start).getTime()) / 86400000)) : 1;
        const b = buckets.find(b => days >= b.min && days <= b.max) || buckets[3];
        b.items.push({ id: c.id, name: c.name, phone: c.phone || '', debt, days, start });
    });

    totalOverdueDebt = round2(totalOverdueDebt);

    container.innerHTML = buckets.map(b => {
        const bTotal = round2(b.items.reduce((sum, item) => sum + item.debt, 0));
        const percent = totalOverdueDebt > 0 ? Math.round((bTotal / totalOverdueDebt) * 100) : 0;
        const isActive = currentAgingFilterBucket === b.id;

        return `
            <div class="aging-bucket-card ${isActive ? 'active' : ''}" onclick="toggleAgingBucketDrilldown('${b.id}')" style="border-right: 3px solid ${b.color};">
                <div class="aging-bucket-header">
                    <span class="aging-bucket-title" style="color:${b.color};">
                        <i class="fa-solid ${b.icon}"></i> ${b.label}
                    </span>
                    <span class="aging-bucket-count" style="color:${b.color};">${b.items.length} عميل</span>
                </div>
                <div style="font-size:0.65rem; color:var(--muted); margin-bottom:4px;">${b.sub}</div>
                <strong class="aging-bucket-amount" style="color:var(--text);">${formatMoney(bTotal)}</strong>
                <div class="aging-bar-track">
                    <div class="aging-bar-fill" style="width:${percent}%; background: linear-gradient(90deg, ${b.color}, #f59e0b);"></div>
                </div>
                <div style="display:flex; justify-content:space-between; margin-top:6px; font-size:0.65rem; color:var(--muted);">
                    <span>النسبة من الإجمالي</span>
                    <strong style="color:${b.color};">${percent}%</strong>
                </div>
            </div>
        `;
    }).join('');

    renderAgingDrilldownList(buckets);
}

// ------------------------------------------
// دالة 6.1.5: toggleAgingBucketDrilldown — فتح وإغلاق قائمة عملاء فئة عمرية
// ------------------------------------------
function toggleAgingBucketDrilldown(bucketId) {
    currentAgingFilterBucket = (currentAgingFilterBucket === bucketId) ? null : bucketId;
    renderDebtAgingSummary();
}

// ------------------------------------------
// دالة 6.1.6: renderAgingDrilldownList — عرض عملاء الفئة العمرية المنسدلة
// ------------------------------------------
function renderAgingDrilldownList(buckets) {
    const drillEl = document.getElementById('debt-aging-drilldown');
    if(!drillEl) return;

    if(!currentAgingFilterBucket) {
        drillEl.style.display = 'none';
        drillEl.innerHTML = '';
        return;
    }

    const b = buckets.find(x => x.id === currentAgingFilterBucket);
    if(!b || b.items.length === 0) {
        drillEl.style.display = 'block';
        drillEl.innerHTML = `<p class="sub-text" style="text-align:center; padding:15px; margin:0;">🎉 لا توجد مديونيات متأخرة ضمن فئة "${b ? b.label : ''}" حالياً.</p>`;
        return;
    }

    const sorted = [...b.items].sort((x, y) => y.debt - x.debt);

    drillEl.style.display = 'block';
    drillEl.innerHTML = `
        <div class="flex-between" style="margin-bottom:10px;">
            <strong style="font-size:0.85rem; color:${b.color}; display:flex; align-items:center; gap:6px;">
                <i class="fa-solid fa-list-check"></i> عملاء فئة: ${b.label} (${sorted.length} عميل)
            </strong>
            <button class="btn-sm" style="background:var(--input); color:var(--text); padding:4px 8px; font-size:0.68rem;" onclick="toggleAgingBucketDrilldown('${b.id}')"><i class="fa-solid fa-xmark"></i> إغلاق</button>
        </div>
        <div style="display:flex; flex-direction:column; gap:6px; max-height:280px; overflow-y:auto;">
            ${sorted.map(c => `
                <div class="aging-drill-row">
                    <div style="min-width:0; flex:1;">
                        <strong style="font-size:0.82rem; color:var(--text); cursor:pointer;" onclick="openContactTransactions(${c.id})">${c.name}</strong>
                        <span style="display:block; font-size:0.68rem; color:var(--muted); margin-top:2px;">
                            متأخر منذ <strong>${c.days}</strong> يوماً ${c.phone ? ' • 📞 ' + c.phone : ''}
                        </span>
                    </div>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <strong style="font-size:0.85rem; color:#ef4444;">${formatMoney(c.debt)}</strong>
                        ${c.phone ? `
                            <button class="btn-sm" style="background:#25D366; color:#fff; padding:6px 8px; border-radius:8px; font-size:0.75rem;" onclick="sendWhatsAppAgingReminder(${c.id}, ${c.days}, ${c.debt})" title="إرسال تذكير واتساب"><i class="fa-brands fa-whatsapp"></i></button>
                            <a href="tel:${c.phone}" class="btn-sm" style="background:var(--c-blue); color:#fff; padding:6px 8px; border-radius:8px; font-size:0.75rem;" title="اتصال"><i class="fa-solid fa-phone"></i></a>
                        ` : ''}
                        <button class="btn-sm" style="background:var(--input); color:var(--text); padding:6px 8px; font-size:0.75rem;" onclick="openContactTransactions(${c.id})" title="عرض كشف الحساب"><i class="fa-solid fa-book-open"></i></button>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

// ------------------------------------------
// دالة 6.1.7: sendWhatsAppAgingReminder — إرسال رسالة تذكير بالواتساب لعميل متأخر
// ------------------------------------------
function sendWhatsAppAgingReminder(contactId, days, debt) {
    const c = db.contacts.find(x => x.id == contactId);
    if(!c || !c.phone) {
        showNotification('تنبيه', 'لا يوجد رقم هاتف مسجل لهذا العميل.', 'fa-phone-slash', 'var(--c-orange)');
        return;
    }
    const shopName = getShopName();
    const msg = encodeURIComponent(`السلام عليكم أخي الكريم ${c.name}،\nتحية طيبة من ${shopName}.\n\nنود تذكير سيادتكم بلطف بوجود مستحقات مالية قدرها (${formatMoney(debt)}) مستحقة السداد منذ ${days} يوماً.\n\nشاكرين ومقدرين حسن تعاونكم الدائم معنا.`);
    
    let cleanPhone = c.phone.replace(/[^0-9]/g, '');
    if(cleanPhone.startsWith('01')) cleanPhone = '2' + cleanPhone;
    window.open(`https://wa.me/${cleanPhone}?text=${msg}`, '_blank');
}

// ------------------------------------------
// دالة 6.1.8: renderDefaultedDebtsList — عرض قائمة الديون المتعثرة (+90 يوماً) بتنسيق منظم وموزع
// ------------------------------------------
function renderDefaultedDebtsList() {
    const listEl = document.getElementById('defaulted-debts-list');
    const statsEl = document.getElementById('defaulted-debts-summary-stats');
    if(!listEl) return;

    const defaulted = [];
    (db.contacts || []).filter(c => !c.archived).forEach(c => {
        const bal = getContactBalance(c.id);
        if(bal >= 0) return;
        const debt = Math.abs(bal);
        const start = getDebtStartDate(c.id);
        const days = start ? Math.floor((Date.now() - new Date(start).getTime()) / 86400000) : 0;
        if(days > 90) {
            defaulted.push({ id: c.id, name: c.name, phone: c.phone || '', debt, days, start });
        }
    });

    defaulted.sort((a, b) => b.days - a.days);
    const totalDef = round2(defaulted.reduce((s, x) => s + x.debt, 0));

    if(statsEl) {
        statsEl.innerHTML = `
            <div class="mini-stat" style="border-right:3px solid #ef4444;">
                <i class="fa-solid fa-triangle-exclamation" style="color:#ef4444;"></i>
                <span>عدد المتعثرين</span>
                <strong style="color:#ef4444;">${defaulted.length} عميل</strong>
            </div>
            <div class="mini-stat" style="border-right:3px solid #ef4444;">
                <i class="fa-solid fa-coins" style="color:var(--c-gold);"></i>
                <span>إجمالي الديون المتعثرة</span>
                <strong style="color:var(--c-gold); font-size:1.1rem;">${formatMoney(totalDef)}</strong>
            </div>
            <div class="mini-stat">
                <i class="fa-solid fa-hourglass-end" style="color:var(--c-orange);"></i>
                <span>أقدم مديونية</span>
                <strong style="color:var(--c-orange);">${defaulted.length ? defaulted[0].days + ' يوم' : '0'}</strong>
            </div>
        `;
    }

    if(defaulted.length === 0) {
        listEl.innerHTML = `
            <div style="text-align:center; padding:35px 20px; background:var(--input); border-radius:12px;">
                <span style="font-size:2.5rem; display:block; margin-bottom:10px;">🎉</span>
                <h4 style="margin:0 0 6px; color:#22c55e;">ممتاز! لا توجد ديون متعثرة تجاوزت 90 يوماً</h4>
                <p class="sub-text" style="font-size:0.75rem; margin:0;">كافة مديونيات العملاء ضمن فترات التحصيل الطبيعية.</p>
            </div>
        `;
        return;
    }

    listEl.innerHTML = defaulted.map(c => `
        <div class="defaulted-debt-card">
            <div class="defaulted-card-header">
                <span class="defaulted-card-name" onclick="openContactTransactions(${c.id})">
                    <i class="fa-solid fa-user"></i> ${c.name}
                </span>
                <span class="defaulted-card-badge">
                    <i class="fa-solid fa-triangle-exclamation"></i> متأخر منذ ${c.days} يوم
                </span>
            </div>
            <div class="defaulted-card-meta">
                <span class="defaulted-card-meta-item">
                    <i class="fa-regular fa-calendar-days"></i> بدأ في: ${c.start ? new Date(c.start).toLocaleDateString('ar-EG') : 'غير محدد'}
                </span>
                ${c.phone ? `
                <span class="defaulted-card-meta-item">
                    <i class="fa-solid fa-phone"></i> ${c.phone}
                </span>` : ''}
            </div>
            <div class="defaulted-card-footer">
                <div class="defaulted-card-amount">
                    <span class="defaulted-card-amount-label">المديونية المتعثرة:</span>
                    <span class="defaulted-card-amount-value">${formatMoney(c.debt)}</span>
                </div>
                <div class="defaulted-card-actions">
                    <button class="btn-urgent-collect" onclick="sendUrgentWhatsAppDefaultNotice(${c.id}, ${c.days}, ${c.debt})" title="إرسال خطاب تحصيل عاجل عبر واتساب">
                        <i class="fa-brands fa-whatsapp"></i> تحصيل عاجل
                    </button>
                    <button class="btn-defaulted-ledger" onclick="openContactTransactions(${c.id})" title="كشف الحساب">
                        <i class="fa-solid fa-book-open"></i>
                    </button>
                </div>
            </div>
        </div>
    `).join('');
}

// ------------------------------------------
// دالة 6.1.9: sendUrgentWhatsAppDefaultNotice — إرسال إشعار تحصيل رسمي عاجل
// ------------------------------------------
function sendUrgentWhatsAppDefaultNotice(contactId, days, debt) {
    const c = (db.contacts || []).find(x => x.id == contactId);
    if(!c || !c.phone) {
        showNotification('تنبيه', 'لا يوجد رقم هاتف مسجل لهذا العميل.', 'fa-phone-slash', 'var(--c-orange)');
        return;
    }
    const shopName = getShopName();
    const msg = encodeURIComponent(`السلام عليكم ورحمة الله وبركاته،\nالأخ الكريم / ${c.name} المحترم،\n\nنحيط سيادتكم علماً بأن مديونيتكم المستحقة وقدرها (${formatMoney(debt)}) قد تجاوزت فترة السماح القصوى (أكثر من ${days} يوماً).\n\nنرجو من سيادتكم التكرم بسرعة سداد المبلغ تفادياً لاتخاذ أي إجراءات وحرصاً على استمرار التعامل الطيب بيننا.\n\nشاكرين تفهمكم وحسن تعاونكم.\nإدارة ${shopName}`);

    let cleanPhone = c.phone.replace(/[^0-9]/g, '');
    if(cleanPhone.startsWith('01')) cleanPhone = '2' + cleanPhone;
    window.open(`https://wa.me/${cleanPhone}?text=${msg}`, '_blank');
}

// ------------------------------------------
// دالة 6.1.10: renderDebtsRatioDonut — رسم بياني دائري لمعدل التحصيل ونسبة السداد
// ------------------------------------------
function renderDebtsRatioDonut(totalIn, totalOut, net) {
    const container = document.getElementById('debt-ratio-donut-container');
    const badge = document.getElementById('debt-ratio-status-badge');
    if(!container) return;

    if(totalIn === undefined || totalOut === undefined) {
        const mode = (db.settings && db.settings.totalsMode) || 'active';
        const allContacts = (db.contacts || []).filter(c => isCustomer(c));
        const relevantContacts = allContacts.filter(c => mode === 'all' || !c.archived);
        const relevantIds = new Set(relevantContacts.map(c => String(c.id)));
        totalIn = 0; totalOut = 0;
        (db.transactions || []).forEach(t => {
            if(!relevantIds.has(String(t.contactId))) return;
            if(t.direction === 'in') totalIn += t.amount;
            else if(t.direction === 'out') totalOut += t.amount;
        });
        totalIn = round2(totalIn);
        totalOut = round2(totalOut);
        net = round2(totalIn - totalOut);
    }

    // إجمالي الدين الممنوح (فلوس خرجت / أعطيته) وإجمالي ما تم تحصيله وسداده (فلوس دخلت / أخذت منه)
    const totalCredit = totalOut;
    const totalCollected = totalIn;

    if(totalCredit <= 0 && totalCollected <= 0) {
        container.innerHTML = `<div style="text-align:center; padding:18px; color:var(--muted); font-size:0.8rem;">لا توجد معاملات مسجلة حالياً لحساب نسبة التحصيل والديون.</div>`;
        return;
    }

    let pctCollected = 0;
    let pctRemaining = 0;
    let remainingDebt = 0;

    if(totalCredit > 0) {
        const effectiveRepaid = Math.min(totalCollected, totalCredit);
        remainingDebt = Math.max(0, round2(totalCredit - totalCollected));
        pctCollected = Math.round((effectiveRepaid / totalCredit) * 100);
        pctRemaining = Math.max(0, 100 - pctCollected);
    } else {
        // إذا لم يكن هناك ديون ممنوحة، بل مقبوضات ودفعات مسبقة
        pctCollected = 100;
        pctRemaining = 0;
        remainingDebt = 0;
    }

    if(badge) {
        if(pctCollected === 100) {
            badge.innerText = 'تم تحصيل كافة الديون بالكامل (100%)';
            badge.style.background = 'rgba(34,197,94,0.18)';
            badge.style.color = '#22c55e';
        } else if(pctCollected >= 70) {
            badge.innerText = 'معدل تحصيل ممتاز (سداد مرتفع)';
            badge.style.background = 'rgba(34,197,94,0.18)';
            badge.style.color = '#22c55e';
        } else if(pctCollected >= 50) {
            badge.innerText = 'معدل تحصيل متكافئ (سداد النصف فما فوق)';
            badge.style.background = 'rgba(59,130,246,0.18)';
            badge.style.color = '#60a5fa';
        } else if(pctCollected >= 25) {
            badge.innerText = 'معدل تحصيل متوسط (متابعة السداد مطلوبة)';
            badge.style.background = 'rgba(234,179,8,0.18)';
            badge.style.color = '#eab308';
        } else {
            badge.innerText = 'تنبيه: نسبة المديونيات المتبقية مرتفعة';
            badge.style.background = 'rgba(239,68,68,0.18)';
            badge.style.color = '#f87171';
        }
    }

    const radius = 42;
    const circumference = 2 * Math.PI * radius;
    const strokeDashIn = (circumference * pctCollected) / 100;

    container.innerHTML = `
        <div style="position:relative; width:110px; height:110px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
            <svg width="110" height="110" style="transform: rotate(-90deg);">
                <circle cx="55" cy="55" r="${radius}" stroke="#ef4444" stroke-width="12" fill="none" opacity="0.85" />
                <circle cx="55" cy="55" r="${radius}" stroke="#22c55e" stroke-width="12" fill="none"
                    stroke-dasharray="${strokeDashIn} ${circumference}"
                    stroke-linecap="butt"
                    style="transition: stroke-dasharray 0.8s ease;" />
            </svg>
            <div style="position:absolute; text-align:center; direction:ltr;">
                <span style="font-size:1.15rem; font-weight:900; color:#22c55e;">${pctCollected}%</span>
                <span style="display:block; font-size:0.6rem; color:var(--muted); font-weight:700;">مسدد</span>
            </div>
        </div>

        <div style="flex:1; min-width:210px; display:flex; flex-direction:column; gap:8px;">
            <div class="debt-donut-badge" style="justify-content:space-between; border-right:4px solid #22c55e;">
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:10px; height:10px; border-radius:50%; background:#22c55e;"></span>
                    <strong style="color:var(--text);">فلوس دخلت (أخذت منه / مسدد):</strong>
                </div>
                <div style="text-align:left;">
                    <strong style="color:#22c55e; font-size:0.92rem;">${formatMoney(totalCollected)}</strong>
                    <span style="font-size:0.65rem; color:var(--muted); margin-right:4px;">(${pctCollected}%)</span>
                </div>
            </div>

            <div class="debt-donut-badge" style="justify-content:space-between; border-right:4px solid #ef4444;">
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:10px; height:10px; border-radius:50%; background:#ef4444;"></span>
                    <strong style="color:var(--text);">المتبقي للتحصيل (عليه):</strong>
                </div>
                <div style="text-align:left;">
                    <strong style="color:#ef4444; font-size:0.92rem;">${formatMoney(remainingDebt)}</strong>
                    <span style="font-size:0.65rem; color:var(--muted); margin-right:4px;">(${pctRemaining}%)</span>
                </div>
            </div>

            <div class="debt-donut-badge" style="justify-content:space-between; border-right:4px solid var(--c-gold); background:rgba(0,0,0,0.18);">
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:10px; height:10px; border-radius:50%; background:var(--c-gold);"></span>
                    <span style="color:var(--muted); font-size:0.75rem;">إجمالي الدين الممنوح (أعطيته):</span>
                </div>
                <div style="text-align:left;">
                    <strong style="color:var(--text); font-size:0.85rem;">${formatMoney(totalCredit)}</strong>
                </div>
            </div>

            <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 12px; background:rgba(0,0,0,0.25); border-radius:8px; border:1px solid var(--border); font-size:0.75rem;">
                <span style="color:var(--muted);">صافي المركز المالي:</span>
                <strong style="color:${net >= 0 ? 'var(--c-green)' : 'var(--c-red)'}; font-size:0.95rem;">${formatMoney(net)}</strong>
            </div>
        </div>
    `;
}

// ------------------------------------------
// دالة 6.1.11: checkOverdueGracePeriodAlerts — فحص تلقائي لتجاوز فترات السماح
// ------------------------------------------
function checkOverdueGracePeriodAlerts() {
    if(!db.contacts) return;
    const today = new Date();
    const todayStr = getTodayStr();

    db.contacts.filter(c => !c.archived).forEach(c => {
        const bal = getContactBalance(c.id);
        if(bal >= 0) return;

        let isOverdue = false;
        let reason = '';

        if(c.dueDate) {
            const due = new Date(c.dueDate);
            if(due < today) {
                isOverdue = true;
                const overdueDays = Math.max(1, Math.floor((today - due) / 86400000));
                reason = `تجاوز تاريخ الاستحقاق بمقدار ${overdueDays} يوماً`;
            }
        }

        if(!isOverdue) {
            const start = getDebtStartDate(c.id);
            const days = start ? Math.floor((today - new Date(start).getTime()) / 86400000) : 0;
            if(days > 60) {
                isOverdue = true;
                reason = `المديونية قائمة منذ ${days} يوماً`;
            }
        }

        if(isOverdue && c.lastGraceAlert !== todayStr) {
            c.lastGraceAlert = todayStr;
            showNotification(
                'تنبيه استحقاق ⚠️',
                `العميل "${c.name}" مديونيته (${formatMoney(Math.abs(bal))}) و${reason}.`,
                'fa-triangle-exclamation', 'var(--c-red)'
            );
        }
    });
}

// ======================================
// 📌 القسم 7: خطة سداد الديون والآلة الحاسبة والتذكيرات
// ======================================

// ══════════════════════
// 7.1 خطة السداد الذكية (Debt Plan)
// ══════════════════════

// ------------------------------------------
// دالة 7.1.1: openDebtPlanModal — فتح نافذة خطة السداد الذكية
// ------------------------------------------
function openDebtPlanModal() {
    debtPlanStrategy = 'snowball';
    openModal('debt-plan-modal');
    updateDebtPlanButtons();
    calculateDebtPlan();
}

// ------------------------------------------
// دالة 7.1.2: setDebtPlanStrategy — تبديل الاستراتيجية (كرة الثلج / الانهيار)
// ------------------------------------------
function setDebtPlanStrategy(strat) {
    debtPlanStrategy = strat;
    updateDebtPlanButtons();
    calculateDebtPlan();
}

// ------------------------------------------
// دالة 7.1.3: updateDebtPlanButtons — تحديث لون زر الاستراتيجية المحددة
// ------------------------------------------
function updateDebtPlanButtons() {
    const sbBtn = document.getElementById('plan-strategy-snowball');
    const avBtn = document.getElementById('plan-strategy-avalanche');
    if(sbBtn && avBtn) {
        if(debtPlanStrategy === 'snowball') {
            sbBtn.style.background = 'var(--c-teal)';
            sbBtn.style.color = '#fff';
            avBtn.style.background = 'var(--input)';
            avBtn.style.color = 'var(--text)';
        } else {
            avBtn.style.background = 'var(--c-teal)';
            avBtn.style.color = '#fff';
            sbBtn.style.background = 'var(--input)';
            sbBtn.style.color = 'var(--text)';
        }
    }
}

// ------------------------------------------
// دالة 7.1.4: calculateDebtPlan — حساب فترات السداد وترتيب أولويات العملاء
// ------------------------------------------
function calculateDebtPlan() {
    const resEl = document.getElementById('debt-plan-result');
    if(!resEl) return;

    const monthlyInput = parseFloat(document.getElementById('debt-plan-monthly').value) || 0;
    
    const debtors = [];
    (db.contacts || []).filter(c => !c.archived).forEach(c => {
        const bal = getContactBalance(c.id);
        if(bal >= 0) return;
        const debt = Math.abs(bal);
        const start = getDebtStartDate(c.id);
        const days = start ? Math.floor((Date.now() - new Date(start).getTime()) / 86400000) : 0;
        debtors.push({ id: c.id, name: c.name, debt, days });
    });

    if(debtors.length === 0) {
        resEl.innerHTML = `<p class="sub-text" style="text-align:center; padding:15px;">🎉 لا توجد ديون مستحقة حالياً.</p>`;
        return;
    }

    if(debtPlanStrategy === 'snowball') {
        debtors.sort((a, b) => a.debt - b.debt);
    } else {
        debtors.sort((a, b) => b.days - a.days);
    }

    const totalDebt = round2(debtors.reduce((s, x) => s + x.debt, 0));
    const monthsEst = monthlyInput > 0 ? Math.ceil(totalDebt / monthlyInput) : 'غير محدد';

    resEl.innerHTML = `
        <div class="flex-between" style="margin-bottom:10px;">
            <span>إجمالي المديونية: <strong style="color:#ef4444;">${formatMoney(totalDebt)}</strong></span>
            <span>المدة المقدرة: <strong style="color:var(--c-teal);">${monthsEst} شهر</strong></span>
        </div>
        <div style="font-size:0.75rem; font-weight:700; margin-bottom:8px; color:var(--c-gold);">ترتيب أولويات التحصيل المقترحة:</div>
        <ol style="margin:0; padding-right:20px; font-size:0.72rem; line-height:1.7;">
            ${debtors.slice(0, 6).map(d => `
                <li><strong>${d.name}</strong> — ${formatMoney(d.debt)} (متأخر منذ ${d.days} يوم)</li>
            `).join('')}
        </ol>
    `;
}

// ══════════════════════
// 7.2 الآلة الحاسبة المدمجة (Calculator)
// ══════════════════════

// ------------------------------------------
// دالة 7.2.1: openCalculator — فتح نافذة الآلة الحاسبة
// ------------------------------------------
function openCalculator() {
    calcExpression = '';
    document.getElementById('calc-display').value = '';
    openModal('calc-modal');
}

// ------------------------------------------
// دالة 7.2.2: calcInput — إدخال رقم أو معامل في الحاسبة
// ------------------------------------------
function calcInput(val) {
    calcExpression += val;
    document.getElementById('calc-display').value = calcExpression;
}

// ------------------------------------------
// دالة 7.2.3: calcClear — مسح شاشة الآلة الحاسبة
// ------------------------------------------
function calcClear() {
    calcExpression = '';
    document.getElementById('calc-display').value = '';
}

// ------------------------------------------
// دالة 7.2.4: calcEval — تقييم وحساب المعادلة الرياضية
// ------------------------------------------
function calcEval() {
    try {
        const result = eval(calcExpression);
        document.getElementById('calc-display').value = result;
        calcExpression = result.toString();
    } catch (e) { alert('عملية غير صحيحة'); }
}

// ------------------------------------------
// دالة 7.2.5: calcResult — اعتماد الناتج ونقله لحقل المبلغ
// ------------------------------------------
function calcResult() {
    try {
        const result = eval(calcExpression);
        document.getElementById('tx-amount').value = result;
        calcClear();
        closeModal('calc-modal');
    } catch (e) { alert('عملية غير صحيحة'); }
}

// ══════════════════════
// 7.3 تذكيرات مواعيد السداد
// ══════════════════════

// ------------------------------------------
// دالة 7.3.1: openReminderModal — فتح نافذة ضبط تذكير سداد لعميل
// ------------------------------------------
function openReminderModal() {
    reminderContactId = currentContactId;
    const contact = db.contacts.find(c => c.id == currentContactId);
    document.getElementById('reminder-contact-name').value = contact ? contact.name : '';
    document.getElementById('reminder-search-results').innerHTML = '';
    document.getElementById('reminder-date').value = getLocalDatetime();
    document.getElementById('reminder-msg').value = '';
    openModal('reminder-modal');
}

// ------------------------------------------
// دالة 7.3.2: searchReminderContact — البحث عن عميل في نافذة التذكير
// ------------------------------------------
function searchReminderContact(val) {
    const resultsDiv = document.getElementById('reminder-search-results');
    resultsDiv.innerHTML = '';
    if (!val) return;
    const matches = db.contacts.filter(c => isCustomer(c) && c.name.toLowerCase().includes(val.toLowerCase()));
    if (matches.length > 0) {
        resultsDiv.innerHTML = matches.map(c => `<a onclick="selectReminderContact(${c.id}, '${c.name}')" style="display:block; padding:8px; background:var(--input); margin-bottom:5px; border-radius:6px; cursor:pointer;">${c.name}</a>`).join('');
    }
}

// ------------------------------------------
// دالة 7.3.3: selectReminderContact — اختيار العميل المستهدف للتذكير
// ------------------------------------------
function selectReminderContact(id, name) {
    reminderContactId = id;
    document.getElementById('reminder-contact-name').value = name;
    document.getElementById('reminder-search-results').innerHTML = '';
}

// ------------------------------------------
// دالة 7.3.4: saveReminder — حفظ تذكير السداد
// ------------------------------------------
function saveReminder() {
    if(!reminderContactId) { showNotification('خطأ', 'اختر عميلاً صحيحاً', 'fa-circle-xmark', 'var(--c-red)'); return; }
    const date = document.getElementById('reminder-date').value;
    const msg = document.getElementById('reminder-msg').value;
    if(!date) { showNotification('خطأ', 'اختر وقت التنبيه', 'fa-circle-xmark', 'var(--c-red)'); return; }
    db.reminders.push({ id: Date.now(), contactId: reminderContactId, date, msg, done: false });
    saveDb();
    closeModal('reminder-modal');
    showNotification('تم الحفظ', 'تم حفظ التنبيه بنجاح.');
}

// ------------------------------------------
// دالة 7.3.5: checkReminders — الفحص الدوري لمواعيد التذكيرات المستحقة
// ------------------------------------------
function checkReminders() {
    const now = new Date();
    let changed = false;
    db.reminders.forEach(r => {
        if(!r.done && new Date(r.date) <= now && !notifiedReminderIds.has(r.id)) {
            const contact = db.contacts.find(c => c.id == r.contactId);
            const contactName = contact ? contact.name : '';
            showNotification(
                'تنبيه سداد مستحق 🔔',
                `حان موعد مطالبة العميل "${contactName}" بالسداد.` + (r.msg ? `\nملاحظة: ${r.msg}` : ''),
                'fa-bell', 'var(--c-gold)'
            );
            notifiedReminderIds.add(r.id);
            r.done = true;
            changed = true;
        }
    });
    if(changed) { saveDb(); renderContacts(); }
    checkCeilingsAndDue();
}

// ------------------------------------------
// دالة 7.3.6: checkCeilingsAndDue — فحص تجاوز سقف الدين والتواريخ
// ------------------------------------------
function checkCeilingsAndDue() {
    const today = getTodayStr();
    db.contacts.forEach(c => {
        if(c.archived || !isCustomer(c)) return;
        const balance = getContactBalance(c.id);
        if(balance < 0) {
            const debt = Math.abs(balance);
            if(c.ceiling && debt > Number(c.ceiling) && c.lastCeilingAlert !== today) {
                showNotification('تجاوز سقف الدين ⚠️', `العميل "${c.name}" تجاوز سقف المديونية (${formatMoney(c.ceiling)}).`, 'fa-triangle-exclamation', 'var(--c-red)');
                c.lastCeilingAlert = today;
                saveDb();
            }
        }
    });
}

// ══════════════════════
// 7.4 معدل التحصيل ونسبة السداد للعميل (Customer Repayment Ratio)
// ══════════════════════

// ------------------------------------------
// دالة 7.4.1: openCustomerRatioModal — فتح نافذة معدل التحصيل ونسبة السداد للعميل
// ------------------------------------------
function openCustomerRatioModal(contactId) {
    const id = contactId || currentContactId;
    if(!id) {
        showNotification('تنبيه', 'يرجى اختيار عميل أولاً لعرض معدل السداد الخاص به.', 'fa-user', 'var(--c-orange)');
        return;
    }
    const contact = (db.contacts || []).find(c => String(c.id) === String(id));
    if(!contact) {
        showNotification('خطأ', 'لم يتم العثور على بيانات العميل.', 'fa-circle-xmark', 'var(--c-red)');
        return;
    }

    const nameEl = document.getElementById('customer-ratio-client-name');
    if(nameEl) {
        nameEl.innerHTML = `<i class="fa-solid fa-user-tag" style="color:var(--c-teal); margin-left:6px;"></i> العميل: <strong>${contact.name}</strong>`;
    }

    renderCustomerRatioDonut(id);
    openModal('customer-ratio-modal');
}

// ------------------------------------------
// دالة 7.4.2: renderCustomerRatioDonut — حساب ورسم نسبة السداد والمحصل للعميل
// ------------------------------------------
function renderCustomerRatioDonut(contactId) {
    const container = document.getElementById('customer-ratio-donut-container');
    const badge = document.getElementById('customer-ratio-status-badge');
    if(!container) return;

    let totalIn = 0;   // فلوس دخلت (أخذت منه / مسدد)
    let totalOut = 0;  // فلوس خرجت (أعطيته / دين ممنوح ومبيعات)

    (db.transactions || []).forEach(t => {
        if(String(t.contactId) !== String(contactId)) return;
        if(t.direction === 'in') totalIn += Number(t.amount) || 0;
        else if(t.direction === 'out') totalOut += Number(t.amount) || 0;
    });

    totalIn = round2(totalIn);
    totalOut = round2(totalOut);
    const net = round2(totalIn - totalOut);

    const totalCredit = totalOut;
    const totalCollected = totalIn;

    if(totalCredit <= 0 && totalCollected <= 0) {
        container.innerHTML = `<div style="text-align:center; padding:18px; color:var(--muted); font-size:0.85rem; width:100%;">لا توجد أي معاملات مسجلة لهذا العميل حتى الآن.</div>`;
        if(badge) {
            badge.innerText = 'لا توجد حركات مسجلة';
            badge.style.background = 'rgba(150,150,150,0.18)';
            badge.style.color = 'var(--muted)';
        }
        return;
    }

    let pctCollected = 0;
    let pctRemaining = 0;
    let remainingDebt = 0;

    if(totalCredit > 0) {
        const effectiveRepaid = Math.min(totalCollected, totalCredit);
        remainingDebt = Math.max(0, round2(totalCredit - totalCollected));
        pctCollected = Math.round((effectiveRepaid / totalCredit) * 100);
        pctRemaining = Math.max(0, 100 - pctCollected);
    } else {
        pctCollected = 100;
        pctRemaining = 0;
        remainingDebt = 0;
    }

    if(badge) {
        if(pctCollected === 100) {
            badge.innerText = 'تم سداد المديونية بالكامل (100%)';
            badge.style.background = 'rgba(34,197,94,0.18)';
            badge.style.color = '#22c55e';
        } else if(pctCollected >= 70) {
            badge.innerText = 'معدل سداد ممتاز للعميل (سداد مرتفع)';
            badge.style.background = 'rgba(34,197,94,0.18)';
            badge.style.color = '#22c55e';
        } else if(pctCollected >= 50) {
            badge.innerText = 'معدل سداد متكافئ (سدد النصف فما فوق)';
            badge.style.background = 'rgba(59,130,246,0.18)';
            badge.style.color = '#60a5fa';
        } else if(pctCollected >= 25) {
            badge.innerText = 'معدل سداد متوسط (متابعة السداد مطلوبة)';
            badge.style.background = 'rgba(234,179,8,0.18)';
            badge.style.color = '#eab308';
        } else {
            badge.innerText = 'تنبيه: مديونية العميل مرتفعة ونسبة السداد منخفضة';
            badge.style.background = 'rgba(239,68,68,0.18)';
            badge.style.color = '#f87171';
        }
    }

    const radius = 42;
    const circumference = 2 * Math.PI * radius;
    const strokeDashIn = (circumference * pctCollected) / 100;

    container.innerHTML = `
        <div style="position:relative; width:110px; height:110px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
            <svg width="110" height="110" style="transform: rotate(-90deg);">
                <circle cx="55" cy="55" r="${radius}" stroke="#ef4444" stroke-width="12" fill="none" opacity="0.85" />
                <circle cx="55" cy="55" r="${radius}" stroke="#22c55e" stroke-width="12" fill="none"
                    stroke-dasharray="${strokeDashIn} ${circumference}"
                    stroke-linecap="butt"
                    style="transition: stroke-dasharray 0.8s ease;" />
            </svg>
            <div style="position:absolute; text-align:center; direction:ltr;">
                <span style="font-size:1.15rem; font-weight:900; color:#22c55e;">${pctCollected}%</span>
                <span style="display:block; font-size:0.6rem; color:var(--muted); font-weight:700;">سداد</span>
            </div>
        </div>

        <div style="flex:1; min-width:190px; display:flex; flex-direction:column; gap:8px;">
            <div class="debt-donut-badge" style="justify-content:space-between; border-right:4px solid #22c55e; padding:6px 10px; background:rgba(0,0,0,0.15); border-radius:6px; display:flex; align-items:center;">
                <div style="display:flex; align-items:center; gap:6px;">
                    <span style="width:8px; height:8px; border-radius:50%; background:#22c55e;"></span>
                    <span style="color:var(--text); font-size:0.8rem; font-weight:700;">المحصل (سدد):</span>
                </div>
                <div style="text-align:left;">
                    <strong style="color:#22c55e; font-size:0.88rem;">${formatMoney(totalCollected)}</strong>
                    <span style="font-size:0.65rem; color:var(--muted); margin-right:4px;">(${pctCollected}%)</span>
                </div>
            </div>

            <div class="debt-donut-badge" style="justify-content:space-between; border-right:4px solid #ef4444; padding:6px 10px; background:rgba(0,0,0,0.15); border-radius:6px; display:flex; align-items:center;">
                <div style="display:flex; align-items:center; gap:6px;">
                    <span style="width:8px; height:8px; border-radius:50%; background:#ef4444;"></span>
                    <span style="color:var(--text); font-size:0.8rem; font-weight:700;">المتبقي (عليه):</span>
                </div>
                <div style="text-align:left;">
                    <strong style="color:#ef4444; font-size:0.88rem;">${formatMoney(remainingDebt)}</strong>
                    <span style="font-size:0.65rem; color:var(--muted); margin-right:4px;">(${pctRemaining}%)</span>
                </div>
            </div>

            <div class="debt-donut-badge" style="justify-content:space-between; border-right:4px solid var(--c-gold); padding:6px 10px; background:rgba(0,0,0,0.15); border-radius:6px; display:flex; align-items:center;">
                <div style="display:flex; align-items:center; gap:6px;">
                    <span style="width:8px; height:8px; border-radius:50%; background:var(--c-gold);"></span>
                    <span style="color:var(--muted); font-size:0.75rem;">إجمالي ما أخذ:</span>
                </div>
                <div style="text-align:left;">
                    <strong style="color:var(--text); font-size:0.85rem;">${formatMoney(totalCredit)}</strong>
                </div>
            </div>

            <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 10px; background:rgba(0,0,0,0.25); border-radius:6px; border:1px solid var(--border); font-size:0.75rem;">
                <span style="color:var(--muted);">الرصيد الحالي:</span>
                <strong style="color:${net >= 0 ? 'var(--c-green)' : 'var(--c-red)'}; font-size:0.9rem;">
                    ${net < 0 ? `عليه ${formatMoney(Math.abs(net))}` : net > 0 ? `له ${formatMoney(net)}` : 'خالص (0)'}
                </strong>
            </div>
        </div>
    `;
}

// ======================================
// 📌 القسم 8: الاتصال والواتساب وتقارير PDF وسندات القبض والصرف
// ======================================

// ══════════════════════
// 8.1 الاتصال وواتساب كشف الحساب
// ══════════════════════

// ------------------------------------------
// دالة 8.1.1: callCustomer — إجراء اتصال هاتفي مباشر بالعميل
// ------------------------------------------
function callCustomer() {
    const contact = db.contacts.find(c => c.id == currentContactId);
    if(!contact || !contact.phone) { alert('لا يوجد رقم هاتف'); return; }
    window.location.href = `tel:${contact.phone}`;
}

// ------------------------------------------
// دالة 8.1.2: normalizePhone — تنظيف وتنسيق أرقام الهواتف
// ------------------------------------------
function normalizePhone(phone) {
    let p = String(phone).replace(/\D/g, '');
    if (p.startsWith('00')) p = p.substring(2);
    else if (p.startsWith('0')) p = '20' + p.substring(1); 
    else if (!p.startsWith('20')) p = '20' + p; 
    return p;
}

// ------------------------------------------
// دالة 8.1.3: sendWhatsAppStatement — إرسال كشف حساب العميل الحالي عبر واتساب
// ------------------------------------------
function sendWhatsAppStatement() { 
    sendWhatsAppTo(currentContactId); 
}

// ------------------------------------------
// دالة 8.1.4: sendWhatsAppTo — إرسال كشف حساب مفصل مع آخر الحركات بالواتساب
// ------------------------------------------
function sendWhatsAppTo(contactId) {
    const contact = db.contacts.find(c => c.id == contactId);
    if(!contact) return;
    if(!contact.phone) { alert('لا يوجد رقم هاتف للعميل ' + contact.name); return; }
    const phone = normalizePhone(contact.phone);
    
    const balance = getContactBalance(contactId);
    let msg = `مرحباً ${contact.name}،\nنأمل أن تكون بخير.\n\n`;
    if (balance < 0) { msg += `نذكرك بكل ود بوجود مبلغ ${formatMoney(Math.abs(balance))} مستحق سداده. شكراً لتعاونك.`; } 
    else if (balance > 0) { msg += `نود إعلامك بأنه سيتم سداد مبلغ ${formatMoney(balance)} المستحق لك قريباً.`; } 
    else { msg += `نود إعلامك بأن حسابك خالص بالكامل. شكراً لتعاملك معنا.`; }
    
    const txs = db.transactions
        .filter(t => t.contactId == contactId)
        .sort((a, b) => new Date(a.date) - new Date(b.date))
        .slice(-5)
        .reverse();
    if(txs.length) {
        msg += `\n\nآخر الحركات:\n`;
        txs.forEach(t => {
            const d = new Date(t.date).toLocaleDateString('ar-EG');
            const sign = t.direction === 'out' ? 'عليه' : 'له';
            msg += `• ${d}: ${sign} ${formatMoney(t.amount)}${t.notes ? ` (${t.notes})` : ''}\n`;
        });
    }
    
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
}

// ══════════════════════
// 8.2 نظام توليد ومعاينة الـ PDF والتقارير
// ══════════════════════

// ------------------------------------------
// دالة 8.2.1: previewPDF — تحويل القالب لصورة ومعاينتها بمودال الطباعة
// ------------------------------------------
function previewPDF(htmlContent, title) {
    document.querySelectorAll('.modal.show').forEach(m => {
        if(m.id !== 'notification-modal' && m.id !== 'pdf-preview-modal') {
            m.classList.remove('show');
        }
    });
    
    const template = document.getElementById('pdf-template');
    template.innerHTML = htmlContent;
    currentPDFTitle = title;
    
    html2canvas(template, {scale: 2}).then(canvas => {
        const imgData = canvas.toDataURL('image/jpeg', 0.9);
        currentPDFData = imgData;
        document.querySelector('#pdf-preview-image-container img').src = imgData;
        openModal('pdf-preview-modal');
        template.innerHTML = '';
    });
}

// ------------------------------------------
// دالة 8.2.2: printCurrentPDF — طباعة مستند الـ PDF المعاين حالياً
// ------------------------------------------
function printCurrentPDF() {
    if(!currentPDFData) { alert('لا يوجد مستند للطباعة'); return; }
    const w = window.open('', '_blank', 'width=850,height=700');
    if(!w) { alert('المتصفح منع النافذة المنبثقة — يرجى السماح بها ثم المحاولة.'); return; }
    w.document.write(`<!DOCTYPE html>
<html dir="rtl">
<head>
<title>طباعة المستند</title>
<style>
    @page { size: A4; margin: 10mm; }
    html, body { margin: 0; padding: 0; background: #fff; }
    img { width: 100%; display: block; }
</style>
</head>
<body>
<img src="${currentPDFData}">
<script>
    window.onload = function() {
        setTimeout(function() { window.print(); }, 300);
    };
<` + `/script>
</body>
</html>`);
    w.document.close();
}

// ------------------------------------------
// دالة 8.2.3: generateVoucherPDF — إصدار سند قبض أو سند صرف رسمي
// ------------------------------------------
function generateVoucherPDF(txId) {
    const t = db.transactions.find(x => x.id == txId);
    if(!t) return;
    const contact = db.contacts.find(c => c.id == t.contactId);
    if(!contact) return;
    
    closeModal('tx-details-modal');
    
    const me = db.profile;
    const isReceipt = t.direction === 'in';
    const voucherType = isReceipt ? 'سند قبض' : 'سند صرف';
    const typeColor = isReceipt ? '#15803d' : '#b91c1c';
    const curr = (db.settings && db.settings.currency) ? db.settings.currency : 'ج.م';
    const docNum = String(t.id).slice(-6).padStart(6, '0');
    const dateStr = new Date(t.date).toLocaleString('ar-EG');
    const shopName = getShopName();
    
    const htmlContent = `
        <div style="padding: 40px; font-family: 'Cairo', sans-serif; direction: rtl;">
            <div style="text-align: center; margin-bottom: 30px;">
                <h1 style="font-size: 30px; color: #15101f; margin: 0;">${shopName}</h1>
            </div>
            <div style="border: 3px solid ${typeColor}; border-radius: 12px; padding: 30px; position: relative;">
                <div style="position: absolute; top: -22px; right: 30px; background: #fff; padding: 0 15px;">
                    <h2 style="font-size: 28px; color: ${typeColor}; margin: 0;">${voucherType}</h2>
                </div>
                <div style="display: flex; justify-content: space-between; margin-top: 15px; margin-bottom: 25px; font-size: 18px; color: #333;">
                    <span>رقم السند: <strong>${docNum}</strong></span>
                    <span>التاريخ: <strong>${dateStr}</strong></span>
                </div>
                <div style="background: #f9f9f9; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
                    <p style="margin: 0 0 12px 0; font-size: 20px;">${isReceipt ? 'استلمت من السيد/' : 'صرفت إلى السيد/'} <strong>${contact.name}</strong></p>
                    <p style="margin: 0 0 12px 0; font-size: 20px;">مبلغ وقدره: <strong style="font-size: 28px; color: ${typeColor};">${t.amount} ${curr}</strong></p>
                    <p style="margin: 0; font-size: 18px; color: #555;">وذلك عن: ${t.notes || 'معاملة مالية'}</p>
                </div>
                ${contact.phone ? `<p style="margin: 0 0 10px 0; font-size: 16px; color: #666;">الهاتف: ${contact.phone}</p>` : ''}
                <div style="display: flex; justify-content: space-between; margin-top: 50px;">
                    <div style="text-align: center;">
                        <div style="border-top: 2px solid #333; padding-top: 8px; width: 170px; font-size: 15px;">توقيع ${me.name || 'المسؤول'}</div>
                    </div>
                    <div style="text-align: center;">
                        <div style="border-top: 2px solid #333; padding-top: 8px; width: 170px; font-size: 15px;">توقيع ${contact.name}</div>
                    </div>
                </div>
            </div>
            <p style="text-align: center; margin-top: 25px; font-size: 14px; color: #999;">تم إنشاء هذا السند بواسطة ${shopName}</p>
        </div>`;
    
    previewPDF(htmlContent, `${voucherType}_${contact.name}_${docNum}`);
}

// ------------------------------------------
// دالة 8.2.4: openReportModal — فتح نافذة خيارات التقرير المفلتر
// ------------------------------------------
function openReportModal(presetType = 'summary', presetContactId = null) {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('show');
    document.body.classList.remove('no-scroll');
    
    document.getElementById('report-type').value = presetType;
    const contactSelect = document.getElementById('report-contact');
    contactSelect.innerHTML = '<option value="">-- اختر العميل --</option>' + 
        db.contacts.filter(c => isCustomer(c) && !c.archived).map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    if(presetContactId) contactSelect.value = presetContactId;
    
    document.getElementById('report-from').value = '';
    document.getElementById('report-to').value = '';
    
    onReportTypeChange();
    openModal('report-settings-modal');
}

// ------------------------------------------
// دالة 8.2.5: onReportTypeChange — إظهار حقل اختيار العميل للتقرير الخاص به
// ------------------------------------------
function onReportTypeChange() {
    const type = document.getElementById('report-type').value;
    document.getElementById('report-contact-wrap').style.display = type === 'contact' ? 'block' : 'none';
}

// ------------------------------------------
// دالة 8.2.6: generateFilteredReport — توليد التقارير المفلترة بالفترة الزمنية
// ------------------------------------------
function generateFilteredReport() {
    const type = document.getElementById('report-type').value;
    const contactId = document.getElementById('report-contact').value;
    const from = document.getElementById('report-from').value;
    const to = document.getElementById('report-to').value;
    if(type === 'contact' && !contactId) { alert('اختر العميل أولاً'); return; }
    
    closeModal('report-settings-modal');
    const shopName = getShopName();
    
    let txs = [...db.transactions];
    if(from) txs = txs.filter(t => new Date(t.date) >= new Date(from + 'T00:00'));
    if(to) txs = txs.filter(t => new Date(t.date) <= new Date(to + 'T23:59'));
    txs.sort((a, b) => new Date(a.date) - new Date(b.date));
    
    if(type === 'contact') {
        exportStatementPDF(contactId, txs.filter(t => t.contactId == contactId), from, to);
        return;
    }
    
    const curr = (db.settings && db.settings.currency) ? db.settings.currency : 'ج.م';
    const periodText = (from || to) 
        ? `الفترة: ${from ? new Date(from).toLocaleDateString('ar-EG') : 'البداية'} إلى ${to ? new Date(to).toLocaleDateString('ar-EG') : 'اليوم'}` 
        : 'كل الفترات';
    
    let title = '', bodyHtml = '';
    
    if(type === 'summary') {
        title = 'تقرير إجمالي المبالغ';
        let totalIn = 0, totalOut = 0;
        txs.forEach(t => { if(t.direction === 'in') totalIn += t.amount; else if(t.direction === 'out') totalOut += t.amount; });
        totalIn = round2(totalIn); totalOut = round2(totalOut);
        const net = round2(totalIn - totalOut);
        bodyHtml = `
            <p style="text-align:center; color:#666; margin-bottom:20px;">${periodText}</p>
            <table style="width: 100%; border-collapse: collapse; text-align: center; margin-top: 20px;">
                <tr style="background: #f9f9f9;"><td style="padding: 20px; border: 1px solid #eee; font-size: 22px;">إجمالي المبالغ — فلوس دخلت (أخذت منه)</td><td style="padding: 20px; border: 1px solid #eee; color: #15803d; font-weight: bold; font-size: 22px;">${totalIn} ${curr}</td></tr>
                <tr style="background: #f9f9f9;"><td style="padding: 20px; border: 1px solid #eee; font-size: 22px;">إجمالي المبالغ — فلوس خرجت (أعطيته)</td><td style="padding: 20px; border: 1px solid #eee; color: #b91c1c; font-weight: bold; font-size: 22px;">${totalOut} ${curr}</td></tr>
                <tr style="background: #15101f; color: #fff;"><td style="padding: 20px; border: 1px solid #15101f; font-size: 22px;">الصافي</td><td style="padding: 20px; border: 1px solid #15101f; font-weight: bold; font-size: 22px;">${net} ${curr}</td></tr>
            </table>`;
    } else if(type === 'detailed') {
        title = 'تقرير تفاصيل كل المبالغ';
        let rowsHtml = '';
        txs.forEach(t => {
            const contact = db.contacts.find(c => c.id == t.contactId);
            const contactName = contact ? contact.name : 'محذوف';
            const typeText = t.direction === 'out' ? 'أعطيته (عليه)' : 'أخذت منه (له)';
            rowsHtml += `<tr><td style="padding: 10px; border: 1px solid #eee; font-size: 18px;">${contactName}</td><td style="padding: 10px; border: 1px solid #eee; font-size: 18px;">${new Date(t.date).toLocaleString('ar-EG')}</td><td style="padding: 10px; border: 1px solid #eee; font-size: 18px;">${typeText}</td><td style="padding: 10px; border: 1px solid #eee; font-size: 18px;">${t.amount} ${curr}</td></tr>`;
        });
        if(!rowsHtml) rowsHtml = '<tr><td colspan="4" style="padding:20px; text-align:center;">لا توجد معاملات في هذه الفترة</td></tr>';
        bodyHtml = `
            <p style="text-align:center; color:#666; margin-bottom:20px;">${periodText}</p>
            <table style="width: 100%; border-collapse: collapse;">
                <thead><tr style="background: #15101f; color: #fff;"><th style="padding: 15px; border: 1px solid #15101f; font-size: 20px;">العميل</th><th style="padding: 15px; border: 1px solid #15101f; font-size: 20px;">التاريخ</th><th style="padding: 15px; border: 1px solid #15101f; font-size: 20px;">النوع</th><th style="padding: 15px; border: 1px solid #15101f; font-size: 20px;">المبلغ</th></tr></thead>
                <tbody>${rowsHtml}</tbody>
            </table>`;
    } else if(type === 'monthly') {
        title = 'تقرير إجمالي المبالغ شهرياً';
        const monthlyData = {};
        txs.forEach(t => {
            const month = new Date(t.date).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long' });
            if(!monthlyData[month]) monthlyData[month] = { in: 0, out: 0 };
            if(t.direction === 'in') monthlyData[month].in += t.amount;
            else if(t.direction === 'out') monthlyData[month].out += t.amount;
        });
        let rowsHtml = '';
        Object.keys(monthlyData).forEach(month => {
            monthlyData[month].in = round2(monthlyData[month].in);
            monthlyData[month].out = round2(monthlyData[month].out);
            const net = round2(monthlyData[month].in - monthlyData[month].out);
            rowsHtml += `<tr><td style="padding: 15px; border: 1px solid #eee; font-size: 20px;">${month}</td><td style="padding: 15px; border: 1px solid #eee; color: #15803d; font-size: 20px;">${monthlyData[month].in} ${curr}</td><td style="padding: 15px; border: 1px solid #eee; color: #b91c1c; font-size: 20px;">${monthlyData[month].out} ${curr}</td><td style="padding: 15px; border: 1px solid #eee; font-weight: bold; font-size: 20px;">${net} ${curr}</td></tr>`;
        });
        if(!rowsHtml) rowsHtml = '<tr><td colspan="4" style="padding:20px; text-align:center;">لا توجد معاملات في هذه الفترة</td></tr>';
        bodyHtml = `
            <p style="text-align:center; color:#666; margin-bottom:20px;">${periodText}</p>
            <table style="width: 100%; border-collapse: collapse; text-align: center;">
                <thead><tr style="background: #15101f; color: #fff;"><th style="padding: 15px; border: 1px solid #15101f; font-size: 20px;">الشهر</th><th style="padding: 15px; border: 1px solid #15101f; font-size: 20px;">فلوس دخلت (أخذت منه)</th><th style="padding: 15px; border: 1px solid #15101f; font-size: 20px;">فلوس خرجت (أعطيته)</th><th style="padding: 15px; border: 1px solid #15101f; font-size: 20px;">الصافي</th></tr></thead>
                <tbody>${rowsHtml}</tbody>
            </table>`;
    }
    
    const htmlContent = `
        <div style="padding: 40px; font-family: 'Cairo', sans-serif; direction: rtl;">
            <div style="text-align: center; border-bottom: 4px solid #15101f; padding-bottom: 20px; margin-bottom: 30px;">
                <h1 style="font-size: 36px; color: #15101f; margin: 0;">${shopName}</h1>
                <h2 style="font-size: 24px; color: #666; margin: 10px 0 0 0;">${title}</h2>
            </div>
            ${bodyHtml}
            <p style="text-align: center; margin-top: 30px; font-size: 16px; color: #999;">تم إنشاء هذا المستند بواسطة ${shopName}</p>
        </div>`;
    
    previewPDF(htmlContent, title);
}

// ------------------------------------------
// دالة 8.2.7: exportStatementPDF — إنشاء كشف حساب رسمي للعميل بصيغة PDF
// ------------------------------------------
function exportStatementPDF(contactId, txs = null, fromDate = null, toDate = null) {
    const contact = db.contacts.find(c => c.id == contactId);
    if(!contact) return;
    const allTxs = db.transactions.filter(t => t.contactId == contactId).sort((a,b) => new Date(a.date) - new Date(b.date));
    if(!txs) txs = allTxs;
    
    const curr = (db.settings && db.settings.currency) ? db.settings.currency : 'ج.م';
    const shopName = getShopName();
    
    let openingBal = 0;
    if(fromDate) {
        allTxs.forEach(t => { 
            if(new Date(t.date) < new Date(fromDate + 'T00:00')) 
                openingBal += (t.direction === 'in' ? t.amount : -t.amount); 
        });
        openingBal = round2(openingBal);
    }
    
    let runningBal = openingBal;
    let rowsHtml = '';
    if(fromDate) {
        const obText = openingBal > 0 ? `${openingBal} ${curr} (له)` : (openingBal < 0 ? `${Math.abs(openingBal)} ${curr} (عليه)` : `0 ${curr}`);
        rowsHtml += `<tr><td colspan="4" style="padding: 12px; border: 1px solid #eee; font-size: 18px; font-weight: bold;">رصيد أول المدة</td><td style="padding: 12px; border: 1px solid #eee; text-align: center; font-weight: bold; font-size: 18px;">${obText}</td></tr>`;
    }
    txs.forEach(t => {
        if(t.direction === 'in') runningBal = round2(runningBal + t.amount); 
        else if(t.direction === 'out') runningBal = round2(runningBal - t.amount); 
        let runText = runningBal > 0 ? `${runningBal} ${curr} (له)` : (runningBal < 0 ? `${Math.abs(runningBal)} ${curr} (عليه)` : `0 ${curr}`);
        let outAmount = t.direction === 'out' ? t.amount : '';
        let inAmount = t.direction === 'in' ? t.amount : '';
        const formattedDate = new Date(t.date).toLocaleString('ar-EG');
        rowsHtml += `<tr><td style="padding: 12px; border: 1px solid #eee; font-size: 18px;">${formattedDate}</td><td style="padding: 12px; border: 1px solid #eee; text-align: center; color: #ef4444; font-size: 18px;">${outAmount}</td><td style="padding: 12px; border: 1px solid #eee; text-align: center; color: #22c55e; font-size: 18px;">${inAmount}</td><td style="padding: 12px; border: 1px solid #eee; font-size: 18px;">${t.notes || ''}</td><td style="padding: 12px; border: 1px solid #eee; text-align: center; font-weight: bold; font-size: 18px;">${runText}</td></tr>`;
    });
    if(!txs.length && !fromDate) rowsHtml = '<tr><td colspan="5" style="padding: 20px; text-align: center;">لا توجد معاملات</td></tr>';
    
    const balance = runningBal;
    let finalBalanceText = balance > 0 ? `${balance} ${curr} (له)` : (balance < 0 ? `${Math.abs(balance)} ${curr} (عليه)` : `0 ${curr}`);
    let finalColor = balance > 0 ? '#15803d' : (balance < 0 ? '#b91c1c' : '#6b7280');
    const periodText = (fromDate || toDate) 
        ? `الفترة: ${fromDate ? new Date(fromDate).toLocaleDateString('ar-EG') : 'البداية'} إلى ${toDate ? new Date(toDate).toLocaleDateString('ar-EG') : 'اليوم'}` 
        : 'كل الفترات';
    
    const htmlContent = `
        <div style="padding: 40px; font-family: 'Cairo', sans-serif; direction: rtl;">
            <div style="text-align: center; border-bottom: 4px solid #15101f; padding-bottom: 20px; margin-bottom: 30px;">
                <h1 style="font-size: 36px; color: #15101f; margin: 0;">${shopName}</h1>
                <h2 style="font-size: 24px; color: #666; margin: 10px 0 0 0;">كشف حساب رسمي</h2>
            </div>
            <div style="background: #f9f9f9; padding: 20px; border-radius: 8px; margin-bottom: 30px; border-right: 6px solid #15101f;">
                <p style="margin: 0 0 10px 0; font-size: 20px;"><strong>العميل:</strong> ${contact.name}</p>
                <p style="margin: 0 0 10px 0; font-size: 20px;"><strong>الهاتف:</strong> ${contact.phone || 'لا يوجد'}</p>
                <p style="margin: 0 0 10px 0; font-size: 20px;"><strong>التاريخ:</strong> ${new Date().toLocaleDateString('ar-EG')}</p>
                <p style="margin: 0; font-size: 20px; color: #666;">${periodText}</p>
            </div>
            <table style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr style="background: #15101f; color: #fff;">
                        <th style="padding: 15px; border: 1px solid #15101f; font-size: 20px;">التاريخ</th>
                        <th style="padding: 15px; border: 1px solid #15101f; font-size: 20px;">عليه</th>
                        <th style="padding: 15px; border: 1px solid #15101f; font-size: 20px;">له</th>
                        <th style="padding: 15px; border: 1px solid #15101f; font-size: 20px;">البيان</th>
                        <th style="padding: 15px; border: 1px solid #15101f; font-size: 20px;">الرصيد</th>
                    </tr>
                </thead>
                <tbody>${rowsHtml}</tbody>
            </table>
            <div style="text-align: center; margin-top: 40px; font-size: 28px; background: ${finalColor}; color: #fff; padding: 20px; border-radius: 8px;">
                صافي الرصيد: ${finalBalanceText}
            </div>
            <p style="text-align: center; margin-top: 30px; font-size: 16px; color: #999;">تم إنشاء هذا المستند بواسطة ${shopName}</p>
        </div>
    `;
    
    previewPDF(htmlContent, `كشف حساب_${contact.name}`);
}

// ------------------------------------------
// دالة 8.2.8: openAgingReport — توليد تقرير أعمار الديون PDF
// ------------------------------------------
function openAgingReport() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('show');
    document.body.classList.remove('no-scroll');
    
    const shopName = getShopName();
    const buckets = [
        { label: 'أقل من 30 يوم', min: 0, max: 30, color: '#3b82f6', items: [] },
        { label: '30 - 60 يوم', min: 31, max: 60, color: '#f59e0b', items: [] },
        { label: '60 - 90 يوم', min: 61, max: 90, color: '#f97316', items: [] },
        { label: 'أكثر من 90 يوم (تحصيل عاجل!)', min: 91, max: Infinity, color: '#b91c1c', items: [] }
    ];
    const curr = (db.settings && db.settings.currency) ? db.settings.currency : 'ج.م';
    
    db.contacts.filter(c => isCustomer(c) && !c.archived).forEach(c => {
        const bal = getContactBalance(c.id);
        if(bal >= 0) return;
        const start = getDebtStartDate(c.id);
        const days = start ? Math.floor((Date.now() - new Date(start).getTime()) / 86400000) : 0;
        const bucket = buckets.find(b => days >= b.min && days <= b.max) || buckets[3];
        bucket.items.push({ name: c.name, debt: Math.abs(bal), days, start });
    });
    
    let summaryRows = '';
    buckets.forEach(b => {
        const total = round2(b.items.reduce((s, x) => s + x.debt, 0));
        summaryRows += `<tr><td style="padding: 15px; border: 1px solid #eee; font-size: 20px; color: ${b.color}; font-weight: bold;">${b.label}</td><td style="padding: 15px; border: 1px solid #eee; font-size: 20px; text-align: center;">${b.items.length}</td><td style="padding: 15px; border: 1px solid #eee; font-size: 20px; text-align: center; font-weight: bold;">${total} ${curr}</td></tr>`;
    });
    
    let detailRows = '';
    [...buckets].reverse().forEach(b => {
        b.items.sort((a, x) => x.days - a.days).forEach(x => {
            detailRows += `<tr><td style="padding: 10px; border: 1px solid #eee; font-size: 18px;">${x.name}</td><td style="padding: 10px; border: 1px solid #eee; font-size: 18px; text-align: center; color: #b91c1c; font-weight: bold;">${x.debt} ${curr}</td><td style="padding: 10px; border: 1px solid #eee; font-size: 18px; text-align: center;">${x.days} يوم</td><td style="padding: 10px; border: 1px solid #eee; font-size: 18px; text-align: center;">${x.start ? new Date(x.start).toLocaleDateString('ar-EG') : '-'}</td></tr>`;
        });
    });
    if(!detailRows) detailRows = '<tr><td colspan="4" style="padding: 20px; text-align: center;">🎉 لا توجد مديونيات على أي عميل!</td></tr>';
    
    const htmlContent = `
        <div style="padding: 40px; font-family: 'Cairo', sans-serif; direction: rtl;">
            <div style="text-align: center; border-bottom: 4px solid #15101f; padding-bottom: 20px; margin-bottom: 30px;">
                <h1 style="font-size: 36px; color: #15101f; margin: 0;">${shopName}</h1>
                <h2 style="font-size: 24px; color: #666; margin: 10px 0 0 0;">تقرير أعمار الديون</h2>
            </div>
            <h3 style="font-size: 22px; margin-bottom: 15px;">ملخص الفئات العمرية</h3>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 40px;">
                <thead><tr style="background: #15101f; color: #fff;"><th style="padding: 15px; border: 1px solid #15101f; font-size: 20px;">الفئة العمرية</th><th style="padding: 15px; border: 1px solid #15101f; font-size: 20px;">عدد العملاء</th><th style="padding: 15px; border: 1px solid #15101f; font-size: 20px;">إجمالي المديونية</th></tr></thead>
                <tbody>${summaryRows}</tbody>
            </table>
            <h3 style="font-size: 22px; margin-bottom: 15px;">تفاصيل العملاء (الأقدم أولاً)</h3>
            <table style="width: 100%; border-collapse: collapse;">
                <thead><tr style="background: #15101f; color: #fff;"><th style="padding: 15px; border: 1px solid #15101f; font-size: 20px;">العميل</th><th style="padding: 15px; border: 1px solid #15101f; font-size: 20px;">المديونية</th><th style="padding: 15px; border: 1px solid #15101f; font-size: 20px;">عمر الدين</th><th style="padding: 15px; border: 1px solid #15101f; font-size: 20px;">بدأ في</th></tr></thead>
                <tbody>${detailRows}</tbody>
            </table>
            <p style="text-align: center; margin-top: 30px; font-size: 16px; color: #999;">تم إنشاء هذا المستند بواسطة ${shopName}</p>
        </div>`;
    
    previewPDF(htmlContent, 'تقرير أعمار الديون');
}


// ======================================
// 📌 القسم 9: نظام التراجع الموحد والنسخ الاحتياطي والإعدادات
// ======================================

// ══════════════════════
// 9.1 نظام التراجع الذكي (Undo System)
// ══════════════════════

// ------------------------------------------
// دالة 9.1.1: registerUndo — تسجيل عملية حذف تتيح التراجع لمدة 5 ثوانٍ
// ------------------------------------------
function registerUndo(label, snapshot, restore, commit = null) {
    if(pendingDelete) finalizeDelete();
    pendingDelete = { label, snapshot, restore, commit };
    showUndoToast(label);
    clearTimeout(pendingDeleteTimer);
    pendingDeleteTimer = setTimeout(() => finalizeDelete(), UNDO_MS);
}

// ------------------------------------------
// دالة 9.1.2: finalizeDelete — إنهاء الحذف نهائياً بعد فوات المهلة
// ------------------------------------------
function finalizeDelete() {
    clearTimeout(pendingDeleteTimer);
    hideUndoToast();
    if(pendingDelete && typeof pendingDelete.commit === 'function') pendingDelete.commit();
    pendingDelete = null;
}

// ------------------------------------------
// دالة 9.1.3: undoDelete — التراجع عن العملية المحذوفة واستعادة حالتها
// ------------------------------------------
function undoDelete() {
    clearTimeout(pendingDeleteTimer);
    if(pendingDelete && typeof pendingDelete.restore === 'function') {
        pendingDelete.restore();
        showNotification('تم التراجع ✓', 'تم استرجاع ما تم حذفه بنجاح.');
    }
    pendingDelete = null;
    hideUndoToast();
}

// ------------------------------------------
// دالة 9.1.4: showUndoToast — إظهار شريط التراجع
// ------------------------------------------
function showUndoToast(msg) {
    document.getElementById('undo-toast-msg').innerText = msg;
    document.getElementById('undo-toast').classList.add('show');
}

// ------------------------------------------
// دالة 9.1.5: hideUndoToast — إخفاء شريط التراجع
// ------------------------------------------
function hideUndoToast() {
    document.getElementById('undo-toast').classList.remove('show');
}

// ══════════════════════
// 9.2 النسخ الاحتياطي والاستيراد والتصدير
// ══════════════════════

// ------------------------------------------
// دالة 9.2.1: exportBackup — تصدير نسخة احتياطية كاملة
// ------------------------------------------
function exportBackup(isAuto = false) { 
    db.settings.lastBackupTime = Date.now();
    db.settings.lastBackupReminder = null;
    saveDb();
    
    const d = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(db)); 
    const a = document.createElement('a'); 
    a.href = d; 
    a.download = `backup_debts_${new Date().toLocaleDateString('ar-EG').replace(/\//g, '-')}.json`; 
    document.body.appendChild(a); 
    a.click(); 
    document.body.removeChild(a);
    
    if(!isAuto) showNotification('تم الحفظ', 'تم تنزيل النسخة الاحتياطية بنجاح.');
}

// ------------------------------------------
// دالة 9.2.2: importBackup — استرجاع نسخة احتياطية
// ------------------------------------------
function importBackup(e) { 
    const f = e.target.files[0]; 
    if(!f) return; 
    const r = new FileReader(); 
    r.onload = (ev) => {
        try { 
            let text = ev.target.result;
            if (text && text.charCodeAt(0) === 0xFEFF) {
                text = text.slice(1);
            }
            const parsed = JSON.parse(text);
            if(!parsed || typeof parsed !== "object") throw new Error("الملف فارغ أو غير صالح");
            
            db = parsed;
            if(!db.profile) db.profile = DEFAULT_DB.profile;
            if(!db.settings) db.settings = DEFAULT_DB.settings;
            if(!db.contacts) db.contacts = [];
            if(!db.transactions) db.transactions = [];
            if(!db.reminders) db.reminders = [];
            if(!db.vault) db.vault = [];
            if(!db.settings.currency) db.settings.currency = "ج.م";
            if(!db.settings.totalsMode) db.settings.totalsMode = "active";
            if(db.settings.autoSave === undefined) db.settings.autoSave = false;
            if(!db.settings.autoSaveTime) db.settings.autoSaveTime = 86400;
            
            saveDb(); 
            showNotification("تم الاسترجاع", "تم استرجاع النسخة بنجاح، جاري تحديث الصفحة...");
            setTimeout(() => location.reload(), 1500);
        } catch(err) { 
            showNotification("خطأ", "ملف النسخة غير صالح أو تالف.", "fa-circle-xmark", "var(--c-red)");
        } finally {
            if(e.target) e.target.value = "";
        }
    }; 
    r.readAsText(f, "UTF-8"); 
}

// ------------------------------------------
// دالة 9.2.3: exportCSVRows — تنزيل صفوف CSV
// ------------------------------------------
function exportCSVRows(rows, baseName) {
    const csv = rows.map(r => r.map(cell => `"${String(cell)}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const d = new Date();
    const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseName}_${dateStr}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { 
        document.body.removeChild(a); 
        URL.revokeObjectURL(url); 
    }, 100);
}

// ------------------------------------------
// دالة 9.2.4: parseCSV — معالجة وتحليل ملف CSV
// ------------------------------------------
function parseCSV(text) {
    const rows = [];
    let row = [], cell = '', inQuotes = false;
    for(let i = 0; i < text.length; i++) {
        const ch = text[i];
        if(inQuotes) {
            if(ch === '"') {
                if(text[i+1] === '"') { cell += '"'; i++; }
                else inQuotes = false;
            } else cell += ch;
        } else {
            if(ch === '"') inQuotes = true;
            else if(ch === ',') { row.push(cell); cell = ''; }
            else if(ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
            else if(ch !== '\r') cell += ch;
        }
    }
    if(cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
}

// ------------------------------------------
// دالة 9.2.5: exportTransactionsCSV — تصدير معاملات الديون إكسل
// ------------------------------------------
function exportTransactionsCSV() {
    if(db.transactions.length === 0) { showNotification('لا توجد بيانات', 'لا توجد معاملات لتصديرها.', 'fa-circle-info', 'var(--c-gold)'); return; }
    const rows = [['اسم العميل', 'التاريخ', 'النوع', 'المبلغ', 'البيان', 'ISO']];
    [...db.transactions].sort((a,b) => new Date(a.date) - new Date(b.date)).forEach(t => {
        const c = db.contacts.find(x => x.id == t.contactId);
        rows.push([
            c ? c.name : 'محذوف',
            new Date(t.date).toLocaleString('ar-EG'),
            t.direction === 'out' ? 'أعطيته (عليه)' : 'أخذت منه (له)',
            t.amount,
            t.notes || '',
            t.date || ''
        ]);
    });
    exportCSVRows(rows, 'transactions');
}

// ------------------------------------------
// دالة 9.2.6: exportContactsCSV — تصدير عملاء الديون إكسل
// ------------------------------------------
function exportContactsCSV() {
    const customers = db.contacts.filter(c => isCustomer(c));
    if(customers.length === 0) { showNotification('لا توجد بيانات', 'لا يوجد عملاء لتصديرهم.', 'fa-circle-info', 'var(--c-gold)'); return; }
    const rows = [['اسم العميل', 'الهاتف', 'العنوان', 'الحالة', 'سقف الدين', 'تاريخ الاستحقاق', 'ملاحظات']];
    customers.forEach(c => {
        rows.push([
            c.name, c.phone || '', c.address || '',
            c.archived ? 'مؤرشف' : 'نشط',
            c.ceiling || '', c.dueDate || '', c.notes || ''
        ]);
    });
    exportCSVRows(rows, 'contacts');
}

// ------------------------------------------
// دالة 9.2.7: startCSVImport — بدء استيراد CSV
// ------------------------------------------
function startCSVImport(mode) {
    csvImportMode = mode;
    document.getElementById('import-csv-file').value = '';
    document.getElementById('import-csv-file').click();
}

// ------------------------------------------
// دالة 9.2.8: importCSV — تنفيذ استيراد الـ CSV
// ------------------------------------------
function importCSV(e) {
    const f = e.target.files[0];
    if(!f) return;
    const r = new FileReader();
    r.onload = (ev) => {
        try {
            const rows = parseCSV(ev.target.result);
            if(rows.length < 2) throw new Error('ملف فارغ');
            let added = 0, skipped = 0;
            
            if(csvImportMode === 'contacts') {
                for(let i = 1; i < rows.length; i++) {
                    const row = rows[i];
                    if(!row[0] || !row[0].trim()) continue;
                    const name = row[0].trim();
                    if(db.contacts.some(c => c.name === name)) { skipped++; continue; }
                    db.contacts.push({
                        id: Date.now() + i,
                        name, type: 'customer',
                        phone: row[1] || '',
                        address: row[2] || '',
                        archived: false,
                        ceiling: row[4] ? (Number(row[4]) || null) : null,
                        dueDate: row[5] || null,
                        notes: row[6] || ''
                    });
                    added++;
                }
            } else {
                for(let i = 1; i < rows.length; i++) {
                    const row = rows[i];
                    if(!row[0] || !row[0].trim()) continue;
                    let contact = db.contacts.find(c => c.name === row[0].trim());
                    if(!contact) {
                        contact = { id: Date.now() + i * 1000, name: row[0].trim(), type: 'customer', phone: '', address: '', archived: false, notes: 'من الاستيراد' };
                        db.contacts.push(contact);
                    }
                    const direction = (row[2] || '').includes('أخذت') ? 'in' : 'out';
                    const amount = parseFloat(row[3]);
                    if(!amount || amount <= 0) { skipped++; continue; }
                    let date = new Date();
                    if(row[5]) { const d = new Date(row[5]); if(!isNaN(d.getTime())) date = d; }
                    
                    db.transactions.push({
                        id: Date.now() + i * 1000 + i,
                        contactId: contact.id,
                        amount: round2(amount),
                        direction,
                        date: toLocalInput(date),
                        notes: row[4] || '',
                        receipt: false
                    });
                    added++;
                }
            }
            saveDb();
            showNotification('تم الاستيراد', `تم استيراد ${added} سجل بنجاح.`);
        } catch(err) {
            showNotification('خطأ', 'تعذر قراءة ملف CSV.', 'fa-circle-xmark', 'var(--c-red)');
        }
    };
    r.readAsText(f, 'UTF-8');
}

// ══════════════════════
// 9.3 الإعدادات العامة والحفظ الدوري
// ══════════════════════

// ------------------------------------------
// دالة 9.3.1: openDebtsSettings — فتح نافذة إعدادات النظام
// ------------------------------------------
function openDebtsSettings() {
    const sb = document.getElementById("sidebar");
    const sbo = document.getElementById("sidebar-overlay");
    if(sb) sb.classList.remove("open");
    if(sbo) sbo.classList.remove("show");
    document.body.classList.remove("no-scroll");
    updateDebtsSettingsUI();
    openModal("debts-settings-modal");
}

// ------------------------------------------
// دالة 9.3.2: updateDebtsSettingsUI — قراءة الإعدادات في الحقول
// ------------------------------------------
function updateDebtsSettingsUI() {
    const toggle = document.getElementById("auto-save-toggle");
    const timeSelect = document.getElementById("auto-save-time");
    const currencySelect = document.getElementById("currency-select");
    if(toggle && db.settings) toggle.checked = !!db.settings.autoSave;
    if(timeSelect && db.settings) timeSelect.value = String(db.settings.autoSaveTime || 86400);
    if(currencySelect && db.settings && db.settings.currency) currencySelect.value = db.settings.currency;
}

// ------------------------------------------
// دالة 9.3.3: toggleAutoSave — تفعيل/إيقاف الحفظ التلقائي
// ------------------------------------------
function toggleAutoSave() {
    const el = document.getElementById("auto-save-toggle");
    db.settings.autoSave = el ? el.checked : !db.settings.autoSave;
    saveDb();
    if(db.settings.autoSave) {
        checkAutoBackup();
        showNotification("تم التفعيل", "تم تفعيل الحفظ التلقائي.");
    } else {
        showNotification("تم الإيقاف", "تم إيقاف الحفظ التلقائي.");
    }
}

// ------------------------------------------
// دالة 9.3.4: updateAutoSaveTime — تغيير مهلة الحفظ التلقائي
// ------------------------------------------
function updateAutoSaveTime() {
    const el = document.getElementById("auto-save-time");
    if(el) {
        db.settings.autoSaveTime = Number(el.value) || 86400;
        saveDb();
        if(db.settings.autoSave) checkAutoBackup();
    }
}

// ------------------------------------------
// دالة 9.3.5: checkAutoBackup — فحص استحقاق النسخ التلقائي
// ------------------------------------------
function checkAutoBackup() {
    if(!db.settings || !db.settings.autoSave) return;
    const now = Date.now();
    const interval = (Number(db.settings.autoSaveTime) || 86400) * 1000;
    if (now - (db.settings.lastAutoSave || 0) >= interval) {
        exportBackup(true);
        db.settings.lastAutoSave = now;
        saveDb();
    }
}

// ------------------------------------------
// دالة 9.3.6: changeCurrency — تعديل العملة المعتمدة
// ------------------------------------------
function changeCurrency() {
    const el = document.getElementById("currency-select");
    if(el) {
        db.settings.currency = el.value;
        saveDb();
        if(currentContactId) renderTransactions();
        calculateTotals();
        renderContacts();
    }
}

// ------------------------------------------
// دالة 9.3.7: checkBackupReminder — تذكير أسبوعي بالنسخ
// ------------------------------------------
function checkBackupReminder() {
    if(db.settings.autoSave) return;
    const now = Date.now();
    const week = 7 * 86400000;
    const last = db.settings.lastBackupTime || 0;
    if(now - last > week && db.settings.lastBackupReminder !== getTodayStr()) {
        const days = last ? Math.floor((now - last) / 86400000) : 0;
        showNotification(
            'تذكير أمان 💾',
            `مرت ${days} يوماً على آخر نسخة احتياطية — احفظ نسخة جديدة لحماية بياناتك.`,
            'fa-cloud-arrow-up', 'var(--c-gold)'
        );
        db.settings.lastBackupReminder = getTodayStr();
        saveDb();
    }
}




// ══════════════════════
// 9.4 الملف الشخصي وإعدادات التاجر
// ══════════════════════

// ------------------------------------------
// دالة 9.4.1: openProfileModal — فتح نافذة تعديل الملف الشخصي
// ------------------------------------------
function openProfileModal() {
    if(!db.profile) db.profile = DEFAULT_DB.profile;
    const p = db.profile;
    const nameEl = document.getElementById("prof-name");
    const shopEl = document.getElementById("prof-shopname");
    const roleEl = document.getElementById("prof-role");
    const emailEl = document.getElementById("prof-email");
    const phoneEl = document.getElementById("prof-phone");
    const addrEl = document.getElementById("prof-address");
    const bioEl = document.getElementById("prof-bio");
    
    if(nameEl) nameEl.value = p.name || "";
    if(shopEl) shopEl.value = p.shopName || "";
    if(roleEl) roleEl.value = p.role || "";
    if(emailEl) emailEl.value = p.email || "";
    if(phoneEl) phoneEl.value = p.phone || "";
    if(addrEl) addrEl.value = p.address || "";
    if(bioEl) bioEl.value = p.bio || "";
    
    const preview = document.getElementById("profile-preview");
    if(preview) {
        if(p.pic) preview.innerHTML = `<img src="${p.pic}" alt="Profile">`;
        else preview.innerHTML = `<i class="fa-solid fa-user-circle"></i>`;
    }
    openModal("profile-modal");
}

// ------------------------------------------
// دالة 9.4.2: uploadProfilePic — رفع صورة البروفايل وضغطها
// ------------------------------------------
async function uploadProfilePic(e) {
    const file = e.target.files[0]; 
    if(!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
        const compressed = await compressImage(ev.target.result, 200, 0.8); 
        db.profile.pic = compressed; 
        const preview = document.getElementById("profile-preview");
        if(preview) preview.innerHTML = `<img src="${compressed}" alt="Profile">`; 
        saveDb(); 
        renderSidebarProfile();
    };
    reader.readAsDataURL(file);
}

// ------------------------------------------
// دالة 9.4.3: saveProfile — حفظ الملف الشخصي وتحديث العرض
// ------------------------------------------
function saveProfile() { 
    if(!db.profile) db.profile = {};
    const nameEl = document.getElementById("prof-name");
    const shopEl = document.getElementById("prof-shopname");
    const roleEl = document.getElementById("prof-role");
    const emailEl = document.getElementById("prof-email");
    const phoneEl = document.getElementById("prof-phone");
    const addrEl = document.getElementById("prof-address");
    const bioEl = document.getElementById("prof-bio");
    
    if(nameEl) db.profile.name = nameEl.value.trim() || "المستخدم"; 
    if(shopEl) db.profile.shopName = shopEl.value.trim(); 
    if(roleEl) db.profile.role = roleEl.value.trim(); 
    if(emailEl) db.profile.email = emailEl.value.trim(); 
    if(phoneEl) db.profile.phone = phoneEl.value.trim(); 
    if(addrEl) db.profile.address = addrEl.value.trim(); 
    if(bioEl) db.profile.bio = bioEl.value.trim(); 
    
    saveDb(); 
    closeModal("profile-modal"); 
    renderSidebarProfile();
    showNotification("تم الحفظ ✓", "تم حفظ بيانات الملف الشخصي بنجاح.");
}

// ------------------------------------------
// دالة 9.4.4: renderSidebarProfile — تحديث معلومات المستخدم في القائمة الجانبية
// ------------------------------------------
function renderSidebarProfile() {
    const p = db.profile || DEFAULT_DB.profile;
    const nameEl = document.getElementById("user-display-name");
    const roleEl = document.getElementById("user-display-role");
    if(nameEl) nameEl.innerText = p.name || "المستخدم";
    if(roleEl) roleEl.innerText = p.role || "رائد أعمال";
    
    const sidebarHeader = document.querySelector(".sidebar-header");
    let imgEl = document.getElementById("sidebar-profile-img");
    const iconEl = document.getElementById("sidebar-default-icon");
    if(!sidebarHeader) return;
    
    if (p.pic) {
        if (!imgEl) { 
            imgEl = document.createElement("img"); 
            imgEl.id = "sidebar-profile-img"; 
            imgEl.className = "profile-img-sidebar"; 
            sidebarHeader.insertBefore(imgEl, sidebarHeader.firstChild); 
        }
        imgEl.src = p.pic; 
        if(iconEl) iconEl.style.display = "none";
    } else {
        if (imgEl) imgEl.remove(); 
        if(iconEl) iconEl.style.display = "block";
    }
}

// ══════════════════════
// 9.5 رمز الدخول والحماية (PIN & Biometric Lock)
// ══════════════════════

// ------------------------------------------
// دالة 9.5.1: openPinModal — فتح نافذة إدارة رمز الدخول والبصمة
// ------------------------------------------
function openPinModal() {
    const hasHash = db.settings.pinLock && db.settings.pinLock.enabled && db.settings.pinLock.hash;
    const statusEl = document.getElementById("pin-status");
    const setupEl = document.getElementById("pin-setup");
    const manageEl = document.getElementById("pin-manage");
    
    if(hasHash) {
        if(statusEl) statusEl.innerText = "✅ رمز الدخول مفعّل — تقدر تغيّره أو تلغي الحماية";
        if(setupEl) setupEl.style.display = "none";
        if(manageEl) manageEl.style.display = "block";
    } else {
        if(statusEl) statusEl.innerText = "⚠️ لا يوجد رمز ساري — اضبط رمزاً جديداً الآن";
        if(setupEl) setupEl.style.display = "block";
        if(manageEl) manageEl.style.display = "none";
    }
    
    ["pin-new","pin-confirm","pin-current","pin-new2","pin-confirm2"].forEach(id => { 
        const el = document.getElementById(id); 
        if(el) el.value = ""; 
    });
    
    loadBiometricStatus();
    openModal("pin-modal");
}

// ------------------------------------------
// دالة 9.5.2: enablePin — تفعيل رمز الدخول
// ------------------------------------------
function enablePin() {
    const p1 = (document.getElementById("pin-new")?.value || "").trim();
    const p2 = (document.getElementById("pin-confirm")?.value || "").trim();
    if(!/^\d{4,6}$/.test(p1)) { alert("الرمز يجب أن يكون من 4 إلى 6 أرقام"); return; }
    if(p1 !== p2) { alert("الرمزان غير متطابقين"); return; }
    db.settings.pinLock = { enabled: true, hash: hashPin(p1) };
    db.settings.authCompleted = true;
    saveDb(); 
    closeModal("pin-modal");
    showNotification("تم الحفظ ✓", "تم تفعيل رمز الدخول بنجاح.", "fa-shield-halved", "var(--c-green)");
}

// ------------------------------------------
// دالة 9.5.3: disablePin — إلغاء حماية رمز الدخول
// ------------------------------------------
function disablePin() {
    const cur = (document.getElementById("pin-current")?.value || "").trim();
    if(!db.settings.pinLock || hashPin(cur) !== db.settings.pinLock.hash) { 
        alert("الرمز الحالي غير صحيح"); 
        return; 
    }
    db.settings.pinLock = { enabled: false, hash: null };
    saveDb(); 
    closeModal("pin-modal");
    showNotification("تم الإلغاء", "تم إلغاء حماية رمز الدخول.");
}

// ------------------------------------------
// دالة 9.5.4: changePin — تغيير رمز الدخول الحالي
// ------------------------------------------
function changePin() {
    const cur = (document.getElementById("pin-current")?.value || "").trim();
    if(!db.settings.pinLock || hashPin(cur) !== db.settings.pinLock.hash) { 
        alert("الرمز الحالي غير صحيح"); 
        return; 
    }
    const p1 = (document.getElementById("pin-new2")?.value || "").trim();
    const p2 = (document.getElementById("pin-confirm2")?.value || "").trim();
    if(!/^\d{4,6}$/.test(p1)) { alert("الرمز الجديد يجب أن يكون من 4 إلى 6 أرقام"); return; }
    if(p1 !== p2) { alert("الرمزان غير متطابقين"); return; }
    db.settings.pinLock.hash = hashPin(p1);
    saveDb(); 
    closeModal("pin-modal");
    showNotification("تم التغيير ✓", "تم تغيير رمز الدخول بنجاح.");
}

// ------------------------------------------
// دالة 9.5.5: biometricAvailable — التحقق من دعم البصمة على الجهاز
// ------------------------------------------
function biometricAvailable() {
    return !!(window.PublicKeyCredential && typeof window.PublicKeyCredential !== "undefined");
}

// ------------------------------------------
// دالة 9.5.6: bioCredIdKey — مفتاح تخزين البصمة
// ------------------------------------------
function bioCredIdKey(userKey) {
    return "wos_biometric_" + (userKey || "owner");
}

// ------------------------------------------
// دالة 9.5.7: loadBiometricStatus — تحديث حالة البصمة بالنافذة
// ------------------------------------------
function loadBiometricStatus() {
    const el = document.getElementById("biometric-status");
    if(!el) return;
    const btn = document.getElementById("biometric-setup-btn");
    
    if(!biometricAvailable()) {
        el.innerHTML = "⚠️ الجهاز لا يدعم البصمة/الوجه — استخدم الرمز";
        if(btn) btn.style.display = "none";
        return;
    }
    
    const saved = localStorage.getItem(bioCredIdKey("owner"));
    if(saved) {
        el.innerHTML = "✅ مسجلة على هذا الجهاز للدخول السريع";
        if(btn) { btn.innerText = "إعادة تسجيل"; btn.style.display = "inline-block"; }
    } else {
        el.innerHTML = "غير مسجلة على هذا الجهاز — سجّلها للدخول السريع";
        if(btn) { btn.innerText = "تسجيل"; btn.style.display = "inline-block"; }
    }
}

// ------------------------------------------
// دالة 9.5.8: setupBiometric — تسجيل البصمة للمالك
// ------------------------------------------
async function setupBiometric() {
    if(!biometricAvailable()) {
        alert("جهازك لا يدعم تسجيل البصمة أو الوجه.");
        return;
    }
    try {
        const challenge = new Uint8Array(32);
        crypto.getRandomValues(challenge);
        const userId = new TextEncoder().encode("debts_owner");
        const shopName = (db.profile && (db.profile.shopName || db.profile.name)) || "منظومة الديون";
        
        const cred = await navigator.credentials.create({
            publicKey: {
                challenge: challenge,
                rp: { name: shopName },
                user: { id: userId, name: "owner", displayName: "مالك النظام" },
                pubKeyCredParams: [
                    { type: "public-key", alg: -7 },
                    { type: "public-key", alg: -257 }
                ],
                authenticatorSelection: {
                    authenticatorAttachment: "platform",
                    userVerification: "required",
                    residentKey: "preferred"
                },
                timeout: 60000
            }
        });
        
        const credId = btoa(String.fromCharCode(...new Uint8Array(cred.rawId)));
        localStorage.setItem(bioCredIdKey("owner"), credId);
        loadBiometricStatus();
        showNotification("تم التسجيل ✓", "تم تسجيل البصمة بنجاح على هذا الجهاز.", "fa-fingerprint", "var(--c-teal)");
    } catch(err) {
        if(err.name !== "NotAllowedError") {
            alert("تعذر التسجيل: " + err.message);
        }
    }
}


// ======================================
// 📌 القسم 10: الصلاحيات والنوافذ التفاعلية والتشغيل
// ======================================

// ══════════════════════
// 10.1 الصلاحيات والتحقق
// ══════════════════════

// ------------------------------------------
// دالة 10.1.1: staffEnabled — فحص تفعيل وضع الموظفين
// ------------------------------------------
function staffEnabled() { 
    return !!(db.settings.staff && db.settings.staff.enabled && (db.settings.staff.users || []).length > 0); 
}

// ------------------------------------------
// دالة 10.1.2: isOwner — هل المستخدم هو المالك؟
// ------------------------------------------
function isOwner() { 
    return (sessionStorage.getItem('wos_login_user') || 'owner') === 'owner'; 
}

// ------------------------------------------
// دالة 10.1.3: can — فحص الصلاحية المطلوبة
// ------------------------------------------
function can(perm) {
    if(!staffEnabled()) return true;
    if(isOwner()) return true;
    const uid = sessionStorage.getItem('wos_login_user');
    const u = (db.settings.staff.users || []).find(x => String(x.id) === String(uid));
    if(!u) return true;
    return u.perms && u.perms[perm] === true;
}

// ------------------------------------------
// دالة 10.1.4: staffLogout — تسجيل الخروج والرجوع للرئيسية
// ------------------------------------------
function staffLogout() {
    sessionStorage.removeItem('wos_login_user');
    goToHub();
}

// ══════════════════════
// 10.2 النوافذ التفاعلية والتأكيد
// ══════════════════════

// ------------------------------------------
// دالة 10.2.1: showNotification — إرسال إشعار فوري
// ------------------------------------------
function showNotification(title, msg, icon = 'fa-circle-check', color = 'var(--c-green)', action = null) {
    notifQueue.push({ title, msg, icon, color, action });
    if(!notifShowing) processNotifQueue();
}

// ------------------------------------------
// دالة 10.2.2: processNotifQueue — معالجة طابور الإشعارات
// ------------------------------------------
function processNotifQueue() {
    if(notifQueue.length === 0) { notifShowing = false; return; }
    notifShowing = true;
    const n = notifQueue.shift();
    
    document.getElementById('notif-title').innerText = n.title;
    document.getElementById('notif-message').innerText = n.msg;
    const iconEl = document.getElementById('notif-icon');
    iconEl.className = `fa-solid ${n.icon}`;
    iconEl.style.color = n.color;
    
    const actionBtn = document.getElementById('notif-action-btn');
    const okBtn = document.getElementById('notif-ok-btn');
    if(n.action) {
        currentNotifAction = n.action;
        document.getElementById('notif-action-label').innerText = n.action.label;
        document.getElementById('notif-action-icon').className = n.action.icon || 'fa-brands fa-whatsapp';
        actionBtn.style.background = n.action.color || '#25D366';
        actionBtn.style.display = 'block';
    } else {
        currentNotifAction = null;
        actionBtn.style.display = 'none';
    }
    
    if(navigator.vibrate) navigator.vibrate([100, 50, 100]);
    openModal('notification-modal');
}

// ------------------------------------------
// دالة 10.2.3: notifActionClick — تنفيذ إجراء الإشعار الفوري
// ------------------------------------------
function notifActionClick() {
    if(!currentNotifAction) return;
    const action = currentNotifAction;
    currentNotifAction = null;
    dismissNotification();
    if(typeof action === 'object' && typeof action.fn === 'function') action.fn();
    else if(typeof action === 'function') action();
}

// ------------------------------------------
// دالة 10.2.4: dismissNotification — إغلاق الإشعار الحالي ومتابعة الطابور
// ------------------------------------------
function dismissNotification() {
    closeModal('notification-modal');
    setTimeout(processNotifQueue, 150);
}

// ------------------------------------------
// دالة 10.2.5: showConfirm — نافذة تأكيد الإجراءات الحساسة
// ------------------------------------------
function showConfirm(message, callback, cancelCallback = null) {
    confirmState = { callback, cancelCallback, reopenModalId: null };
    document.querySelectorAll('.modal.show').forEach(m => {
        if(m.id !== 'confirm-modal' && m.id !== 'notification-modal') {
            confirmState.reopenModalId = m.id;
            m.classList.remove('show');
        }
    });
    document.getElementById('confirm-message').innerText = message;
    openModal('confirm-modal');
}

// ------------------------------------------
// دالة 10.2.6: clearSearchInput — مسح حقل البحث وإعادة العرض
// ------------------------------------------
function clearSearchInput(inputId, btnId, context) {
    const input = document.getElementById(inputId);
    if(!input) return;
    input.value = '';
    const btn = document.getElementById(btnId);
    if(btn) btn.style.display = 'none';
    if(context === 'contacts') renderContacts();
    else if(context === 'tx') renderTransactions();
    input.focus();
}

// ------------------------------------------
// دالة 10.2.7: toggleSearchClear — إظهار وإخفاء زر مسح البحث
// ------------------------------------------
function toggleSearchClear(inputId, btnId) {
    const input = document.getElementById(inputId);
    const btn = document.getElementById(btnId);
    if(!input || !btn) return;
    btn.style.display = input.value.trim() ? 'flex' : 'none';
}

// ------------------------------------------
// دالة 10.2.8: initFab — تهيئة الزر العائم للمعاملات مع دعم السحب
// ------------------------------------------
function initFab() {
    const fab = document.getElementById('fabAddTx');
    if(!fab) return;
    let isDragging = false, startX, startY, initialLeft, initialTop, hasMoved = false;

    function onStart(e) {
        isDragging = true; hasMoved = false;
        const rect = fab.getBoundingClientRect();
        fab.style.left = rect.left + 'px'; fab.style.top = rect.top + 'px'; fab.style.right = 'auto'; fab.style.bottom = 'auto'; 
        const touch = e.touches ? e.touches[0] : e;
        startX = touch.clientX; startY = touch.clientY; initialLeft = rect.left; initialTop = rect.top;
        document.addEventListener('mousemove', onMove);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('mouseup', onEnd);
        document.addEventListener('touchend', onEnd);
    }
    function onMove(e) {
        if (!isDragging) return;
        e.preventDefault(); 
        const touch = e.touches ? e.touches[0] : e;
        const dx = touch.clientX - startX; const dy = touch.clientY - startY;
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) hasMoved = true;
        let newLeft = initialLeft + dx; let newTop = initialTop + dy;
        const headerHeight = 80, padding = 10;
        const maxX = window.innerWidth - fab.offsetWidth - padding;
        const maxY = window.innerHeight - fab.offsetHeight - padding;
        newLeft = Math.max(padding, Math.min(newLeft, maxX));
        newTop = Math.max(headerHeight, Math.min(newTop, maxY));
        fab.style.left = newLeft + 'px'; fab.style.top = newTop + 'px';
    }
    function onEnd() {
        isDragging = false;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('mouseup', onEnd);
        document.removeEventListener('touchend', onEnd);
    }
    fab.addEventListener('mousedown', onStart);
    fab.addEventListener('touchstart', onStart, { passive: false });
    fab.addEventListener('click', (e) => {
        e.preventDefault();
        if (!hasMoved) openTxModal();
    });
}

// ══════════════════════
// 10.3 التشغيل الابتدائي ومستمعات الأحداث الموحدة
// ══════════════════════

// ------------------------------------------
// دالة 10.3.1: تهيئة برنامج دفتر الديون عند تحميل المستند
// ------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
    initReceiptDB();
    initFab();
    updateThemeIcon();
    renderSidebarProfile();
    updateDebtsSettingsUI();
    
    // تشغيل كشف الحسابات واحتساب الإجماليات
    switchDebtTab('contacts');
    renderContacts();
    calculateTotals();
    updateDebtTabBadges();
    checkOverdueGracePeriodAlerts();
    
    // فحص التذكيرات الدورية
    checkReminders();
    checkBackupReminder();
    if(db.settings.autoSave) checkAutoBackup();
    
    setInterval(checkReminders, 60 * 1000);
    setInterval(checkAutoBackup, 60 * 1000);
});

// إغلاق النوافذ المنبثقة عند النقر خارجها
window.addEventListener('click', function(e) {
    document.querySelectorAll('.modal').forEach(modal => {
        if (e.target === modal) {
            if(modal.id === 'notification-modal') dismissNotification();
            else modal.classList.remove('show');
        }
    });
});

// أزرار نافذة التأكيد
document.getElementById('confirm-yes-btn')?.addEventListener('click', () => {
    closeModal('confirm-modal');
    const cb = confirmState?.callback;
    confirmState = null;
    if(cb) cb();
});

document.getElementById('confirm-no-btn')?.addEventListener('click', () => {
    closeModal('confirm-modal');
    const state = confirmState;
    confirmState = null;
    if(state && state.cancelCallback) state.cancelCallback();
    else if(state && state.reopenModalId) openModal(state.reopenModalId);
});