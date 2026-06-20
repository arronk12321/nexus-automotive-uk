/* ================================================================
   NEXUS AUTOMOTIVE UK — ADMIN PORTAL JS
   Full order management, file upload/return, status updates
   ================================================================ */

const AdminApp = (() => {
  let db, auth, storage;
  let allOrders = [];
  let allCustomers = [];
  const ADMIN_EMAILS = ['admin@nexusautomotive.co.uk', 'nexusautomotiveuk@gmail.com'];

  function init() {
    if (!window.NEXUS_FB_CONFIG || window.NEXUS_FB_CONFIG.apiKey === 'YOUR_API_KEY') {
      document.getElementById('adminLoginScreen').innerHTML = `
        <div class="auth-card"><div class="auth-logo"><span class="logo-n">N</span>EXUS</div>
        <h2 class="auth-title" style="color:#ffc107">Firebase Not Configured</h2>
        <p style="color:#888;text-align:center;font-size:0.85rem">Please set up Firebase first — see <a href="portal.html" style="color:#2196f3">portal.html</a> for instructions.</p></div>`;
      return;
    }
    if (!firebase.apps.length) firebase.initializeApp(window.NEXUS_FB_CONFIG);
    auth = firebase.auth();
    db = firebase.firestore();
    storage = firebase.storage();
    auth.onAuthStateChanged(user => {
      if (user) { showDashboard(); loadOrders(); loadCustomers(); }
      else { document.getElementById('adminLoginScreen').classList.remove('hidden'); document.getElementById('adminDashboard').classList.add('hidden'); }
    });
    document.getElementById('adminLoginForm').addEventListener('submit', handleAdminLogin);
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
  }

  async function loadOrders() {
    try {
      const snap = await db.collection('orders').orderBy('createdAt', 'desc').get();
      allOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderStats();
      renderRecentOrders();
      renderAllOrdersTable(allOrders);
      renderFilteredOrders('pending', 'adminPendingOrders');
      renderFilteredOrders('processing', 'adminProcessingOrders');
      const pending = allOrders.filter(o => o.status === 'pending').length;
      document.getElementById('pendingBadge').textContent = pending;
    } catch(e) { console.error('loadOrders error:', e); }
  }

  async function loadCustomers() {
    try {
      const snap = await db.collection('users').orderBy('createdAt', 'desc').get();
      allCustomers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderCustomers();
    } catch(e) { console.error('loadCustomers:', e); }
  }

  function refreshOrders() { loadOrders(); loadCustomers(); }

  function renderStats() {
    document.getElementById('aStatTotal').textContent = allOrders.length;
    document.getElementById('aStatPending').textContent = allOrders.filter(o => o.status === 'pending').length;
    document.getElementById('aStatProcessing').textContent = allOrders.filter(o => o.status === 'processing').length;
    document.getElementById('aStatCompleted').textContent = allOrders.filter(o => o.status === 'completed').length;
    document.getElementById('aStatRejected').textContent = allOrders.filter(o => o.status === 'rejected').length;
  }

  function renderRecentOrders() {
    const el = document.getElementById('adminRecentOrders');
    el.innerHTML = buildTable(allOrders.slice(0, 10));
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
    if (!allCustomers.length) { el.innerHTML = `<div class="empty-state" style="padding:40px;text-align:center;color:#555"><p>No customers yet.</p></div>`; return; }
    el.innerHTML = `<table class="admin-table"><thead><tr>
      <th>Name</th><th>Email</th><th>Phone</th><th>Orders</th><th>Joined</th>
    </tr></thead><tbody>${allCustomers.map(c => {
      const orders = allOrders.filter(o => o.userId === c.id).length;
      const joined = c.createdAt ? new Date(c.createdAt.seconds * 1000).toLocaleDateString('en-GB') : '—';
      return `<tr><td style="color:#fff;font-weight:500">${c.firstName || ''} ${c.lastName || ''}</td>
        <td>${c.email || '—'}</td><td>${c.phone || '—'}</td>
        <td><span class="badge badge-processing">${orders}</span></td><td>${joined}</td></tr>`;
    }).join('')}</tbody></table>`;
  }

  function buildTable(orders) {
    if (!orders.length) return `<div class="empty-state" style="padding:40px;text-align:center;color:#555"><p>No orders found.</p></div>`;
    return `<table class="admin-table"><thead><tr>
      <th>Order ID</th><th>Customer</th><th>Vehicle</th><th>Service</th><th>Status</th><th>Price</th><th>Date</th><th>Actions</th>
    </tr></thead><tbody>${orders.map(o => {
      const date = o.createdAt ? new Date(o.createdAt.seconds * 1000).toLocaleDateString('en-GB') : '—';
      const aiTag = o.aiProcessed ? '<span style="color:#ce93d8;margin-left:4px" title="AI Processed">🤖</span>' : '';
      return `<tr onclick="AdminApp.openOrder('${o.id}')">
        <td style="font-family:monospace;font-size:0.78rem;color:#666">#${o.id.slice(-8).toUpperCase()}</td>
        <td style="color:#e5e5e5">${o.userName || o.userEmail || '—'}</td>
        <td>${o.vehicle || '—'} <span style="color:#555;font-size:0.78rem">${o.reg || ''}</span></td>
        <td>${o.service || '—'}${aiTag}</td>
        <td><span class="badge badge-${o.status || 'pending'}">${o.status || 'pending'}</span></td>
        <td style="color:#4caf50">${o.price ? '£' + o.price : '<span style="color:#555">—</span>'}</td>
        <td style="color:#666">${date}</td>
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
      const matchQ = !q || (o.userName || '').toLowerCase().includes(q) || (o.userEmail || '').toLowerCase().includes(q) || (o.vehicle || '').toLowerCase().includes(q) || (o.reg || '').toLowerCase().includes(q) || (o.service || '').toLowerCase().includes(q);
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
    const date = order.createdAt ? new Date(order.createdAt.seconds * 1000).toLocaleString('en-GB') : '—';
    let aiSection = '';
    if (order.aiReport && order.aiReport.length) {
      aiSection = `<div class="ai-result-card"><div class="ai-result-header"><span>🤖</span><h4>AI Processing Report</h4></div>
        ${order.aiReport.map(r => `<div class="ai-result-item ${r.warn ? 'warn' : ''}">${r.text}</div>`).join('')}</div>`;
    }
    content.innerHTML = `
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:20px;gap:12px">
        <div>
          <h3 style="color:#fff;margin:0 0 4px;font-size:1.2rem">${order.service}</h3>
          <div style="font-family:monospace;font-size:0.78rem;color:#666">#${id.slice(-8).toUpperCase()} · ${date}</div>
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
      if (status === 'completed') update.completedAt = firebase.firestore.FieldValue.serverTimestamp();
      await db.collection('orders').doc(id).update(update);
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
      await db.collection('orders').doc(orderId).update({ modifiedFileUrl: url, modifiedFileName: file.name, status: 'completed', completedAt: firebase.firestore.FieldValue.serverTimestamp() });
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
      await db.collection('orders').doc(id).update({ status });
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

  return { init, logout, showView, openOrder, closeModal, saveOrderUpdate, uploadModifiedFile, quickStatus, filterTable, refreshOrders };
})();

document.addEventListener('DOMContentLoaded', () => AdminApp.init());
