/* ================================================================
   NEXUS AUTOMOTIVE UK — MAIN APPLICATION LOGIC
   ================================================================ */

'use strict';

// ── Constants ────────────────────────────────────────────────────
const ADMIN_PASSWORD = 'nexus2024';
const WHATSAPP_NUMBER = '447700000000'; // Replace with real number

const SERVICES = [
  { id: 'stage1',    icon: 'fa-tachometer-alt', name: 'Stage 1 Remapping',       price: 'From £65', chips: ['+20–40 BHP','+30–80 Nm','Improved MPG'],    offRoad: false,
    desc: 'Optimise fuel injection, boost pressure, ignition timing, and torque limiters for maximum power and efficiency gains — no hardware changes required.' },
  { id: 'egr',       icon: 'fa-wind',           name: 'EGR Delete',               price: 'From £45', chips: ['Cleaner Intake','Better Response','Prevents EGR Failure'], offRoad: false,
    desc: 'Disable the Exhaust Gas Recirculation system in software to eliminate intake carbon build-up, prevent clogging, and restore sharp throttle response.' },
  { id: 'dpf',       icon: 'fa-filter',         name: 'DPF Delete',               price: 'From £65', chips: ['No Regen Cycles','No DPF Failures','Off-Road Use'], offRoad: true,
    desc: 'Remove all Diesel Particulate Filter regeneration cycles and monitoring from the ECU. Eliminates costly DPF blockages and failures. Motorsport/off-road only.' },
  { id: 'adblue',    icon: 'fa-tint-slash',     name: 'AdBlue Delete',            price: 'From £75', chips: ['SCR System Off','No AdBlue Faults','No Warning Lights'], offRoad: true,
    desc: 'Disable SCR (Selective Catalytic Reduction) and AdBlue injection systems at ECU level. Eliminates AdBlue faults, sensor warnings and costly SCR failures.' },
  { id: 'pops',      icon: 'fa-fire',           name: 'Pops & Bangs',             price: 'From £45', chips: ['Throttle-Off Pops','Overrun Burbles','Launch Control'], offRoad: false,
    desc: 'Add dramatic throttle-off fuel pops, overrun burbles, and an aggressive launch control strategy to your ECU map — the ultimate crowd-pleasing enhancement.' },
  { id: 'swirl',     icon: 'fa-dharmachakra',   name: 'Swirl Flap Delete',        price: 'From £35', chips: ['Prevents Engine Damage','Smoother Idle','Vacuum Free'], offRoad: false,
    desc: 'Disable swirl flap motor operation in ECU software to prevent catastrophic mechanical failure. Essential preventive maintenance for high-mileage diesel engines.' },
  { id: 'speed',     icon: 'fa-gauge-high',     name: 'Speed Limiter Removal',    price: 'From £45', chips: ['Vmax Removed','Track Day Ready','Fleet Use'], offRoad: true,
    desc: 'Remove OEM factory speed limiter caps from the ECU. Suitable for track days, private land, and specialist fleet applications only.' },
  { id: 'startstop', icon: 'fa-power-off',      name: 'Start/Stop Disable',       price: 'From £35', chips: ['Permanently Off','Less Starter Wear','No Button Needed'], offRoad: false,
    desc: 'Permanently disable the engine auto Start/Stop system in software — no button required each journey. Significantly reduces starter motor and battery wear.' },
  { id: 'tcu',       icon: 'fa-cogs',           name: 'TCU/DSG Gearbox Tuning',   price: 'From £75', chips: ['Faster Shifts','Higher Torque','Launch Control'], offRoad: false,
    desc: 'Optimise DSG, PDK, DCT, and automatic TCU modules for faster shift speeds, higher torque acceptance, raised rev limits, and improved launch control.' },
  { id: 'immo',      icon: 'fa-key',            name: 'Immo Off / ECU Solutions', price: 'POA',      chips: ['Immo Disabled','ECU Cloning','Virgin ECU Work'], offRoad: false,
    desc: 'Immobiliser disabling, ECU cloning, replacement ECU programming, donor ECU conversion, and Virgin ECU solutions for complex and specialist work.' },
];

