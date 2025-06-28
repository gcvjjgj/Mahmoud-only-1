// تطبيق إدارة التعلم الإلكتروني

// ----------------------------------------------------
// متغيرات الإعدادات (Configuration Variables)
// ----------------------------------------------------
const SERVER_API_URL = "https://patientkoala8765864.onrender.com/api";

// A simple IndexedDB wrapper for storing files
class FileStore {
    constructor(dbName = 'EducationAppDB', storeName = 'files') {
        this.dbName = dbName;
        this.storeName = storeName;
        this.db = null;
    }

    async open() {
        if (this.db) return Promise.resolve(this.db);
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);
            request.onerror = (event) => reject('Error opening DB: ' + event.target.errorCode);
            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve(this.db);
            };
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName);
                }
            };
        });
    }

    async saveFile(key, blob) {
        await this.open();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.put(blob, key);
            request.onsuccess = () => resolve(key);
            request.onerror = (event) => reject('Error saving file: ' + event.target.error);
        });
    }

    async getFile(key) {
        if (!key) return Promise.resolve(null);
        await this.open();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.get(key);
            request.onsuccess = () => {
                resolve(request.result || null);
            };
            request.onerror = (event) => reject('Error getting file: ' + event.target.error);
        });
    }

    async deleteFile(key) {
        if (!key) return Promise.resolve();
        await this.open();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.delete(key);
            request.onsuccess = () => resolve();
            request.onerror = (event) => reject('Error deleting file: ' + event.target.error);
        });
    }

    async getFileAsURL(key) {
        try {
            const fileBlob = await this.getFile(key);
            if (fileBlob) {
                return URL.createObjectURL(fileBlob);
            }
            return null;
        } catch (error) {
            console.error(`Error getting file URL for key ${key}:`, error);
            return null;
        }
    }
}

class EducationApp {
    constructor() {
        this.currentUser = null;
        this.currentPage = 'homePage';
        this.currentLessonId = null;
        this.currentLessonFilter = 'all'; // Default filter
        this.examTimer = null;
        this.examTimeLeft = 1800; // 30 minutes in seconds
        this.mediaRecorder = null;
        this.recordedBlob = null;
        this.fileStore = new FileStore();
        this.syncEnabled = false;
        
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.loadUserSession();
        this.initializeTheme();
        this.applyCustomBackground();
        this.checkServerConnection();
    }

    // Check if server is available
    async checkServerConnection() {
        try {
            await this.sendRequest('/health', 'GET');
            this.syncEnabled = true;
            console.log('Server connection established');
            this.syncDataFromServer();
        } catch (error) {
            console.log('Server not available, using local storage only');
            this.syncEnabled = false;
        }
    }

    // Sync all data from server
    async syncDataFromServer() {
        if (!this.syncEnabled) return;
        
        try {
            const dataToSync = ['lessons', 'subscriptions', 'general-messages', 'books', 'payment-methods'];
            const localKeys = ['lessons', 'subscriptions', 'generalMessages', 'books', 'paymentMethods'];

            for (let i = 0; i < dataToSync.length; i++) {
                const endpoint = dataToSync[i];
                const localKey = localKeys[i];
                const serverData = await this.sendRequest(`/${endpoint}`, 'GET');
                if(serverData) {
                    this.saveStoredData(localKey, serverData);
                }
            }

            console.log('Data synchronized from server');
        } catch (error) {
            console.error('Error syncing data from server:', error);
        }
    }
    
    /**
     * دالة لإرسال طلبات HTTP إلى السيرفر.
     */
    async sendRequest(endpoint, method, data = null) {
        try {
            const options = {
                method: method,
                headers: {
                    'Content-Type': 'application/json',
                },
            };

            if (data) {
                options.body = JSON.stringify(data);
            }

            const response = await fetch(`${SERVER_API_URL}${endpoint}`, options);

            if (!response.ok) {
                let errorData = { message: `HTTP error! status: ${response.status}` };
                try {
                    errorData = await response.json();
                } catch (e) {
                   // Ignore if error response is not JSON
                }
                throw new Error(errorData.message);
            }
            
            if (response.status === 204) { // No Content
                return null;
            }

            return await response.json();
        } catch (error) {
            console.error(`Error in ${method} request to ${endpoint}:`, error);
            this.showMessage('فشل الاتصال بالخادم. قد لا يتم حفظ التغييرات.', 'error');
            throw error;
        }
    }
    
    // إعداد مستمعي الأحداث
    setupEventListeners() {
        // أزرار التنقل الرئيسية
        document.querySelectorAll('[data-target]').forEach(button => {
            button.addEventListener('click', (e) => {
                const target = e.currentTarget.getAttribute('data-target');
                this.showPage(target);
            });
        });

        // أزرار لوحة التحكم
        document.querySelectorAll('.dashboard-card').forEach(card => {
            card.addEventListener('click', (e) => {
                const target = card.getAttribute('data-target');
                if (target) {
                    this.showPage(target);
                }
            });
        });

        // نماذج تسجيل الدخول
        this.setupLoginForms();
        
        // نماذج إنشاء الحساب
        this.setupRegistrationForms();
        
        // تبديل الوضع الليلي/النهار
        this.setupThemeToggle();
        
        // نماذج رفع المحتوى
        this.setupUploadForms();
        
        // نماذج أخرى
        this.setupOtherForms();
    }

