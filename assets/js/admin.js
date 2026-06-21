/* ================================================================
   NEXUS AUTOMOTIVE UK — ADMIN PORTAL JS (REST API — no Firebase SDK for Firestore)
   ================================================================ */

const AdminApp = (() => {

  // ── Firestore REST helpers ──────────────────────────────────────
  function fsBase() {
    const cfg = window.NEXUS_FB_CONFIG;
    return `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/nexus/documents`;
  }

  async function fsList(collection) {
    const url = `${fsBase()}/${collection}?pageSize=300`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Firestore ${res.status}`);
    const data = await res.json();
    return (data.documents || []).map(fsDocToObj);
  }

  async function fsUpdate(collection, docId, fields) {
    const mask = Object.keys(fields).map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
    const url = `${fsBase()}/${collection}/${docId}?${mask}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: toFsFields(fields) })
    });
    if (!res.ok) throw new Error(`Firestore ${res.status}`);
    return res.json();
  }

  function toFsFields(obj) {
    const f = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string') f[k] = { stringValue: v };
      else if (typeof v === 'number') f[k] = { doubleValue: v };
      else if (typeof v === 'boolean') f[k] = { booleanValue: v };
      else if (v instanceof Date) f[k] = { timestampValue: v.toISOString() };
      else f[k] = { nullValue: null };
    }
    return f;
  }

  function fsDocToObj(doc) {
    if (!doc || !doc.fields) return { id: doc.name.split('/').pop() };
    const id = doc.name.split('/').pop();
    const obj = { id };
    for (const [k, v] of Object.entries(doc.fields)) {
      obj[k] = fsValToJs(v);
    }
    return obj;
  }

  function fsValToJs(v) {
    if ('stringValue' in v) return v.stringValue;
    if ('integerValue' in v) return parseInt(v.integerValue);
    if ('doubleValue' in v) return parseFloat(v.doubleValue);
    if ('booleanValue' in v) return v.booleanValue;
    if ('timestampValue' in v) return new Date(v.timestampValue);
    if ('nullValue' in v) return null;
    if ('mapValue' in v) {
      const m = {};
      for (const [k2, v2] of Object.entries(v.mapValue.fields || {})) m[k2] = fsValToJs(v2);
      return m;
    }
    if ('arrayValue' in v) return (v.arrayValue.values || []).map(fsValToJs);
    return null;
  }

  // Normalise any timestamp type → ms
  function getTs(val) {
    if (!val) return 0;
    if (val instanceof Date) return val.getTime();
    if (typeof val === 'object' && val.seconds) return val.seconds * 1000;
    if (typeof val === 'string') return new Date(val).getTime();
    return 0;
  }

  function formatDate(val) {
    const ms = getTs(val);
    return ms ? new Date(ms).toLocaleDateString('en-GB') : '—';
  }

  function formatDateTime(val) {
    const ms = getTs(val);
    return ms ? new Date(ms).toLocaleString('en-GB') : '—';
  }

  // ── State ────────────────────────────────────────────────────────
  let auth, storage;
  let allOrders = [];
  let allCustomers = [];
  let openAIKey = null;

  // ── Init ─────────────────────────────────────────────────────────
  function init() {
    if (!window.NEXUS_FB_CONFIG || window.NEXUS_FB_CONFIG.apiKey === 'YOUR_API_KEY') {
      document.getElementById('adminLoginScreen').innerHTML = `
        <div class="auth-card"><div class="auth-logo"><span class="logo-n">N</span>EXUS</div>
        <h2 class="auth-title" style="color:#ffc107">Firebase Not Configured</h2>
        <p style="color:#888;text-align:center;font-size:0.85rem">Please set up Firebase first — see <a href="portal.html" style="color:#2196f3">portal.html</a>.</p></div>`;
      return;
    }
    if (!firebase.apps.length) firebase.initializeApp(window.NEXUS_FB_CONFIG);
    auth = firebase.auth();
    storage = firebase.storage();
    auth.onAuthStateChanged(user => {
      if (user) { showDashboard(); loadOrders(); loadCustomers(); }
      else {
        document.getElementById('adminLoginScreen').classList.remove('hidden');
        document.getElementById('adminDashboard').classList.add('hidden');
      }
    });
    document.getElementById('adminLoginForm').addEventListener('submit', handleAdminLogin);
    loadOpenAIKey();
  }

  async function handleAdminLogin(e) {
    e.preventDefault();
    const btn = document.getElementById('adminLoginBtn');
    const err = document.getElementById('adminLoginError');
    btn.disabled = true; btn.querySelector('span').textContent = 'Signing in...';
    try {
      await auth.signInWithEmailAndPassword(
        document.getElementById('adminEmail').value,
        document.getElementById('adminPassword').value
      );
    } catch(ex) {
      err.textContent = 'Invalid admin credentials.';
      btn.disabled = false; btn.querySelector('span').textContent = 'Sign In to Admin';
    }
  }

  function logout() { if (auth) auth.signOut(); }

  function showDashboard() {
    document.getElementById('adminLoginScreen').classList.add('hidden');
    document.getElementById('adminDashboard').classList.remove('hidden');
    const user = auth && auth.currentUser;
    if (user) {
      const nameEl = document.getElementById('adminUserName');
      if (nameEl) nameEl.textContent = user.email;
    }
  }

  // ── Data Loading ─────────────────────────────────────────────────
  async function loadOrders() {
    try {
      allOrders = await fsList('orders');
      allOrders.sort((a, b) => getTs(b.createdAt) - getTs(a.createdAt));
      renderStats();
      renderRecentOrders();
      renderAllOrdersTable(allOrders);
      renderFilteredOrders('pending', 'adminPendingOrders');
      renderFilteredOrders('processing', 'adminProcessingOrders');
      const pending = allOrders.filter(o => o.status === 'pending').length;
      const badge = document.getElementById('pendingBadge');
      if (badge) badge.textContent = pending;
    } catch(e) {
      console.error('loadOrders error:', e);
      const el = document.getElementById('adminRecentOrders');
      if (el) el.innerHTML = `<div style="padding:20px;color:#f44336;font-size:0.85rem">⚠️ Error loading orders: ${e.message || 'Permission denied — check Firestore rules.'}</div>`;
    }
  }

  async function loadCustomers() {
    try {
      allCustomers = await fsList('users');
      allCustomers.sort((a, b) => getTs(b.createdAt) - getTs(a.createdAt));
      renderCustomers();
    } catch(e) { console.error('loadCustomers:', e); }
  }

  function refreshOrders() { loadOrders(); loadCustomers(); }

  // ── Render ───────────────────────────────────────────────────────
  function renderStats() {
    document.getElementById('aStatTotal').textContent = allOrders.length;
    document.getElementById('aStatPending').textContent = allOrders.filter(o => o.status === 'pending').length;
    document.getElementById('aStatProcessing').textContent = allOrders.filter(o => o.status === 'processing').length;
    document.getElementById('aStatCompleted').textContent = allOrders.filter(o => o.status === 'completed').length;
    document.getElementById('aStatRejected').textContent = allOrders.filter(o => o.status === 'rejected').length;
  }

  function renderRecentOrders() {
    document.getElementById('adminRecentOrders').innerHTML = buildTable(allOrders.slice(0, 10));
  }

  function renderAllOrdersTable(orders) {
    document.getElementById('adminAllOrders').innerHTML = buildTable(orders);
  }

  function renderFilteredOrders(status, elId) {
    const el = document.getElementById(elId);
    if (!el) return;
    const filtered = allOrders.filter(o => o.status === status);
    el.innerHTML = filtered.length ? buildTable(filtered) : `<div class="empty-state" style="padding:40px;text-align:center;color:#555"><p>No ${status} orders.</p></div>`;
  }

  function renderCustomers() {
    const el = document.getElementById('adminCustomers');
    if (!allCustomers.length) {
      el.innerHTML = `<div class="empty-state" style="padding:40px;text-align:center;color:#555"><p>No customers yet.</p></div>`;
      return;
    }
    el.innerHTML = `<table class="admin-table"><thead><tr>
      <th>Name</th><th>Email</th><th>Phone</th><th>Orders</th><th>Joined</th>
    </tr></thead><tbody>${allCustomers.map(c => {
      const orders = allOrders.filter(o => o.userId === c.id).length;
      return `<tr><td style="color:#fff;font-weight:500">${c.firstName || ''} ${c.lastName || ''}</td>
        <td>${c.email || '—'}</td><td>${c.phone || '—'}</td>
        <td><span class="badge badge-processing">${orders}</span></td>
        <td>${formatDate(c.createdAt)}</td></tr>`;
    }).join('')}</tbody></table>`;
  }

  function buildTable(orders) {
    if (!orders.length) return `<div class="empty-state" style="padding:40px;text-align:center;color:#555"><p>No orders found.</p></div>`;
    return `<table class="admin-table"><thead><tr>
      <th>Order ID</th><th>Customer</th><th>Vehicle</th><th>Service</th><th>Status</th><th>Price</th><th>Date</th><th>Actions</th>
    </tr></thead><tbody>${orders.map(o => {
      const aiTag = o.aiProcessed ? '<span style="color:#ce93d8;margin-left:4px" title="AI Processed">🤖</span>' : '';
      return `<tr onclick="AdminApp.openOrder('${o.id}')">
        <td style="font-family:monospace;font-size:0.78rem;color:#666">#${o.id.slice(-8).toUpperCase()}</td>
        <td style="color:#e5e5e5">${o.userName || o.userEmail || '—'}</td>
        <td>${o.vehicle || '—'} <span style="color:#555;font-size:0.78rem">${o.reg || ''}</span></td>
        <td>${o.service || '—'}${aiTag}</td>
        <td><span class="badge badge-${o.status || 'pending'}">${o.status || 'pending'}</span></td>
        <td style="color:#4caf50">${o.price ? '£' + o.price : '<span style="color:#555">—</span>'}</td>
        <td style="color:#666">${formatDate(o.createdAt)}</td>
        <td onclick="event.stopPropagation()">
          <div class="admin-actions">
            <button class="action-btn" onclick="AdminApp.openOrder('${o.id}')">View</button>
            ${o.status !== 'completed' ? `<button class="action-btn success" onclick="AdminApp.quickStatus('${o.id}','processing')">Process</button>` : ''}
            ${o.status === 'processing' ? `<button class="action-btn success" onclick="AdminApp.openOrder('${o.id}')">Complete</button>` : ''}
          </div>
        </td>
      </tr>`;
    }).join('')}</tbody></table>`;
  }

  function filterTable() {
    const q = (document.getElementById('adminSearch').value || '').toLowerCase();
    const f = document.getElementById('adminStatusFilter').value;
    const filtered = allOrders.filter(o => {
      const matchQ = !q || (o.userName || '').toLowerCase().includes(q) || (o.userEmail || '').toLowerCase().includes(q)
        || (o.vehicle || '').toLowerCase().includes(q) || (o.reg || '').toLowerCase().includes(q) || (o.service || '').toLowerCase().includes(q);
      const matchF = f === 'all' || o.status === f;
      return matchQ && matchF;
    });
    renderAllOrdersTable(filtered);
  }

  function showView(view, e) {
    if (e) e.preventDefault();
    document.querySelectorAll('.admin-view').forEach(v => v.classList.add('hidden'));
    document.querySelectorAll('.admin-nav-link').forEach(l => l.classList.remove('active'));
    const el = document.getElementById('view-' + view);
    if (el) el.classList.remove('hidden');
    const link = document.querySelector(`[data-view="${view}"]`);
    if (link) link.classList.add('active');
  }

  // ── Order Detail Modal ─────────────────────────────────────────
  async function openOrder(id) {
    const order = allOrders.find(o => o.id === id);
    if (!order) return;
    const modal = document.getElementById('adminModal');
    const content = document.getElementById('adminModalContent');
    let aiSection = '';
    if (order.aiReport && order.aiReport.length) {
      aiSection = `<div class="ai-result-card"><div class="ai-result-header"><span>🤖</span><h4>AI Processing Report</h4></div>
        ${order.aiReport.map(r => `<div class="ai-result-item ${r.warn ? 'warn' : ''}">${r.text}</div>`).join('')}</div>`;
    }
    content.innerHTML = `
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:20px;gap:12px">
        <div>
          <h3 style="color:#fff;margin:0 0 4px;font-size:1.2rem">${order.service}</h3>
          <div style="font-family:monospace;font-size:0.78rem;color:#666">#${id.slice(-8).toUpperCase()} · ${formatDateTime(order.createdAt)}</div>
        </div>
        <span class="badge badge-${order.status || 'pending'}" style="font-size:0.82rem;padding:5px 12px;flex-shrink:0">${order.status}</span>
      </div>
      <div class="admin-section">
        <h3>Customer & Vehicle</h3>
        <div class="modal-detail-row"><span class="modal-detail-label">Customer</span><span class="modal-detail-value">${order.userName || '—'}</span></div>
        <div class="modal-detail-row"><span class="modal-detail-label">Email</span><span class="modal-detail-value"><a href="mailto:${order.userEmail}" style="color:#2196f3">${order.userEmail || '—'}</a></span></div>
        <div class="modal-detail-row"><span class="modal-detail-label">Phone</span><span class="modal-detail-value">${order.userPhone || '—'}</span></div>
        <div class="modal-detail-row"><span class="modal-detail-label">Vehicle</span><span class="modal-detail-value">${order.vehicle || '—'}</span></div>
        <div class="modal-detail-row"><span class="modal-detail-label">Registration</span><span class="modal-detail-value">${order.reg || '—'}</span></div>
        <div class="modal-detail-row"><span class="modal-detail-label">Engine</span><span class="modal-detail-value">${order.engine || '—'}</span></div>
        <div class="modal-detail-row"><span class="modal-detail-label">ECU Type</span><span class="modal-detail-value">${order.ecuType || 'Unknown'}</span></div>
        ${order.notes ? `<div class="modal-detail-row"><span class="modal-detail-label">Notes</span><span class="modal-detail-value">${order.notes}</span></div>` : ''}
      </div>
      ${order.originalFileUrl ? `<div class="admin-section">
        <h3>Original ECU File</h3>
        <div style="display:flex;align-items:center;justify-content:space-between">
          <span style="color:#aaa;font-size:0.85rem">📁 ${order.originalFileName || 'ECU File'}</span>
          <a href="${order.originalFileUrl}" target="_blank" class="download-btn" style="font-size:0.82rem;padding:7px 14px">⬇ Download Original</a>
        </div>
      </div>` : ''}
      ${(() => {
        if (!order.originalFileUrl) return '';
        if (order.ecuReport) {
          let report = null;
          try { report = JSON.parse(order.ecuReport); } catch(e) {}
          return `<div class="admin-section">
            <h3>🤖 ECU Analysis <span style="font-size:0.72rem;font-weight:400;color:#4caf50;margin-left:8px">✓ Identified</span></h3>
            ${report ? renderECUReport(report, id) : '<div style="color:#f44336;font-size:0.83rem">Could not parse report — try re-analysing.</div>'}
          </div>`;
        }
        return `<div class="admin-section">
          <h3>🤖 ECU Analysis</h3>
          <p style="color:#666;font-size:0.82rem;margin:0 0 14px">AI will analyse the uploaded ECU binary — detecting platform, software version, checksum type, and service compatibility.</p>
          <button class="btn-blue-sm" id="analyseBtn" onclick="AdminApp.analyseECU('${id}')">🤖 Analyse ECU File</button>
          <div id="analyseStatus" style="display:none;margin-top:10px;font-size:0.82rem;color:#888;line-height:1.5"></div>
        </div>`;
      })()}
      ${aiSection}
      <div class="admin-section">
        <h3>Update Order</h3>
        <div class="admin-form-group"><label>Status</label>
          <select id="modalStatus">
            <option value="pending" ${order.status==='pending'?'selected':''}>Pending</option>
            <option value="processing" ${order.status==='processing'?'selected':''}>Processing</option>
            <option value="completed" ${order.status==='completed'?'selected':''}>Completed</option>
            <option value="rejected" ${order.status==='rejected'?'selected':''}>Rejected</option>
          </select>
        </div>
        <div class="admin-form-group"><label>Price (£)</label>
          <input type="number" id="modalPrice" value="${order.price || ''}" placeholder="e.g. 75">
        </div>
        <div class="admin-form-group"><label>Technician Notes (visible to customer)</label>
          <textarea id="modalNotes" rows="2">${order.adminNotes || ''}</textarea>
        </div>
        <button class="btn-blue-sm" onclick="AdminApp.saveOrderUpdate('${id}')">Save Changes</button>
        <div id="saveMsg" class="info-msg" style="display:none"></div>
      </div>
      <div class="admin-section">
        <h3>Upload Modified File</h3>
        <p style="color:#666;font-size:0.82rem;margin:0 0 12px">Upload the processed ECU file — it will be made available in the customer's portal immediately.</p>
        ${order.modifiedFileUrl ? `<div style="margin-bottom:12px;font-size:0.85rem;color:#4caf50">✅ Modified file already uploaded. <a href="${order.modifiedFileUrl}" target="_blank" style="color:#2196f3">Download it</a></div>` : ''}
        <div class="admin-upload-zone" id="adminUploadZone" onclick="document.getElementById('adminModifiedFile').click()">
          <div style="font-size:0.9rem;color:#888">📁 Click to upload modified ECU file</div>
          <div style="font-size:0.75rem;color:#555;margin-top:4px">.bin .ori .hex .kp .tun</div>
          <input type="file" id="adminModifiedFile" accept=".bin,.ori,.hex,.kp,.tun,.damos,.rom" style="display:none" onchange="AdminApp.uploadModifiedFile('${id}',this)">
        </div>
        <div id="uploadProgress" style="display:none;margin-top:8px">
          <div style="background:#1a1a1a;border-radius:4px;height:6px;overflow:hidden">
            <div id="uploadBar" style="height:100%;background:#2196f3;width:0%;transition:width 0.3s"></div>
          </div>
          <div id="uploadMsg" class="info-msg" style="margin-top:6px"></div>
        </div>
      </div>`;
    modal.classList.remove('hidden');
  }

  async function saveOrderUpdate(id) {
    const status = document.getElementById('modalStatus').value;
    const price = document.getElementById('modalPrice').value;
    const notes = document.getElementById('modalNotes').value;
    const msg = document.getElementById('saveMsg');
    try {
      const update = { status, adminNotes: notes };
      if (price) update.price = parseFloat(price);
      if (status === 'completed') update.completedAt = new Date();
      await fsUpdate('orders', id, update);
      const idx = allOrders.findIndex(o => o.id === id);
      if (idx >= 0) allOrders[idx] = { ...allOrders[idx], ...update };
      msg.textContent = '✅ Order updated successfully!';
      msg.className = 'success-msg';
      msg.style.display = 'block';
      renderStats();
      renderRecentOrders();
      setTimeout(() => { msg.style.display = 'none'; }, 3000);
    } catch(e) {
      msg.textContent = '❌ Error saving. Try again.';
      msg.className = 'info-msg';
      msg.style.display = 'block';
    }
  }

  async function uploadModifiedFile(orderId, input) {
    const file = input.files[0];
    if (!file) return;
    const progress = document.getElementById('uploadProgress');
    const bar = document.getElementById('uploadBar');
    const msg = document.getElementById('uploadMsg');
    progress.style.display = 'block';
    msg.textContent = 'Uploading...';
    try {
      const order = allOrders.find(o => o.id === orderId);
      const path = `orders/${order.userId}/modified_${Date.now()}_${file.name}`;
      const ref = storage.ref(path);
      const task = ref.put(file);
      task.on('state_changed', snap => {
        const pct = (snap.bytesTransferred / snap.totalBytes * 100).toFixed(0);
        bar.style.width = pct + '%';
        msg.textContent = `Uploading... ${pct}%`;
      });
      await task;
      const url = await ref.getDownloadURL();
      await fsUpdate('orders', orderId, { modifiedFileUrl: url, modifiedFileName: file.name, status: 'completed', completedAt: new Date() });
      const idx = allOrders.findIndex(o => o.id === orderId);
      if (idx >= 0) allOrders[idx] = { ...allOrders[idx], modifiedFileUrl: url, status: 'completed' };
      bar.style.width = '100%';
      bar.style.background = '#4caf50';
      msg.textContent = '✅ File uploaded! Customer can now download it.';
      msg.className = 'success-msg';
      renderStats();
    } catch(e) {
      console.error('Upload error:', e);
      msg.textContent = '❌ Upload failed. Try again.';
      msg.className = 'info-msg';
    }
  }

  async function quickStatus(id, status) {
    try {
      await fsUpdate('orders', id, { status });
      const idx = allOrders.findIndex(o => o.id === id);
      if (idx >= 0) allOrders[idx].status = status;
      renderStats(); renderRecentOrders(); renderAllOrdersTable(allOrders);
      renderFilteredOrders('pending', 'adminPendingOrders');
    } catch(e) { console.error('quickStatus error:', e); }
  }

  function closeModal(e) {
    if (!e || e.target === document.getElementById('adminModal') || e.currentTarget?.classList?.contains('modal-close')) {
      document.getElementById('adminModal').classList.add('hidden');
    }
  }

  // ── OpenAI / ECU Analysis ──────────────────────────────────────────
  async function loadOpenAIKey() {
    try {
      const res = await fetch(`${fsBase()}/settings/openai`);
      if (!res.ok) return;
      const doc = await res.json();
      if (doc.fields && doc.fields.apiKey) openAIKey = fsValToJs(doc.fields.apiKey);
    } catch(e) { console.warn('OpenAI key not loaded:', e); }
  }

  function renderECUReport(report, orderId) {
    const riskColor = { low: '#4caf50', medium: '#ff9800', high: '#f44336' }[report.riskLevel] || '#888';
    const confColor = report.confidence >= 80 ? '#4caf50' : report.confidence >= 60 ? '#ff9800' : '#f44336';
    const warnings = Array.isArray(report.warnings) ? report.warnings : [];
    return `
      <div style="background:#111;border:1px solid #2a2a2a;border-radius:10px;padding:16px;margin-top:4px">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:14px;gap:12px">
          <div>
            <div style="font-size:1.1rem;font-weight:700;color:#fff;letter-spacing:0.3px">${report.manufacturer || '—'} ${report.platform || ''}</div>
            ${report.hardwareNumber && report.hardwareNumber !== 'Unknown' ? `<div style="font-size:0.75rem;color:#555;margin-top:2px;font-family:monospace">HW: ${report.hardwareNumber}</div>` : ''}
            <div style="font-size:0.78rem;color:#666;margin-top:4px">${report.vehicleCompatibility || ''}</div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-size:1.3rem;font-weight:700;color:${confColor}">${report.confidence || '?'}%</div>
            <div style="font-size:0.68rem;color:#444;text-transform:uppercase;letter-spacing:0.5px">confidence</div>
            ${report.confidenceReason ? `<div style="font-size:0.7rem;color:#555;margin-top:3px;max-width:160px;text-align:right;line-height:1.3">${report.confidenceReason}</div>` : ''}
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
          <div style="background:#0d0d0d;border-radius:6px;padding:10px">
            <div style="font-size:0.65rem;color:#555;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Software Version</div>
            <div style="font-size:0.82rem;color:#e5e5e5;word-break:break-all;font-family:monospace">${report.softwareVersion || 'Unknown'}</div>
          </div>
          <div style="background:#0d0d0d;border-radius:6px;padding:10px">
            <div style="font-size:0.65rem;color:#555;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Cal Version</div>
            <div style="font-size:0.82rem;color:#e5e5e5;font-family:monospace">${report.calVersion || 'Unknown'}</div>
          </div>
          <div style="background:#0d0d0d;border-radius:6px;padding:10px">
            <div style="font-size:0.65rem;color:#555;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Risk Level</div>
            <div style="font-size:0.88rem;font-weight:600;color:${riskColor}">${(report.riskLevel || 'unknown').toUpperCase()}</div>
          </div>
          <div style="background:#0d0d0d;border-radius:6px;padding:10px">
            <div style="font-size:0.65rem;color:#555;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Checksum</div>
            <div style="font-size:0.78rem;color:#e5e5e5">${report.checksum || 'Unknown'}</div>
          </div>
        </div>
        <div style="background:#0a1a0a;border:1px solid #1a3a1a;border-radius:6px;padding:10px;margin-bottom:10px">
          <div style="font-size:0.65rem;color:#4caf50;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Service Assessment</div>
          <div style="font-size:0.83rem;color:#c8e6c9;line-height:1.5">${report.serviceCompatibility || '—'}</div>
        </div>
        ${report.adminNotes ? `<div style="background:#1a1500;border:1px solid #3a2f00;border-radius:6px;padding:10px;margin-bottom:10px"><div style="font-size:0.65rem;color:#ffc107;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">⚙️ Technician Notes</div><div style="font-size:0.83rem;color:#ffe082;line-height:1.5">${report.adminNotes}</div></div>` : ''}
        ${warnings.length ? `<div style="background:#1a0000;border:1px solid #3a0000;border-radius:6px;padding:10px;margin-bottom:10px">${warnings.map(w => `<div style="font-size:0.82rem;color:#ef9a9a;padding:3px 0;line-height:1.4">⚠️ ${w}</div>`).join('')}</div>` : ''}
        ${report.additionalInfo ? `<div style="font-size:0.78rem;color:#555;margin-bottom:12px;line-height:1.6;border-top:1px solid #1a1a1a;padding-top:10px">${report.additionalInfo}</div>` : ''}
        <button class="btn-blue-sm" onclick="AdminApp.analyseECU('${orderId}')" style="margin-top:4px;opacity:0.7;font-size:0.75rem">🔄 Re-analyse</button>
      </div>`;
  }

  async function analyseECU(orderId) {
    if (!openAIKey) { alert('OpenAI API key not found in settings. Contact support.'); return; }
    const order = allOrders.find(o => o.id === orderId);
    if (!order || !order.originalFileUrl) { alert('No ECU file attached to this order.'); return; }

    const btn = document.getElementById('analyseBtn');
    const statusEl = document.getElementById('analyseStatus');
    const setStatus = (msg, color) => {
      if (statusEl) { statusEl.style.display = 'block'; statusEl.style.color = color || '#888'; statusEl.innerHTML = msg; }
    };
    if (btn) { btn.disabled = true; btn.textContent = '🔄 Analysing...'; }
    setStatus('⬇️ Downloading ECU binary file...');

    try {
      const dlUrl = order.originalFileUrl + (order.originalFileUrl.includes('?') ? '&' : '?') + '_nc=' + Date.now();
      const response = await fetch(dlUrl);
      if (!response.ok) throw new Error(`Could not download ECU file (HTTP ${response.status}). Check Storage permissions.`);
      const buffer = await response.arrayBuffer();
      const bytes = new Uint8Array(buffer);

      const fileSizeBytes = bytes.length;
      const fileSizeKB = (fileSizeBytes / 1024).toFixed(1);
      const fileSizeMB = (fileSizeBytes / 1048576).toFixed(3);
      setStatus(`📦 File downloaded: ${fileSizeKB} KB. Scanning full binary for ECU signatures...`);

      // ── 1. FULL FILE STRING EXTRACTION ─────────────────────────────────────
      const allStrings = [];
      let cur = '';
      for (let i = 0; i < bytes.length; i++) {
        const c = bytes[i];
        if (c >= 32 && c <= 126) { cur += String.fromCharCode(c); }
        else { if (cur.length >= 5) allStrings.push(cur); cur = ''; }
      }
      if (cur.length >= 5) allStrings.push(cur);
      const uniqueStrings = [...new Set(allStrings)].filter(s => /[a-zA-Z0-9]/.test(s) && s.length <= 100);

      // ── 2. ECU KEYWORD DETECTION ────────────────────────────────────────────
      const ecuKeywords = [
        'BOSCH','EDC15','EDC16','EDC17','ME7','ME9','ME17','ME18','MED9','MED17','MD1','MG1',
        'SIMOS','SID','SID205','SID305','SID307','PCR2','EMS31','SIM2K','SIM28','SIM29',
        'DELPHI','DCM3','DCM6','MT80','MT86','MT92',
        'SIEMENS','CONTINENTAL','CONTI',
        'DENSO','MARELLI','MAGNETI','HITACHI',
        'TRICORE','TC1766','TC1796','TC1797','TC1798',
        'DME','DDE','ECM','PCM','TCU',
        'VAG','VOLKSWAGEN','AUDI','BMW','FORD','VAUXHALL','OPEL','RENAULT','PEUGEOT','CITROEN','MERCEDES'
      ];
      const textContent = uniqueStrings.join(' ').toUpperCase();
      const foundKeywords = ecuKeywords.filter(kw => textContent.includes(kw));

      // ── 3. HIGH-VALUE STRING CLASSIFICATION ────────────────────────────────
      const partNumbers = uniqueStrings.filter(s => /^\d{7,12}$/.test(s.trim()));
      const versionStrings = uniqueStrings.filter(s => /\b\d+\.\d+/.test(s) && s.length < 40);
      const swHwStrings = uniqueStrings.filter(s => /sw|hw|cal|par|prg|nr\b/i.test(s) && s.length < 60);
      const alphaCodes = uniqueStrings.filter(s => s.length >= 6 && s.length <= 22 && /[A-Z]/.test(s) && /\d/.test(s));

      const highValueStrings = [...new Set([
        ...partNumbers.slice(0, 25),
        ...versionStrings.slice(0, 25),
        ...swHwStrings.slice(0, 20),
        ...alphaCodes.slice(0, 40)
      ])].slice(0, 100);

      // ── 4. HEX SAMPLING (8 windows across full file) ───────────────────────
      const toHexLine = arr => Array.from(arr).map(b => b.toString(16).padStart(2,'0')).join('');
      const hexSamples = [];
      const numWindows = 8, windowSize = 64;
      for (let w = 0; w < numWindows; w++) {
        const pct = numWindows > 1 ? w / (numWindows - 1) : 0;
        const offset = Math.min(Math.floor(pct * (fileSizeBytes - windowSize)), fileSizeBytes - windowSize);
        hexSamples.push(`[0x${offset.toString(16).toUpperCase().padStart(6,'0')}] ${toHexLine(bytes.slice(offset, offset + windowSize))}`);
      }

      setStatus(`🔍 Found ${uniqueStrings.length} strings, ${foundKeywords.length} keyword(s): <b style="color:#fff">${foundKeywords.join(', ') || 'none yet'}</b>. Sending to GPT-4o...`);

      // ── 5. BUILD AI PROMPT ──────────────────────────────────────────────────
      const prompt = `You are a world-class automotive ECU binary analyst. Identify the ECU platform from the binary evidence below as precisely as possible.

Supported platforms: Bosch (EDC15/16/17, ME7/ME9/ME17/ME18, MED9/MED17, MD1/MG1), Siemens/Continental (SID205/305/307, PCR2.1, EMS3132), Delphi (DCM3.5/6.1/6.2, MT80/86/92), Simos (6/7/8/10/18/19), Denso, Magneti Marelli, Hitachi, Mitsubishi, and all others.

FILE METADATA:
Size: ${fileSizeBytes} bytes (${fileSizeKB} KB / ${fileSizeMB} MB)
Known ECU sizes: 128KB=131072 | 256KB=262144 | 512KB=524288 | 1MB=1048576 | 2MB=2097152 | 4MB=4194304
Requested service: ${order.service}
Vehicle (customer stated): ${order.vehicle || 'Unknown'}
Engine (customer stated): ${order.engine || 'Unknown'}
ECU type (customer stated): ${order.ecuType || 'Not specified'}
Reg plate: ${order.reg || 'Unknown'}

ECU KEYWORDS DETECTED IN BINARY:
${foundKeywords.length > 0 ? foundKeywords.join(', ') : 'None matched'}

HIGH-VALUE STRINGS (part numbers / version refs / SW-HW codes):
${highValueStrings.join('\n') || 'None'}

ALL ASCII STRINGS FROM FULL FILE SCAN:
${uniqueStrings.slice(0, 200).join('\n') || 'None'}

HEX SAMPLES (8 windows across full file, 64 bytes each):
${hexSamples.join('\n')}

TASK: Cross-reference file size + keywords + part numbers + version strings + hex patterns.
If customer stated an ECU type, validate it against the binary evidence.
Be specific — e.g. "EDC17C10" not just "EDC17". Explain confidence level briefly.

Respond with valid JSON only (no markdown):
{
  "manufacturer": "e.g. Bosch",
  "platform": "e.g. EDC17C10",
  "hardwareNumber": "e.g. 0 281 015 xxx or Unknown",
  "softwareVersion": "e.g. 1037395048 or Unknown",
  "calVersion": "calibration version if found, or Unknown",
  "vehicleCompatibility": "e.g. VW/Audi 2.0 TDI 140bhp 2008-2012 (CBEA/CJAA)",
  "confidence": 92,
  "confidenceReason": "brief reason e.g. EDC17C10 string at 0x1200 + 512KB matches known size",
  "serviceCompatibility": "Specific: is ${order.service} supported/safe on this ECU? Note any tool or protocol requirements.",
  "riskLevel": "low",
  "checksum": "e.g. Bosch CRC32 at last 4 bytes of each block, or Unknown",
  "adminNotes": "Specific actionable notes for the technician performing this service",
  "warnings": [],
  "additionalInfo": "Other useful technical details: quirks, required tools, OBD protocol, etc."
}`;

      const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openAIKey}` },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: 'You are an expert automotive ECU binary analyst. Respond with valid JSON only, no markdown.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.1,
          max_tokens: 1400,
          response_format: { type: 'json_object' }
        })
      });

      if (!aiRes.ok) {
        const errText = await aiRes.text();
        throw new Error(`OpenAI error ${aiRes.status}: ${errText.slice(0, 300)}`);
      }

      const aiData = await aiRes.json();
      const rawText = (aiData.choices[0].message.content || '').trim();
      let report;
      try {
        const match = rawText.match(/\{[\s\S]*\}/);
        report = JSON.parse(match ? match[0] : rawText);
      } catch(pe) { throw new Error('AI returned malformed JSON — try re-analysing'); }

      await fsUpdate('orders', orderId, {
        ecuReport: JSON.stringify(report),
        ecuDetected: `${report.manufacturer || ''} ${report.platform || ''}`.trim(),
        ecuConfidence: report.confidence || 0,
        ecuAnalysedAt: new Date().toISOString(),
        ecuFoundKeywords: foundKeywords.join(', '),
        ecuFileSize: fileSizeBytes,
        ecuStringsFound: uniqueStrings.length
      });

      const idx = allOrders.findIndex(o => o.id === orderId);
      if (idx >= 0) Object.assign(allOrders[idx], {
        ecuReport: JSON.stringify(report),
        ecuDetected: `${report.manufacturer || ''} ${report.platform || ''}`.trim(),
        ecuConfidence: report.confidence || 0,
        ecuFoundKeywords: foundKeywords.join(', ')
      });

      openOrder(orderId);

    } catch(err) {
      console.error('ECU analysis error:', err);
      setStatus(`❌ ${err.message}`, '#f44336');
      if (btn) { btn.disabled = false; btn.textContent = '🤖 Analyse ECU File'; }
    }
  }



  return { init, logout, showView, openOrder, closeModal, saveOrderUpdate, uploadModifiedFile, quickStatus, filterTable, refreshOrders, analyseECU };
})();

document.addEventListener('DOMContentLoaded', () => AdminApp.init());