// ── State ─────────────────────────────────────────────────────────
const state = {
  selectedService: '',
  uploadedFile: null,
  uploadedFileName: '',
  uploadedFileData: null,
  orders: [],
  view: 'site', // 'site' | 'admin'
  adminFilter: 'all',
  selectedOrder: null,
};

// ── DB ─────────────────────────────────────────────────────────────
const DB_KEY = 'nexus_orders_v2';

function loadOrders() {
  try {
    state.orders = JSON.parse(localStorage.getItem(DB_KEY) || '[]');
  } catch { state.orders = []; }
}

function saveOrders() {
  localStorage.setItem(DB_KEY, JSON.stringify(state.orders));
}

function addOrder(order) {
  order.id = Date.now();
  order.ref = 'NX-' + Date.now().toString(36).toUpperCase().slice(-6);
  order.createdAt = new Date().toISOString();
  order.status = 'pending';
  order.price = '';
  order.notes = '';
  order.modifiedFile = null;
  state.orders.unshift(order);
  saveOrders();
  return order;
}

function updateOrder(id, updates) {
  const idx = state.orders.findIndex(o => o.id === id);
  if (idx !== -1) {
    state.orders[idx] = { ...state.orders[idx], ...updates };
    saveOrders();
    return state.orders[idx];
  }
  return null;
}

// ── Toast ──────────────────────────────────────────────────────────
function toast(msg, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  t.innerHTML = `<span>${icons[type] || 'ℹ️'}</span> ${msg}`;
  container.appendChild(t);
  setTimeout(() => {
    t.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => t.remove(), 300);
  }, 3500);
}

// ── Render Services ────────────────────────────────────────────────
function renderServices() {
  const grid = document.getElementById('services-grid');
  if (!grid) return;
  grid.innerHTML = SERVICES.map(s => `
    <div class="service-card fade-up" data-service="${s.name}" onclick="selectService('${s.name}')">
      <div class="service-icon"><i class="fas ${s.icon}"></i></div>
      <div class="service-name">${s.name}</div>
      <p class="service-desc">${s.desc}</p>
      <div class="service-chips">
        ${s.chips.map(c => `<span class="chip">${c}</span>`).join('')}
        ${s.offRoad ? `<span class="off-road-tag"><i class="fas fa-exclamation-triangle"></i> Off-Road Only</span>` : ''}
      </div>
      <div class="service-footer">
        <span class="service-price">${s.price}</span>
        <span class="service-cta">Order Now <i class="fas fa-arrow-right"></i></span>
      </div>
    </div>
  `).join('');

  // Render sidebar
  const sidebar = document.getElementById('sidebar-services');
  if (sidebar) {
    sidebar.innerHTML = SERVICES.map(s => `
      <div class="sidebar-svc" data-service="${s.name}" onclick="selectService('${s.name}')">
        <i class="fas ${s.icon}"></i>
        <span class="sidebar-svc-name">${s.name}</span>
        <span class="sidebar-svc-price">${s.price}</span>
      </div>
    `).join('');
  }

  initFadeUp();
}