    // إعداد نماذج تسجيل الدخول
    setupLoginForms() {
        // تسجيل دخول الطالب
        const loginForm = document.getElementById('loginForm');
        if (loginForm) {
            loginForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleStudentLogin();
            });
        }

        // تسجيل دخول المدرس
        const teacherLoginForm = document.getElementById('teacherLoginForm');
        if (teacherLoginForm) {
            teacherLoginForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleTeacherLogin();
            });
        }

        // تسجيل دخول الدعم الفني
        const supportLoginForm = document.getElementById('supportLoginForm');
        if (supportLoginForm) {
            supportLoginForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleSupportLogin();
            });
        }
    }

    // إعداد نماذج إنشاء الحساب
    setupRegistrationForms() {
        const registerForm = document.getElementById('registerForm');
        if (registerForm) {
            registerForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleStudentRegistration();
            });
        }
    }

    // إعداد تبديل الوضع الليلي
    setupThemeToggle() {
        document.querySelectorAll('#themeToggle, .theme-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.toggleTheme();
            });
        });
    }

    // إعداد نماذج رفع المحتوى
    setupUploadForms() {
        // رفع الحصص
        const uploadLessonForm = document.getElementById('uploadLessonForm');
        if (uploadLessonForm) {
            uploadLessonForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleLessonUpload();
            });
        }

        // إضافة سؤال جديد
        const addQuestionBtn = document.getElementById('addQuestionBtn');
        if (addQuestionBtn) {
            addQuestionBtn.addEventListener('click', () => {
                this.addNewQuestion();
            });
        }

        // نموذج الاشتراكات
        const subscriptionForm = document.getElementById('subscriptionForm');
        if (subscriptionForm) {
            subscriptionForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleSubscriptionCreate();
            });
        }
    }

    // إعداد النماذج الأخرى
    setupOtherForms() {
        // المحفظة
        const addFundsForm = document.getElementById('addFundsForm');
        if (addFundsForm) {
            addFundsForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleAddFunds();
            });
        }

        // وسائل الدفع
        const paymentMethodForm = document.getElementById('paymentMethodForm');
        if (paymentMethodForm) {
            paymentMethodForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleAddPaymentMethod();
            });
        }

        // الرسائل العامة
        const generalMessageForm = document.getElementById('generalMessageForm');
        if (generalMessageForm) {
            generalMessageForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleGeneralMessage();
            });
        }

        // إدارة الكتب
        const bookForm = document.getElementById('bookForm');
        if (bookForm) {
            bookForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleBookAdd();
            });
        }

        // نموذج إرسال السؤال
        const questionForm = document.getElementById('questionForm');
        if (questionForm) {
            questionForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleQuestionSubmit();
            });
        }
        
        // نموذج الدعم الفني للطالب
        const studentSupportForm = document.getElementById('studentSupportForm');
        if (studentSupportForm) {
            studentSupportForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleStudentSupportMessage();
            });
            // Handle textarea auto-resize
            const textarea = document.getElementById('studentSupportMessage');
            if (textarea) {
                textarea.addEventListener('input', () => {
                    textarea.style.height = 'auto';
                    textarea.style.height = (textarea.scrollHeight) + 'px';
                });
            }
        }

        // الامتحان
        const submitExamBtn = document.getElementById('submitExamBtn');
        if (submitExamBtn) {
            submitExamBtn.addEventListener('click', () => {
                this.submitExam();
            });
        }

        // معاينة إيصال التحويل
        const transferReceiptInput = document.getElementById('transferReceipt');
        if (transferReceiptInput) {
            transferReceiptInput.addEventListener('change', (e) => {
                this.previewImage(e, 'receiptPreview', 'receiptImg');
            });
        }

        // معاينة صورة رسالة الدعم
        const studentSupportImage = document.getElementById('studentSupportImage');
        if (studentSupportImage) {
            studentSupportImage.addEventListener('change', (e) => {
                this.previewImage(e, 'studentSupportImagePreview', 'studentSupportPreviewImg');
            });
        }
    }

    // معاينة الصورة
    async previewImage(event, previewId, imgId) {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            return new Promise(resolve => {
                reader.onload = (e) => {
                    const result = e.target.result;
                    if (previewId && imgId) {
                        const preview = document.getElementById(previewId);
                        const img = document.getElementById(imgId);
                        if (preview && img) {
                            img.src = result;
                            preview.style.display = 'block';
                        }
                    }
                    resolve(result);
                };
                reader.readAsDataURL(file);
            });
        }
        return null;
    }

    // تسجيل دخول الطالب
    handleStudentLogin() {
        const name = document.getElementById('loginName').value.trim();
        const password = document.getElementById('loginPassword').value.trim();

        if (!name || !password) {
            this.showMessage('يرجى إدخال جميع البيانات', 'error');
            return;
        }

        const students = this.getStoredData('students') || [];
        const student = students.find(s => s.name === name && s.password === password);

        if (student) {
            if (student.isBanned) {
                this.showMessage(`تم حظر حسابك. السبب: ${student.banReason || 'غير محدد'}\nتاريخ الحظر: ${student.bannedAt ? new Date(student.bannedAt).toLocaleDateString('ar-EG') : 'غير محدد'}\nيمكنك التواصل مع الدعم الفني لمراجعة الحظر`, 'error');
                return;
            }

            this.currentUser = {
                id: student.id,
                name: student.name,
                type: 'student',
                grade: student.grade,
                studentNumber: student.studentNumber,
                parentPhone: student.parentPhone
            };

            this.saveUserSession();
            this.showMessage('تم تسجيل الدخول بنجاح', 'success');
            this.showPage('studentDashboard');
            
            // تحديث آخر نشاط
            student.lastActivity = new Date().toISOString();
            this.saveStoredData('students', students);
            
            // تحديث عداد الإشعارات
            setTimeout(() => {
                this.updateNotificationCount();
            }, 100);
        } else {
            this.showMessage('بيانات تسجيل الدخول غير صحيحة', 'error');
        }
    }

    // تسجيل دخول المدرس
    handleTeacherLogin() {
        const name = document.getElementById('teacherName').value.trim();
        const code = document.getElementById('teacherCode').value.trim();
        const phone = document.getElementById('teacherPhone').value.trim();

        console.log('Teacher login attempt:', { name, code, phone });

        if (!name || !code || !phone) {
            this.showMessage('يرجى إدخال جميع البيانات', 'error');
            return;
        }

        // بيانات المدرس الصحيحة
        const correctTeacher = {
            name: 'Mahmoud only',
            code: 'HHDV/58HR',
            phone: '01050747978'
        };

        console.log('Checking against:', correctTeacher);

        if (name === correctTeacher.name && code === correctTeacher.code && phone === correctTeacher.phone) {
            this.currentUser = {
                id: 'teacher_1',
                name: name,
                type: 'teacher'
            };

            this.saveUserSession();
            this.showMessage('تم تسجيل الدخول بنجاح', 'success');
            this.showPage('teacherDashboard');
        } else {
            console.log('Login failed - incorrect credentials');
            this.showMessage('بيانات تسجيل الدخول غير صحيحة', 'error');
        }
    }

    // تسجيل دخول الدعم الفني
    async handleSupportLogin() {
        const name = document.getElementById('supportName').value.trim();
        const code = document.getElementById('supportCode').value.trim();

        if (!name || !code) {
            this.showMessage('يرجى إدخال جميع البيانات', 'error');
            return;
        }
        
        try {
            const response = await this.sendRequest('/auth/support-login', 'POST', { name, code });
            const support = response.user;
            
            this.currentUser = {
                id: support.id,
                name: support.name,
                type: 'support'
            };

            this.saveUserSession();
            this.showMessage('تم تسجيل الدخول بنجاح', 'success');
            this.showPage('supportDashboard');

            // تحميل البيانات الخاصة بالدعم
            setTimeout(() => {
                this.loadPendingPayments();
                this.loadBannedStudents('support');
                this.loadStudentChatList();
                this.loadStudentOperations();
            }, 100);
        } catch (error) {
             console.error('Support login failed:', error);
             this.showMessage(error.message || 'بيانات تسجيل الدخول غير صحيحة', 'error');
        }
    }

    // تسجيل طالب جديد
    async handleStudentRegistration() {
        const name = document.getElementById('registerName').value.trim();
        const studentNumber = document.getElementById('studentNumber').value.trim();
        const parentPhone = document.getElementById('parentPhone').value.trim();
        const password = document.getElementById('registerPassword').value.trim();
        const confirmPassword = document.getElementById('confirmPassword').value.trim();
        const grade = document.getElementById('gradeSelect').value;
        
        if (!name || !studentNumber || !parentPhone || !password || !confirmPassword || !grade) {
            this.showMessage('يرجى إدخال جميع البيانات', 'error');
            return;
        }
        
        if (password !== confirmPassword) {
            this.showMessage('كلمة المرور غير متطابقة', 'error');
            return;
        }
        
        try {
            const userData = {
                fullName: name,
                studentNumber: studentNumber,
                parentNumber: parentPhone,
                password: password,
                gradeLevel: grade,
                balance: 0,
                points: 0,
            };

            // Register on server first
            if (this.syncEnabled) {
                await this.sendRequest('/auth/register', 'POST', userData);
            }
            
            // If server registration is successful (or offline), save locally
            const students = this.getStoredData('students') || [];
            if (students.some(s => s.name === name || s.studentNumber === studentNumber)) {
                this.showMessage('يوجد طالب مسجل بنفس الاسم أو رقم الطالب', 'error');
                return;
            }
            
            const newStudent = {
                id: Date.now(), // Local ID, can be replaced by server ID later
                name,
                studentNumber,
                parentPhone,
                password, // Note: In a real app, never store plain text passwords
                grade,
                balance: 0,
                points: 0,
                registrationDate: new Date().toISOString(),
                lastActivity: new Date().toISOString(),
                isBanned: false
            };

            students.push(newStudent);
            this.saveStoredData('students', students);
            this.showMessage('تم إنشاء الحساب بنجاح، يمكنك الآن تسجيل الدخول', 'success');
            this.showPage('studentLogin');

        } catch (error) {
            console.error('Registration failed:', error);
            this.showMessage(error.message || 'فشل إنشاء الحساب.', 'error');
        }
    }

    // حفظ جلسة المستخدم
    saveUserSession() {
        localStorage.setItem('userSession', JSON.stringify(this.currentUser));
    }

    // تحميل جلسة المستخدم
    loadUserSession() {
        const session = localStorage.getItem('userSession');
        if (session) {
            try {
                this.currentUser = JSON.parse(session);
                
                // التحقق من صحة البيانات المحفوظة
                if (this.currentUser && this.currentUser.type) {
                    // إعادة توجيه المستخدم إلى لوحته حسب نوعه
                    if (this.currentUser.type === 'student') {
                        this.showPage('studentDashboard');
                        // تحديث عداد الإشعارات للطالب
                        setTimeout(() => {
                            this.updateNotificationCount();
                        }, 100);
                    } else if (this.currentUser.type === 'teacher') {
                        this.showPage('teacherDashboard');
                    } else if (this.currentUser.type === 'support') {
                        this.showPage('supportDashboard');
                        // تحميل البيانات الخاصة بالدعم
                        setTimeout(() => {
                            this.loadPendingPayments();
                            this.loadBannedStudents('support');
                            this.loadStudentChatList();
                            this.loadStudentOperations();
                        }, 100);
                    }
                } else {
                    // حذف الجلسة التالفة
                    localStorage.removeItem('userSession');
                    this.currentUser = null;
                }
            } catch (error) {
                console.error('Error loading user session:', error);
                localStorage.removeItem('userSession');
                this.currentUser = null;
            }
        }
        
        // تطبيق الخلفية المخصصة بعد تحميل الصفحة
        setTimeout(() => {
            this.applyCustomBackground();
        }, 100);
    }

    // تسجيل الخروج
    logout() {
        // تسجيل وقت الخروج للدعم الفني
        if (this.currentUser && this.currentUser.type === 'support') {
            const supportStaff = this.getStoredData('supportStaff') || [];
            const support = supportStaff.find(s => s.id === this.currentUser.id);
            if (support) {
                support.lastLogout = new Date().toISOString();
                support.isOnline = false;
                this.saveStoredData('supportStaff', supportStaff);
            }
        }

        localStorage.removeItem('userSession');
        this.currentUser = null;
        this.showPage('homePage');
        this.showMessage('تم تسجيل الخروج بنجاح', 'success');
    }

    // عرض الصفحة
    showPage(pageId) {
        // إخفاء جميع الصفحات
        document.querySelectorAll('.page').forEach(page => {
            page.classList.remove('active');
        });

        // عرض الصفحة المطلوبة
        const targetPage = document.getElementById(pageId);
        if (targetPage) {
            targetPage.classList.add('active');
            this.currentPage = pageId;
        }

        // تحديث العنوان
        this.updatePageTitle(pageId);
        
        // تحميل البيانات حسب الصفحة
        if (pageId === 'paidLessons') {
            if (this.currentUser && this.currentUser.type === 'student') {
                // Set default filter to student's grade, or 'all' if not set
                this.currentLessonFilter = this.currentUser.grade || 'all';
                // Update active state on filter buttons
                const filterButtons = document.querySelectorAll('#paidLessons .filter-btn');
                filterButtons.forEach(btn => {
                    const btnFilter = btn.getAttribute('onclick').match(/'([^']+)'/)[1];
                    if (btnFilter === this.currentLessonFilter) {
                        btn.classList.add('active');
                    } else {
                        btn.classList.remove('active');
                    }
                });
            }
            this.loadPaidLessons();
        } else if (pageId === 'wallet') {
            this.loadWalletPage();
        } else if (pageId === 'subscriptions') {
            this.loadSubscriptionsPage();
        } else if (pageId === 'activityLog') {
            this.loadActivityLog();
        } else if (pageId === 'books') {
            this.loadBooksPage();
        } else if (pageId === 'notifications') {
            this.loadNotificationsPage();
        } else if (pageId === 'rewards') {
            this.loadRewardsPage();
        } else if (pageId === 'studentSupport') {
            this.loadStudentSupportChat();
        } else if (pageId === 'manageLessons') {
            this.loadTeacherLessons();
        } else if (pageId === 'manageSubscriptions') {
            this.loadTeacherSubscriptions();
        } else if (pageId === 'paymentMethods') {
            this.loadCurrentPaymentMethods();
        } else if (pageId === 'generalMessages') {
            this.loadSentGeneralMessages();
        } else if (pageId === 'studentMessages') {
            this.loadStudentMessages();
        } else if (pageId === 'banStudents') {
            this.searchAndFilterStudents('teacher');
            this.loadBannedStudents('teacher');
        } else if (pageId === 'banStudentsSupport') {
            this.searchAndFilterStudents('support');
            this.loadBannedStudents('support');
        } else if (pageId === 'supportChat') {
            this.loadStudentChatList();
        }
    }

    // تحديث عنوان الصفحة
    updatePageTitle(pageId) {
        const titles = {
            'homePage': 'مستر محمود حمد - مدرس أول لغة إنجليزية',
            'studentPage': 'تسجيل الدخول - طالب',
            'teacherPage': 'تسجيل الدخول - مدرس',
            'supportPage': 'تسجيل الدخول - دعم فني',
            'studentDashboard': 'لوحة تحكم الطالب',
            'teacherDashboard': 'لوحة تحكم المعلم',
            'supportDashboard': 'لوحة تحكم الدعم الفني',
            'manageLessons': 'إدارة الحصص',
            'manageSubscriptions': 'إدارة الاشتراكات',
            'generalMessages': 'إرسال رسائل عامة',
            'banStudents': 'حظر الطلاب'
        };

        document.title = titles[pageId] || document.title;
    }

    // عرض رسالة
    showMessage(message, type = 'info') {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}`;
        messageDiv.textContent = message;
        messageDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${type === 'error' ? '#e74c3c' : type === 'success' ? '#27ae60' : '#3498db'};
            color: white;
            padding: 15px 25px;
            border-radius: 10px;
            z-index: 10000;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            animation: slideIn 0.3s ease;
        `;

        document.body.appendChild(messageDiv);

        setTimeout(() => {
            messageDiv.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => {
                if (messageDiv.parentNode) {
                    messageDiv.parentNode.removeChild(messageDiv);
                }
            }, 300);
        }, 3000);
    }

    // تبديل الوضع الليلي/النهار
    toggleTheme() {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        
        // تحديث أيقونة الزر
        document.querySelectorAll('.theme-btn i').forEach(icon => {
            icon.className = newTheme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
        });
    }

    // تهيئة الوضع الليلي
    initializeTheme() {
        const savedTheme = localStorage.getItem('theme') || 'light';
        document.documentElement.setAttribute('data-theme', savedTheme);
        
        // تحديث أيقونة الزر
        document.querySelectorAll('.theme-btn i').forEach(icon => {
            icon.className = savedTheme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
        });
    }

    // حفظ البيانات
    saveStoredData(key, data) {
        try {
            localStorage.setItem(key, JSON.stringify(data));
        } catch (error) {
            console.error('Error saving data:', error);
            this.showMessage('خطأ في حفظ البيانات', 'error');
        }
    }

    // جلب البيانات
    getStoredData(key) {
        try {
            const data = localStorage.getItem(key);
            return data ? JSON.parse(data) : null;
        } catch (error) {
            console.error('Error loading data:', error);
            return null;
        }
    }

    // فلترة الحصص حسب الصف
    filterLessonsByGrade(grade) {
        this.currentLessonFilter = grade;
        // تحديث حالة الأزرار
        const filterButtons = document.querySelectorAll('#paidLessons .filter-btn');
        filterButtons.forEach(btn => {
            const btnFilter = btn.getAttribute('onclick').match(/'([^']+)'/)[1];
            if (btnFilter === grade) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
        this.loadPaidLessons(); // إعادة تحميل الحصص بالفلتر الجديد
    }

    // تحميل الحصص المدفوعة
    async loadPaidLessons() {
        if (!this.currentUser || this.currentUser.type !== 'student') return;
        
        this.updateStudentBalance();
        
        const lessons = this.getStoredData('lessons') || [];
        let activeLessons = lessons.filter(lesson => lesson.isActive);
        
        // تطبيق الفلتر
        if (this.currentLessonFilter && this.currentLessonFilter !== 'all') {
            activeLessons = activeLessons.filter(lesson => lesson.grade === this.currentLessonFilter);
        }

        const container = document.getElementById('lessonsGrid');
        
        if (!container) return;
        
        if (activeLessons.length === 0) {
            container.innerHTML = `
                <div class="no-lessons">
                    <i class="fas fa-graduation-cap"></i>
                    <h3>لا توجد حصص متاحة</h3>
                    <p>سيتم إضافة حصص جديدة قريباً</p>
                </div>
            `;
            return;
        }
        
        // جلب الحصص المشتراة
        const purchasedLessons = this.getStoredData('purchasedLessons') || [];
        const userPurchased = purchasedLessons.filter(p => p.studentId === this.currentUser.id);
        
        container.innerHTML = ''; // Clear container

        activeLessons.forEach(async lesson => {
            const isPurchased = userPurchased.some(p => p.lessonId === lesson.id);
            
            const coverImageUrl = await this.fileStore.getFileAsURL(lesson.coverImage);
            
            const lessonCardHtml = `
                <div class="lesson-card ${isPurchased ? 'purchased' : ''}">
                    <div class="lesson-cover" style="${coverImageUrl ? `background-image: url('${coverImageUrl}')` : ''}">
                        ${!coverImageUrl ? '<i class="fas fa-play-circle"></i>' : ''}
                    </div>
                    
                    <div class="lesson-info">
                        <h3>${lesson.title}</h3>
                        <p>${lesson.description}</p>
                        <div class="lesson-details">
                            <span class="lesson-price">${lesson.price} جنيه</span>
                            <span class="lesson-grade">${this.getGradeText(lesson.grade)}</span>
                        </div>
                        
                        <div class="lesson-actions">
                            ${isPurchased ? `
                                <button class="view-lesson-btn" onclick="window.app.viewLesson(${lesson.id})">
                                    <i class="fas fa-eye"></i>
                                    عرض الحصة
                                </button>
                            ` : `
                                <button class="purchase-lesson-btn" onclick="window.app.purchaseLesson(${lesson.id})" 
                                        ${this.canAffordLesson(lesson.price) ? '' : 'disabled'}>
                                    <i class="fas fa-shopping-cart"></i>
                                    شراء
                                </button>
                            `}
                        </div>
                    </div>
                </div>
            `;
            container.insertAdjacentHTML('beforeend', lessonCardHtml);
        });
    }

    // تحديث رصيد الطالب
    updateStudentBalance() {
        if (!this.currentUser || this.currentUser.type !== 'student') return;
        
        const students = this.getStoredData('students') || [];
        const student = students.find(s => s.id === this.currentUser.id);
        const balance = student ? (student.balance || 0) : 0;
        
        // تحديث عرض الرصيد في جميع الصفحات
        document.querySelectorAll('#currentBalance, #walletBalance, #currentBalanceSubscriptions, #currentBalanceBooks').forEach(element => {
            if (element) {
                element.textContent = `${balance} جنيه`;
            }
        });
    }

    // التحقق من إمكانية شراء الحصة
    canAffordLesson(price) {
        if (!this.currentUser) return false;
        
        const students = this.getStoredData('students') || [];
        const student = students.find(s => s.id === this.currentUser.id);
        const balance = student ? (student.balance || 0) : 0;
        
        return balance >= price;
    }

    // شراء الحصة
    purchaseLesson(lessonId) {
        if (!this.currentUser) {
            this.showMessage('يجب تسجيل الدخول أولاً', 'error');
            return;
        }
        
        const lessons = this.getStoredData('lessons') || [];
        const lesson = lessons.find(l => l.id === lessonId);
        
        if (!lesson) {
            this.showMessage('الحصة غير موجودة', 'error');
            return;
        }
        
        // التحقق من الرصيد
        const students = this.getStoredData('students') || [];
        const studentIndex = students.findIndex(s => s.id === this.currentUser.id);
        
        if (studentIndex === -1) {
            this.showMessage('بيانات الطالب غير موجودة', 'error');
            return;
        }
        
        const currentBalance = students[studentIndex].balance || 0;
        
        if (currentBalance < lesson.price) {
            this.showMessage('رصيدك غير كافي لشراء هذه الحصة', 'error');
            return;
        }
        
        // تأكيد الشراء
        if (!confirm(`هل تريد شراء حصة "${lesson.title}" بسعر ${lesson.price} جنيه؟`)) {
            return;
        }
        
        // خصم الرصيد
        students[studentIndex].balance = currentBalance - lesson.price;
        students[studentIndex].lastActivity = new Date().toISOString();
        this.saveStoredData('students', students);
        
        // إضافة الحصة للمشتريات
        const purchasedLessons = this.getStoredData('purchasedLessons') || [];
        const purchaseData = {
            id: Date.now(),
            studentId: this.currentUser.id,
            lessonId: lesson.id,
            purchaseDate: new Date().toISOString(),
            price: lesson.price
        };
        purchasedLessons.push(purchaseData);
        this.saveStoredData('purchasedLessons', purchasedLessons);
        
        // إضافة سجل المعاملة
        this.addTransactionRecord({
            studentId: this.currentUser.id,
            studentName: this.currentUser.name,
            amount: lesson.price,
            type: 'lesson',
            description: `شراء حصة: ${lesson.title}`
        }, 'completed');
        
        this.showMessage('تم شراء الحصة بنجاح!', 'success');
        
        // تحديث العرض
        this.updateStudentBalance();
        this.loadPaidLessons();
    }

    // عرض الحصة
    viewLesson(lessonId) {
        const lessons = this.getStoredData('lessons') || [];
        const lesson = lessons.find(l => l.id === lessonId);
        
        if (!lesson) {
            this.showMessage('الحصة غير موجودة', 'error');
            return;
        }
        
        // التحقق من الشراء
        const purchasedLessons = this.getStoredData('purchasedLessons') || [];
        const isPurchased = purchasedLessons.some(p => 
            p.studentId === this.currentUser.id && p.lessonId === lessonId
        );
        
        if (!isPurchased) {
            this.showMessage('يجب شراء الحصة أولاً', 'error');
            return;
        }
        
        // عرض محتوى الحصة
        this.showLessonContent(lesson);
    }

    // عرض محتوى الحصة
    async showLessonContent(lesson) {
        this.currentLessonId = lesson.id;
        
        // الانتقال إلى صفحة محتوى الحصة
        this.showPage('lessonContent');
        
        // تحديث المحتوى
        document.getElementById('lessonTitle').textContent = lesson.title;
        
        const lessonDetails = document.getElementById('lessonDetails');
        lessonDetails.innerHTML = `
            <h3>${lesson.title}</h3>
            <p>${lesson.description}</p>
            <div class="lesson-meta">
                <span><i class="fas fa-graduation-cap"></i> ${this.getGradeText(lesson.grade)}</span>
                <span><i class="fas fa-money-bill"></i> تم الشراء</span>
            </div>
        `;
        
        // عرض المواد التعليمية
        this.showLessonMaterials(lesson);
    }

    // عرض المواد التعليمية
    async showLessonMaterials(lesson) {
        // فيديو الشرح
        const videoSection = document.getElementById('videoSection');
        const lessonVideo = document.getElementById('lessonVideo');
        const lessonVideoUrl = await this.fileStore.getFileAsURL(lesson.videoFile);
        if (lessonVideoUrl && videoSection && lessonVideo) {
            lessonVideo.src = lessonVideoUrl;
            videoSection.style.display = 'block';
        } else if (videoSection) {
            videoSection.style.display = 'none';
        }
        
        // ملف PDF
        const pdfSection = document.getElementById('pdfSection');
        const viewPdfBtn = document.getElementById('viewPdfBtn');
        const pdfUrl = await this.fileStore.getFileAsURL(lesson.pdfFile);
        if (pdfUrl && pdfSection && viewPdfBtn) {
            viewPdfBtn.onclick = () => window.open(pdfUrl, '_blank');
            pdfSection.style.display = 'block';
        } else if (pdfSection) {
            pdfSection.style.display = 'none';
        }
        
        // الواجب
        const homeworkSection = document.getElementById('homeworkSection');
        const viewHomeworkBtn = document.getElementById('viewHomeworkBtn');
        const homeworkUrl = await this.fileStore.getFileAsURL(lesson.homeworkFile);
        if (homeworkUrl && homeworkSection && viewHomeworkBtn) {
            viewHomeworkBtn.onclick = () => window.open(homeworkUrl, '_blank');
            homeworkSection.style.display = 'block';
        } else if (homeworkSection) {
            homeworkSection.style.display = 'none';
        }
        
        // حل الواجب
        const solutionSection = document.getElementById('solutionSection');
        const viewSolutionBtn = document.getElementById('viewSolutionBtn');
        const viewSolutionVideoBtn = document.getElementById('viewSolutionVideoBtn');

        const solutionPdfUrl = await this.fileStore.getFileAsURL(lesson.solutionFile);
        const solutionVideoUrl = await this.fileStore.getFileAsURL(lesson.homeworkSolutionVideo);

        if (solutionPdfUrl || solutionVideoUrl) {
            solutionSection.style.display = 'block';
            if(solutionPdfUrl && viewSolutionBtn) {
                viewSolutionBtn.style.display = 'inline-block';
                viewSolutionBtn.onclick = () => window.open(solutionPdfUrl, '_blank');
            } else {
                viewSolutionBtn.style.display = 'none';
            }

            if(solutionVideoUrl && viewSolutionVideoBtn) {
                viewSolutionVideoBtn.style.display = 'inline-block';
                viewSolutionVideoBtn.onclick = () => this.showVideoModal(solutionVideoUrl, 'فيديو حل الواجب');
            } else {
                viewSolutionVideoBtn.style.display = 'none';
            }
        } else if (solutionSection) {
            solutionSection.style.display = 'none';
        }
        
        // الامتحان
        const startExamBtn = document.getElementById('startExamBtn');
        if (startExamBtn) {
            startExamBtn.onclick = () => this.startExam(lesson);
        }
    }

    showVideoModal(videoSrc, title) {
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.style.display = 'block';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 800px;">
                <span class="close" onclick="this.parentElement.parentElement.remove()">&times;</span>
                <h3>${title}</h3>
                <video src="${videoSrc}" controls style="width: 100%; border-radius: 10px;"></video>
            </div>
        `;
        document.body.appendChild(modal);
    }

    // بدء الامتحان
    startExam(lesson) {
        if (!lesson.examQuestions || lesson.examQuestions.length === 0) {
            this.showMessage('لا توجد أسئلة امتحان لهذه الحصة', 'error');
            return;
        }
        
        // التحقق من وجود محاولة سابقة ناجحة
        const examResults = this.getStoredData('examResults') || [];
        const previousResult = examResults.find(r => 
            r.studentId === this.currentUser.id && 
            r.lessonId === lesson.id && 
            r.passed
        );
        
        if (previousResult) {
            if (!confirm('لقد نجحت في هذا الامتحان من قبل. هل تريد إعادة المحاولة؟')) {
                return;
            }
        }
        
        this.showExamModal(lesson);
    }

    // عرض نافذة الامتحان
    showExamModal(lesson) {
        const modal = document.getElementById('examModal');
        const examTitle = document.getElementById('examTitle');
        const examQuestions = document.getElementById('examQuestions');
        
        if (!modal || !examTitle || !examQuestions) return;
        
        examTitle.textContent = `امتحان: ${lesson.title}`;
        
        // تحضير الأسئلة
        examQuestions.innerHTML = lesson.examQuestions.map((question, index) => `
            <div class="exam-question">
                <h4>السؤال ${index + 1}: ${question.question}</h4>
                <div class="exam-choices">
                    ${question.choices.map((choice, choiceIndex) => `
                        <label class="exam-choice">
                            <input type="radio" name="question_${index}" value="${choiceIndex}">
                            <span>${choice}</span>
                        </label>
                    `).join('')}
                </div>
            </div>
        `).join('');
        
        // بدء العداد
        this.startExamTimer();
        
        // عرض النافذة
        modal.style.display = 'block';
        
        // إعداد إرسال الامتحان
        const submitBtn = document.getElementById('submitExamBtn');
        if (submitBtn) {
            submitBtn.onclick = () => this.submitExam(lesson);
        }
    }

    // بدء عداد الامتحان
    startExamTimer() {
        this.examTimeLeft = 1800; // 30 دقيقة
        const timerDisplay = document.getElementById('examTimer');
        
        this.examTimer = setInterval(() => {
            this.examTimeLeft--;
            
            const minutes = Math.floor(this.examTimeLeft / 60);
            const seconds = this.examTimeLeft % 60;
            
            if (timerDisplay) {
                timerDisplay.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            }
            
            if (this.examTimeLeft <= 0) {
                clearInterval(this.examTimer);
                this.submitExam();
            }
        }, 1000);
    }

    // تسليم الامتحان
    submitExam(lesson = null) {
        if (!lesson) {
            const lessons = this.getStoredData('lessons') || [];
            lesson = lessons.find(l => l.id === this.currentLessonId);
        }
        
        if (!lesson) return;
        
        clearInterval(this.examTimer);
        
        // جمع الإجابات
        const answers = [];
        const questions = lesson.examQuestions;
        
        for (let i = 0; i < questions.length; i++) {
            const selectedOption = document.querySelector(`input[name="question_${i}"]:checked`);
            answers.push(selectedOption ? parseInt(selectedOption.value) : -1);
        }
        
        // حساب النتيجة
        let correctAnswers = 0;
        questions.forEach((question, index) => {
            if (answers[index] === parseInt(question.correctAnswer)) {
                correctAnswers++;
            }
        });
        
        const score = Math.round((correctAnswers / questions.length) * 100);
        const passed = score >= 50; // النجاح بنسبة 50% أو أكثر
        
        // حفظ النتيجة
        const examResults = this.getStoredData('examResults') || [];
        const result = {
            id: Date.now(),
            studentId: this.currentUser.id,
            studentName: this.currentUser.name,
            lessonId: lesson.id,
            lessonTitle: lesson.title,
            score: score,
            correctAnswers: correctAnswers,
            totalQuestions: questions.length,
            answers: answers,
            passed: passed,
            timestamp: new Date().toISOString()
        };
        
        examResults.push(result);
        this.saveStoredData('examResults', examResults);
        
        // إغلاق النافذة
        this.closeExamModal();
        
        // عرض النتيجة
        const resultMessage = passed ? 
            `تهانينا! لقد نجحت في الامتحان بدرجة ${score}%` :
            `للأسف لم تنجح في الامتحان. درجتك: ${score}%. يمكنك المحاولة مرة أخرى.`;
        
        this.showMessage(resultMessage, passed ? 'success' : 'error');
        
        // إضافة النقاط للطالب
        if (passed) {
            this.addPointsToStudent(this.currentUser.id, this.calculateExamPoints(score), `نجاح في امتحان: ${lesson.title}`);
        }
        
        // إشعار المدرس بنتيجة الامتحان
        this.notifyTeacherOfExamResult(score, passed);
    }

    // حساب النقاط بناء على الدرجة
    calculateExamPoints(score) {
        if (score >= 90) return 20;
        if (score >= 80) return 15;
        if (score >= 70) return 10;
        if (score >= 50) return 5;
        return 0;
    }

    // إضافة نقاط للطالب
    addPointsToStudent(studentId, points, reason) {
        const students = this.getStoredData('students') || [];
        const studentIndex = students.findIndex(s => s.id === studentId);
        
        if (studentIndex !== -1) {
            students[studentIndex].points = (students[studentIndex].points || 0) + points;
            this.saveStoredData('students', students);
            
            // حفظ سجل المكافآت
            const rewardHistory = this.getStoredData('rewardHistory') || [];
            rewardHistory.push({
                id: Date.now(),
                studentId: studentId,
                points: points,
                reason: reason,
                timestamp: new Date().toISOString()
            });
            this.saveStoredData('rewardHistory', rewardHistory);
        }
    }

    // إشعار المدرس بنتيجة الامتحان
    notifyTeacherOfExamResult(score, passed) {
        const teacherNotifications = this.getStoredData('teacherNotifications') || [];
        teacherNotifications.push({
            id: Date.now(),
            type: 'exam_result',
            studentName: this.currentUser.name,
            score: score,
            passed: passed,
            lessonId: this.currentLessonId,
            timestamp: new Date().toISOString(),
            isRead: false
        });
        this.saveStoredData('teacherNotifications', teacherNotifications);
        
        // إضافة نقاط للطالب بناء على الدرجة
        let points = 0;
        let reason = '';
        
        if (score >= 90) {
            points = 20;
            reason = 'درجة ممتازة (90% فأكثر)';
        } else if (score >= 80) {
            points = 15;
            reason = 'درجة جيدة جداً (80-89%)';
        } else if (score >= 70) {
            points = 10;
            reason = 'درجة جيدة (70-79%)';
        } else if (score >= 50) {
            points = 5;
            reason = 'درجة مقبولة (50-69%)';
        }
        
        if (points > 0) {
            this.addPointsToStudent(this.currentUser.id, points, reason);
        }
    }

    // إغلاق نافذة الامتحان
    closeExamModal() {
        const modal = document.getElementById('examModal');
        if (modal) {
            modal.style.display = 'none';
        }
        
        if (this.examTimer) {
            clearInterval(this.examTimer);
        }
    }

    // إرسال سؤال للمدرس
    async handleQuestionSubmit() {
        const subject = document.getElementById('questionSubject').value.trim();
        const text = document.getElementById('questionText').value.trim();
        const imageInput = document.getElementById('questionImage');
        
        if (!subject || !text) {
            this.showMessage('يرجى إدخال موضوع السؤال ونصه', 'error');
            return;
        }
        
        let imageKey = null;
        if (imageInput.files[0]) {
            imageKey = await this.handleFileUpload('questionImage', `question_${this.currentUser.id}_${Date.now()}`);
        }

        // إنشاء الرسالة
        const message = {
            id: Date.now(),
            studentId: this.currentUser.id,
            studentName: this.currentUser.name,
            lessonId: this.currentLessonId,
            subject: subject,
            text: text,
            imageKey: imageKey, // Store key instead of URL
            timestamp: new Date().toISOString(),
            isRead: false,
            replies: []
        };
        
        // حفظ الرسالة
        const studentMessages = this.getStoredData('studentMessages') || [];
        studentMessages.push(message);
        this.saveStoredData('studentMessages', studentMessages);
        
        this.showMessage('تم إرسال السؤال بنجاح', 'success');
        
        // مسح النموذج
        document.getElementById('questionForm').reset();
        document.getElementById('imagePreview').style.display = 'none';
    }

    // إرسال رسالة دعم من الطالب
    async handleStudentSupportMessage() {
        if (!this.currentUser || this.currentUser.type !== 'student') return;

        const messageText = document.getElementById('studentSupportMessage').value.trim();
        const imageInput = document.getElementById('studentSupportImage');
        
        if (!messageText && !imageInput.files[0]) {
            this.showMessage('يرجى كتابة رسالة أو إرفاق صورة', 'error');
            return;
        }

        let imageKey = null;
        if (imageInput.files[0]) {
            imageKey = await this.handleFileUpload('studentSupportImage', `support_${this.currentUser.id}_${Date.now()}`);
        }

        const message = {
            id: Date.now(),
            from: 'student',
            studentId: this.currentUser.id,
            studentName: this.currentUser.name,
            text: messageText,
            imageKey: imageKey,
            timestamp: new Date().toISOString(),
            isRead: false
        };

        const supportMessages = this.getStoredData('supportMessages') || [];
        supportMessages.push(message);
        this.saveStoredData('supportMessages', supportMessages);

        this.showMessage('تم إرسال رسالتك بنجاح', 'success');

        // مسح النموذج
        document.getElementById('studentSupportForm').reset();
        this.clearStudentSupportImage();
        const textarea = document.getElementById('studentSupportMessage');
        if (textarea) textarea.style.height = 'auto';

        // تحديث واجهة الدردشة
        this.loadStudentSupportChat();

        // تحديث قائمة الدردشة للدعم الفني (إذا كان متصلاً)
        this.loadStudentChatList(); 
    }
    
    // مسح معاينة صورة الدعم
    clearStudentSupportImage() {
        const preview = document.getElementById('studentSupportImagePreview');
        const img = document.getElementById('studentSupportPreviewImg');
        const input = document.getElementById('studentSupportImage');
        if (preview && img && input) {
            preview.style.display = 'none';
            img.src = '';
            input.value = '';
        }
    }

    // تحميل دردشة الدعم الفني للطالب
    async loadStudentSupportChat() {
        if (!this.currentUser || this.currentUser.type !== 'student') return;

        const container = document.getElementById('studentChatMessages');
        if (!container) return;

        const allMessages = this.getStoredData('supportMessages') || [];
        const studentMessages = allMessages.filter(m => m.studentId === this.currentUser.id);

        if (studentMessages.length === 0) {
            container.innerHTML = `
                <div class="no-chat-selected">
                    <p>مرحباً بك في الدعم الفني. كيف يمكننا مساعدتك؟</p>
                </div>`;
            return;
        }

        container.innerHTML = '';
        for (const message of studentMessages) {
            let imageHtml = '';
            if (message.imageKey) {
                const imageUrl = await this.fileStore.getFileAsURL(message.imageKey);
                if (imageUrl) {
                    imageHtml = `<img src="${imageUrl}" alt="صورة مرفقة" class="chat-image" onclick="window.app.viewReceipt('${message.imageKey}')">`;
                }
            }

            const messageClass = message.from === 'student' ? 'from-student' : 'from-support';
            const senderName = message.from === 'student' ? 'أنت' : message.supportName || 'الدعم الفني';
            
            const messageHtml = `
                <div class="message ${messageClass}">
                    <div class="message-sender">${senderName}</div>
                    ${message.text ? `<p>${message.text}</p>` : ''}
                    ${imageHtml}
                    <div class="message-time">${new Date(message.timestamp).toLocaleTimeString('ar-EG')}</div>
                </div>
            `;
            
            container.insertAdjacentHTML('beforeend', messageHtml);
        }
        
        container.scrollTop = container.scrollHeight;
    }

    // تحميل صفحة المحفظة
    loadWalletPage() {
        if (!this.currentUser || this.currentUser.type !== 'student') return;
        
        this.updateStudentBalance();
        this.loadPaymentMethods();
        this.loadTransferHistory();
        
        // إعداد وقت التحويل الافتراضي (الوقت الحالي)
        const transferTimeInput = document.getElementById('transferTime');
        if (transferTimeInput) {
            const now = new Date();
            now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
            transferTimeInput.value = now.toISOString().slice(0, 16);
        }
    }

    // تحميل وسائل الدفع
    loadPaymentMethods() {
        const paymentMethods = this.getStoredData('paymentMethods') || [];
        const select = document.getElementById('paymentMethodSelect');
        
        if (!select) return;
        
        select.innerHTML = '<option value="">اختر وسيلة الدفع</option>';
        
        paymentMethods.forEach(method => {
            const option = document.createElement('option');
            option.value = method.id;
            option.textContent = `${method.name} - ${method.number}`;
            select.appendChild(option);
        });
    }

    // إضافة رصيد
    async handleAddFunds() {
        const amount = parseFloat(document.getElementById('transferAmount').value);
        const paymentMethodId = document.getElementById('paymentMethodSelect').value;
        const transactionNumber = document.getElementById('transactionNumber').value.trim();
        const transferTime = document.getElementById('transferTime').value;
        const message = document.getElementById('transferMessage').value.trim();
        const receiptInput = document.getElementById('transferReceipt');
        
        if (!amount || amount <= 0) {
            this.showMessage('يرجى إدخال مبلغ صحيح', 'error');
            return;
        }
        
        if (!paymentMethodId) {
            this.showMessage('يرجى اختيار وسيلة الدفع', 'error');
            return;
        }
        
        if (!transactionNumber) {
            this.showMessage('يرجى إدخال رقم العملية', 'error');
            return;
        }
        
        if (!transferTime) {
            this.showMessage('يرجى إدخال وقت التحويل', 'error');
            return;
        }
        
        if (!receiptInput.files[0]) {
            this.showMessage('يرجى رفع صورة إيصال التحويل', 'error');
            return;
        }

        const receiptKey = await this.handleFileUpload('transferReceipt', `receipt_${this.currentUser.id}_${Date.now()}`);
        if (!receiptKey) {
            this.showMessage('فشل في حفظ صورة الإيصال', 'error');
            return;
        }
        
        // إنشاء طلب التحويل
        const transferRequest = {
            id: Date.now(),
            studentId: this.currentUser.id,
            studentName: this.currentUser.name,
            amount: amount,
            paymentMethodId: paymentMethodId,
            transactionNumber: transactionNumber,
            transferTime: transferTime,
            message: message,
            receiptImageKey: receiptKey,
            status: 'pending',
            timestamp: new Date().toISOString()
        };
        
        // حفظ الطلب
        const transferRequests = this.getStoredData('transferRequests') || [];
        transferRequests.push(transferRequest);
        this.saveStoredData('transferRequests', transferRequests);
        
        this.showMessage('تم إرسال طلب التحويل بنجاح. سيتم مراجعته من قبل الدعم الفني', 'success');
        
        // مسح النموذج
        document.getElementById('addFundsForm').reset();
        document.getElementById('receiptPreview').style.display = 'none';
        
        // تحديث سجل التحويلات
        this.loadTransferHistory();
    }

    // تحميل سجل التحويلات
    loadTransferHistory() {
        if (!this.currentUser) return;
        
        const transferRequests = this.getStoredData('transferRequests') || [];
        const userRequests = transferRequests.filter(r => r.studentId === this.currentUser.id);
        const container = document.getElementById('transferHistoryList');
        
        if (!container) return;
        
        if (userRequests.length === 0) {
            container.innerHTML = '<p>لا توجد عمليات سابقة</p>';
            return;
        }
        
        container.innerHTML = userRequests.map(request => {
            const statusText = {
                'pending': 'في الانتظار',
                'confirmed': 'مؤكد',
                'rejected': 'مرفوض'
            };
            
            const statusClass = {
                'pending': 'warning',
                'confirmed': 'success',
                'rejected': 'error'
            };
            
            return `
                <div class="transfer-item">
                    <div class="transfer-info">
                        <strong>${request.amount} جنيه</strong>
                        <small>رقم العملية: ${request.transactionNumber}</small>
                        <small>التاريخ: ${new Date(request.timestamp).toLocaleDateString('ar-EG')}</small>
                    </div>
                    <div class="transfer-status ${statusClass[request.status]}">
                        ${statusText[request.status]}
                    </div>
                </div>
            `;
        }).join('');
    }

    // تحميل صفحة الاشتراكات
    loadSubscriptionsPage() {
        if (!this.currentPage || this.currentPage !== 'subscriptions') return;
        
        this.updateStudentBalance();
        this.loadAvailableSubscriptions();
    }
    
    // تحميل الاشتراكات المتاحة
    async loadAvailableSubscriptions() {
        const subscriptions = this.getStoredData('subscriptions') || [];
        const activeSubscriptions = subscriptions.filter(sub => sub.isActive);
        const container = document.getElementById('subscriptionsGrid');
        
        if (!container) return;
        
        if (activeSubscriptions.length === 0) {
            container.innerHTML = `
                <div class="no-subscriptions">
                    <i class="fas fa-box-open"></i>
                    <h3>لا توجد اشتراكات متاحة</h3>
                    <p>سيتم إضافة اشتراكات جديدة قريباً</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = ''; // Clear container

        activeSubscriptions.forEach(async subscription => {
            const isPurchased = this.getStoredData('purchasedSubscriptions') || [].some(p => p.subscriptionId === subscription.id && p.studentId === this.currentUser.id);
            const imageUrl = await this.fileStore.getFileAsURL(subscription.image);
            
            const cardHtml = `
                <div class="subscription-card ${isPurchased ? 'purchased' : ''}">
                    <div class="subscription-cover" style="${imageUrl ? `background-image: url('${imageUrl}')` : ''}">
                        ${!imageUrl ? '<i class="fas fa-graduation-cap"></i>' : ''}
                    </div>
                    
                    <div class="subscription-info">
                        <h3>${subscription.name}</h3>
                        <p>${subscription.description}</p>
                        
                        <div class="subscription-details">
                            <div class="detail-item">
                                <i class="fas fa-money-bill"></i>
                                <span>${subscription.price} جنيه</span>
                            </div>
                            <div class="detail-item">
                                <i class="fas fa-calendar"></i>
                                <span>${subscription.duration} يوم</span>
                            </div>
                            <div class="detail-item">
                                <i class="fas fa-book"></i>
                                <span>${this.getSubscriptionLessonsCount(subscription.id)} حصة</span>
                            </div>
                        </div>
                        
                        <div class="subscription-actions">
                            ${isPurchased ? `
                                <button class="view-subscription-btn" onclick="window.app.viewSubscription(${subscription.id})">
                                    <i class="fas fa-eye"></i>
                                    عرض المحتوى
                                </button>
                            ` : `
                                <button class="purchase-subscription-btn" onclick="window.app.purchaseSubscription(${subscription.id})" 
                                        ${this.canAffordSubscription(subscription.price) ? '' : 'disabled'}>
                                    <i class="fas fa-shopping-cart"></i>
                                    اشتراك
                                </button>
                            `}
                        </div>
                    </div>
                </div>
            `;
            container.insertAdjacentHTML('beforeend', cardHtml);
        });
    }
    
    // التحقق من إمكانية شراء الاشتراك
    canAffordSubscription(price) {
        if (!this.currentUser) return false;
        
        const students = this.getStoredData('students') || [];
        const student = students.find(s => s.id === this.currentUser.id);
        const balance = student ? (student.balance || 0) : 0;
        
        return balance >= price;
    }
    
    // شراء الاشتراك
    purchaseSubscription(subscriptionId) {
        if (!this.currentUser) {
            this.showMessage('يجب تسجيل الدخول أولاً', 'error');
            return;
        }
        
        const subscriptions = this.getStoredData('subscriptions') || [];
        const subscription = subscriptions.find(s => s.id === subscriptionId);
        
        if (!subscription) {
            this.showMessage('الاشتراك غير موجود', 'error');
            return;
        }
        
        // التحقق من الرصيد
        const students = this.getStoredData('students') || [];
        const studentIndex = students.findIndex(s => s.id === this.currentUser.id);
        
        if (studentIndex === -1) {
            this.showMessage('بيانات الطالب غير موجودة', 'error');
            return;
        }
        
        const currentBalance = students[studentIndex].balance || 0;
        
        if (currentBalance < subscription.price) {
            this.showMessage('رصيدك غير كافي لشراء هذا الاشتراك', 'error');
            return;
        }
        
        // تأكيد الشراء
        if (!confirm(`هل تريد الاشتراك في "${subscription.name}" بسعر ${subscription.price} جنيه؟`)) {
            return;
        }
        
        // خصم الرصيد
        students[studentIndex].balance = currentBalance - subscription.price;
        students[studentIndex].lastActivity = new Date().toISOString();
        this.saveStoredData('students', students);
        
        // إضافة الاشتراك للمشتريات
        const purchasedSubscriptions = this.getStoredData('purchasedSubscriptions') || [];
        const purchaseData = {
            id: Date.now(),
            studentId: this.currentUser.id,
            subscriptionId: subscription.id,
            purchaseDate: new Date().toISOString(),
            price: subscription.price,
            expiryDate: new Date(Date.now() + subscription.duration * 24 * 60 * 60 * 1000).toISOString()
        };
        purchasedSubscriptions.push(purchaseData);
        this.saveStoredData('purchasedSubscriptions', purchasedSubscriptions);
        
        // إضافة سجل المعاملة
        this.addTransactionRecord({
            studentId: this.currentUser.id,
            studentName: this.currentUser.name,
            amount: subscription.price,
            type: 'subscription',
            description: `اشتراك في: ${subscription.name}`
        }, 'completed');
        
        this.showMessage('تم شراء الاشتراك بنجاح!', 'success');
        
        // تحديث العرض
        this.updateStudentBalance();
        this.loadAvailableSubscriptions();
    }
    
    // عرض محتوى الاشتراك
    viewSubscription(subscriptionId) {
        const subscriptions = this.getStoredData('subscriptions') || [];
        const subscription = subscriptions.find(s => s.id === subscriptionId);
        
        if (!subscription) {
            this.showMessage('الاشتراك غير موجود', 'error');
            return;
        }
        
        // التحقق من الشراء
        const purchasedSubscriptions = this.getStoredData('purchasedSubscriptions') || [];
        const purchase = purchasedSubscriptions.find(p => 
            p.studentId === this.currentUser.id && p.subscriptionId === subscriptionId
        );
        
        if (!purchase) {
            this.showMessage('يجب شراء الاشتراك أولاً', 'error');
            return;
        }
        
        // التحقق من انتهاء الصلاحية
        if (new Date() > new Date(purchase.expiryDate)) {
            this.showMessage('انتهت صلاحية الاشتراك', 'error');
            return;
        }
        
        // عرض محتوى الاشتراك
        this.showSubscriptionContent(subscription, purchase);
    }
    
    // عرض محتوى الاشتراك
    async showSubscriptionContent(subscription, purchase) {
        // الانتقال إلى صفحة محتوى الاشتراك
        this.showPage('subscriptionContent');
        
        // تحديث المحتوى
        document.getElementById('subscriptionTitle').textContent = subscription.name;
        
        const subscriptionDetails = document.getElementById('subscriptionDetails');
        subscriptionDetails.innerHTML = `
            <h3>${subscription.name}</h3>
            <p>${subscription.description}</p>
            <div class="subscription-meta">
                <span class="subscription-date">تاريخ الشراء: ${new Date(purchase.purchaseDate).toLocaleDateString('ar-EG')}</span>
                <span class="subscription-expiry">ينتهي في: ${new Date(purchase.expiryDate).toLocaleDateString('ar-EG')}</span>
                <span class="subscription-price">${subscription.price} جنيه</span>
            </div>
        `;
        
        // تحميل الحصص المرتبطة بالاشتراك
        this.loadSubscriptionLessons(subscription.id);
    }
    
    // تحميل حصص الاشتراك
    loadSubscriptionLessons(subscriptionId) {
        const lessons = this.getStoredData('lessons') || [];
        const subscriptionLessons = lessons.filter(lesson => 
            lesson.subscriptionId === subscriptionId && lesson.isActive
        );
        
        const container = document.getElementById('subscriptionLessonsGrid');
        
        if (subscriptionLessons.length === 0) {
            container.innerHTML = '<p>لا توجد حصص مرتبطة بهذا الاشتراك</p>';
            return;
        }
        
        container.innerHTML = subscriptionLessons.map(lesson => `
            <div class="subscription-lesson-card" onclick="window.app.viewLesson(${lesson.id})">
                <div class="lesson-icon">
                    <i class="fas fa-play-circle"></i>
                </div>
                <div class="lesson-info">
                    <h4>${lesson.title}</h4>
                    <p>${lesson.description}</p>
                    <small>${this.getGradeText(lesson.grade)}</small>
                </div>
            </div>
        `).join('');
    }
    
    // الحصول على عدد حصص الاشتراك
    getSubscriptionLessonsCount(subscriptionId) {
        const lessons = this.getStoredData('lessons') || [];
        return lessons.filter(lesson => 
            lesson.subscriptionId === subscriptionId && lesson.isActive
        ).length;
    }

    // تحميل سجل النشاط
    loadActivityLog() {
        if (!this.currentUser || this.currentUser.type !== 'student') return;
        
        const examResults = this.getStoredData('examResults') || [];
        const userResults = examResults.filter(r => r.studentId === this.currentUser.id);
        
        // حساب الإحصائيات
        const totalExams = userResults.length;
        const passedExams = userResults.filter(r => r.passed).length;
        const averageScore = totalExams > 0 ? 
            Math.round(userResults.reduce((sum, r) => sum + r.score, 0) / totalExams) : 0;
        const successRate = totalExams > 0 ? Math.round((passedExams / totalExams) * 100) : 0;
        
        // تحديث الإحصائيات
        this.updateElement('totalExams', totalExams);
        this.updateElement('passedExams', passedExams);
        this.updateElement('averageScore', `${averageScore}%`);
        this.updateElement('successRate', `${successRate}%`);
        
        // عدد الحصص والاشتراكات
        const purchasedLessons = this.getStoredData('purchasedLessons') || [];
        const purchasedSubscriptions = this.getStoredData('purchasedSubscriptions') || [];
        const userLessons = purchasedLessons.filter(p => p.studentId === this.currentUser.id);
        const userSubscriptions = purchasedSubscriptions.filter(p => p.studentId === this.currentUser.id);
        
        this.updateElement('totalLessons', userLessons.length);
        this.updateElement('totalSubscriptions', userSubscriptions.length);
        
        // تحميل درجات الطالب
        this.loadStudentGrades(userResults);
    }

    // تحديث عنصر DOM
    updateElement(id, value) {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = value;
        }
    }

    // تحميل درجات الطالب
    loadStudentGrades(examResults) {
        const container = document.getElementById('studentGradesList');
        if (!container) return;
        
        if (examResults.length === 0) {
            container.innerHTML = '<p>لم تخض أي امتحانات بعد</p>';
            return;
        }
        
        container.innerHTML = examResults.map(result => `
            <div class="grade-item">
                <div class="grade-info">
                    <strong>${result.lessonTitle}</strong>
                    <small>التاريخ: ${new Date(result.timestamp).toLocaleDateString('ar-EG')}</small>
                    <small>الأسئلة الصحيحة: ${result.correctAnswers} من ${result.totalQuestions}</small>
                </div>
                <div class="grade-score ${result.passed ? 'passed' : 'failed'}">
                    ${result.score}%
                </div>
            </div>
        `).join('');
    }

    // تحميل صفحة الكتب
    loadBooksPage() {
        if (!this.currentUser || this.currentUser.type !== 'student') return;
        
        this.updateStudentBalance();
        this.loadAvailableBooks();
    }

    // تحميل الكتب المتاحة
    async loadAvailableBooks() {
        const books = this.getStoredData('books') || [];
        const availableBooks = books.filter(book => book.availability !== 'unavailable');
        const container = document.getElementById('booksGrid');
        
        if (!container) return;
        
        if (availableBooks.length === 0) {
            container.innerHTML = `
                <div class="no-books">
                    <i class="fas fa-book-open"></i>
                    <h3>لا توجد كتب متاحة</h3>
                    <p>سيتم إضافة كتب جديدة قريباً</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = ''; // Clear container

        availableBooks.forEach(async book => {
            const availabilityText = {
                'available': 'متوفر',
                'limited': 'كمية محدودة',
                'unavailable': 'غير متوفر'
            };
            
            const availabilityClass = {
                'available': 'availability-available',
                'limited': 'availability-limited',
                'unavailable': 'availability-unavailable'
            };

            const imageUrl = await this.fileStore.getFileAsURL(book.imageKey);
            
            const cardHtml = `
                <div class="book-card">
                    <div class="book-cover" style="${imageUrl ? `background-image: url('${imageUrl}')` : ''}">
                        ${!imageUrl ? '<i class="fas fa-book"></i>' : ''}
                    </div>
                    
                    <div class="book-info">
                        <h3>${book.name}</h3>
                        <p>${book.description}</p>
                        
                        <div class="book-details">
                            <div class="detail-item">
                                <i class="fas fa-money-bill"></i>
                                <span>${book.price} جنيه</span>
                            </div>
                            <div class="detail-item">
                                <i class="fas fa-graduation-cap"></i>
                                <span>${this.getGradeText(book.grade)}</span>
                            </div>
                            <div class="detail-item">
                                <i class="fas fa-check-circle"></i>
                                <span class="${availabilityClass[book.availability]}">${availabilityText[book.availability]}</span>
                            </div>
                        </div>
                        
                        <div class="book-actions">
                            <button class="order-book-btn" onclick="window.app.orderBook(${book.id})" 
                                    ${book.availability === 'unavailable' || !this.canAffordBook(book.price) ? 'disabled' : ''}>
                                <i class="fas fa-shopping-cart"></i>
                                طلب الكتاب
                            </button>
                        </div>
                    </div>
                </div>
            `;
            container.insertAdjacentHTML('beforeend', cardHtml);
        });
    }

    // التحقق من إمكانية شراء الكتاب
    canAffordBook(price) {
        if (!this.currentUser) return false;
        
        const students = this.getStoredData('students') || [];
        const student = students.find(s => s.id === this.currentUser.id);
        const balance = student ? (student.balance || 0) : 0;
        
        return balance >= price;
    }

    // طلب كتاب
    orderBook(bookId) {
        const books = this.getStoredData('books') || [];
        const book = books.find(b => b.id === bookId);
        
        if (!book) {
            this.showMessage('الكتاب غير موجود', 'error');
            return;
        }
        
        if (book.availability === 'unavailable') {
            this.showMessage('الكتاب غير متوفر حالياً', 'error');
            return;
        }
        
        // عرض نموذج طلب الكتاب
        this.showBookOrderForm(book);
    }

    // عرض نموذج طلب الكتاب
    showBookOrderForm(book) {
        const contentContainer = document.getElementById('bookOrderModal');
        if (!contentContainer) return;

        contentContainer.innerHTML = `
            <div class="modal-content">
                <span class="close" onclick="this.parentElement.parentElement.remove()">&times;</span>
                <h3>طلب كتاب: ${book.name}</h3>
                
                <div class="book-order-summary">
                    <p><strong>اسم الكتاب:</strong> ${book.name}</p>
                    <p><strong>السعر:</strong> ${book.price} جنيه</p>
                    <p><strong>الحالة:</strong> ${book.availability === 'available' ? 'متوفر' : 'كمية محدودة'}</p>
                </div>
                
                <form id="bookOrderForm">
                    <div class="form-group">
                        <label>الاسم الكامل</label>
                        <input type="text" id="orderFullName" value="${this.currentUser.name}" required>
                    </div>
                    
                    <div class="form-group">
                        <label>رقم الهاتف</label>
                        <input type="tel" id="orderPhone" value="${this.currentUser.parentPhone || ''}" required>
                    </div>
                    
                    <div class="form-group">
                        <label>العنوان التفصيلي</label>
                        <textarea id="orderAddress" rows="3" placeholder="اكتب عنوانك التفصيلي..." required></textarea>
                    </div>
                    
                    <div class="form-group">
                        <label>المكتبة القريبة المفضلة (اختياري)</label>
                        <input type="text" id="preferredBookstore" placeholder="اسم المكتبة القريبة منك">
                    </div>
                    
                    <div class="order-total">
                        <strong>المجموع: ${book.price} جنيه</strong>
                    </div>
                    
                    ${!this.canAffordBook(book.price) ? 
                        '<p class="error-text">رصيدك غير كافي لطلب هذا الكتاب</p>' : 
                        '<button type="submit" class="submit-btn"><i class="fas fa-shopping-cart"></i> تأكيد الطلب</button>'
                    }
                </form>
            </div>
        `;
        
        // إعداد النموذج
        const form = document.getElementById('bookOrderForm');
        if (form) {
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleBookOrder(book);
            });
        }
    }

    // معالجة طلب الكتاب
    async handleBookOrder(book) {
        const fullName = document.getElementById('orderFullName').value.trim();
        const phone = document.getElementById('orderPhone').value.trim();
        const address = document.getElementById('orderAddress').value.trim();
        const preferredBookstore = document.getElementById('preferredBookstore').value.trim();
        
        if (!fullName || !phone || !address) {
            this.showMessage('يرجى إدخال جميع البيانات المطلوبة', 'error');
            return;
        }
        
        // التحقق من الرصيد
        const students = this.getStoredData('students') || [];
        const studentIndex = students.findIndex(s => s.id === this.currentUser.id);
        
        if (studentIndex === -1) {
            this.showMessage('بيانات الطالب غير موجودة', 'error');
            return;
        }
        
        const currentBalance = students[studentIndex].balance || 0;
        
        if (currentBalance < book.price) {
            this.showMessage('رصيدك غير كافي لطلب هذا الكتاب', 'error');
            return;
        }
        
        // خصم الرصيد
        students[studentIndex].balance = currentBalance - book.price;
        students[studentIndex].lastActivity = new Date().toISOString();
        this.saveStoredData('students', students);
        
        // إنشاء طلب الكتاب
        const bookOrder = {
            id: Date.now(),
            studentId: this.currentUser.id,
            studentName: this.currentUser.name,
            bookId: book.id,
            bookName: book.name,
            price: book.price,
            fullName: fullName,
            phone: phone,
            address: address,
            preferredBookstore: preferredBookstore,
            status: 'pending',
            timestamp: new Date().toISOString()
        };
        
        // حفظ الطلب
        const bookOrders = this.getStoredData('bookOrders') || [];
        bookOrders.push(bookOrder);
        this.saveStoredData('bookOrders', bookOrders);
        
        // إضافة سجل المعاملة
        this.addTransactionRecord({
            studentId: this.currentUser.id,
            studentName: this.currentUser.name,
            amount: book.price,
            type: 'book',
            description: `طلب كتاب: ${book.name}`
        }, 'completed');
        
        this.showMessage('تم طلب الكتاب بنجاح. سيتم التواصل معك قريباً', 'success');
        
        // إغلاق النموذج وتحديث العرض
        this.closeBookOrderModal();
        this.updateStudentBalance();
    }

    // إغلاق نموذج طلب الكتاب
    closeBookOrderModal() {
        const modal = document.querySelector('#bookOrderModal'); // Select by id
        if (modal) {
            const parent = modal.parentElement;
            if(parent) parent.removeChild(modal);
        }
    }

    // تحميل صفحة الإشعارات
    loadNotificationsPage() {
        if (!this.currentUser || this.currentUser.type !== 'student') return;
        
        const personalNotifications = this.getStoredData('studentNotifications') || [];
        const generalMessages = this.getStoredData('generalMessages') || [];

        const userPersonalNotifications = personalNotifications.filter(n => n.studentId === this.currentUser.id);

        const now = new Date();
        const userGeneralMessages = generalMessages
            .filter(msg => {
                const isTargeted = msg.target === 'all' || msg.target === this.currentUser.grade;
                const expiryDate = new Date(new Date(msg.createdAt).getTime() + msg.duration * 24 * 60 * 60 * 1000);
                return isTargeted && now < expiryDate;
            })
            .map(msg => ({
                id: `gm_${msg.id}`,
                type: 'general',
                title: msg.title,
                message: msg.content,
                timestamp: msg.createdAt,
                isRead: this.isGeneralMessageRead(msg.id),
                canReply: false
            }));

        const allUserNotifications = [...userPersonalNotifications, ...userGeneralMessages];
        
        const container = document.getElementById('notificationsList');
        if (!container) return;
        
        if (allUserNotifications.length === 0) {
            container.innerHTML = `
                <div class="no-notifications">
                    <i class="fas fa-bell-slash"></i>
                    <h3>لا توجد إشعارات</h3>
                    <p>سيتم إشعارك بأي تحديثات مهمة</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = allUserNotifications
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)) // Sort by most recent
        .map(notification => {
            const iconClass = {
                'support': 'fas fa-headset',
                'teacher': 'fas fa-chalkboard-teacher',
                'system': 'fas fa-cog',
                'payment': 'fas fa-money-bill',
                'exam': 'fas fa-clipboard-check',
                'general': 'fas fa-bullhorn'
            };
            
            const clickAction = String(notification.id).startsWith('gm_') ? `window.app.markGeneralMessageAsRead(${notification.id.split('_')[1]})` : `window.app.markNotificationAsRead(${notification.id})`;

            return `
                <div class="notification-item ${notification.isRead ? '' : 'unread'}" onclick="${clickAction}">
                    <div class="notification-icon ${notification.type}">
                        <i class="${iconClass[notification.type] || 'fas fa-bell'}"></i>
                    </div>
                    
                    <div class="notification-content">
                        <strong>${notification.title}</strong>
                        <p>${notification.message}</p>
                        <small>${new Date(notification.timestamp).toLocaleDateString('ar-EG')} ${new Date(notification.timestamp).toLocaleTimeString('ar-EG')}</small>
                        ${notification.canReply ? '<span class="can-reply">يمكن الرد</span>' : ''}
                    </div>
                    
                    ${!notification.isRead ? '<div class="unread-indicator"></div>' : ''}
                </div>
            `;
        }).join('');
        
        // تحديث عداد الإشعارات
        this.updateNotificationCount();
    }
    
    // التحقق مما إذا كانت الرسالة العامة قد قرئت
    isGeneralMessageRead(messageId) {
        if (!this.currentUser) return true;
        const readMessages = this.getStoredData(`readGeneralMessages_${this.currentUser.id}`) || [];
        return readMessages.includes(messageId);
    }
    
    // وضع علامة على الرسالة العامة كمقروءة
    markGeneralMessageAsRead(messageId) {
        if (!this.currentPage || this.currentPage !== 'notifications') return;
        if (!this.currentUser) return;
        let readMessages = this.getStoredData(`readGeneralMessages_${this.currentUser.id}`) || [];
        if (!readMessages.includes(messageId)) {
            readMessages.push(messageId);
            this.saveStoredData(`readGeneralMessages_${this.currentUser.id}`, readMessages);
            this.loadNotificationsPage(); // Refresh view
            this.updateNotificationCount();
        }
    }


    // تحديث عداد الإشعارات
    updateNotificationCount() {
        if (!this.currentUser || this.currentUser.type !== 'student') return;
        
        const personalNotifications = this.getStoredData('studentNotifications') || [];
        const unreadPersonal = personalNotifications.filter(n => !n.isRead && n.studentId === this.currentUser.id);

        const generalMessages = this.getStoredData('generalMessages') || [];
        const now = new Date();
        const unreadGeneral = generalMessages.filter(msg => {
            const isTargeted = msg.target === 'all' || msg.target === this.currentPage;
            const expiryDate = new Date(new Date(msg.createdAt).getTime() + msg.duration * 24 * 60 * 60 * 1000).toLocaleDateString('ar-EG');
            return isTargeted && now < expiryDate && !this.isGeneralMessageRead(msg.id);
        });

        const totalUnread = unreadPersonal.length + unreadGeneral.length;
        
        const countElement = document.getElementById('notificationCount');
        if (countElement) {
            countElement.textContent = totalUnread;
            countElement.style.display = totalUnread > 0 ? 'flex' : 'none';
        }
    }

    // تحديد الإشعار كمقروء
    markNotificationAsRead(notificationId) {
        const notifications = this.getStoredData('studentNotifications') || [];
        const notificationIndex = notifications.findIndex(n => n.id === notificationId);
        
        if (notificationIndex !== -1) {
            notifications[notificationIndex].isRead = true;
            this.saveStoredData('studentNotifications', notifications);
            this.updateNotificationCount();
            this.loadNotificationsPage();
        }
    }

    // استبدال مكافأة
    redeemReward(rewardId, cost) {
        if (!this.currentPage || this.currentPage !== 'rewards') return;
        if (!this.currentUser) return;
        
        const students = this.getStoredData('students') || [];
        const studentIndex = students.findIndex(s => s.id === this.currentUser.id);
        
        if (studentIndex === -1) {
            this.showMessage('بيانات الطالب غير موجودة', 'error');
            return;
        }
        
        const currentPoints = students[studentIndex].points || 0;
        
        if (currentPoints < cost) {
            this.showMessage('نقاطك غير كافية لاستبدال هذه المكافأة', 'error');
            return;
        }
        
        // خصم النقاط
        students[studentIndex].points = currentPoints - cost;
        this.saveStoredData('students', students);
        
        // إضافة المكافأة المستبدلة
        const redeemedRewards = this.getStoredData('redeemedRewards') || [];
        const rewardNames = {
            1: 'حصة مجانية',
            2: 'خصم 50% على الحصة التالية', 
            3: 'كتاب مجاني',
            4: 'اشتراك مجاني لمدة أسبوع'
        };
        
        redeemedRewards.push({
            id: Date.now(),
            studentId: this.currentUser.id,
            rewardId: rewardId,
            rewardName: rewardNames[rewardId],
            cost: cost,
            timestamp: new Date().toISOString()
        });
        this.saveStoredData('redeemedRewards', redeemedRewards);
        
        this.showMessage('تم استبدال المكافأة بنجاح!', 'success');
        
        // تحديث العرض
        this.loadRewardsPage();
    }

    // إضافة سجل معاملة
    addTransactionRecord(transaction, status = 'pending') {
        const transactions = this.getStoredData('transactions') || [];
        transactions.push({
            ...transaction,
            id: Date.now(),
            status: status,
            timestamp: new Date().toISOString()
        });
        this.saveStoredData('transactions', transactions);
    }

    // الحصول على نص الصف
    getGradeText(grade) {
        const gradeTexts = {
            'first': 'الأول الثانوي',
            'second': 'الثاني الثانوي', 
            'third': 'الثالث الثانوي',
            'all': 'جميع الطلاب'
        };
        return gradeTexts[grade] || grade;
    }

    // تطبيق الخلفية المخصصة
    async applyCustomBackground() {
        const customBackground = this.getStoredData('customBackground');
        if (customBackground && customBackground.imageKey) {
            const imageUrl = await this.fileStore.getFileAsURL(customBackground.imageKey);
            if(imageUrl) {
                document.documentElement.style.setProperty('--custom-bg', `url('${imageUrl}')`);
                
                // تطبيق الشفافية على العناصر
                const opacity = customBackground.opacity || 0.3;
                document.querySelectorAll('.hero-section::before').forEach(element => {
                    element.style.opacity = opacity;
                });
            }
        }
    }

    // رفع الحصة (للمدرس)
    async handleLessonUpload() {
        const editingId = document.getElementById('editingLessonId').value;
        const title = document.getElementById('lessonFormTitleInput').value.trim();
        const price = parseFloat(document.getElementById('lessonPrice').value);
        const description = document.getElementById('lessonDescription').value.trim();
        const grade = document.getElementById('lessonGrade').value;
        
        if (!title || isNaN(price) || !description || !grade) {
            this.showMessage('يرجى إدخال جميع البيانات المطلوبة', 'error');
            return;
        }
        
        if (price < 0) {
            this.showMessage('يرجى إدخال سعر صحيح', 'error');
            return;
        }
        
        // جمع أسئلة الامتحان
        const examQuestions = this.collectExamQuestions();
        if (examQuestions.length === 0) {
            this.showMessage('يرجى إضافة سؤال واحد على الأقل للامتحان', 'error');
            return;
        }
        
        const lessons = this.getStoredData('lessons') || [];

        if (editingId) {
            // تحديث حصة موجودة
            const lessonIndex = lessons.findIndex(l => l.id == editingId);
            if (lessonIndex !== -1) {
                const lesson = lessons[lessonIndex];
                lesson.title = title;
                lesson.price = price;
                lesson.description = description;
                lesson.grade = grade;
                lesson.examQuestions = examQuestions;
                lesson.updatedAt = new Date().toISOString();

                // تحديث الملفات فقط إذا تم اختيار ملفات جديدة
                const coverImage = await this.handleFileUpload('lessonCover', `lesson_${lesson.id}_cover`);
                if (coverImage) {
                    await this.fileStore.deleteFile(lesson.coverImage);
                    lesson.coverImage = coverImage;
                }
                const videoFile = await this.handleFileUpload('lessonVideoFile', `lesson_${lesson.id}_video`);
                if (videoFile) {
                    await this.fileStore.deleteFile(lesson.videoFile);
                    lesson.videoFile = videoFile;
                }
                const pdfFile = await this.handleFileUpload('lessonPDF', `lesson_${lesson.id}_pdf`);
                if (pdfFile) {
                    await this.fileStore.deleteFile(lesson.pdfFile);
                    lesson.pdfFile = pdfFile;
                }
                const homeworkFile = await this.handleFileUpload('homeworkPDF', `lesson_${lesson.id}_homework`);
                if (homeworkFile) {
                    await this.fileStore.deleteFile(lesson.homeworkFile);
                    lesson.homeworkFile = homeworkFile;
                }
                const solutionFile = await this.handleFileUpload('homeworkSolutionPDF', `lesson_${lesson.id}_solution_pdf`);
                if (solutionFile) {
                    await this.fileStore.deleteFile(lesson.solutionFile);
                    lesson.solutionFile = solutionFile;
                }
                const homeworkSolutionVideo = await this.handleFileUpload('homeworkSolutionVideo', `lesson_${lesson.id}_solution_video`);
                if (homeworkSolutionVideo) {
                    await this.fileStore.deleteFile(lesson.homeworkSolutionVideo);
                    lesson.homeworkSolutionVideo = homeworkSolutionVideo;
                }

                this.saveStoredData('lessons', lessons);
                
                // Send updated lesson to server
                if (this.syncEnabled) {
                    try {
                        await this.sendRequest(`/lessons/${editingId}`, 'PUT', lessons[lessonIndex]);
                    } catch (e) {
                        console.error("Failed to update lesson on server", e);
                    }
                }
                
                this.showMessage('تم تحديث الحصة بنجاح', 'success');
            }
        } else {
            // إنشاء حصة جديدة
            const lessonId = Date.now();
            const lesson = {
                id: lessonId,
                title: title,
                price: price,
                description: description,
                grade: grade,
                coverImage: await this.handleFileUpload('lessonCover', `lesson_${lessonId}_cover`),
                videoFile: await this.handleFileUpload('lessonVideoFile', `lesson_${lessonId}_video`),
                pdfFile: await this.handleFileUpload('lessonPDF', `lesson_${lessonId}_pdf`),
                homeworkFile: await this.handleFileUpload('homeworkPDF', `lesson_${lessonId}_homework`),
                solutionFile: await this.handleFileUpload('homeworkSolutionPDF', `lesson_${lessonId}_solution_pdf`),
                homeworkSolutionVideo: await this.handleFileUpload('homeworkSolutionVideo', `lesson_${lessonId}_solution_video`),
                examQuestions: examQuestions,
                isActive: true,
                createdAt: new Date().toISOString()
            };
            lessons.push(lesson);
            
            // Send new lesson to server
            if (this.syncEnabled) {
                try {
                    const serverResponse = await this.sendRequest('/lessons', 'POST', lesson);
                    // Optionally update local lesson with server ID
                    lesson.id = serverResponse.lesson.id;
                } catch(e) {
                     console.error("Failed to send lesson to server", e);
                }
            }
            this.saveStoredData('lessons', lessons);
            this.showMessage('تم رفع الحصة بنجاح', 'success');
        }
        
        this.cancelEditLesson(); // لإعادة تعيين النموذج
        this.loadTeacherLessons();
    }

    // معالجة رفع الملفات
    async handleFileUpload(inputId, prefix) {
        const input = document.getElementById(inputId);
        if (input && input.files[0]) {
            const file = input.files[0];
            const key = `${prefix}_${Date.now()}_${file.name}`;
            try {
                await this.fileStore.saveFile(key, file);
                return key;
            } catch (error) {
                console.error('File store error:', error);
                this.showMessage('خطأ في حفظ الملف', 'error');
                return null;
            }
        }
        return null;
    }

    // جمع أسئلة الامتحان
    collectExamQuestions() {
        const questions = [];
        const questionItems = document.querySelectorAll('#examQuestionsContainer .question-item');
        
        questionItems.forEach(item => {
            const questionText = item.querySelector('.question-text').value.trim();
            const choices = Array.from(item.querySelectorAll('.choice')).map(input => input.value.trim());
            const correctAnswer = item.querySelector('.correct-answer').value;
            
            if (questionText && choices.every(choice => choice) && correctAnswer !== '') {
                questions.push({
                    question: questionText,
                    choices: choices,
                    correctAnswer: correctAnswer
                });
            }
        });
        
        return questions;
    }

    // إضافة سؤال جديد
    addNewQuestion() {
        const questionsContainer = document.getElementById('examQuestionsContainer');
        const questionCount = questionsContainer.children.length + 1;
        
        const questionHtml = `
            <div class="question-item">
                <button type="button" class="delete-question-btn" onclick="this.parentElement.remove()">
                    <i class="fas fa-trash"></i>
                </button>
                <div class="form-group">
                    <label>السؤال ${questionCount}</label>
                    <input type="text" class="question-text" placeholder="اكتب السؤال هنا" required>
                </div>
                <div class="choices-grid">
                    <div class="form-group">
                        <label>الخيار الأول</label>
                        <input type="text" class="choice" placeholder="الخيار الأول" required>
                    </div>
                    <div class="form-group">
                        <label>الخيار الثاني</label>
                        <input type="text" class="choice" placeholder="الخيار الثاني" required>
                    </div>
                    <div class="form-group">
                        <label>الخيار الثالث</label>
                        <input type="text" class="choice" placeholder="الخيار الثالث" required>
                    </div>
                    <div class="form-group">
                        <label>الخيار الرابع</label>
                        <input type="text" class="choice" placeholder="الخيار الرابع" required>
                    </div>
                </div>
                <div class="form-group">
                    <label>الإجابة الصحيحة</label>
                    <select class="correct-answer" required>
                        <option value="">اختر الإجابة الصحيحة</option>
                        <option value="0">الخيار الأول</option>
                        <option value="1">الخيار الثاني</option>
                        <option value="2">الخيار الثالث</option>
                        <option value="3">الخيار الرابع</option>
                    </select>
                </div>
            </div>
        `;
        
        questionsContainer.insertAdjacentHTML('beforeend', questionHtml);
    }

    // تعديل حصة
    editLesson(lessonId) {
        const lessons = this.getStoredData('lessons') || [];
        const lesson = lessons.find(l => l.id === lessonId);
        if (!lesson) {
            this.showMessage('الحصة غير موجودة', 'error');
            return;
        }

        document.getElementById('editingLessonId').value = lesson.id;
        document.getElementById('lessonFormTitle').textContent = '✏️ تعديل الحصة';
        document.getElementById('lessonFormTitleInput').value = lesson.title;
        document.getElementById('lessonPrice').value = lesson.price;
        document.getElementById('lessonDescription').value = lesson.description;
        document.getElementById('lessonGrade').value = lesson.grade;
        
        const questionsContainer = document.getElementById('examQuestionsContainer');
        questionsContainer.innerHTML = '';
        if (lesson.examQuestions && lesson.examQuestions.length > 0) {
            lesson.examQuestions.forEach((q, index) => {
                this.addNewQuestion();
                const qItem = questionsContainer.children[index];
                qItem.querySelector('.question-text').value = q.question;
                q.choices.forEach((choice, choiceIndex) => {
                    qItem.querySelectorAll('.choice')[choiceIndex].value = choice;
                });
                qItem.querySelector('.correct-answer').value = q.correctAnswer;
            });
        } else {
            this.addNewQuestion();
        }

        document.getElementById('lessonSubmitBtn').innerHTML = '<i class="fas fa-save"></i> <span>حفظ التعديلات</span>';
        document.getElementById('cancelEditLessonBtn').style.display = 'block';

        // Scroll to the form
        document.getElementById('lessonFormTitle').scrollIntoView({ behavior: 'smooth' });
    }

    // إلغاء تعديل الحصة
    cancelEditLesson() {
        document.getElementById('editingLessonId').value = '';
        document.getElementById('lessonFormTitle').textContent = '📥 إضافة حصة جديدة';
        document.getElementById('uploadLessonForm').reset();
        this.resetExamQuestions();
        document.getElementById('lessonSubmitBtn').innerHTML = '<i class="fas fa-upload"></i> <span>رفع الحصة</span>';
        document.getElementById('cancelEditLessonBtn').style.display = 'none';
    }

    // حذف حصة
    async deleteLesson(lessonId) {
        if (!confirm('هل أنت متأكد من حذف هذه الحصة؟ سيتم حذفها نهائياً.')) return;

        let lessons = this.getStoredData('lessons') || [];
        const lessonToDelete = lessons.find(l => l.id === lessonId);

        if(lessonToDelete){
            // Delete associated files from IndexedDB
            const fileKeys = [
                lessonToDelete.coverImage,
                lessonToDelete.videoFile,
                lessonToDelete.pdfFile,
                lessonToDelete.homeworkFile,
                lessonToDelete.solutionFile,
                lessonToDelete.homeworkSolutionVideo
            ].filter(Boolean); // Filter out null/undefined keys

            for (const key of fileKeys) {
                try {
                    await this.fileStore.deleteFile(key);
                } catch(e) {
                    console.error(`Failed to delete file ${key} from IndexedDB`, e);
                }
            }
        }

        lessons = lessons.filter(l => l.id !== lessonId);
        this.saveStoredData('lessons', lessons);
        
        // Delete lesson from server
        this.deleteFromServer(`/lessons/${lessonId}`);
        
        this.showMessage('تم حذف الحصة بنجاح', 'success');
        this.loadTeacherLessons();
    }

    // تحميل اشتراكات المدرس
    loadTeacherSubscriptions() {
        const subscriptions = this.getStoredData('subscriptions') || [];
        const container = document.getElementById('teacherSubscriptionsList');

        if (!container) return;

        if (subscriptions.length === 0) {
            container.innerHTML = `<p>لم تقم بإنشاء أي اشتراكات بعد.</p>`;
            return;
        }

        container.innerHTML = subscriptions.map(sub => `
            <div class="subscription-item">
                <div>
                    <strong>${sub.name}</strong> (${sub.price} جنيه - ${sub.duration} يوم)
                </div>
                <div class="item-actions">
                    <button class="edit-btn" onclick="window.app.editSubscription(${sub.id})">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="delete-btn" onclick="window.app.deleteSubscription(${sub.id})">
                        <i class="fas fa-trash"></i>
                    </button>
                    <button class="add-content-btn" onclick="window.app.addLessonToSubscription(${sub.id})">
                        <i class="fas fa-plus"></i> إضافة حصة
                    </button>
                </div>
            </div>
        `).join('');
    }

    // حذف اشتراك
    deleteSubscription(subscriptionId) {
        if (!confirm('هل أنت متأكد من حذف هذا الاشتراك؟')) return;

        let subscriptions = this.getStoredData('subscriptions') || [];
        subscriptions = subscriptions.filter(s => s.id !== subscriptionId);
        this.saveStoredData('subscriptions', subscriptions);
        
        // Delete subscription from server
        this.deleteFromServer(`/subscriptions/${subscriptionId}`);
        
        this.showMessage('تم حذف الاشتراك بنجاح', 'success');
        this.loadTeacherSubscriptions();
    }

    // تعديل الاشتراك (مستقبلاً)
    editSubscription(subscriptionId) {
        this.showMessage('ميزة تعديل الاشتراك سيتم إضافة قريباً', 'info');
    }

    // إضافة حصة للاشتراك (مستقبلاً)
    addLessonToSubscription(subscriptionId) {
        this.showMessage('ميزة إضافة حصة للاشتراك سيتم إضافة قريباً', 'info');
    }

    // تحميل حصص المدرس
    async loadTeacherLessons() {
        const lessons = this.getStoredData('lessons') || [];
        const container = document.getElementById('teacherLessonsList');
        
        if (!container) return;
        
        container.innerHTML = `<p style="text-align: center; padding: 20px;">جار تحميل الحصص...</p>`;
        
        if (lessons.length === 0) {
            container.innerHTML = `<p style="text-align: center; padding: 20px;">لم تقم برفع أي حصص بعد.</p>`;
            return;
        }

        container.innerHTML = ''; // Clear container

        lessons.forEach(async lesson => {
            const coverImageUrl = await this.fileStore.getFileAsURL(lesson.coverImage);
            const lessonCardHtml = `
            <div class="lesson-card">
                <div class="lesson-cover" style="${coverImageUrl ? `background-image: url('${coverImageUrl}')` : ''}">
                    ${!coverImageUrl ? '<i class="fas fa-play-circle"></i>' : ''}
                </div>
                <div class="lesson-info">
                    <h3>${lesson.title}</h3>
                    <div class="lesson-details">
                        <span class="lesson-price">${lesson.price} جنيه</span>
                        <span class="lesson-grade">${this.getGradeText(lesson.grade)}</span>
                    </div>
                    <div class="lesson-actions" style="margin-top: 15px; display: flex; gap: 10px;">
                        <button class="edit-btn" onclick="window.app.editLesson(${lesson.id})">
                            <i class="fas fa-edit"></i> تعديل
                        </button>
                        <button class="delete-btn" onclick="window.app.deleteLesson(${lesson.id})">
                            <i class="fas fa-trash"></i> حذف
                        </button>
                    </div>
                </div>
            </div>
            `;
            container.insertAdjacentHTML('beforeend', lessonCardHtml);
        });

        this.resetExamQuestions();
    }
    // ------ General Messages (Teacher) ------

    handleGeneralMessage() {
        const target = document.getElementById('messageTarget').value;
        const title = document.getElementById('messageTitle').value.trim();
        const content = document.getElementById('messageContent').value.trim();
        const duration = document.getElementById('messageDuration').value;
        const priority = document.getElementById('messagePriority').value;
    
        if (!target || !title || !content) {
            this.showMessage('يرجى ملء جميع الحقول المطلوبة.', 'error');
            return;
        }
    
        const generalMessages = this.getStoredData('generalMessages') || [];
        const newMessage = {
            id: Date.now(),
            target,
            title,
            content,
            duration: parseInt(duration, 10),
            priority,
            createdAt: new Date().toISOString(),
            teacherId: this.currentUser.id
        };
    
        generalMessages.push(newMessage);
        this.saveStoredData('generalMessages', generalMessages);
        
        // Send general message to server
        this.sendRequest('/general-messages', 'POST', newMessage);
    
        this.showMessage('تم إرسال الرسالة العامة بنجاح.', 'success');
        document.getElementById('generalMessageForm').reset();
        this.loadSentGeneralMessages();
    }
    
    loadSentGeneralMessages() {
        const messages = this.getStoredData('generalMessages') || [];
        const container = document.getElementById('sentMessagesList');
        if (!container) return;
    
        if (messages.length === 0) {
            container.innerHTML = '<p>لا توجد رسائل مرسلة.</p>';
            return;
        }
    
        container.innerHTML = messages
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .map(msg => `
                <div class="message-item">
                    <div>
                        <strong>${msg.title}</strong>
                        <p>المستهدف: ${this.getGradeText(msg.target)} - الأولوية: ${msg.priority}</p>
                        <small>أرسلت في: ${new Date(msg.createdAt).toLocaleDateString('ar-EG')}</small>
                    </div>
                    <div class="item-actions">
                        <button class="delete-btn" onclick="window.app.deleteGeneralMessage(${msg.id})">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            `).join('');
    }
    
    deleteGeneralMessage(messageId) {
        if (!confirm('هل أنت متأكد من حذف هذه الرسالة؟')) return;
    
        let messages = this.getStoredData('generalMessages') || [];
        messages = messages.filter(msg => msg.id !== messageId);
        this.saveStoredData('generalMessages', messages);
        
        // Delete general message from server
        this.deleteFromServer(`/general-messages/${messageId}`);
        
        this.showMessage('تم حذف الرسالة بنجاح.', 'success');
        this.loadSentGeneralMessages();
    }
    
    // ------ Student Messages (Teacher) ------
    loadStudentMessages() {
        const statusFilter = document.getElementById('messageStatusFilter').value;
        const gradeFilter = document.getElementById('messageGradeFilter').value;
        const container = document.getElementById('studentMessagesList');
        if(!container) return;

        let messages = this.getStoredData('studentMessages') || [];
        
        // Apply filters
        if(statusFilter !== 'all') {
            messages = messages.filter(m => m.status === statusFilter);
        }
        const students = this.getStoredData('students') || [];
        if(gradeFilter !== 'all') {
            messages = messages.filter(p => {
                const student = students.find(s => s.id === p.studentId);
                return student && student.grade === gradeFilter;
            });
        }
        
        if (messages.length === 0) {
            container.innerHTML = '<p>لا توجد رسائل من الطلاب تطابق الفلاتر.</p>';
            return;
        }

        container.innerHTML = messages.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp)).map(msg => `
            <div class="message-item ${msg.status}">
                <div>
                    <strong>${msg.subject}</strong> (${msg.lessonId})
                    <p>من: ${msg.studentName}</p>
                    <small>التاريخ: ${new Date(msg.timestamp).toLocaleString('ar-EG')}</small>
                </div>
                <div class="item-actions">
                     <button class="view-btn" onclick="window.app.openReplyModal(${msg.id})">عرض و رد</button>
                </div>
            </div>
        `).join('');
    }
    
    openReplyModal(messageId) {
        // This function will open the reply modal. Implementation is for a future step.
        this.showMessage('ميزة الرد على الرسائل سيتم تفعيلها قريباً.', 'info');
    }

    // إضافة وسيلة دفع للمدرس
    loadCurrentPaymentMethods() {
        if (!this.currentUser || this.currentUser.type !== 'teacher') return;
        const paymentMethods = this.getStoredData('paymentMethods') || [];
        const container = document.getElementById('currentPaymentMethods');

        if (!container) return;

        if (paymentMethods.length === 0) {
            container.innerHTML = '<p>لا توجد وسائل دفع مضافة</p>';
            return;
        }

        container.innerHTML = paymentMethods.map(method => `
            <div class="payment-method-item">
                <div>
                    <strong>${method.name}</strong>
                    <p>رقم الحساب: ${method.number}</p>
                </div>
                <div class="item-actions">
                    <button class="delete-btn" onclick="window.app.deletePaymentMethod(${method.id})">
                        <i class="fas fa-trash"></i> حذف
                    </button>
                </div>
            </div>
        `).join('');
    }

    // إضافة وسيلة دفع للمدرس
    handleAddPaymentMethod() {
        if (!this.currentUser || this.currentUser.type !== 'teacher') return;

        const name = document.getElementById('paymentName').value.trim();
        const number = document.getElementById('paymentNumber').value.trim();
        const password = document.getElementById('paymentPassword').value.trim();

        if (!name || !number || !password) {
            this.showMessage('يرجى إدخال جميع البيانات', 'error');
            return;
        }

        const paymentMethods = this.getStoredData('paymentMethods') || [];

        const newMethod = {
            id: Date.now(),
            name: name,
            number: number,
            password: password 
        };

        paymentMethods.push(newMethod);
        this.saveStoredData('paymentMethods', paymentMethods);
        
        // Send payment method to server
        this.sendRequest('/payment-methods', 'POST', newMethod);

        this.showMessage('تمت إضافة وسيلة الدفع بنجاح', 'success');
        document.getElementById('paymentMethodForm').reset();
        this.loadCurrentPaymentMethods();
    }

    // حذف وسيلة دفع للمدرس
    deletePaymentMethod(methodId) {
        if (!this.currentUser || this.currentUser.type !== 'teacher') return;
    
        const controlPassword = prompt("للحذف، يرجى إدخال كلمة مرور التحكم الخاصة بوسيلة الدفع:");
        if (controlPassword === null) return; // User cancelled
    
        let paymentMethods = this.getStoredData('paymentMethods') || [];
        const methodIndex = paymentMethods.findIndex(m => m.id === methodId);
    
        if (methodIndex === -1) {
            this.showMessage('وسيلة الدفع غير موجودة', 'error');
            return;
        }
    
        if (paymentMethods[methodIndex].password !== controlPassword) {
            this.showMessage('كلمة مرور التحكم غير صحيحة.', 'error');
            return;
        }
    
        paymentMethods = paymentMethods.filter(m => m.id !== methodId);
        this.saveStoredData('paymentMethods', paymentMethods);
        
        // Delete payment method from server
        this.deleteFromServer(`/payment-methods/${methodId}`);
    
        this.showMessage('تم حذف وسيلة الدفع بنجاح', 'success');
        this.loadCurrentPaymentMethods();
    }

    // تسجيل نشاط الدعم الفني
    logSupportActivity(supportId, supportName, action, details = {}) {
        const activityLog = this.getStoredData('supportActivityLog') || [];
        activityLog.push({
            id: Date.now(),
            supportId,
            supportName,
            action,
            details,
            timestamp: new Date().toISOString()
        });
        this.saveStoredData('supportActivityLog', activityLog);
    }
    
    // ------ Chat (Support) ------
    loadStudentChatList() {
        if (!this.currentUser || this.currentUser.type !== 'support') return;
    
        const container = document.getElementById('studentChatList');
        if (!container) return;
    
        const allMessages = this.getStoredData('supportMessages') || [];
        const students = this.getStoredData('students') || [];
    
        // Get unique student IDs from messages
        const studentIdsWithMessage = [...new Set(allMessages.map(m => m.studentId))];
    
        // Get student info for those who have messaged
        const studentsWhoMessaged = students.filter(s => studentIdsWithMessage.includes(s.id));
    
        if (studentsWhoMessaged.length === 0) {
            container.innerHTML = '<p>لا يوجد طلاب حاليون في الدردشة.</p>';
            return;
        }
    
        container.innerHTML = studentsWhoMessaged.map(student => {
            const studentMessages = allMessages.filter(m => m.studentId === student.id);
            const unreadCount = studentMessages.filter(m => m.from === 'student' && !m.isRead).length;
    
            return `
                <div class="student-chat-item" onclick="window.app.openSupportChat(${student.id})">
                    <strong>${student.name}</strong>
                    <p><small>${this.getGradeText(student.grade)}</small></p>
                    ${unreadCount > 0 ? `<span class="unread-count">${unreadCount}</span>` : ''}
                </div>
            `;
        }).join('');
    }
    
    async openSupportChat(studentId) {
        if (!this.currentUser || this.currentUser.type !== 'support') return;
    
        const students = this.getStoredData('students') || [];
        const student = students.find(s => s.id === studentId);
        if (!student) return;
    
        this.currentChatStudentId = studentId;
    
        document.getElementById('chatHeader').style.display = 'block';
        document.getElementById('currentChatStudent').textContent = student.name;
        document.getElementById('chatInput').style.display = 'flex';
        document.getElementById('chatMessages').innerHTML = '';
    
        const allMessages = this.getStoredData('supportMessages') || [];
        const chatMessages = allMessages.filter(m => m.studentId === studentId);
    
        const messagesContainer = document.getElementById('chatMessages');
    
        if (chatMessages.length === 0) {
            messagesContainer.innerHTML = '<p>لا توجد رسائل في هذه المحادثة. يمكنك بدء المحادثة.</p>';
            return;
        }
    
        for (const message of chatMessages) {
            let imageHtml = '';
            if (message.imageKey) {
                const imageUrl = await this.fileStore.getFileAsURL(message.imageKey);
                if (imageUrl) {
                    imageHtml = `<img src="${imageUrl}" alt="صورة مرفقة" class="chat-image" onclick="window.app.viewReceipt('${message.imageKey}')">`;
                }
            }
            const messageClass = message.from === 'student' ? 'from-student' : 'from-support';
            const senderName = message.from === 'student' ? student.name : (message.supportName || 'الدعم الفني');
    
            const messageHtml = `
                <div class="message ${messageClass}">
                    <div class="message-sender">${senderName}</div>
                    ${message.text ? `<p>${message.text}</p>` : ''}
                    ${imageHtml}
                    <div class="message-time">${new Date(message.timestamp).toLocaleTimeString('ar-EG')}</div>
                </div>
            `;
            messagesContainer.insertAdjacentHTML('beforeend', messageHtml);
        }
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    
        const updatedMessages = allMessages.map(m => {
            if (m.studentId === studentId && m.from === 'student' && !m.isRead) {
                m.isRead = true;
            }
            return m;
        });
        this.saveStoredData('supportMessages', updatedMessages);
    
        this.loadStudentChatList();
    }
    
    sendChatMessage() {
        if (!this.currentUser || this.currentUser.type !== 'support' || !this.currentChatStudentId) return;
    
        const messageInput = document.getElementById('messageInput');
        const messageText = messageInput.value.trim();
    
        if (!messageText) return;
    
        const message = {
            id: Date.now(),
            from: 'support',
            supportId: this.currentUser.id,
            supportName: this.currentUser.name,
            studentId: this.currentChatStudentId,
            text: messageText,
            timestamp: new Date().toISOString(),
            isRead: false
        };
    
        const supportMessages = this.getStoredData('supportMessages') || [];
        supportMessages.push(message);
        this.saveStoredData('supportMessages', supportMessages);
    
        messageInput.value = '';
        this.openSupportChat(this.currentChatStudentId); // Refresh chat view
    }
    
    handleChatKeyPress(event) {
        if (event.key === 'Enter') {
            this.sendChatMessage();
        }
    }
}

