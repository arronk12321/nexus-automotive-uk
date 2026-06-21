/* ================================================================
   NEXUS AUTOMOTIVE UK — MAIN PAGE LOGIC
   ================================================================ */

'use strict';

// ── Config ────────────────────────────────────────────────────────
const PROJECT_ID     = 'nexus-automotive-uk';
const DB_NAME        = 'nexus';
const API_KEY        = 'AIzaSyAoMVPxA9T1MMD7dYm8jg5iH0yfCcdHtsA';
const STORAGE_BUCKET = 'nexus-automotive-uk.firebasestorage.app';
const FS_BASE        = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DB_NAME}/documents`;
const ST_BASE        = `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o`;
const WHATSAPP_NUMBER = '447700000000';

// ── Services ──────────────────────────────────────────────────────
const SERVICES = [
  { id: 'stage1',    icon: 'fa-tachometer-alt', name: 'Stage 1 Remapping',
    price: 'From £65', chips: ['+20–40 BHP','+30–80 Nm','Improved MPG'], offRoad: false,
    desc: 'Optimise fuel injection, boost pressure, ignition timing, and torque limiters for maximum power and efficiency gains — no hardware changes required.' },
  { id: 'egr',       icon: 'fa-wind',           name: 'EGR Delete',
    price: 'From £45', chips: ['Cleaner Intake','Better Response','Prevents EGR Failure'], offRoad: false,
    desc: 'Disable the Exhaust Gas Recirculation system in software to eliminate intake carbon build-up, prevent clogging, and restore sharp throttle response.' },
  { id: 'dpf',       icon: 'fa-filter',         name: 'DPF Delete',
    price: 'From £65', chips: ['No Regen Cycles','No DPF Failures','Off-Road Use'], offRoad: true,
    desc: 'Remove all Diesel Particulate Filter regeneration cycles and monitoring from the ECU. Eliminates costly DPF blockages and failures. Motorsport/off-road only.' },
  { id: 'adblue',    icon: 'fa-tint-slash',     name: 'AdBlue Delete',
    price: 'From £75', chips: ['SCR System Off','No AdBlue Faults','No Warning Lights'], offRoad: true,
    desc: 'Disable SCR (Selective Catalytic Reduction) and AdBlue injection systems at ECU level. Eliminates AdBlue faults, sensor warnings and costly SCR failures.' },
  { id: 'pops',      icon: 'fa-fire',           name: 'Pops & Bangs',
    price: 'From £45', chips: ['Throttle-Off Pops','Overrun Burbles','Launch Control'], offRoad: false,
    desc: 'Add dramatic throttle-off fuel pops, overrun burbles, and an aggressive launch control strategy to your ECU map.' },
  { id: 'swirl',     icon: 'fa-dharmachakra',   name: 'Swirl Flap Delete',
    price: 'From £35', chips: ['Prevents Engine Damage','Smoother Idle','Vacuum Free'], offRoad: false,
    desc: 'Disable swirl flap motor operation in ECU software to prevent catastrophic mechanical failure. Essential preventive maintenance for high-mileage diesel engines.' },
  { id: 'speed',     icon: 'fa-gauge-high',     name: 'Speed Limiter Removal',
    price: 'From £45', chips: ['Vmax Removed','Track Day Ready','Fleet Use'], offRoad: true,
    desc: 'Remove OEM factory speed limiter caps from the ECU. Suitable for track days, private land, and specialist fleet applications only.' },
  { id: 'startstop', icon: 'fa-power-off',      name: 'Start/Stop Disable',
    price: 'From £35', chips: ['Permanently Off','Less Starter Wear','No Button Needed'], offRoad: false,
    desc: 'Permanently disable the engine auto Start/Stop system in software — no button required each journey. Significantly reduces starter motor and battery wear.' },
  { id: 'tcu',       icon: 'fa-cogs',           name: 'TCU/DSG Gearbox Tuning',
    price: 'From £75', chips: ['Faster Shifts','Higher Torque','Launch Control'], offRoad: false,
    desc: 'Optimise DSG, PDK, DCT, and automatic TCU modules for faster shift speeds, higher torque acceptance, raised rev limits, and improved launch control.' },
  { id: 'immo',      icon: 'fa-key',            name: 'Immo Off / ECU Solutions',
    price: 'POA',      chips: ['Immo Disabled','ECU Cloning','Virgin ECU Work'], offRoad: false,
    desc: 'Immobiliser disabling, ECU cloning, replacement ECU programming, donor ECU conversion, and Virgin ECU solutions for complex and specialist work.' },
];

// ── State ─────────────────────────────────────────────────────────
const state = {
  selectedService: '',
  uploadedFile: null,
  uploadedFileName: '',
  uploadedFileData: null,
};

// ── Firestore REST Helpers ─────────────────────────────────────────
function toFS(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number')  return { doubleValue: val };
  if (val instanceof Date)      return { timestampValue: val.toISOString() };
  return { stringValue: String(val) };
}

function buildFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) fields[k] = toFS(v);
  }
  return fields;
}

async function fsPost(collection, data) {
  const resp = await fetch(`${FS_BASE}/${collection}?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: buildFields(data) }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Firestore error: ${resp.status} ${err}`);
  }
  return resp.json();
}

// ── Firebase Storage Upload ────────────────────────────────────────
async function uploadToStorage(path, fileData) {
  const encodedPath = encodeURIComponent(path);
  const resp = await fetch(`${ST_BASE}?uploadType=media&name=${encodedPath}&key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: fileData,
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Storage upload error: ${resp.status} ${err}`);
  }
  const result = await resp.json();
  const token = result.downloadTokens;
  return `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encodedPath}?alt=media&token=${token}`;
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
  }, 4000);
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
  // Toggle this service in the multi-select checkboxes (if on page)
  const checkboxes = document.querySelectorAll('input[name="services"]');
  if (checkboxes.length) {
    const cb = Array.from(checkboxes).find(c => c.value === name);
    if (cb) cb.checked = !cb.checked;
    updateServiceHiddenInput();
  }
  // Also highlight service cards / sidebar items
  document.querySelectorAll('.service-card').forEach(el =>
    el.classList.toggle('selected', el.dataset.service === name));
  document.querySelectorAll('.sidebar-svc').forEach(el =>
    el.classList.toggle('active', el.dataset.service === name));
  document.getElementById('order')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function updateServiceHiddenInput() {
  const checked = Array.from(document.querySelectorAll('input[name="services"]:checked')).map(c => c.value);
  const hidden = document.getElementById('service-select');
  if (hidden) hidden.value = checked.join(', ');
  // Sync checkboxes with service cards / sidebar
  document.querySelectorAll('.service-card').forEach(el =>
    el.classList.toggle('selected', checked.includes(el.dataset.service)));
  document.querySelectorAll('.sidebar-svc').forEach(el =>
    el.classList.toggle('active', checked.includes(el.dataset.service)));
  // Hide error if something is now selected
  if (checked.length) {
    const errEl = document.getElementById('service-error-msg');
    if (errEl) errEl.style.display = 'none';
  }
}

// ── File Upload ────────────────────────────────────────────────────
function setupFileUpload() {
  const area  = document.getElementById('file-upload-area');
  const input = document.getElementById('ecu-file');
  const info  = document.getElementById('file-info');
  const fileName = document.getElementById('file-name');
  const fileSize = document.getElementById('file-size');
  const fileEcu  = document.getElementById('file-ecu-type');

  if (!area || !input) return;

  area.addEventListener('dragover', e => { e.preventDefault(); area.classList.add('drag-over'); });
  area.addEventListener('dragleave', () => area.classList.remove('drag-over'));
  area.addEventListener('drop', e => {
    e.preventDefault();
    area.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });
  input.addEventListener('change', () => { if (input.files[0]) handleFile(input.files[0]); });

  function handleFile(file) {
    state.uploadedFile = file;
    state.uploadedFileName = file.name;
    const reader = new FileReader();
    reader.onload = e => {
      state.uploadedFileData = e.target.result;
      const analysis = ECUProcessor.analyseFile(e.target.result);
      const sizeStr = analysis.sizeKB >= 1024
        ? `${(analysis.sizeKB / 1024).toFixed(1)} MB`
        : `${analysis.sizeKB} KB`;
      fileName.textContent = file.name;
      fileSize.textContent = sizeStr;
      fileEcu.textContent  = analysis.name;
      info.style.display   = 'flex';
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

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const data = new FormData(form);
    // Multi-service: collect all checked checkboxes, fall back to hidden input or old state
    const checkedServices = Array.from(document.querySelectorAll('input[name="services"]:checked')).map(c => c.value);
    const service = checkedServices.length ? checkedServices.join(', ') : (data.get('service') || '');
    if (!service) {
      const errEl = document.getElementById('service-error-msg');
      if (errEl) errEl.style.display = 'block';
      toast('Please select at least one service', 'error');
      return;
    }
    if (!state.uploadedFileData)   { toast('Please upload your ECU file', 'error'); return; }

    const order = {
      customerName: data.get('name'),
      email:        data.get('email'),
      phone:        data.get('phone'),
      make:         data.get('make'),
      model:        data.get('model'),
      year:         data.get('year'),
      engine:       data.get('engine'),
      ecuType:      data.get('ecu_type') || '',
      registration: data.get('registration') || '',
      service,
      notes:        data.get('notes') || '',
      fileName:     state.uploadedFileName,
    };

    const req = ['customerName','email','phone','make','model','year','engine'];
    for (const f of req) {
      if (!order[f]) { toast('Please fill in all required fields', 'error'); return; }
    }

    showProcessingModal(order);
  });
}

// ── Processing Modal ───────────────────────────────────────────────
async function showProcessingModal(orderData) {
  const overlay = document.getElementById('processing-modal');
  overlay.classList.add('open');

  const labels = [
    '📂 Reading ECU file...',
    '🔍 Detecting ECU platform...',
    '🧠 AI analysis running...',
    '⚙️ Applying modification logic...',
    '☁️ Saving to cloud...',
  ];

  document.getElementById('proc-title').textContent = 'Processing Your File';
  document.getElementById('proc-text').textContent  = 'Our AI is analysing your ECU file and preparing it for modification.';

  const stepsEl = document.getElementById('proc-steps');
  stepsEl.innerHTML = labels.map((l, i) => `
    <div class="prog-step" id="step-${i}">
      <span class="step-icon">⏳</span>
      <span>${l}</span>
    </div>
  `).join('');

  // Animate first 4 steps
  for (let i = 0; i < 4; i++) {
    await sleep(600 + Math.random() * 400);
    const el = document.getElementById(`step-${i}`);
    if (el) { el.classList.add('active'); el.querySelector('.step-icon').textContent = '🔄'; }
    await sleep(700 + Math.random() * 500);
    if (el) { el.classList.remove('active'); el.classList.add('done'); el.querySelector('.step-icon').textContent = '✅'; }
  }

  // Run AI analysis
  const analysis = ECUProcessor.analyseFile(orderData.fileData || state.uploadedFileData);
  const { modifiedBuffer, results } = ECUProcessor.applyModification(
    orderData.fileData || state.uploadedFileData, orderData.service, orderData);

  const autoProcessed = results.some(r => r.status === 'Applied');

  // Step 5 — save to Firestore + Storage
  const step4 = document.getElementById('step-4');
  if (step4) { step4.classList.add('active'); step4.querySelector('.step-icon').textContent = '🔄'; }

  try {
    // Generate order ref
    const ref = 'NX-' + Math.random().toString(36).toUpperCase().slice(2, 8);
    const orderId = ref;
    const now = new Date().toISOString();

    // Upload original file to Storage
    let fileUrl = '';
    try {
      const storagePath = `orders/${orderId}/original_${state.uploadedFileName}`;
      fileUrl = await uploadToStorage(storagePath, state.uploadedFileData);
    } catch (storageErr) {
      console.warn('Storage upload failed (continuing):', storageErr);
    }

    // Upload modified file if auto-processed
    let modifiedFileUrl = '';
    if (autoProcessed && modifiedBuffer) {
      try {
        const modPath = `orders/${orderId}/modified_${state.uploadedFileName}`;
        modifiedFileUrl = await uploadToStorage(modPath, modifiedBuffer);
      } catch (e) {
        console.warn('Modified file upload failed:', e);
      }
    }

    // Save order to Firestore
    const fsDoc = await fsPost('orders', {
      ref,
      customerName:    orderData.customerName,
      email:           orderData.email,
      phone:           orderData.phone,
      make:            orderData.make,
      model:           orderData.model,
      year:            orderData.year,
      engine:          orderData.engine,
      ecuType:         orderData.ecuType,
      registration:    orderData.registration,
      service:         orderData.service,
      notes:           orderData.notes,
      fileName:        state.uploadedFileName,
      fileUrl,
      modifiedFileUrl,
      status:          autoProcessed ? 'completed' : 'pending',
      price:           '',
      createdAt:       now,
      source:          'main-page',
      ecuDetected:     analysis.name,
      ecuPlatform:     analysis.platform,
      fileSizeKB:      String(analysis.sizeKB),
      fileHealth:      analysis.fileHealth,
    });

    if (step4) { step4.classList.remove('active'); step4.classList.add('done'); step4.querySelector('.step-icon').textContent = '✅'; }

    await sleep(400);
    overlay.classList.remove('open');

    showResultModal({ ref, ...orderData, status: autoProcessed ? 'completed' : 'pending' },
      autoProcessed, analysis, results, modifiedFileUrl);

  } catch (err) {
    console.error('Order save error:', err);
    if (step4) { step4.querySelector('.step-icon').textContent = '❌'; }
    await sleep(400);
    overlay.classList.remove('open');
    toast('Failed to save order — please try again or contact us on WhatsApp.', 'error');
  }
}

function showResultModal(order, autoProcessed, analysis, results, modifiedFileUrl) {
  const overlay = document.getElementById('result-modal');
  const box     = document.getElementById('result-box');
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
          <thead><tr style="font-size:0.72rem;color:var(--grey)">
            <th style="padding:0.5rem;text-align:left">Modification</th>
            <th style="padding:0.5rem;text-align:left">Status</th>
            <th style="padding:0.5rem;text-align:left">Detail</th>
          </tr></thead>
          <tbody>${modRows}</tbody>
        </table>
      </div>

      ${autoProcessed && modifiedFileUrl ? `
        <div class="detail-section">
          <h4>Download Modified File</h4>
          <p style="color:var(--grey);font-size:0.85rem;margin-bottom:1rem">Your file has been processed. Download below.</p>
          <a class="file-download-btn" href="${modifiedFileUrl}" download>
            <i class="fas fa-download"></i> Download Modified ECU File
          </a>
        </div>
      ` : `
        <div class="detail-section">
          <div class="disclaimer-box">
            <i class="fas fa-info-circle"></i>
            <div>Your file has been queued for our expert technicians. You'll receive your modified file within 2–24 hours to <strong>${esc(order.email)}</strong>. Reference: <strong>${order.ref}</strong>.</div>
          </div>
        </div>
      `}

      <div style="display:flex;gap:0.75rem;flex-wrap:wrap;margin-top:1.25rem">
        <a href="https://wa.me/${WHATSAPP_NUMBER}?text=Hi+Nexus+Automotive,+my+order+ref+is+${order.ref}" target="_blank" class="btn btn-green btn-sm">
          <i class="fab fa-whatsapp"></i> Chat on WhatsApp
        </a>
        <a href="portal.html" class="btn btn-outline btn-sm">
          <i class="fas fa-user"></i> Track in Customer Portal
        </a>
        <button class="btn btn-outline btn-sm" onclick="document.getElementById('result-modal').classList.remove('open')">Close</button>
      </div>
    </div>
  `;
}

// ── Navbar ─────────────────────────────────────────────────────────
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
    entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('visible'); obs.unobserve(e.target); }
    });
  }, { threshold: 0.1 });
  document.querySelectorAll('.fade-up').forEach(el => obs.observe(el));
}

// ── Hero progress bar animation ────────────────────────────────────
function animateHeroProgress() {
  setTimeout(() => {
    document.querySelectorAll('.prog-bar-fill').forEach(bar => {
      bar.style.width = (bar.dataset.target || '80') + '%';
    });
  }, 800);
}

// ── Helpers ────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

function esc(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ── Init ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  renderServices();
  setupFileUpload();
  setupOrderForm();
  setupNav();
  initFadeUp();
  animateHeroProgress();

  // Wire multi-select checkboxes
  document.querySelectorAll('input[name="services"]').forEach(cb => {
    cb.addEventListener('change', updateServiceHiddenInput);
  });

  window.selectService = selectService;
});
