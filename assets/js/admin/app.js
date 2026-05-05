// ═══════════════════════════════════════════════════════════════
// admin/app.js — Admin SPA bootstrap + tab management
// ═══════════════════════════════════════════════════════════════

(function () {
  const loginScreen = document.getElementById('login-screen');
  const adminShell = document.getElementById('admin-shell');
  const loginForm = document.getElementById('login-form');
  const loginError = document.getElementById('login-error');
  const logoutBtn = document.getElementById('logout-btn');
  const refreshBtn = document.getElementById('refresh-btn');
  const tabs = document.querySelectorAll('.tab[data-tab]');

  let editorLoaded = false;
  let auditLoaded = false;
  let phonesLoaded = false;
  let uploadsLoaded = false;

  function showLogin() {
    loginScreen.classList.remove('hidden');
    adminShell.classList.add('hidden');
  }

  function showDashboard() {
    loginScreen.classList.add('hidden');
    adminShell.classList.remove('hidden');
    const session = getSession();
    if (session) {
      document.getElementById('admin-username').textContent = session.user;
    }
    loadDashboard();
  }

  function activateTab(tabName) {
    tabs.forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    const targetTab = document.querySelector(`.tab[data-tab="${tabName}"]`);
    const targetPanel = document.getElementById(`panel-${tabName}`);
    if (targetTab) targetTab.classList.add('active');
    if (targetPanel) targetPanel.classList.add('active');

    // Lazy-load editor and audit
    if (tabName === 'editor' && !editorLoaded) {
      editorLoaded = true;
      Editor.initEditor();
    }
    if (tabName === 'phones' && !phonesLoaded) {
      phonesLoaded = true;
      Phones.initPhones();
    }
    if (tabName === 'uploads' && !uploadsLoaded) {
      uploadsLoaded = true;
      Uploads.initUploads();
    }
    if (tabName === 'audit' && !auditLoaded) {
      auditLoaded = true;
      Audit.initAudit();
    }
  }

  // Check existing session
  if (isAuthenticated()) {
    showDashboard();
  }

  // Login form
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.textContent = '';
    const user = document.getElementById('username').value.trim();
    const pass = document.getElementById('password').value;

    if (!user || !pass) {
      loginError.textContent = 'أدخل اسم المستخدم وكلمة المرور';
      return;
    }

    const ok = await authenticate(user, pass);
    if (ok) {
      saveSession();
      showDashboard();
    } else {
      loginError.textContent = 'اسم المستخدم أو كلمة المرور غير صحيحة';
      document.getElementById('password').value = '';
    }
  });

  // Logout
  logoutBtn.addEventListener('click', () => {
    clearSession();
    showLogin();
    document.getElementById('username').value = '';
    document.getElementById('password').value = '';
    loginError.textContent = '';
    editorLoaded = false;
    auditLoaded = false;
    phonesLoaded = false;
    uploadsLoaded = false;
  });

  // Tabs
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      if (tab.disabled) return;
      activateTab(tab.dataset.tab);
    });
  });

  // Refresh
  refreshBtn.addEventListener('click', () => {
    refreshBtn.classList.add('spinning');
    loadDashboard().finally(() => {
      setTimeout(() => refreshBtn.classList.remove('spinning'), 500);
    });
  });
})();
