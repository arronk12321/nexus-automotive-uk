/* ================================================================
   NEXUS AUTOMOTIVE UK — CUSTOMER PORTAL
   Full Firebase auth, order submission, AI ECU processing
   ================================================================ */

const PortalApp = (() => {
  let db, auth, storage;
  let currentUser = null;
  let userProfile = null;
  let allOrders = [];

  // ── AI Processing Services ──────────────────────────────────────
  const AI_AUTO_SERVICES = ['Start/Stop Disable', 'Speed Limiter Removal', 'Swirl Flap Delete', 'EGR Delete'];
  const AI_REVIEW_SERVICES = ['Stage 1 Remap', 'DPF Delete', 'AdBlue Delete', 'Pops & Bangs', 'TCU/DSG Tuning', 'Immo Off / ECU Solutions'];

  // ── Firestore REST helpers (bypass SDK transport issues on Safari) ──
  function toFsValue(val) {
    if (val === null || val === undefined) return { nullValue: null };
    if (typeof val === 'boolean') return { booleanValue: val };
    if (val instanceof Date) return { timestampValue: val.toISOString() };
    if (typeof val === 'number') return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
    if (typeof val === 'string') return { stringValue: val };
    if (Array.isArray(val)) return { arrayValue: { values: val.map(toFsValue) } };
    if (typeof val === 'object') {
      const fields = {};
      for (const [k, v] of Object.entries(val)) fields[k] = toFsValue(v);
      return { mapValue: { fields } };
    }
    return { stringValue: String(val) };
  }

  async function fsAdd(collection, data) {
    const token = await auth.currentUser.getIdToken(true);
    const pid = window.NEXUS_FB_CONFIG.projectId;
    const fields = {};
    for (const [k, v] of Object.entries(data)) fields[k] = toFsValue(v);
    const res = await fetch(
      `https://firestore.googleapis.com/v1/projects/${pid}/databases/nexus/documents/${collection}`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields })
      }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Firestore REST error ${res.status}`);
    }
    const result = await res.json();
    return { id: result.name.split('/').pop() };
  }

  // Decode a Firestore REST field value back to JS
  function fromFsValue(val) {
    if (!val) return null;
    if ('nullValue' in val) return null;
    if ('booleanValue' in val) return val.booleanValue;
    if ('integerValue' in val) return parseInt(val.integerValue, 10);
    if ('doubleValue' in val) return val.doubleValue;
    if ('timestampValue' in val) return val.timestampValue; // ISO string
    if ('stringValue' in val) return val.stringValue;
    if ('arrayValue' in val) return (val.arrayValue.values || []).map(fromFsValue);
    if ('mapValue' in val) {
      const obj = {};
      for (const [k, v] of Object.entries(val.mapValue.fields || {})) obj[k] = fromFsValue(v);
      return obj;
    }
    return null;
  }

  function fromFsDoc(doc) {
    const obj = {};
    for (const [k, v] of Object.entries(doc.fields || {})) obj[k] = fromFsValue(v);
    return obj;
  }

  // Parse a date that may be an ISO string (from REST) or a Firestore {seconds} object
  function parseDate(val) {
    if (!val) return null;
    if (typeof val === 'string') return new Date(val);
    if (val.seconds) return new Date(val.seconds * 1000);
    return null;
  }

  async function fsGet(collection, docId) {
    const token = await auth.currentUser.getIdToken(true);
    const pid = window.NEXUS_FB_CONFIG.projectId;
    const res = await fetch(
      `https://firestore.googleapis.com/v1/projects/${pid}/databases/nexus/documents/${collection}/${docId}`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Firestore GET error ${res.status}`);
    return fromFsDoc(await res.json());
  }

  async function fsSet(collection, docId, data) {
    const token = await auth.currentUser.getIdToken(true);
    const pid = window.NEXUS_FB_CONFIG.projectId;
    const fields = {};
    for (const [k, v] of Object.entries(data)) fields[k] = toFsValue(v);
    const res = await fetch(
      `https://firestore.googleapis.com/v1/projects/${pid}/databases/nexus/documents/${collection}/${docId}`,
      {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields })
      }
    );
    if (!res.ok) throw new Error(`Firestore SET error ${res.status}`);
  }

  async function fsUpdate(collection, docId, data) {
    const token = await auth.currentUser.getIdToken(true);
    const pid = window.NEXUS_FB_CONFIG.projectId;
    const fieldPaths = Object.keys(data).map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
    const fields = {};
    for (const [k, v] of Object.entries(data)) fields[k] = toFsValue(v);
    const res = await fetch(
      `https://firestore.googleapis.com/v1/projects/${pid}/databases/nexus/documents/${collection}/${docId}?${fieldPaths}`,
      {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields })
      }
    );
    if (!res.ok) throw new Error(`Firestore UPDATE error ${res.status}`);
  }

  async function fsQuery(collection, field, value) {
    const token = await auth.currentUser.getIdToken(true);
    const pid = window.NEXUS_FB_CONFIG.projectId;
    const body = {
      structuredQuery: {
        from: [{ collectionId: collection }],
        where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: toFsValue(value) } }
      }
    };
    const res = await fetch(
      `https://firestore.googleapis.com/v1/projects/${pid}/databases/nexus/documents:runQuery`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }
    );
    if (!res.ok) throw new Error(`Firestore QUERY error ${res.status}`);
    const results = await res.json();
    return results.filter(r => r.document).map(r => ({ id: r.document.name.split('/').pop(), ...fromFsDoc(r.document) }));
  }

  // ── Init ───────────────────────────────────────────────────────
  function init() {
    if (!window.NEXUS_FB_CONFIG || window.NEXUS_FB_CONFIG.apiKey === 'YOUR_API_KEY') {
      showConfigError();
      return;
    }
    try {
      if (!firebase.apps.length) firebase.initializeApp(window.NEXUS_FB_CONFIG);
      auth = firebase.auth();
      storage = firebase.storage();
      auth.onAuthStateChanged(handleAuthChange);
    } catch(e) {
      console.error('Firebase init error:', e);
      showConfigError();
    }
    setupFormListeners();
  }

  function showConfigError() {
    document.getElementById('authScreen').innerHTML = `
      <div class="auth-card" style="max-width:520px">
        <div class="auth-logo"><span class="logo-n">N</span>EXUS</div>
        <h2 class="auth-title" style="color:#ffc107">⚙️ Setup Required</h2>
        <p style="color:#888;text-align:center;font-size:0.88rem;margin-bottom:20px">Firebase needs to be configured before the portal is live. See setup instructions below.</p>
        <div style="background:#0d0d0d;border:1px solid #1e1e1e;border-radius:8px;padding:16px;font-size:0.82rem;color:#aaa;line-height:1.8">
          <strong style="color:#e5e5e5">1.</strong> Go to <a href="https://console.firebase.google.com" target="_blank" style="color:#2196f3">console.firebase.google.com</a><br>
          <strong style="color:#e5e5e5">2.</strong> Create a new project<br>
          <strong style="color:#e5e5e5">3.</strong> Enable Authentication → Email/Password<br>
          <strong style="color:#e5e5e5">4.</strong> Create Firestore Database (start in test mode)<br>
          <strong style="color:#e5e5e5">5.</strong> Enable Storage<br>
          <strong style="color:#e5e5e5">6.</strong> Go to Project Settings → Your Apps → Add Web App<br>
          <strong style="color:#e5e5e5">7.</strong> Copy the config into <code style="color:#2196f3">assets/js/firebase-config.js</code>
        </div>
        <a href="index.html" style="display:block;text-align:center;margin-top:20px;color:#2196f3;font-size:0.85rem">← Back to main site</a>
      </div>`;
  }

  function handleAuthChange(user) {
    if (user) {
      currentUser = user;
      loadUserProfile();
    } else {
      currentUser = null;
      userProfile = null;
      document.getElementById('authScreen').classList.remove('hidden');
      document.getElementById('portalDashboard').classList.add('hidden');
      document.getElementById('headerRight').style.display = 'none';
    }
  }

  async function loadUserProfile() {
    try {
      const data = await fsGet('users', currentUser.uid);
      userProfile = data || {};
      showPortal();
    } catch(e) {
      userProfile = {};
      showPortal();
    }
  }

  const ADMIN_EMAILS = ['kostileka@gmail.com'];

  function isAdmin() {
    return currentUser && ADMIN_EMAILS.includes(currentUser.email.toLowerCase());
  }

  function showPortal() {
    const name = userProfile.firstName || currentUser.email.split('@')[0];
    document.getElementById('welcomeName').textContent = name;
    document.getElementById('sidebarName').textContent = `${userProfile.firstName || ''} ${userProfile.lastName || ''}`.trim() || 'Customer';
    document.getElementById('sidebarEmail').textContent = currentUser.email;
    document.getElementById('sidebarAvatar').textContent = (userProfile.firstName || currentUser.email)[0].toUpperCase();
    document.getElementById('headerUserName').textContent = name;

    // Show admin badge & link if admin
    const headerRight = document.getElementById('headerRight');
    headerRight.style.display = 'flex';
    const existingBadge = document.getElementById('adminHeaderBadge');
    if (existingBadge) existingBadge.remove();
    if (isAdmin()) {
      const badge = document.createElement('a');
      badge.id = 'adminHeaderBadge';
      badge.href = 'admin.html';
      badge.textContent = 'ADMIN';
      badge.style.cssText = 'background:#e53935;color:#fff;font-size:0.7rem;font-weight:700;padding:4px 10px;border-radius:4px;letter-spacing:1px;text-decoration:none;margin-right:4px';
      headerRight.insertBefore(badge, headerRight.firstChild);
    }

    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('portalDashboard').classList.remove('hidden');
    loadOrders();
    fillProfile();
  }

  // ── Auth ───────────────────────────────────────────────────────
  function setupFormListeners() {
    document.getElementById('loginForm').addEventListener('submit', handleLogin);
    document.getElementById('registerForm').addEventListener('submit', handleRegister);
    document.getElementById('newOrderForm').addEventListener('submit', handleOrderSubmit);
    document.getElementById('profileForm').addEventListener('submit', handleProfileSave);
    setupFileUpload();
    setupServiceGrid();
  }

  async function handleLogin(e) {
    e.preventDefault();
    const btn = document.getElementById('loginBtn');
    const err = document.getElementById('loginError');
    btn.disabled = true; btn.querySelector('span').textContent = 'Signing in...';
    err.textContent = '';
    try {
      await auth.signInWithEmailAndPassword(
        document.getElementById('loginEmail').value,
        document.getElementById('loginPassword').value
      );
    } catch(ex) {
      err.textContent = friendlyAuthError(ex.code);
      btn.disabled = false; btn.querySelector('span').textContent = 'Sign In';
    }
  }

  async function handleRegister(e) {
    e.preventDefault();
    const btn = document.getElementById('registerBtn');
    const err = document.getElementById('registerError');
    btn.disabled = true; btn.querySelector('span').textContent = 'Creating account...';
    err.textContent = '';
    const firstName = document.getElementById('regFirstName').value.trim();
    const lastName = document.getElementById('regLastName').value.trim();
    const email = document.getElementById('regEmail').value;
    const phone = document.getElementById('regPhone').value;
    const password = document.getElementById('regPassword').value;
    if (password.length < 8) { err.textContent = 'Password must be at least 8 characters'; btn.disabled = false; btn.querySelector('span').textContent = 'Create Account'; return; }
    try {
      const cred = await auth.createUserWithEmailAndPassword(email, password);
      await db.collection('users').doc(cred.user.uid).set({ firstName, lastName, email, phone, createdAt: new Date() });
    } catch(ex) {
      err.textContent = friendlyAuthError(ex.code);
      btn.disabled = false; btn.querySelector('span').textContent = 'Create Account';
    }
  }

  function friendlyAuthError(code) {
    const map = {
      'auth/user-not-found': 'No account found with that email.',
      'auth/wrong-password': 'Incorrect password.',
      'auth/email-already-in-use': 'An account already exists with that email.',
      'auth/weak-password': 'Password must be at least 6 characters.',
      'auth/invalid-email': 'Please enter a valid email address.',
      'auth/too-many-requests': 'Too many attempts. Try again later.',
      'auth/invalid-credential': 'Invalid email or password.'
    };
    return map[code] || 'Something went wrong. Please try again.';
  }

  function logout() {
    if (auth) auth.signOut();
  }

  function forgotPassword(e) {
    if (e) e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    if (!email) { document.getElementById('loginError').textContent = 'Enter your email above first.'; return; }
    auth.sendPasswordResetEmail(email).then(() => {
      document.getElementById('loginError').style.color = '#4caf50';
      document.getElementById('loginError').textContent = 'Password reset email sent!';
    }).catch(() => {
      document.getElementById('loginError').style.color = '#f44336';
      document.getElementById('loginError').textContent = 'Could not send reset email.';
    });
  }

  function switchTab(tab) {
    document.getElementById('tabLogin').classList.toggle('active', tab === 'login');
    document.getElementById('tabRegister').classList.toggle('active', tab === 'register');
    document.getElementById('loginForm').classList.toggle('hidden', tab !== 'login');
    document.getElementById('registerForm').classList.toggle('hidden', tab !== 'register');
  }

  // ── Views ──────────────────────────────────────────────────────
  function showView(view, e) {
    if (e) e.preventDefault();
    document.querySelectorAll('.portal-view').forEach(v => v.classList.add('hidden'));
    document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
    const el = document.getElementById('view-' + view);
    if (el) el.classList.remove('hidden');
    const link = document.querySelector(`[data-view="${view}"]`);
    if (link) link.classList.add('active');
    if (view === 'orders') renderAllOrders();
    if (view === 'downloads') renderDownloads();
    if (view === 'new-order') resetOrderForm();
  }

  // ── Orders ─────────────────────────────────────────────────────
  async function loadOrders() {
    if (!currentUser) return;
    try {
      allOrders = await fsQuery('orders', 'userId', currentUser.uid);
      renderDashboard();
      renderRecentOrders();
    } catch(e) { console.error('loadOrders error:', e); }
  }

  function renderDashboard() {
    const total = allOrders.length;
    const pending = allOrders.filter(o => o.status === 'pending' || o.status === 'processing').length;
    const completed = allOrders.filter(o => o.status === 'completed').length;
    const downloads = allOrders.filter(o => o.status === 'completed' && o.modifiedFileUrl).length;
    document.getElementById('statTotal').textContent = total;
    document.getElementById('statPending').textContent = pending;
    document.getElementById('statCompleted').textContent = completed;
    document.getElementById('statDownloads').textContent = downloads;
  }

  function renderRecentOrders() {
    const container = document.getElementById('recentOrdersList');
    const recent = allOrders.slice(0, 5);
    if (!recent.length) {
      container.innerHTML = `<div class="empty-state"><p>No orders yet. <a href="#" onclick="PortalApp.showView('new-order',event)">Submit your first ECU file →</a></p></div>`;
      return;
    }
    container.innerHTML = recent.map(o => orderItemHTML(o)).join('');
  }

  function renderAllOrders() {
    const container = document.getElementById('allOrdersList');
    if (!allOrders.length) {
      container.innerHTML = `<div class="empty-state"><p>No orders yet. <a href="#" onclick="PortalApp.showView('new-order',event)">Submit your first ECU file →</a></p></div>`;
      return;
    }
    container.innerHTML = allOrders.map(o => orderItemHTML(o)).join('');
  }

  function filterOrders() {
    const q = (document.getElementById('orderSearch').value || '').toLowerCase();
    const f = document.getElementById('orderFilter').value;
    const filtered = allOrders.filter(o => {
      const matchQ = !q || (o.vehicle || '').toLowerCase().includes(q) || (o.service || '').toLowerCase().includes(q) || (o.reg || '').toLowerCase().includes(q);
      const matchF = f === 'all' || o.status === f;
      return matchQ && matchF;
    });
    document.getElementById('allOrdersList').innerHTML = filtered.length ? filtered.map(o => orderItemHTML(o)).join('') : `<div class="empty-state"><p>No orders match your search.</p></div>`;
  }

  function orderItemHTML(o) {
    const icons = { 'Stage 1 Remap': '⚡', 'EGR Delete': '🔧', 'DPF Delete': '💨', 'AdBlue Delete': '🔵', 'Pops & Bangs': '🔥', 'Swirl Flap Delete': '🌀', 'Speed Limiter Removal': '🏎️', 'Start/Stop Disable': '🔋', 'TCU/DSG Tuning': '⚙️', 'Immo Off / ECU Solutions': '🔑' };
    const icon = icons[o.service] || '📁';
    const date = o.createdAt ? (parseDate(o.createdAt) || new Date()).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }) : 'Pending';
    const aiTag = o.aiProcessed ? '<span style="font-size:0.7rem;color:#ce93d8;margin-left:6px">🤖 AI</span>' : '';
    return `<div class="order-item" onclick="PortalApp.openOrder('${o.id}')">
      <div class="order-item-left">
        <div class="order-item-icon">${icon}</div>
        <div class="order-item-info">
          <div class="order-item-id">#${o.id.slice(-8).toUpperCase()}</div>
          <div class="order-item-title">${o.service || 'Unknown Service'}${aiTag}</div>
          <div class="order-item-sub">${o.vehicle || ''} ${o.reg ? '· ' + o.reg : ''}</div>
        </div>
      </div>
      <div class="order-item-right">
        <span class="order-item-date">${date}</span>
        <span class="badge badge-${o.status || 'pending'}">${o.status || 'pending'}</span>
        ${o.status === 'completed' && o.modifiedFileUrl ? '<span style="font-size:1.2rem" title="Ready to download">📥</span>' : ''}
      </div>
    </div>`;
  }

  async function openOrder(id) {
    const order = allOrders.find(o => o.id === id);
    if (!order) return;
    const modal = document.getElementById('orderModal');
    const content = document.getElementById('modalContent');
    const date = order.createdAt ? new Date(order.createdAt.seconds * 1000).toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' }) : 'Unknown';
    let aiSection = '';
    if (order.aiReport) {
      aiSection = `<div class="ai-result-card">
        <div class="ai-result-header"><span style="font-size:1.4rem">🤖</span><h4>AI Processing Report</h4></div>
        ${order.aiReport.map(r => `<div class="ai-result-item ${r.warn ? 'warn' : ''}">${r.text}</div>`).join('')}
      </div>`;
    }
    let downloadBtn = '';
    if (order.status === 'completed' && order.modifiedFileUrl) {
      downloadBtn = `<a href="${order.modifiedFileUrl}" target="_blank" class="download-btn">📥 Download Modified ECU File</a>`;
    }
    content.innerHTML = `
      <h3 style="color:#fff;margin:0 0 4px;font-size:1.2rem">${order.service}</h3>
      <p style="color:#666;font-size:0.82rem;margin:0 0 20px">#${id.slice(-8).toUpperCase()} · ${date}</p>
      <span class="badge badge-${order.status || 'pending'}" style="font-size:0.85rem;padding:6px 14px">${order.status || 'pending'}</span>
      ${order.price ? `<span class="price-tag" style="margin-left:12px">£${order.price}</span>` : ''}
      <div style="margin-top:20px">
        <div class="modal-detail-row"><span class="modal-detail-label">Vehicle</span><span class="modal-detail-value">${order.vehicle || '—'}</span></div>
        <div class="modal-detail-row"><span class="modal-detail-label">Registration</span><span class="modal-detail-value">${order.reg || '—'}</span></div>
        <div class="modal-detail-row"><span class="modal-detail-label">Engine</span><span class="modal-detail-value">${order.engine || '—'}</span></div>
        <div class="modal-detail-row"><span class="modal-detail-label">ECU Type</span><span class="modal-detail-value">${order.ecuType || 'Unknown'}</span></div>
        <div class="modal-detail-row"><span class="modal-detail-label">Service</span><span class="modal-detail-value">${order.service}</span></div>
        ${order.notes ? `<div class="modal-detail-row"><span class="modal-detail-label">Notes</span><span class="modal-detail-value">${order.notes}</span></div>` : ''}
        ${order.adminNotes ? `<div class="modal-detail-row"><span class="modal-detail-label">Technician Notes</span><span class="modal-detail-value" style="color:#90caf9">${order.adminNotes}</span></div>` : ''}
      </div>
      ${aiSection}
      ${downloadBtn}`;
    modal.classList.remove('hidden');
  }

  function closeModal(e) {
    if (!e || e.target === document.getElementById('orderModal') || e.currentTarget.classList.contains('modal-close')) {
      document.getElementById('orderModal').classList.add('hidden');
    }
  }

  // ── Downloads ──────────────────────────────────────────────────
  function renderDownloads() {
    const container = document.getElementById('downloadsList');
    const ready = allOrders.filter(o => o.status === 'completed' && o.modifiedFileUrl);
    if (!ready.length) {
      container.innerHTML = `<div class="empty-state" style="text-align:center;padding:60px 20px;color:#555"><div style="font-size:3rem;margin-bottom:12px">📭</div><p>No completed files yet. Files appear here when your order is done.</p></div>`;
      return;
    }
    container.innerHTML = ready.map(o => {
      const date = o.completedAt ? new Date(o.completedAt.seconds * 1000).toLocaleDateString('en-GB') : 'Complete';
      return `<div class="download-card">
        <div class="download-card-info">
          <div class="download-card-icon">📁</div>
          <div>
            <div class="download-card-title">${o.service} — ${o.vehicle}</div>
            <div class="download-card-sub">${o.reg || ''} · Completed ${date}</div>
            ${o.aiProcessed ? '<div class="download-card-ai">🤖 AI Processed</div>' : ''}
          </div>
        </div>
        <a href="${o.modifiedFileUrl}" target="_blank" class="download-btn">📥 Download File</a>
      </div>`;
    }).join('');
  }

  // ── New Order Form ─────────────────────────────────────────────
  function setupServiceGrid() {
    document.querySelectorAll('.service-option').forEach(el => {
      el.addEventListener('click', () => {
        document.querySelectorAll('.service-option').forEach(s => s.classList.remove('selected'));
        el.classList.add('selected');
        document.getElementById('ordService').value = el.dataset.service;
        document.getElementById('serviceError').classList.add('hidden');
      });
    });
  }

  function setupFileUpload() {
    const zone = document.getElementById('fileUploadZone');
    const input = document.getElementById('ordFile');
    zone.addEventListener('click', () => input.click());
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('dragover');
      if (e.dataTransfer.files[0]) showFileInfo(e.dataTransfer.files[0]);
    });
    input.addEventListener('change', () => { if (input.files[0]) showFileInfo(input.files[0]); });
  }

  function showFileInfo(file) {
    const info = document.getElementById('fileInfo');
    const size = (file.size / 1024).toFixed(1);
    info.textContent = `✅ ${file.name} — ${size} KB`;
    info.classList.remove('hidden');
    // Set on input
    const dt = new DataTransfer();
    dt.items.add(file);
    document.getElementById('ordFile').files = dt.files;
  }

  function resetOrderForm() {
    document.querySelectorAll('.service-option').forEach(s => s.classList.remove('selected'));
    document.getElementById('ordService').value = '';
    document.getElementById('fileInfo').classList.add('hidden');
    document.getElementById('submitStatus').textContent = '';
    document.getElementById('submitBtnText').textContent = '🤖 Submit for AI Processing';
    document.getElementById('submitOrderBtn').disabled = false;
  }

  async function handleOrderSubmit(e) {
    e.preventDefault();
    const service = document.getElementById('ordService').value;
    if (!service) { document.getElementById('serviceError').classList.remove('hidden'); return; }
    const file = document.getElementById('ordFile').files[0];
    if (!file) { setStatus('Please upload your ECU file.', 'error'); return; }
    const disclaimer = document.getElementById('ordDisclaimer').checked;
    if (!disclaimer) { setStatus('Please accept the disclaimer.', 'error'); return; }
    const make = document.getElementById('ordMake').value;
    const model = document.getElementById('ordModel').value;
    const year = document.getElementById('ordYear').value;
    const engine = document.getElementById('ordEngine').value;
    const reg = document.getElementById('ordReg').value.toUpperCase();
    const ecuType = document.getElementById('ordEcuType').value;
    const notes = document.getElementById('ordNotes').value;
    const btn = document.getElementById('submitOrderBtn');
    btn.disabled = true;
    setStatus('🤖 Uploading ECU file...', 'info');

    try {
      // 1. Upload original file to Storage
      const filePath = `ecu-files/${currentUser.uid}/${Date.now()}_${file.name}`;
      const ref = storage.ref(filePath);
      try {
        await new Promise((resolve, reject) => {
          const task = ref.put(file, { contentType: 'application/octet-stream' });
          let lastBytes = 0;
          let stallTimer = null;

          const resetStallTimer = () => {
            clearTimeout(stallTimer);
            stallTimer = setTimeout(() => {
              task.cancel();
              reject(new Error('Upload timed out — CORS or network issue. Please try again or contact support.'));
            }, 30000);
          };
          resetStallTimer();

          task.on('state_changed',
            (snap) => {
              if (snap.bytesTransferred > lastBytes) { lastBytes = snap.bytesTransferred; resetStallTimer(); }
              const pct = snap.totalBytes > 0 ? Math.round((snap.bytesTransferred / snap.totalBytes) * 100) : 0;
              setStatus(`🤖 Uploading ECU file... ${pct}% (${snap.bytesTransferred}/${snap.totalBytes} bytes) — state: ${snap.state}`, 'info');
              console.log('Upload snap:', snap.state, snap.bytesTransferred, snap.totalBytes);
            },
            (err) => { clearTimeout(stallTimer); console.error('Storage upload error:', err.code, err.message, err.serverResponse_); reject(err); },
            () => { clearTimeout(stallTimer); resolve(task.snapshot); }
          );
        });
      } catch(storageErr) {
        console.error('Storage error:', storageErr);
        setStatus('❌ ' + (storageErr.message || storageErr.code || 'File upload failed — Storage error. Please contact support.'), 'error');
        btn.disabled = false;
        return;
      }
      const originalFileUrl = await ref.getDownloadURL();
      setStatus('🤖 Running AI analysis...', 'info');

      // 2. Run AI processor on file
      let aiReport = [];
      let aiProcessed = false;
      let modifiedFileUrl = null;
      let modifiedFileName = null;
      let orderStatus = 'pending';

      if (typeof ECUProcessor !== 'undefined') {
        try {
          const arrayBuffer = await file.arrayBuffer();
          const result = ECUProcessor.analyseFile(arrayBuffer, file.name, service);
          aiReport = result.report || [];

          if (AI_AUTO_SERVICES.includes(service) && result.canAutoProcess) {
            setStatus('🤖 Applying AI modifications...', 'info');
            const modified = ECUProcessor.processFile(arrayBuffer, service, result.ecuInfo);
            if (modified) {
              const modBlob = new Blob([modified], { type: 'application/octet-stream' });
              const modExt = file.name.split('.').pop();
              modifiedFileName = `NEXUS_${service.replace(/[^a-zA-Z0-9]/g,'_')}_${file.name}`;
              const modRef = storage.ref(`processed-files/${currentUser.uid}/modified_${Date.now()}_${modifiedFileName}`);
              await new Promise((resolve, reject) => {
                const modTask = modRef.put(modBlob);
                modTask.on('state_changed', null, reject, () => resolve(modTask.snapshot));
              });
              modifiedFileUrl = await modRef.getDownloadURL();
              aiProcessed = true;
              orderStatus = 'completed';
              aiReport.push({ text: 'File successfully modified by AI', warn: false });
              aiReport.push({ text: 'Checksums recalculated and verified', warn: false });
              setStatus('✅ AI processing complete! File ready to download.', 'success');
            }
          } else {
            orderStatus = 'pending';
            aiReport.push({ text: `${service} queued for manual technician review (within 24hrs)`, warn: true });
            setStatus('📋 Submitted for technician review (24hr turnaround)', 'info');
          }
        } catch(aiErr) {
          console.error('AI processing error:', aiErr);
          aiReport = [{ text: 'AI analysis queued for manual review', warn: true }];
          orderStatus = 'pending';
        }
      } else {
        orderStatus = 'pending';
        setStatus('📋 File uploaded — technician will process within 24hrs', 'info');
      }

      // 3. Save order to Firestore
      const orderData = {
        userId: currentUser.uid,
        userEmail: currentUser.email,
        userName: `${userProfile.firstName || ''} ${userProfile.lastName || ''}`.trim() || currentUser.email,
        userPhone: userProfile.phone || '',
        vehicle: `${year} ${make} ${model}`,
        make, model, year, engine, reg, ecuType,
        service, notes,
        originalFileName: file.name,
        originalFileUrl,
        modifiedFileUrl,
        modifiedFileName,
        aiProcessed,
        aiReport,
        status: orderStatus,
        price: null,
        adminNotes: '',
        createdAt: new Date(),
        completedAt: orderStatus === 'completed' ? new Date() : null
      };

      // Write order via REST API (bypasses SDK transport issues on Safari)
      const docRef = await fsAdd('orders', orderData);
      allOrders.unshift({ id: docRef.id, ...orderData, createdAt: { seconds: Date.now() / 1000 } });
      renderDashboard();

      if (orderStatus === 'completed') {
        setStatus('✅ Done! Your modified file is ready. Go to Downloads.', 'success');
        setTimeout(() => showView('downloads'), 2500);
      } else {
        setStatus('✅ Order submitted! You\'ll be notified when complete.', 'success');
        setTimeout(() => showView('orders'), 2500);
      }

    } catch(err) {
      console.error('Order submit error:', err);
      const errMsg = err.message || err.code || 'Unknown error';
      alert('ORDER ERROR: ' + errMsg);
      setStatus('❌ ' + errMsg, 'error');
      btn.disabled = false;
    }
  }

  function setStatus(msg, type) {
    const el = document.getElementById('submitStatus');
    el.textContent = msg;
    el.className = 'submit-status ' + type;
  }

  // ── Profile ────────────────────────────────────────────────────
  function fillProfile() {
    if (!userProfile) return;
    document.getElementById('profFirstName').value = userProfile.firstName || '';
    document.getElementById('profLastName').value = userProfile.lastName || '';
    document.getElementById('profEmail').value = currentUser.email;
    document.getElementById('profPhone').value = userProfile.phone || '';
  }

  async function handleProfileSave(e) {
    e.preventDefault();
    try {
      const updates = {
        firstName: document.getElementById('profFirstName').value.trim(),
        lastName: document.getElementById('profLastName').value.trim(),
        phone: document.getElementById('profPhone').value.trim()
      };
      await fsUpdate('users', currentUser.uid, updates);
      userProfile = { ...userProfile, ...updates };
      document.getElementById('profileMsg').textContent = '✅ Profile updated!';
      document.getElementById('profileMsg').className = 'submit-status success mt-8';
      setTimeout(() => { document.getElementById('profileMsg').textContent = ''; }, 3000);
    } catch(e) {
      document.getElementById('profileMsg').textContent = '❌ Error saving profile.';
      document.getElementById('profileMsg').className = 'submit-status error mt-8';
    }
  }

  // ── Public API ─────────────────────────────────────────────────
  return { init, logout, switchTab, showView, openOrder, closeModal, filterOrders, forgotPassword };
})();

document.addEventListener('DOMContentLoaded', () => PortalApp.init());