function selectService(name) {
  state.selectedService = name;
  // Update cards
  document.querySelectorAll('.service-card').forEach(el => {
    el.classList.toggle('selected', el.dataset.service === name);
  });
  // Update sidebar
  document.querySelectorAll('.sidebar-svc').forEach(el => {
    el.classList.toggle('active', el.dataset.service === name);
  });
  // Update select input
  const sel = document.getElementById('service-select');
  if (sel) sel.value = name;
  // Scroll to form
  document.getElementById('order')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── File Upload ────────────────────────────────────────────────────
function setupFileUpload() {
  const area = document.getElementById('file-upload-area');
  const input = document.getElementById('ecu-file');
  const info = document.getElementById('file-info');
  const fileName = document.getElementById('file-name');
  const fileSize = document.getElementById('file-size');
  const fileEcu  = document.getElementById('file-ecu-type');

  if (!area || !input) return;

  area.addEventListener('dragover', e => { e.preventDefault(); area.classList.add('drag-over'); });
  area.addEventListener('dragleave', () => area.classList.remove('drag-over'));
  area.addEventListener('drop', e => {
    e.preventDefault();
    area.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  input.addEventListener('change', () => {
    if (input.files[0]) handleFile(input.files[0]);
  });

  function handleFile(file) {
    state.uploadedFileName = file.name;
    const reader = new FileReader();
    reader.onload = (e) => {
      state.uploadedFileData = e.target.result;
      const analysis = ECUProcessor.analyseFile(e.target.result);
      const sizeStr = analysis.sizeKB >= 1024
        ? `${(analysis.sizeKB/1024).toFixed(1)} MB`
        : `${analysis.sizeKB} KB`;

      fileName.textContent = file.name;
      fileSize.textContent = sizeStr;
      fileEcu.textContent = analysis.name;
      info.style.display = 'flex';

      // Auto-detect and show ECU type
      const ecuInput = document.getElementById('ecu-type');
      if (ecuInput && analysis.name !== 'Unknown ECU') {
        ecuInput.value = analysis.name;
        toast(`ECU detected: ${analysis.name} (${sizeStr})`, 'info');
      }
    };
    reader.readAsArrayBuffer(file);
  }
}

// ── Order Form Submit ──────────────────────────────────────────────
function setupOrderForm() {
  const form = document.getElementById('order-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const data = new FormData(form);
    const service = data.get('service') || state.selectedService;
    if (!service) { toast('Please select a service first', 'error'); return; }
    if (!state.uploadedFileData) { toast('Please upload your ECU file', 'error'); return; }

    const order = {
      customerName:  data.get('name'),
      email:         data.get('email'),
      phone:         data.get('phone'),
      make:          data.get('make'),
      model:         data.get('model'),
      year:          data.get('year'),
      engine:        data.get('engine'),
      ecuType:       data.get('ecu_type'),
      registration:  data.get('registration'),
      service:       service,
      notes:         data.get('notes') || '',
      fileName:      state.uploadedFileName,
      fileData:      state.uploadedFileData,
    };

    // Validate required
    const req = ['customerName','email','phone','make','model','year','engine'];
    for (const f of req) {
      if (!order[f]) { toast(`Please fill in all required fields`, 'error'); return; }
    }

    showProcessingModal(order);
  });
}

// ── Processing Modal ───────────────────────────────────────────────
async function showProcessingModal(orderData) {
  const overlay = document.getElementById('processing-modal');
  overlay.classList.add('open');

  const steps = ['step-read', 'step-detect', 'step-analyse', 'step-process', 'step-save'];
  const labels = [
    '📂 Reading ECU file...',
    '🔍 Detecting ECU platform...',
    '🧠 AI analysis running...',
    '⚙️ Applying modification logic...',
    '💾 Saving order...',
  ];

  document.getElementById('proc-title').textContent = 'Processing Your File';
  document.getElementById('proc-text').textContent = 'Our AI is analysing your ECU file and preparing it for modification.';

  const stepsEl = document.getElementById('proc-steps');
  stepsEl.innerHTML = labels.map((l, i) => `
    <div class="prog-step" id="step-${i}">
      <span class="step-icon">⏳</span>
      <span>${l}</span>
    </div>
  `).join('');

  // Animate steps
  for (let i = 0; i < steps.length; i++) {
    await sleep(600 + Math.random() * 400);
    const el = document.getElementById(`step-${i}`);
    if (el) {
      el.classList.add('active');
      el.querySelector('.step-icon').textContent = '🔄';
    }
    await sleep(800 + Math.random() * 600);
    if (el) {
      el.classList.remove('active');
      el.classList.add('done');
      el.querySelector('.step-icon').textContent = '✅';
    }
  }

  // Run AI analysis & apply mod
  const analysis = ECUProcessor.analyseFile(orderData.fileData);
  const { modifiedBuffer, results } = ECUProcessor.applyModification(orderData.fileData, orderData.service, orderData);
  const report = ECUProcessor.generateReport(analysis, orderData.service, orderData);

  // Save order
  orderData.ecuAnalysis = analysis;
  orderData.modReport = report;
  orderData.modResults = results;

  // Store modified file if auto-processed
  const autoProcessed = results.some(r => r.status === 'Applied');
  if (autoProcessed) {
    orderData.modifiedFile = bufferToBase64(modifiedBuffer);
    orderData.status = 'completed';
  }

  const saved = addOrder(orderData);

  await sleep(500);
  overlay.classList.remove('open');
  showResultModal(saved, autoProcessed, analysis, results);
}

function showResultModal(order, autoProcessed, analysis, results) {
  const overlay = document.getElementById('result-modal');
  const box = document.getElementById('result-box');
  overlay.classList.add('open');

  const statusBadge = autoProcessed
    ? `<span class="badge badge-green">✅ Auto-Processed by AI</span>`
    : `<span class="badge badge-yellow">⏳ Queued for Expert Technician</span>`;

  const modRows = results.map(r => `
    <tr>
      <td>${r.mod}</td>
      <td>${r.status}</td>
      <td style="color:var(--grey);font-size:0.78rem">${r.detail || ''}</td>
    </tr>
  `).join('');

  box.innerHTML = `
    <div class="detail-header">
      <div class="detail-title">Order Confirmed ${statusBadge}</div>
      <button class="detail-close" onclick="document.getElementById('result-modal').classList.remove('open')">✕</button>
    </div>
    <div class="detail-body">
      <div class="detail-section">
        <h4>Order Reference</h4>
        <div style="font-size:1.5rem;font-weight:800;color:var(--blue);font-family:monospace;margin-bottom:0.5rem">${order.ref}</div>
        <p style="color:var(--grey);font-size:0.85rem">Save this reference — we'll quote it in all communications.</p>
      </div>

      <div class="detail-section">
        <h4>ECU Detection Results</h4>
        <div class="detail-grid">
          <div class="detail-item"><div class="detail-item-label">ECU Detected</div><div class="detail-item-value">${analysis.name}</div></div>
          <div class="detail-item"><div class="detail-item-label">Platform</div><div class="detail-item-value">${analysis.platform}</div></div>
          <div class="detail-item"><div class="detail-item-label">File Size</div><div class="detail-item-value">${analysis.sizeKB} KB</div></div>
          <div class="detail-item"><div class="detail-item-label">File Health</div><div class="detail-item-value" style="color:${analysis.fileHealth==='Good'?'#4ade80':'#fbbf24'}">${analysis.fileHealth}</div></div>
          <div class="detail-item"><div class="detail-item-label">Checksum</div><div class="detail-item-value" style="color:${analysis.checksumValid?'#4ade80':'#fbbf24'}">${analysis.checksumValid?'Valid':'Re-calc Required'}</div></div>
          <div class="detail-item"><div class="detail-item-label">Map Estimate</div><div class="detail-item-value">${analysis.mapEstimate}</div></div>
        </div>
      </div>

      <div class="detail-section">
        <h4>Modification Log</h4>
        <table class="result-table" style="border-collapse:collapse">
          <thead><tr style="font-size:0.72rem;color:var(--grey)"><th style="padding:0.5rem;text-align:left">Modification</th><th style="padding:0.5rem;text-align:left">Status</th><th style="padding:0.5rem;text-align:left">Detail</th></tr></thead>
          <tbody>${modRows}</tbody>
        </table>
      </div>

      ${autoProcessed ? `
        <div class="detail-section">
          <h4>Download Modified File</h4>
          <p style="color:var(--grey);font-size:0.85rem;margin-bottom:1rem">Your file has been processed. Download below or check your email.</p>
          <button class="file-download-btn" onclick="downloadModifiedFile('${order.id}')">
            <i class="fas fa-download"></i> Download Modified ECU File
          </button>
        </div>
      ` : `
        <div class="detail-section">
          <div class="disclaimer-box">
            <i class="fas fa-info-circle"></i>
            <div>Your file has been queued for our expert technicians. You'll receive your modified file within 2–24 hours to <strong>${order.email}</strong>. Reference: <strong>${order.ref}</strong>.</div>
          </div>
        </div>
      `}

      <div style="display:flex;gap:0.75rem;flex-wrap:wrap;margin-top:1.25rem">
        <a href="https://wa.me/${WHATSAPP_NUMBER}?text=Hi+Nexus+Automotive,+my+order+ref+is+${order.ref}" target="_blank" class="btn btn-green btn-sm">
          <i class="fab fa-whatsapp"></i> Chat on WhatsApp
        </a>
        <button class="btn btn-outline btn-sm" onclick="document.getElementById('result-modal').classList.remove('open')">Close</button>
      </div>
    </div>
  `;
}

function downloadModifiedFile(orderId) {
  const order = state.orders.find(o => o.id == orderId);
  if (!order || !order.modifiedFile) { toast('No modified file available', 'error'); return; }
  const bytes = base64ToUint8Array(order.modifiedFile);
  const blob = new Blob([bytes], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `NEXUS_${order.service.replace(/\W+/g,'_')}_${order.fileName}`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Modified file downloaded!', 'success');
}

// ── Admin Panel ────────────────────────────────────────────────────
function showAdmin() {
  const pw = document.getElementById('admin-password')?.value || prompt('Enter admin password:');
  if (pw !== ADMIN_PASSWORD) { toast('Incorrect password', 'error'); return; }
  document.getElementById('login-overlay').style.display = 'none';
  document.getElementById('site-view').style.display = 'none';
  document.getElementById('admin-view').style.display = 'block';
  state.view = 'admin';
  renderAdmin();
}

function checkAdminLogin() {
  const pw = document.getElementById('admin-password').value;
  if (pw === ADMIN_PASSWORD) {
    document.getElementById('login-overlay').style.display = 'none';
    document.getElementById('site-view').style.display = 'none';
    document.getElementById('admin-view').style.display = 'block';
    state.view = 'admin';
    renderAdmin();
  } else {
    toast('Incorrect password', 'error');
  }
}

function showAdminLogin() {
  document.getElementById('login-overlay').style.display = 'flex';
}

function backToSite() {
  document.getElementById('admin-view').style.display = 'none';
  document.getElementById('login-overlay').style.display = 'none';
  document.getElementById('site-view').style.display = 'block';
  state.view = 'site';
}

function renderAdmin() {
  loadOrders();
  renderAdminStats();
  renderOrdersTable();
}

function renderAdminStats() {
  const counts = { total: state.orders.length, pending: 0, processing: 0, completed: 0, rejected: 0 };
  state.orders.forEach(o => { if (counts[o.status] !== undefined) counts[o.status]++; });
  const el = document.getElementById('admin-stats');
  if (!el) return;
  el.innerHTML = `
    <div class="stat-card"><div class="stat-card-num">${counts.total}</div><div class="stat-card-label">Total Orders</div></div>
    <div class="stat-card"><div class="stat-card-num" style="color:#fbbf24">${counts.pending}</div><div class="stat-card-label">Pending</div></div>
    <div class="stat-card"><div class="stat-card-num" style="color:var(--blue)">${counts.processing}</div><div class="stat-card-label">Processing</div></div>
    <div class="stat-card"><div class="stat-card-num" style="color:#4ade80">${counts.completed}</div><div class="stat-card-label">Completed</div></div>
    <div class="stat-card"><div class="stat-card-num" style="color:#f87171">${counts.rejected}</div><div class="stat-card-label">Rejected</div></div>
  `;
}

function renderOrdersTable() {
  const filter = state.adminFilter;
  const search = document.getElementById('admin-search')?.value?.toLowerCase() || '';
  const filtered = state.orders.filter(o => {
    const matchFilter = filter === 'all' || o.status === filter;
    const matchSearch = !search || [o.ref, o.customerName, o.email, o.make, o.model, o.service]
      .some(v => v?.toLowerCase().includes(search));
    return matchFilter && matchSearch;
  });

  const tbody = document.getElementById('orders-tbody');
  if (!tbody) return;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--grey);padding:3rem">No orders found</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(o => `
    <tr style="cursor:pointer" onclick="openOrderDetail(${o.id})">
      <td><span class="order-ref">${o.ref}</span></td>
      <td>
        <div class="customer-cell">
          <span class="customer-name">${esc(o.customerName)}</span>
          <span class="customer-email">${esc(o.email)}</span>
        </div>
      </td>
      <td>${esc(o.make)} ${esc(o.model)} ${esc(o.year)}</td>
      <td style="font-size:0.82rem">${esc(o.service)}</td>
      <td><span class="badge ${statusBadgeClass(o.status)}">${statusLabel(o.status)}</span></td>
      <td style="font-weight:700">${o.price ? '£'+o.price : '—'}</td>
      <td style="font-size:0.78rem;color:var(--grey)">${formatDate(o.createdAt)}</td>
    </tr>
  `).join('');
}

function openOrderDetail(id) {
  const order = state.orders.find(o => o.id === id);
  if (!order) return;
  state.selectedOrder = order;

  const overlay = document.getElementById('detail-overlay');
  const body = document.getElementById('detail-body');
  overlay.classList.add('open');

  body.innerHTML = `
    <div class="detail-section">
      <h4>Customer</h4>
      <div class="detail-grid">
        <div class="detail-item"><div class="detail-item-label">Name</div><div class="detail-item-value">${esc(order.customerName)}</div></div>
        <div class="detail-item"><div class="detail-item-label">Email</div><div class="detail-item-value">${esc(order.email)}</div></div>
        <div class="detail-item"><div class="detail-item-label">Phone</div><div class="detail-item-value">${esc(order.phone)}</div></div>
        <div class="detail-item"><div class="detail-item-label">Ref</div><div class="detail-item-value" style="font-family:monospace;color:var(--blue)">${esc(order.ref)}</div></div>
      </div>
    </div>
    <div class="detail-section">
      <h4>Vehicle</h4>
      <div class="detail-grid">
        <div class="detail-item"><div class="detail-item-label">Make / Model</div><div class="detail-item-value">${esc(order.make)} ${esc(order.model)}</div></div>
        <div class="detail-item"><div class="detail-item-label">Year</div><div class="detail-item-value">${esc(order.year)}</div></div>
        <div class="detail-item"><div class="detail-item-label">Engine</div><div class="detail-item-value">${esc(order.engine)}</div></div>
        <div class="detail-item"><div class="detail-item-label">Registration</div><div class="detail-item-value">${esc(order.registration)}</div></div>
        <div class="detail-item"><div class="detail-item-label">ECU Type</div><div class="detail-item-value">${esc(order.ecuType)}</div></div>
        <div class="detail-item"><div class="detail-item-label">Service</div><div class="detail-item-value">${esc(order.service)}</div></div>
      </div>
    </div>
    ${order.ecuAnalysis ? `
    <div class="detail-section">
      <h4>AI ECU Analysis</h4>
      <div class="detail-grid">
        <div class="detail-item"><div class="detail-item-label">Detected ECU</div><div class="detail-item-value">${order.ecuAnalysis.name}</div></div>
        <div class="detail-item"><div class="detail-item-label">Platform</div><div class="detail-item-value">${order.ecuAnalysis.platform}</div></div>
        <div class="detail-item"><div class="detail-item-label">File Size</div><div class="detail-item-value">${order.ecuAnalysis.sizeKB} KB</div></div>
        <div class="detail-item"><div class="detail-item-label">Map Count Est.</div><div class="detail-item-value">${order.ecuAnalysis.mapEstimate}</div></div>
        <div class="detail-item"><div class="detail-item-label">Entropy</div><div class="detail-item-value">${order.ecuAnalysis.entropy}</div></div>
        <div class="detail-item"><div class="detail-item-label">File Health</div><div class="detail-item-value" style="color:${order.ecuAnalysis.fileHealth==='Good'?'#4ade80':'#fbbf24'}">${order.ecuAnalysis.fileHealth}</div></div>
      </div>
    </div>` : ''}
    <div class="detail-section">
      <h4>Customer File</h4>
      <button class="file-download-btn" onclick="downloadOriginalFile(${order.id})">
        <i class="fas fa-download"></i> Download Original ECU File (${esc(order.fileName)})
      </button>
    </div>
    <div class="detail-section">
      <h4>Return Modified File</h4>
      <div class="return-file-area">
        <label>Upload the processed/modified ECU file to send back to the customer:</label>
        <input type="file" id="return-file-input" accept=".bin,.hex,.ori,.mod,.kess,.ktag,.*">
        <button class="btn btn-primary btn-sm mt-2" onclick="saveReturnFile(${order.id})" style="margin-top:0.75rem">
          <i class="fas fa-upload"></i> Save & Mark as Completed
        </button>
      </div>
      ${order.modifiedFile ? `
        <div style="margin-top:1rem">
          <button class="file-download-btn" onclick="downloadModifiedFile(${order.id})">
            <i class="fas fa-file-check"></i> Download Modified File (Ready to Send)
          </button>
        </div>` : ''}
    </div>
    <div class="detail-section">
      <h4>Status & Pricing</h4>
      <div class="status-update-area">
        ${['pending','processing','completed','rejected'].map(s => `
          <button class="status-btn ${order.status===s?'active':''}" 
            style="${statusButtonStyle(s)}"
            onclick="setStatus(${order.id},'${s}')">${statusLabel(s)}</button>
        `).join('')}
      </div>
      <div class="price-input-area">
        <label style="white-space:nowrap">Quote / Price (£):</label>
        <input type="number" id="price-input" value="${order.price || ''}" placeholder="e.g. 65" min="0" step="5">
        <button class="btn btn-primary btn-sm" onclick="savePrice(${order.id})">Save Price</button>
      </div>
    </div>
    <div class="detail-section">
      <h4>Admin Notes</h4>
      <textarea id="admin-notes" rows="3" placeholder="Internal notes about this order...">${esc(order.notes || '')}</textarea>
      <button class="btn btn-outline btn-sm mt-2" onclick="saveNotes(${order.id})" style="margin-top:0.5rem">Save Notes</button>
    </div>
  `;
}

function closeDetail() {
  document.getElementById('detail-overlay').classList.remove('open');
  state.selectedOrder = null;
}

function setStatus(id, status) {
  updateOrder(id, { status });
  renderAdmin();
  openOrderDetail(id);
  toast(`Status updated to: ${statusLabel(status)}`, 'success');
}

function savePrice(id) {
  const val = document.getElementById('price-input')?.value;
  updateOrder(id, { price: val });
  renderAdmin();
  toast('Price saved', 'success');
}

function saveNotes(id) {
  const val = document.getElementById('admin-notes')?.value;
  updateOrder(id, { notes: val });
  toast('Notes saved', 'success');
}

function saveReturnFile(id) {
  const input = document.getElementById('return-file-input');
  if (!input?.files[0]) { toast('Please select a file to upload', 'error'); return; }
  const reader = new FileReader();
  reader.onload = (e) => {
    const base64 = bufferToBase64(e.target.result);
    updateOrder(id, { modifiedFile: base64, status: 'completed', returnFileName: input.files[0].name });
    renderAdmin();
    openOrderDetail(id);
    toast('Modified file saved — order marked as Completed!', 'success');
  };
  reader.readAsArrayBuffer(input.files[0]);
}

function downloadOriginalFile(id) {
  const order = state.orders.find(o => o.id === id);
  if (!order?.fileData) { toast('Original file not available', 'error'); return; }
  const bytes = order.fileData instanceof ArrayBuffer ? order.fileData : base64ToUint8Array(order.fileData);
  const blob = new Blob([bytes], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = order.fileName || 'ecu_original.bin';
  a.click();
  URL.revokeObjectURL(url);
  toast('Original file downloaded', 'info');
}

function setAdminFilter(filter) {
  state.adminFilter = filter;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === filter));
  renderOrdersTable();
}

// ── Nav ────────────────────────────────────────────────────────────
function setupNav() {
  window.addEventListener('scroll', () => {
    const nav = document.querySelector('.navbar');
    if (nav) nav.classList.toggle('scrolled', window.scrollY > 30);
  });

  document.querySelector('.hamburger')?.addEventListener('click', () => {
    document.querySelector('.mobile-menu')?.classList.toggle('open');
  });
}

// ── Fade Up Animations ─────────────────────────────────────────────
function initFadeUp() {
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); obs.unobserve(e.target); } });
  }, { threshold: 0.1 });
  document.querySelectorAll('.fade-up').forEach(el => obs.observe(el));
}

// ── Progress bar animation on hero ────────────────────────────────
function animateHeroProgress() {
  const bars = document.querySelectorAll('.prog-bar-fill');
  setTimeout(() => {
    bars.forEach(bar => {
      const target = bar.dataset.target || '80';
      bar.style.width = target + '%';
    });
  }, 800);
}

// ── Helpers ────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

function esc(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToUint8Array(b64) {
  const binary = atob(b64);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return arr;
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
}

function statusLabel(s) {
  return { pending:'⏳ Pending', processing:'🔄 Processing', completed:'✅ Completed', rejected:'❌ Rejected' }[s] || s;
}
function statusBadgeClass(s) {
  return { pending:'badge-yellow', processing:'badge-blue', completed:'badge-green', rejected:'badge-red' }[s] || 'badge-grey';
}
function statusButtonStyle(s) {
  const colours = { pending:'#fbbf24', processing:'var(--blue)', completed:'#4ade80', rejected:'#f87171' };
  return `color:${colours[s]||'var(--grey)'};border-color:${colours[s]||'var(--border)'}`;
}

// ── Init ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadOrders();
  renderServices();
  setupFileUpload();
  setupOrderForm();
  setupNav();
  initFadeUp();
  animateHeroProgress();

  // Expose globals for onclick handlers
  window.selectService    = selectService;
  window.setAdminFilter   = setAdminFilter;
  window.setStatus        = setStatus;
  window.savePrice        = savePrice;
  window.saveNotes        = saveNotes;
  window.saveReturnFile   = saveReturnFile;
  window.downloadOriginalFile  = downloadOriginalFile;
  window.downloadModifiedFile  = downloadModifiedFile;
  window.openOrderDetail  = openOrderDetail;
  window.closeDetail      = closeDetail;
  window.showAdminLogin   = showAdminLogin;
  window.checkAdminLogin  = checkAdminLogin;
  window.backToSite       = backToSite;
  window.renderOrdersTable = renderOrdersTable;
});