// تشغيل التطبيق عند تحميل الصفحة
document.addEventListener('DOMContentLoaded', () => {
    window.app = new EducationApp();
    
    // تهيئة بيانات الدعم الفني
    window.app.initializeSupportStaff();
    
    // Start periodic sync
    window.app.startPeriodicSync();
});

EducationApp.prototype.initializeSupportStaff = function() {
    let supportStaff = this.getStoredData('supportStaff');
    if (!supportStaff || supportStaff.length === 0) {
        const defaultStaff = [
            {
                id: 'support_1',
                name: 'دعم فني',
                code: '12345',
                isOnline: false,
                createdAt: new Date().toISOString()
            }
        ];
        this.saveStoredData('supportStaff', defaultStaff);
        console.log('Default support staff initialized.');
    }
};

EducationApp.prototype.showAddSupportForm = function() {
    const supportContent = document.getElementById('supportContent');
    if (!supportContent) return;

    supportContent.innerHTML = `
        <div class="form-container" style="max-width: 600px; margin: 20px auto;">
            <h3><i class="fas fa-user-plus"></i> إضافة عضو دعم فني جديد</h3>
            <form id="addSupportForm">
                <div class="form-group">
                    <label for="newSupportName">الاسم الثلاثي</label>
                    <input type="text" id="newSupportName" required>
                </div>
                <div class="form-group">
                    <label for="newSupportCode">كود الدخول</label>
                    <input type="text" id="newSupportCode" required>
                </div>
                <button type="submit" class="submit-btn">
                    <i class="fas fa-plus"></i> إضافة العضو
                </button>
            </form>
        </div>
    `;

    document.getElementById('addSupportForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const name = document.getElementById('newSupportName').value.trim();
        const code = document.getElementById('newSupportCode').value.trim();

        if (!name || !code) {
            this.showMessage('يرجى إدخال جميع البيانات', 'error');
            return;
        }

        const supportStaff = this.getStoredData('supportStaff') || [];
        if (supportStaff.some(s => s.code === code)) {
            this.showMessage('كود الدخول مستخدم بالفعل', 'error');
            return;
        }

        const newStaff = {
            id: Date.now(),
            name,
            code,
            isOnline: false,
            createdAt: new Date().toISOString()
        };

        supportStaff.push(newStaff);
        this.saveStoredData('supportStaff', supportStaff);
        this.showMessage('تمت إضافة عضو الدعم الفني بنجاح', 'success');
        document.getElementById('addSupportForm').reset();
        this.showSupportList(); // Refresh the list
    });
};

