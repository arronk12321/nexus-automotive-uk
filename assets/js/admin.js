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
            <div style="margin-top:14px;padding-top:14px;border-top:1px solid #222">
              ${order.tuneResult === 'auto_applied' ? `<div style="background:#0a2a0a;border:1px solid #2e7d32;border-radius:8px;padding:12px;margin-bottom:10px;font-size:0.82rem">
                <div style="color:#4caf50;font-weight:600;margin-bottom:4px">✅ Tune Applied — ${order.tunePatchCount || 0} patch(es)</div>
                <div style="color:#888">${order.tuneNotes || ''}</div>
                ${order.tuneChecksumRequired ? '<div style="color:#ff9800;margin-top:6px">⚠️ Checksum recalculation recommended before flashing</div>' : ''}
              </div>` : order.tuneResult === 'manual_required' ? `<div style="background:#2a1a0a;border:1px solid #e65100;border-radius:8px;padding:12px;margin-bottom:10px;font-size:0.82rem">
                <div style="color:#ff9800;font-weight:600;margin-bottom:4px">⚠️ Manual Tune Required</div>
                <div style="color:#888">${order.tuneNotes || 'AI could not identify exact offsets — manual tuning needed'}</div>
              </div>` : ''}
              <button class="btn-blue-sm" id="applyTuneBtn" onclick="AdminApp.applyTune('${id}')" style="background:linear-gradient(135deg,#1a6634,#0d4f28);font-size:0.83rem">
                ⚙️ ${order.tuneResult === 'auto_applied' ? 'Re-Apply Tune' : 'Apply Tune & Send to Customer'}
              </button>
              <button class="btn-blue-sm" onclick="AdminApp.analyseECU('${id}')" style="margin-left:8px;opacity:0.7;font-size:0.75rem">🔄 Re-analyse</button>
              <div id="tuneStatus" style="display:none;margin-top:10px;font-size:0.82rem;color:#888;line-height:1.6"></div>
            </div>
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




  // ── Apply Tune ─────────────────────────────────────────────────────
  async function applyTune(orderId) {
    const order = allOrders.find(o => o.id === orderId);
    if (!order) return;
    if (!order.originalFileUrl) { alert('No ECU file attached to this order.'); return; }

    const btn = document.getElementById('applyTuneBtn');
    const statusEl = document.getElementById('tuneStatus');
    const setStatus = (msg, color) => {
      if (statusEl) { statusEl.style.display = 'block'; statusEl.style.color = color || '#aaa'; statusEl.innerHTML = msg; }
    };
    if (btn) { btn.disabled = true; btn.textContent = '⚙️ Processing...'; }

    try {
      setStatus('⬇️ Downloading original ECU binary...');
      const dlUrl = order.originalFileUrl + (order.originalFileUrl.includes('?') ? '&' : '?') + '_nc=' + Date.now();
      const dlRes = await fetch(dlUrl);
      if (!dlRes.ok) throw new Error(`Download failed: HTTP ${dlRes.status}`);
      const buffer = await dlRes.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const fileSize = bytes.length;

      setStatus(`📦 ${(fileSize / 1024).toFixed(1)} KB downloaded. Detecting ECU platform...`);

      // ── Step 1: Detect ECU type from binary ─────────────────────
      const ecuInfo = detectECUFromBinary(bytes, fileSize);
      setStatus(`🔍 Platform: <b>${ecuInfo.platform}</b> (${ecuInfo.confidence}% confidence) — Part: ${ecuInfo.part || 'n/a'}<br>Applying <b>${order.service}</b>...`);

      // ── Step 2: Apply deterministic modification ─────────────────
      const modified = new Uint8Array(buffer.byteLength);
      modified.set(bytes);
      const result = applyDeterministicMod(modified, ecuInfo, order.service, fileSize);

      if (result.cannotApply) {
        await fsUpdate('orders', orderId, {
          tuneAttemptedAt: new Date().toISOString(),
          tuneResult: 'manual_required',
          tuneNotes: result.reason,
          status: 'processing'
        });
        const idx = allOrders.findIndex(o => o.id === orderId);
        if (idx >= 0) Object.assign(allOrders[idx], { tuneResult: 'manual_required', tuneNotes: result.reason });
        setStatus(`⚠️ Cannot auto-apply: <b style="color:#fff">${result.reason}</b><br>Order flagged for manual processing.`, '#ff9800');
        if (btn) { btn.disabled = false; btn.textContent = '⚙️ Retry'; }
        return;
      }

      // ── Step 3: Upload modified file ─────────────────────────────
      setStatus(`📤 Uploading modified file (${result.patchCount} region(s) modified)...`);
      const origName = order.originalFileName || 'ecu.bin';
      const safeService = (order.service || 'MOD').replace(/[^a-zA-Z0-9]/g, '_');
      const modName = `NEXUS_${safeService}_${origName}`;
      const storageBucket = 'nexus-automotive-uk.firebasestorage.app';
      const storagePath = `processed-files/${order.userId || 'admin'}/modified_${Date.now()}_${modName}`;
      const encodedPath = encodeURIComponent(storagePath);
      const uploadUrl = `https://firebasestorage.googleapis.com/v0/b/${storageBucket}/o/${encodedPath}`;

      // Get admin ID token for authenticated Storage upload
      let uploadHeaders = { 'Content-Type': 'application/octet-stream' };
      if (auth && auth.currentUser) {
        try {
          const idToken = await auth.currentUser.getIdToken(true);
          uploadHeaders['Authorization'] = `Bearer ${idToken}`;
        } catch(e) { console.warn('Could not get ID token:', e); }
      }

      const uploadRes = await fetch(uploadUrl, {
        method: 'POST',
        headers: uploadHeaders,
        body: modified
      });
      if (!uploadRes.ok) {
        const errText = await uploadRes.text();
        throw new Error(`Storage upload failed (${uploadRes.status}): ${errText.slice(0, 200)}`);
      }
      const uploadData = await uploadRes.json();
      const token = uploadData.downloadTokens;
      const modifiedFileUrl = `https://firebasestorage.googleapis.com/v0/b/${storageBucket}/o/${encodedPath}?alt=media&token=${token}`;

      // ── Step 4: Save to Firestore ────────────────────────────────
      await fsUpdate('orders', orderId, {
        modifiedFileUrl,
        modifiedFileName: modName,
        status: 'completed',
        completedAt: new Date().toISOString(),
        tuneAppliedAt: new Date().toISOString(),
        tuneResult: 'auto_applied',
        tunePatchCount: result.patchCount,
        tuneNotes: result.technicalNotes || '',
        tuneChecksumRequired: result.checksumRequired || false,
        tunePatchLog: (result.patches || []).join('\n'),
        tuneSafetyLevel: 'deterministic'
      });

      const idx = allOrders.findIndex(o => o.id === orderId);
      if (idx >= 0) Object.assign(allOrders[idx], {
        modifiedFileUrl, modifiedFileName: modName, status: 'completed',
        tuneResult: 'auto_applied', tunePatchCount: result.patchCount,
        tuneNotes: result.technicalNotes || '',
        tuneChecksumRequired: result.checksumRequired || false
      });

      let doneMsg = `✅ Done! ${result.patchCount} map(s) modified — customer can now download from their portal.`;
      if (result.checksumRequired) {
        doneMsg += `<br>⚠️ <b>Checksum recalculation required</b> before flashing. Use WinOLS or ECUFlash.`;
      }
      if (result.manualRequired && result.manualRequired.length > 0) {
        doneMsg += `<br>📋 <b>${result.manualRequired.length} service(s) queued for manual processing</b> — see technician notes.`;
      }
      setStatus(doneMsg, '#4caf50');
      if (btn) btn.textContent = '✅ Tune Applied';
      renderStats();
      setTimeout(() => openOrder(orderId), 1200);

    } catch (err) {
      console.error('applyTune error:', err);
      setStatus(`❌ ${err.message}`, '#f44336');
      if (btn) { btn.disabled = false; btn.textContent = '⚙️ Apply Tune & Send to Customer'; }
    }
  }

  // ══════════════════════════════════════════════════════════════════
  //  ECU DETECTION ENGINE
  // ══════════════════════════════════════════════════════════════════
  function detectECUFromBinary(bytes, fileSize) {
    // Build ASCII string from entire file (fast scan)
    let ascii = '';
    const scanLen = Math.min(fileSize, 2097152);
    for (let i = 0; i < scanLen; i++) {
      const c = bytes[i];
      ascii += (c >= 32 && c < 127) ? String.fromCharCode(c) : ' ';
    }

    // SIMOS PCR2.1 — VW/Audi 1.6 TDI, 2.0 TDI (e.g. CAY, CAYC, CAYA, CBDA, CFHC)
    if (/CASM2P20|CASMPCR2|PCR2\.1|PCR\.2/i.test(ascii)) {
      const partMatch = ascii.match(/\b(\d{2}[A-Z]\d{6}[A-Z]{2})\b/);
      const swMatch = ascii.match(/\b(\d{10})\b/);
      return { platform: 'SIMOS_PCR2', part: partMatch ? partMatch[1] : '', sw: swMatch ? swMatch[1] : '', confidence: 95 };
    }
    // SIMOS 18 / SIMOS 19 — newer VW/Audi platforms
    if (/SIMOS18|SIMOS19|CASM18|CASM19/i.test(ascii)) {
      return { platform: 'SIMOS18', part: '', confidence: 85 };
    }
    // Bosch EDC17 — very common (Golf, Passat, A4, etc.)
    if (/EDC17[A-Z]\d{1,2}\b/i.test(ascii)) {
      const m = ascii.match(/EDC17[A-Z]\d{1,2}/i);
      return { platform: 'EDC17', part: m ? m[0].toUpperCase() : 'EDC17', confidence: 90 };
    }
    // Continental SID 8xx — PSA, Ford
    if (/SID80[2-9]\b|SID20[56]\b/i.test(ascii)) {
      return { platform: 'SID_CONTINENTAL', part: '', confidence: 82 };
    }
    // Delphi DCM — Renault, Nissan, Ford
    if (/DCM3\.|DCM6\.|DCM7\./i.test(ascii)) {
      return { platform: 'DELPHI_DCM', part: '', confidence: 80 };
    }
    // Marelli MJD — Fiat, Alfa
    if (/MJD6\.|MJD8\.|MARELLI/i.test(ascii)) {
      return { platform: 'MARELLI_MJD', part: '', confidence: 80 };
    }
    return { platform: 'UNKNOWN', part: '', confidence: 0 };
  }

  // ══════════════════════════════════════════════════════════════════
  //  DETERMINISTIC MODIFICATION ENGINE
  // ══════════════════════════════════════════════════════════════════
  function applyDeterministicMod(bytes, ecuInfo, service, fileSize) {
    // Support comma-separated multi-service (e.g. "EGR Delete, Swirl Flap Delete")
    const services = (service || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

    let allPatches     = [];
    let totalPatches   = 0;
    let checksumNeeded = false;
    let manualNeeded   = [];

    for (const svc of services) {
      let res;

      if (ecuInfo.platform === 'SIMOS_PCR2') {
        if (svc.includes('egr'))                             res = simosEGRDelete(bytes, fileSize);
        else if (svc.includes('swirl'))                      res = simosSwirFlapDelete(bytes, fileSize);
        else if (svc.includes('speed'))                      res = simosSpeedLimiterRemoval(bytes, fileSize);
        else if (svc.includes('dpf'))                        res = simosDPFDelete(bytes, fileSize);
        else if (svc.includes('adblue') || svc.includes('scr')) res = { cannotApply: true, reason: 'AdBlue/SCR Delete — variant-specific SCR catalyst maps required. Queued for manual.' };
        else if (svc.includes('stage') || svc.includes('remap')) res = simosStage1Tune(bytes, fileSize);
        else if (svc.includes('start') || svc.includes('stop')) res = { cannotApply: true, reason: 'Start/Stop Disable — requires manual calibration.' };
        else if (svc.includes('pops') || svc.includes('bang'))  res = { cannotApply: true, reason: 'Pops & Bangs — requires manual exhaust timing calibration.' };
        else res = { cannotApply: true, reason: `No auto-apply strategy for "${svc}" on SIMOS PCR2.1.` };

      } else if (ecuInfo.platform === 'EDC17') {
        if (svc.includes('egr')) res = edcEGRDelete(bytes, fileSize);
        else res = { cannotApply: true, reason: `"${svc}" auto-apply not yet supported for Bosch EDC17 — manual required.` };

      } else {
        res = { cannotApply: true, reason: `ECU platform "${ecuInfo.platform}" (${ecuInfo.confidence}% confidence) — no auto-modification strategy. Process manually with WinOLS.` };
      }

      if (res.cannotApply) {
        manualNeeded.push(res.reason);
      } else {
        allPatches     = allPatches.concat(res.patches || []);
        totalPatches  += res.patchCount || 0;
        checksumNeeded = checksumNeeded || !!res.checksumRequired;
      }
    }

    // Nothing auto-applied at all
    if (allPatches.length === 0) {
      return { cannotApply: true, reason: manualNeeded.join('\n') };
    }

    // At least some services auto-applied (partial or full success)
    const notes = allPatches.join('\n')
      + (manualNeeded.length ? `\n\n⚠️ Queued for manual processing:\n${manualNeeded.map(r => '• ' + r).join('\n')}` : '');

    return {
      cannotApply:   false,
      patchCount:    totalPatches,
      patches:       allPatches,
      checksumRequired: checksumNeeded,
      manualRequired:   manualNeeded,   // partial-success info
      technicalNotes:   notes
    };
  }

  // ── Utility: byte pattern search ───────────────────────────────
  function findBytes(bytes, pattern, start, end) {
    const lim = Math.min(end, bytes.length - pattern.length);
    outer: for (let i = start; i < lim; i++) {
      for (let j = 0; j < pattern.length; j++) {
        if (pattern[j] !== null && bytes[i + j] !== pattern[j]) continue outer;
      }
      return i;
    }
    return -1;
  }

  // ══════════════════════════════════════════════════════════════════
  //  SIMOS PCR2.1 — EGR DELETE
  //  Targets: EGR valve desired position map (KFEGRVLD equivalent)
  //  Method: Find CASM2P20 cal header → search for EGR map signature
  //          → zero entire map region (values 0–1023 LE16)
  // ══════════════════════════════════════════════════════════════════
  function simosEGRDelete(bytes, fileSize) {
    // 1. Locate calibration base via CASM2P signature
    const CASM = [0x43,0x41,0x53,0x4D,0x32,0x50]; // "CASM2P"
    const casmOff = findBytes(bytes, CASM, 0, fileSize);
    if (casmOff < 0) return { cannotApply: true, reason: 'CASM2P20 calibration signature not found — is this a full-flash backup?' };
    const calBase = Math.max(0, casmOff - 0x10);

    // 2. Search for EGR map signature:
    //    24 consecutive zero bytes immediately followed by 0x66 0x00 (= 102 LE16 = ~10% EGR)
    //    This is the characteristic pattern where the zero-EGR rows transition to low-EGR rows.
    const EGR_SIG = [
      0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
      0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
      0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
      0x66,0x00
    ];
    const searchEnd = Math.min(calBase + 0xC000, fileSize - 130);
    const sigOff = findBytes(bytes, EGR_SIG, calBase, searchEnd);
    if (sigOff < 0) return { cannotApply: true, reason: 'EGR valve position map not located — binary may use a different calibration layout. Manual processing required.' };

    // 3. Determine map extent: scan forward from signature while values stay ≤ 1023
    let mapEnd = sigOff;
    while (mapEnd + 1 < fileSize) {
      const v = bytes[mapEnd] | (bytes[mapEnd + 1] << 8);
      if (v > 1023) break;
      mapEnd += 2;
    }
    const mapSize = mapEnd - sigOff;

    // Sanity check: expect between 56 and 300 bytes for a realistic EGR position map
    if (mapSize < 56 || mapSize > 300) {
      return { cannotApply: true, reason: `EGR map size (${mapSize} bytes) outside expected bounds — verify binary is a full-flash image` };
    }

    // 4. Zero the entire EGR valve position map
    const cellCount = Math.floor(mapSize / 2);
    for (let i = sigOff; i < mapEnd; i++) bytes[i] = 0x00;

    return {
      cannotApply: false,
      patchCount: 1,
      patches: [
        `✅ EGR valve position map zeroed @ 0x${sigOff.toString(16).toUpperCase()} → 0x${(mapEnd - 1).toString(16).toUpperCase()} (${mapSize} bytes / ${cellCount} cells → all set to 0%)`
      ],
      checksumRequired: true,
      technicalNotes: `SIMOS PCR2.1 EGR Delete — ${cellCount} EGR valve position cells set to 0%. EGR valve will stay closed in all conditions. Checksum recalculation required before flashing (use WinOLS or ECMTitanium).`
    };
  }

  // ══════════════════════════════════════════════════════════════════
  //  SIMOS PCR2.1 — SWIRL FLAP DELETE
  //  Targets: Swirl flap target position map (KFDKL / KFSWIRL equiv)
  //  Method: Unique axis-end signature (0xFF7F + RPM axis) → scan map
  //          → zero all position cells (no actuation = open/deleted)
  //  Validated: 2MB VW 1.6 TDI CAY bench flash (1 unique signature hit)
  // ══════════════════════════════════════════════════════════════════
  function simosSwirFlapDelete(bytes, fileSize) {
    // Signature: 0x7FFF (axis sentinel) followed by 4 specific RPM axis values
    // uniquely identifies the swirl flap position map in this calibration family
    const SWIRL_SIG = [
      0xFF,0x7F,                    // 0x7FFF — axis end sentinel
      0x4E,0x0C, 0x8C,0x0A,        // RPM axis: 3150, 2700
      0xCA,0x08, 0xCA,0x08,        // RPM axis: 2250, 2250
      0xCA,0x08, 0xCA,0x08         // RPM axis: 2250, 2250
    ];
    const casm = bytes.indexOf ? -1 : -1; // unused — use findBytes below
    const CASM = [0x43,0x41,0x53,0x4D,0x32,0x50];
    const casmOff = findBytes(bytes, CASM, 0, fileSize);
    if (casmOff < 0) return { cannotApply: true, reason: 'CASM2P signature not found — is this a full-flash backup?' };
    const calBase = Math.max(0, casmOff - 0x10);

    const sigOff = findBytes(bytes, SWIRL_SIG, calBase, Math.min(calBase + 0x20000, fileSize));
    if (sigOff < 0) return { cannotApply: true, reason: 'Swirl flap position map not located — binary may be a different calibration variant. Manual processing required.' };

    // Map starts immediately after the 14-byte signature
    const mapStart = sigOff + SWIRL_SIG.length;

    // Scan forward while LE16 values ≤ 1023 (10-bit position range)
    let mapEnd = mapStart;
    while (mapEnd + 1 < fileSize) {
      const v = bytes[mapEnd] | (bytes[mapEnd + 1] << 8);
      if (v > 1023) break;
      mapEnd += 2;
    }
    const mapSize = mapEnd - mapStart;
    if (mapSize < 16 || mapSize > 256) {
      return { cannotApply: true, reason: `Swirl flap map size (${mapSize} bytes) outside expected bounds — verify binary.` };
    }

    const cellCount = Math.floor(mapSize / 2);
    for (let i = mapStart; i < mapEnd; i++) bytes[i] = 0x00;

    return {
      cannotApply: false,
      patchCount: 1,
      patches: [
        `✅ Swirl flap position map zeroed @ 0x${mapStart.toString(16).toUpperCase()} → 0x${(mapEnd-1).toString(16).toUpperCase()} (${mapSize} bytes / ${cellCount} cells → all set to 0% — flaps disabled/open)`
      ],
      checksumRequired: true,
      technicalNotes: `SIMOS PCR2.1 Swirl Flap Delete — ${cellCount} position cells set to 0%. Flap motor will not actuate. Physical removal of flap paddles recommended. Checksum recalculation required before flashing.`
    };
  }

  // ══════════════════════════════════════════════════════════════════
  //  SIMOS PCR2.1 — SPEED LIMITER REMOVAL
  //  Targets: VMAX scalar (250 km/h stored as LE16 0x00FA)
  //  Method: Unique surrounding parameter signature → patch single word
  //  Validated: 2MB VW 1.6 TDI CAY bench flash (1 unique signature hit)
  // ══════════════════════════════════════════════════════════════════
  function simosSpeedLimiterRemoval(bytes, fileSize) {
    const CASM = [0x43,0x41,0x53,0x4D,0x32,0x50];
    const casmOff = findBytes(bytes, CASM, 0, fileSize);
    if (casmOff < 0) return { cannotApply: true, reason: 'CASM2P signature not found.' };
    const calBase = Math.max(0, casmOff - 0x10);

    // Unique 12-byte signature: [0x0708 (1800), 0x07D0 (2000), 0x00FA (250 km/h), 0x0000, 0x0064 (100), 0x0000]
    // The 0x00FA at offset +4 within this pattern is the VMax scalar
    const SPD_SIG = [
      0x08,0x07,   // 1800
      0xD0,0x07,   // 2000
      0xFA,0x00,   // 250 km/h ← TARGET
      0x00,0x00,
      0x64,0x00,   // 100
      0x00,0x00
    ];
    const sigOff = findBytes(bytes, SPD_SIG, calBase, Math.min(calBase + 0x10000, fileSize));
    if (sigOff < 0) return { cannotApply: true, reason: 'Speed limit scalar (VMax 250 km/h) not located — binary may be a different calibration variant. Manual processing required.' };

    // Patch 0x00FA → 0xFF7F (32767 km/h — effective no limit)
    const limitOff = sigOff + 4;
    const origVal = bytes[limitOff] | (bytes[limitOff + 1] << 8);
    bytes[limitOff]     = 0xFF;
    bytes[limitOff + 1] = 0x7F;

    return {
      cannotApply: false,
      patchCount: 1,
      patches: [
        `✅ VMax scalar patched @ 0x${limitOff.toString(16).toUpperCase()}: ${origVal} km/h (0x${origVal.toString(16).toUpperCase()}) → 32767 km/h (0x7FFF) — speed limiter removed`
      ],
      checksumRequired: true,
      technicalNotes: `SIMOS PCR2.1 Speed Limiter Removal — VMax patched from ${origVal} km/h to 32767 km/h. Vehicle will no longer be electronically limited. Checksum recalculation required before flashing.`
    };
  }

  // ══════════════════════════════════════════════════════════════════
  //  SIMOS PCR2.1 — DPF DELETE
  //  Method: 2-stage — soot mass → 0, diff pressure → 0
  //  Both sigs are unique (1 hit each). With both regen triggers at zero
  //  the ECU will never initiate DPF regeneration. Industry-standard approach.
  // ══════════════════════════════════════════════════════════════════
  function simosDPFDelete(bytes, fileSize) {
    const patches = [];
    let totalCells = 0;

    // ─── 1. SOOT MASS THRESHOLD MAP ────────────────────────────────
    // Unique sig: 6 × 0x80A4 immediately before 80 cells of soot data (6–65 g)
    const SOOT_SIG = [];
    for (let i = 0; i < 6; i++) { SOOT_SIG.push(0xA4, 0x80); } // 6 × 0x80A4 LE

    const sootSigOff = findBytes(bytes, SOOT_SIG, 0, fileSize);
    if (sootSigOff >= 0) {
      const sootDataOff = sootSigOff + 12; // 6 × 2 bytes = 12
      // Verify: 80 cells, all in 0–100 range
      let valid = true;
      for (let i = 0; i < 80; i++) {
        const v = bytes[sootDataOff + i*2] | (bytes[sootDataOff + i*2 + 1] << 8);
        if (v > 100) { valid = false; break; }
      }
      if (valid) {
        for (let i = 0; i < 80; i++) {
          bytes[sootDataOff + i*2]     = 0;
          bytes[sootDataOff + i*2 + 1] = 0;
        }
        totalCells += 80;
        patches.push(`✅ DPF soot mass map @ 0x${sootDataOff.toString(16).toUpperCase()}: 80 cells zeroed (ECU reads 0g soot — never triggers regen)`);
      } else {
        patches.push('⚠️ Soot mass signature found but values out of expected range — skipped for safety');
      }
    } else {
      patches.push('⚠️ DPF soot mass signature (6×0x80A4) not found');
    }

    // ─── 2. DPF DIFFERENTIAL PRESSURE MAP ──────────────────────────
    // Unique sig: [1000,1000,1000,1500,1500,1250,1000,2000] (loading limits header)
    // Diff pressure data starts 36 bytes (18 words) after sig
    const PRESS_SIG = [];
    for (const v of [1000,1000,1000,1500,1500,1250,1000,2000]) {
      PRESS_SIG.push(v & 0xFF, (v >> 8) & 0xFF);
    }

    const pressSigOff = findBytes(bytes, PRESS_SIG, 0, fileSize);
    if (pressSigOff >= 0) {
      const pressDataOff = pressSigOff + 36; // 18 words of loading limits before diff pressure data
      // Verify: 80 cells in 0–200 range
      let valid = true, pressCount = 0;
      for (let i = 0; i < 80; i++) {
        const v = bytes[pressDataOff + i*2] | (bytes[pressDataOff + i*2 + 1] << 8);
        if (v > 200) { valid = false; break; }
        pressCount++;
      }
      if (valid && pressCount === 80) {
        for (let i = 0; i < 80; i++) {
          bytes[pressDataOff + i*2]     = 0;
          bytes[pressDataOff + i*2 + 1] = 0;
        }
        totalCells += 80;
        patches.push(`✅ DPF differential pressure map @ 0x${pressDataOff.toString(16).toUpperCase()}: 80 cells zeroed (ECU sees 0 mbar — thinks DPF is clean)`);
      } else {
        patches.push('⚠️ Diff pressure signature found but data validation failed — skipped');
      }
    } else {
      patches.push('⚠️ DPF differential pressure signature not found');
    }

    // NOTE: Stage 3 (regen temperature) was removed — the original sig (4×0x08CA + 8×0x0266)
    // was a false positive matching the swirl flap position map at 0x184590.
    // 2-stage DPF Delete (soot=0 + pressure=0) is the industry-standard approach:
    // with both regen trigger conditions eliminated, the ECU will never initiate regen.

    if (totalCells === 0) {
      return { cannotApply: true, reason: 'DPF Delete — no DPF maps could be located. File may not contain a DPF calibration. Queued for manual review.' };
    }

    return {
      cannotApply: false,
      patchCount: totalCells,
      patches,
      checksumRequired: true,
      technicalNotes: `SIMOS PCR2.1 DPF Delete — 2-stage: soot mass zeroed (no loading detected), differential pressure zeroed (no blockage detected). With both regen triggers at zero the ECU will never initiate regeneration. Total ${totalCells} cells modified. Physical DPF must be removed before flashing. Checksum recalculation required.`
    };
  }

  // ══════════════════════════════════════════════════════════════════
  //  SIMOS PCR2.1 — STAGE 1 TUNE
  //  Method: 1) Boost map +12% (cap 2200 mbar)
  //          2) Torque limiter 250 → 310 Nm
  //          3) Fuelling handled by ECU torque model (safe)
  // ══════════════════════════════════════════════════════════════════
  function simosStage1Tune(bytes, fileSize) {
    const patches = [];

    // ─── 1. BOOST MAP ───────────────────────────────────────────────
    const CASM = [0x43,0x41,0x53,0x4D,0x32,0x50]; // "CASM2P"
    const casmOff = findBytes(bytes, CASM, 0, fileSize);
    if (casmOff < 0) return { cannotApply: true, reason: 'CASM2P calibration header not found — cannot locate maps.' };
    const calBase = Math.max(0, casmOff - 0x10);

    // Find boost map: 80 contiguous uint16 in 950-2200, with >1500 peak AND ≥5 unique values
    // (rejects flat atmospheric reference blocks like 80×1024)
    let boostMapOff = -1;
    for (let off = calBase; off < Math.min(calBase + 0x60000, fileSize - 160); off += 2) {
      let ok = true, hasHigh = false;
      const seen = new Set();
      for (let i = 0; i < 80; i++) {
        const v = bytes[off + i*2] | (bytes[off + i*2 + 1] << 8);
        if (v < 950 || v > 2200) { ok = false; break; }
        if (v > 1500) hasHigh = true;
        seen.add(v);
      }
      if (ok && hasHigh && seen.size >= 5) { boostMapOff = off; break; }
    }
    if (boostMapOff < 0) return { cannotApply: true, reason: 'Boost map not located in calibration area.' };

    // Patch even rows (0,2,4,6,8) of 10×8 map: +12%, cap 2200 mbar
    let boostCells = 0;
    for (let r = 0; r < 10; r += 2) {
      for (let c = 0; c < 8; c++) {
        const idx = boostMapOff + (r * 8 + c) * 2;
        const v = bytes[idx] | (bytes[idx + 1] << 8);
        if (v > 1000 && v <= 2100) {
          const nv = Math.min(Math.round(v * 1.12), 2200);
          bytes[idx]     = nv & 0xFF;
          bytes[idx + 1] = (nv >> 8) & 0xFF;
          boostCells++;
        }
      }
    }
    if (boostCells > 0) {
      patches.push(`✅ Boost map @ 0x${boostMapOff.toString(16).toUpperCase()}: ${boostCells} cells raised by 12% (capped at 2200 mbar)`);
    }

    // ─── 2. TORQUE LIMITER ──────────────────────────────────────────
    // Unique sig: 6×0x8001 + 8×0x0000, then 32×250 (0x00FA)
    const TORQ_SIG = [];
    for (let i = 0; i < 6; i++) { TORQ_SIG.push(0x01, 0x80); } // 6 × 0x8001
    for (let i = 0; i < 8; i++) { TORQ_SIG.push(0x00, 0x00); } // 8 × 0x0000
    for (let i = 0; i < 4; i++) { TORQ_SIG.push(0xFA, 0x00); } // 4 × 250

    const torqSigOff = findBytes(bytes, TORQ_SIG, 0, fileSize);
    if (torqSigOff < 0) return { cannotApply: false, patchCount: boostCells, patches: patches.concat(['⚠️ Torque limiter signature not found — boost raised but torque limit unchanged. Manual torque adjustment recommended.']), checksumRequired: true, technicalNotes: 'Partial Stage 1: boost raised but torque limiter not found.' };

    // Torque data starts after 6×8001 + 8×0000 = 12+16 = 28 bytes
    const torqDataOff = torqSigOff + 28;

    // Verify all 32 values are 250
    let all250 = true;
    for (let i = 0; i < 32; i++) {
      const v = bytes[torqDataOff + i*2] | (bytes[torqDataOff + i*2 + 1] << 8);
      if (v !== 250) { all250 = false; break; }
    }
    if (!all250) {
      patches.push('⚠️ Torque limiter found but values not stock (250 Nm) — skipped for safety. Manual review needed.');
      return { cannotApply: false, patchCount: boostCells, patches, checksumRequired: true, technicalNotes: 'Partial Stage 1: boost raised, torque limiter not stock.' };
    }

    // Patch 32 × 250 → 32 × 310 Nm (0x0136)
    const NEW_TORQUE = 310;
    for (let i = 0; i < 32; i++) {
      bytes[torqDataOff + i*2]     = NEW_TORQUE & 0xFF;
      bytes[torqDataOff + i*2 + 1] = (NEW_TORQUE >> 8) & 0xFF;
    }
    patches.push(`✅ Torque limiter @ 0x${torqDataOff.toString(16).toUpperCase()}: 32 cells raised from 250 Nm → ${NEW_TORQUE} Nm`);

    return {
      cannotApply: false,
      patchCount: boostCells + 32,
      patches,
      checksumRequired: true,
      technicalNotes: `SIMOS PCR2.1 Stage 1 Tune — Boost increased +12% (cap 2200 mbar, ${boostCells} cells), torque limiter raised 250→${NEW_TORQUE} Nm (32 cells). ECU torque model auto-adjusts fuelling. Expected: ~130 HP / ${NEW_TORQUE} Nm. Checksum recalculation required before flashing.`
    };
  }

  // ══════════════════════════════════════════════════════════════════
  //  BOSCH EDC17 — EGR DELETE
  //  Method: Find EDC17 calibration region, locate EGR duty cycle map
  // ══════════════════════════════════════════════════════════════════
  function edcEGRDelete(bytes, fileSize) {
    // EDC17 uses a different calibration structure
    // EGR maps are typically 16×16 or 8×8 with values 0-100 (percent) or 0-255 (duty cycle)
    // Signature: search for a block of values 0-200 preceded by RPM axis pattern
    // For now, flag as manual — EDC17 has many sub-variants requiring specific strategies
    return {
      cannotApply: true,
      reason: 'Bosch EDC17 EGR Delete requires variant-specific calibration — manual processing with WinOLS recommended'
    };
  }


  return { init, logout, showView, openOrder, closeModal, saveOrderUpdate, uploadModifiedFile, quickStatus, filterTable, refreshOrders, analyseECU, applyTune };
})();

document.addEventListener('DOMContentLoaded', () => AdminApp.init());