EducationApp.prototype.showSupportList = function() {
    const supportContent = document.getElementById('supportContent');
    if (!supportContent) return;

    const supportStaff = this.getStoredData('supportStaff') || [];

    let contentHtml = `<h3><i class="fas fa-users"></i> فريق الدعم الفني (${supportStaff.length})</h3>`;

    if (supportStaff.length === 0) {
        contentHtml += '<p>لا يوجد أعضاء في فريق الدعم حالياً.</p>';
    } else {
        contentHtml += `
            <div class="support-list-container">
                <div class="support-staff-list">
                    ${supportStaff.map(staff => `
                        <div class="staff-item">
                            <div class="staff-info">
                                <strong>${staff.name}</strong>
                                <small>الكود: ${staff.code}</small>
                                <small>تاريخ الإنشاء: ${new Date(staff.createdAt).toLocaleDateString('ar-EG')}</small>
                                <small>الحالة: ${staff.isOnline ? '<span style="color:var(--success-color);">متصل</span>' : '<span style="color:var(--accent-color);">غير متصل</span>'}</small>
                            </div>
                            <div class="staff-actions">
                                <button class="delete-btn" onclick="window.app.deleteSupportStaff(${staff.id})">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>`;
    }
    supportContent.innerHTML = contentHtml;
};

EducationApp.prototype.deleteSupportStaff = function(staffId) {
    if (!confirm('هل أنت متأكد من حذف عضو الدعم الفني؟ سيتم حذف حسابه نهائياً.')) return;

    let supportStaff = this.getStoredData('supportStaff') || [];
    supportStaff = supportStaff.filter(s => s.id !== staffId);
    this.saveStoredData('supportStaff', supportStaff);
    this.showMessage('تم حذف عضو الدعم الفني بنجاح', 'success');
    this.showSupportList();
};

EducationApp.prototype.banStudent = function(studentId, role) {
    const reason = prompt("يرجى إدخال سبب الحظر:");
    if (!reason || reason.trim() === '') {
        this.showMessage('يجب إدخال سبب للحظر.', 'error');
        return;
    }

    const students = this.getStoredData('students') || [];
    const studentIndex = students.findIndex(s => s.id === studentId);

    if (studentIndex !== -1) {
        students[studentIndex].isBanned = true;
        students[studentIndex].banReason = reason;
        students[studentIndex].bannedAt = new Date().toISOString();
        students[studentIndex].bannedBy = { id: this.currentUser.id, name: this.currentUser.name }; // Log who banned
        this.saveStoredData('students', students);
        this.showMessage('تم حظر الطالب بنجاح', 'success');
        this.searchAndFilterStudents(role);
        this.loadBannedStudents(role);
    }
};

EducationApp.prototype.unbanStudent = function(studentId, role) {
    if (!confirm('هل أنت متأكد من رفع الحظر عن هذا الطالب؟')) return;

    const students = this.getStoredData('students') || [];
    const studentIndex = students.findIndex(s => s.id === studentId);

    if (studentIndex !== -1) {
        students[studentIndex].isBanned = false;
        delete students[studentIndex].banReason;
        delete students[studentIndex].bannedAt;
        delete students[studentIndex].bannedBy; // Clear who banned
        this.saveStoredData('students', students);
        this.showMessage('تم رفع الحظر عن الطالب بنجاح', 'success');
        this.searchAndFilterStudents(role);
        this.loadBannedStudents(role);
    }
};

EducationApp.prototype.searchAndFilterStudents = function(role) {
    let searchInputId, gradeFilterId, statusFilterId, resultsContainerId;
    if (role === 'teacher') {
        searchInputId = 'studentSearch';
        gradeFilterId = 'gradeFilter';
        statusFilterId = 'statusFilter';
        resultsContainerId = 'searchResults';
    } else { // support
        searchInputId = 'studentSearchSupport';
        gradeFilterId = 'gradeFilterSupport';
        statusFilterId = 'statusFilterSupport';
        resultsContainerId = 'studentSearchResults';
    }

    const searchTerm = document.getElementById(searchInputId).value.toLowerCase();
    const gradeFilter = document.getElementById(gradeFilterId).value;
    const statusFilter = document.getElementById(statusFilterId).value;
    const resultsContainer = document.getElementById(resultsContainerId);

    let students = this.getStoredData('students') || [];

    // Filter by search term
    if (searchTerm) {
        students = students.filter(s => s.name.toLowerCase().includes(searchTerm) || s.studentNumber.includes(searchTerm));
    }
    // Filter by grade
    if (gradeFilter !== 'all') {
        students = students.filter(s => s.grade === gradeFilter);
    }
    // Filter by status
    if (statusFilter !== 'all') {
        students = students.filter(s => (statusFilter === 'banned' && s.isBanned) || (statusFilter === 'active' && !s.isBanned));
    }

    if (students.length === 0) {
        resultsContainer.innerHTML = '<p>لا يوجد طلاب يطابقون معايير البحث.</p>';
        return;
    }

    resultsContainer.innerHTML = students.map(student => `
        <div class="student-result" style="background: ${student.isBanned ? 'rgba(231, 76, 60, 0.1)' : 'transparent'};">
            <div>
                <strong>${student.name}</strong> (${this.getGradeText(student.grade)})
                <br>
                <small>رقم الطالب: ${student.studentNumber}</small>
            </div>
            ${student.isBanned ?
                `<button class="unban-btn" onclick="window.app.unbanStudent(${student.id}, '${role}')">رفع الحظر</button>` :
                `<button class="ban-btn" onclick="window.app.banStudent(${student.id}, '${role}')">حظر</button>`
            }
        </div>
    `).join('');
};

EducationApp.prototype.loadBannedStudents = function(role) {
    let containerId;
    if (role === 'teacher') {
        containerId = 'bannedStudentsList';
    } else { // support
        containerId = 'bannedStudentsListSupport';
    }
    const container = document.getElementById(containerId);
    if(!container) return;

    const students = this.getStoredData('students') || [];
    const bannedStudents = students.filter(s => s.isBanned);

    if (bannedStudents.length === 0) {
        container.innerHTML = '<p>لا يوجد طلاب محظورون حالياً.</p>';
        return;
    }

    container.innerHTML = bannedStudents.map(student => `
        <div class="student-result">
            <div>
                <strong>${student.name}</strong> (${this.getGradeText(student.grade)})
                <br>
                <small>سبب الحظر: ${student.banReason || 'غير محدد'}</small>
            </div>
            <button class="unban-btn" onclick="window.app.unbanStudent(${student.id}, '${role}')">رفع الحظر</button>
        </div>
    `).join('');
};

EducationApp.prototype.viewStudentDetails = function(studentId) {
    const students = this.getStoredData('students') || [];
    const student = students.find(s => s.id === studentId);
    
    if (!student) {
        this.showMessage('الطالب غير موجود', 'error');
        return;
    }
    
    // عرض معلومات الطالب
    this.showPage('studentDetails');
    
    // تحديث المحتوى
    document.getElementById('studentName').textContent = student.name;
    document.getElementById('studentGrade').textContent = this.getGradeText(student.grade);
    document.getElementById('studentNumber').textContent = student.studentNumber;
    document.getElementById('studentParentPhone').textContent = student.parentPhone;
    document.getElementById('studentBalance').textContent = `${student.balance || 0} جنيه`;
    document.getElementById('studentPoints').textContent = `${student.points || 0} نقطة`;
    
    // عرض سجل المعاملات
    this.loadStudentTransactions(studentId);
};

EducationApp.prototype.loadStudentTransactions = function(studentId) {
    const transactions = this.getStoredData('transactions') || [];
    const studentTransactions = transactions.filter(t => t.studentId === studentId);
    
    const container = document.getElementById('studentTransactionsList');
    if (!container) return;
    
    if (studentTransactions.length === 0) {
        container.innerHTML = '<p>لا توجد معاملات سابقة</p>';
        return;
    }
    
    container.innerHTML = studentTransactions.map(transaction => {
        const statusText = {
            'pending': 'في الانتظار',
            'confirmed': 'مؤكد',
            'rejected': 'مرفوض'
        };
        
        const statusClass = {
            'pending': 'warning',
            'confirmed': 'success',
            'rejected': 'error'
        };
        
        return `
            <div class="transaction-item ${statusClass[transaction.status]}">
                <div class="transaction-info">
                    <strong>${transaction.type === 'lesson' ? 'شراء حصة' : 'طلب كتاب'} (${transaction.amount} جنيه)</strong>
                    <small>التاريخ: ${new Date(transaction.timestamp).toLocaleDateString('ar-EG')}</small>
                </div>
                <div class="transaction-status">
                    ${statusText[transaction.status]}
                </div>
            </div>
        `;
    }).join('');
};

EducationApp.prototype.viewReceipt = async function(receiptKey) {
    if (!receiptKey) {
        this.showMessage('لا يوجد إيصال لهذا الطلب', 'error');
        return;
    }

    const imageUrl = await this.fileStore.getFileAsURL(receiptKey);
    
    if (!imageUrl) {
        this.showMessage('لا توجد صورة إيصال', 'error');
        return;
    }
    
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'block';
    modal.innerHTML = `
        <div class="modal-content">
            <span class="close" onclick="this.parentElement.parentElement.remove()">&times;</span>
            <h3>صورة الإيصال</h3>
            <img src="${imageUrl}" style="max-width: 100%; height: auto; border-radius: 10px;" alt="إيصال التحويل">
        </div>
    `;
    document.body.appendChild(modal);
};

EducationApp.prototype.startPeriodicSync = function() {
    if (!this.syncEnabled) return;
        
    // Sync every 30 seconds
    setInterval(() => {
        this.syncDataFromServer();
    }, 30000);
};