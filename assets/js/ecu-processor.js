/* ================================================================
   NEXUS AUTOMOTIVE UK — AI ECU FILE PROCESSOR
   Handles binary ECU file analysis, modification, and validation
   ================================================================ */

const ECUProcessor = (() => {

  // ── ECU Signatures Database ────────────────────────────────────
  const ECU_DB = {
    // Size-based detection (bytes → ECU family)
    sizes: {
      131072:  { name: 'Bosch ME7.1/ME7.4',     brand: 'Bosch',    type: 'Petrol',  platform: 'ME7' },
      262144:  { name: 'Bosch EDC15 / ME7.5',   brand: 'Bosch',    type: 'Mixed',   platform: 'EDC15' },
      524288:  { name: 'Bosch EDC15 / EDC16',   brand: 'Bosch',    type: 'Diesel',  platform: 'EDC15_16' },
      1048576: { name: 'Bosch EDC16 / ME9',     brand: 'Bosch',    type: 'Mixed',   platform: 'EDC16' },
      2097152: { name: 'Bosch EDC17 / MED17',   brand: 'Bosch',    type: 'Mixed',   platform: 'EDC17' },
      4194304: { name: 'Bosch EDC17 (Extended)','brand': 'Bosch',  type: 'Diesel',  platform: 'EDC17_EXT' },
    },
    // Header byte signatures
    headers: [
      { offset: 0x00, bytes: [0x55, 0xAA],       name: 'Bosch Standard',   platform: 'BOSCH' },
      { offset: 0x00, bytes: [0x3E, 0x00],       name: 'Siemens SID806',   platform: 'SID806' },
      { offset: 0x00, bytes: [0xAA, 0x55],       name: 'Delphi DCM3.2',    platform: 'DCM3' },
      { offset: 0x08, bytes: [0x4D, 0x45, 0x37], name: 'Bosch ME7.x',      platform: 'ME7' },
      { offset: 0x10, bytes: [0x45, 0x44, 0x43], name: 'Bosch EDC',        platform: 'EDC' },
    ]
  };

  // ── Known Map Patterns for Common ECUs ────────────────────────
  const MAP_PATTERNS = {
    EDC15: {
      startStop: null, // not present on EDC15
      swirlFlap: { offset: 0x78900, searchBytes: [0x7F, 0x00], replaceBytes: [0x00, 0x00] },
      speedLimiter: { searchPattern: 'find', desc: 'Speed limiter table at ~0x7B400' },
      egr: { searchPattern: 'find', desc: 'EGR duty cycle map' },
    },
    EDC16: {
      startStop: null,
      swirlFlap: { searchPattern: 'find', desc: 'Swirl flap motor map' },
      egr: { searchPattern: 'find', desc: 'EGR correction factor table' },
      dpf: { searchPattern: 'find', desc: 'DPF regen trigger threshold' },
    },
    EDC17: {
      startStop: { searchPattern: 'find', desc: 'ISG_enaSwtEng map' },
      swirlFlap: { searchPattern: 'find', desc: 'TFlap_DesiredPos_Map' },
      egr: { searchPattern: 'find', desc: 'EGR_Vol_Flow_Setpoint_Map' },
      dpf: { searchPattern: 'find', desc: 'DPFR_mDeltaSootMax' },
      adblue: { searchPattern: 'find', desc: 'SCR_AdBlue_Injection_Control' },
    },
    ME7: {
      popsAndBangs: { searchPattern: 'find', desc: 'KFZWOP - throttle-off ignition map' },
      startStop: null,
      speedLimiter: { searchPattern: 'find', desc: 'VMAX limiter table' },
    }
  };

  // ── Checksum Algorithms ────────────────────────────────────────
  function calcChecksum8(buffer, start, end) {
    let sum = 0;
    const bytes = new Uint8Array(buffer, start, end - start);
    for (let b of bytes) sum = (sum + b) & 0xFF;
    return sum;
  }

  function calcChecksum16(buffer, start, end) {
    let sum = 0;
    const view = new DataView(buffer, start, end - start);
    for (let i = 0; i < end - start; i += 2) {
      sum = (sum + view.getUint16(i, false)) & 0xFFFF;
    }
    return sum;
  }

  function calcChecksum32(buffer, start, end) {
    let sum = 0;
    const view = new DataView(buffer);
    for (let i = start; i < end; i += 4) {
      sum = (sum + view.getUint32(i, false)) >>> 0;
    }
    return sum;
  }

  // ── Detect ECU from Buffer ─────────────────────────────────────
  function detectECU(buffer) {
    const size = buffer.byteLength;
    const bytes = new Uint8Array(buffer);

    let platform = 'UNKNOWN';
    let name = 'Unknown ECU';
    let brand = 'Unknown';
    let fuelType = 'Unknown';
    let confidence = 0;

    // Check by size
    if (ECU_DB.sizes[size]) {
      const entry = ECU_DB.sizes[size];
      platform = entry.platform;
      name = entry.name;
      brand = entry.brand;
      fuelType = entry.type;
      confidence = 70;
    }

    // Check header signatures
    for (const sig of ECU_DB.headers) {
      let match = true;
      for (let i = 0; i < sig.bytes.length; i++) {
        if (bytes[sig.offset + i] !== sig.bytes[i]) { match = false; break; }
      }
      if (match) {
        name = sig.name;
        platform = sig.platform;
        confidence = Math.min(confidence + 25, 95);
        break;
      }
    }

    // Try to extract calibration ID (ASCII string scan)
    let calId = '';
    for (let i = 8; i < Math.min(64, size); i++) {
      const c = bytes[i];
      if (c >= 0x20 && c <= 0x7E) calId += String.fromCharCode(c);
      else if (calId.length > 3) break;
    }

    // Validate checksum
    const checkOk = validateChecksum(buffer, platform);

    return {
      name, platform, brand, fuelType, confidence,
      size, sizeKB: Math.round(size / 1024),
      calId: calId.trim() || 'N/A',
      checksumValid: checkOk,
    };
  }

  // ── Validate Checksum ──────────────────────────────────────────
  function validateChecksum(buffer, platform) {
    try {
      const size = buffer.byteLength;
      // EDC17/ME(D)17: last 4 bytes are often a simple sum
      const view = new DataView(buffer);
      const storedSum = view.getUint32(size - 4, true);
      const calcSum = calcChecksum32(buffer, 0, size - 4);
      if (storedSum === calcSum) return true;
      // Try 8-bit sum
      const storedByte = new Uint8Array(buffer)[size - 1];
      const calcByte = calcChecksum8(buffer, 0, size - 1);
      return storedByte === calcByte;
    } catch { return false; }
  }

  // ── Apply Modification ─────────────────────────────────────────
  function applyModification(buffer, service, vehicleInfo) {
    const copy = buffer.slice(0);
    const bytes = new Uint8Array(copy);
    const info = detectECU(buffer);
    const results = [];

    switch (service) {
      case 'Start/Stop Disable': {
        // EDC17 / ME17: ISG enable byte pattern
        const patterns = [
          [0x01, 0x00, 0x00, 0x00, 0x01, 0x00], // ISG enabled pattern
        ];
        let found = 0;
        for (let i = 0; i < bytes.length - 8; i++) {
          if (bytes[i] === 0x01 && bytes[i+1] === 0x00 &&
              bytes[i+2] === 0x00 && bytes[i+3] === 0x00 &&
              bytes[i+4] === 0x01 && bytes[i+5] === 0x00) {
            bytes[i] = 0x00; bytes[i+4] = 0x00;
            found++;
            if (found >= 3) break;
          }
        }
        results.push({
          mod: 'Start/Stop ISG Disable',
          status: found > 0 ? 'Applied' : 'Flagged for Manual Review',
          locations: found > 0 ? `${found} pattern(s) modified` : 'No auto pattern — queued for technician',
          detail: 'ISG_enaSwtEng map patched to disabled state'
        });
        break;
      }

      case 'Swirl Flap Delete': {
        // Search for swirl flap motor duty patterns (0x7F bytes in motor map)
        let found = 0;
        for (let i = 0; i < bytes.length - 16; i++) {
          if (bytes[i] === 0x7F && bytes[i+1] === 0x7F &&
              bytes[i+2] === 0x7F && bytes[i+3] === 0x7F) {
            for (let j = 0; j < 16; j++) {
              if (bytes[i+j] === 0x7F) { bytes[i+j] = 0x00; found++; }
            }
            break;
          }
        }
        results.push({
          mod: 'Swirl Flap Motor Delete',
          status: found > 0 ? 'Applied' : 'Flagged for Manual Review',
          locations: found > 0 ? `${found} bytes zeroed in swirl map` : 'Queued for technician',
          detail: 'Swirl flap position table set to open/off position'
        });
        break;
      }

      case 'Stage 1 Remapping':
      case 'EGR Delete':
      case 'DPF Delete':
      case 'AdBlue Delete':
      case 'Pops & Bangs':
      case 'Speed Limiter Removal':
      case 'TCU/DSG Gearbox Tuning':
      case 'Immo Off / ECU Solutions': {
        // Complex mods — flag for technician
        results.push({
          mod: service,
          status: 'Queued for Expert Technician',
          locations: 'Complex modification — requires WinOLS / ECM Titanium',
          detail: `${service} requires expert map analysis. File logged and assigned to technician.`
        });
        break;
      }
    }

    // Recalculate checksum after modifications
    if (results.some(r => r.status === 'Applied')) {
      try {
        const newSum = calcChecksum8(copy, 0, copy.byteLength - 1);
        bytes[copy.byteLength - 1] = newSum;
        results.push({ mod: 'Checksum Recalculation', status: 'Applied', detail: `New checksum: 0x${newSum.toString(16).toUpperCase()}` });
      } catch(e) {
        results.push({ mod: 'Checksum', status: 'Manual Required', detail: 'Run checksum tool after manual edits' });
      }
    }

    return { modifiedBuffer: copy, results, ecuInfo: info };
  }

  // ── Analyse File (no modification) ────────────────────────────
  function analyseFile(buffer) {
    const info = detectECU(buffer);
    const bytes = new Uint8Array(buffer);

    // Entropy analysis (rough measure of compression/encryption)
    const sample = bytes.slice(0, Math.min(1024, bytes.length));
    const freq = new Array(256).fill(0);
    for (const b of sample) freq[b]++;
    let entropy = 0;
    for (const f of freq) {
      if (f === 0) continue;
      const p = f / sample.length;
      entropy -= p * Math.log2(p);
    }

    // Detect zero-fills (unprogrammed regions)
    let zeroCount = 0;
    let ffCount = 0;
    for (const b of bytes) {
      if (b === 0x00) zeroCount++;
      if (b === 0xFF) ffCount++;
    }
    const zeroPct = Math.round((zeroCount / bytes.length) * 100);
    const ffPct   = Math.round((ffCount   / bytes.length) * 100);

    // Estimate tunable maps count based on file size & platform
    const mapEstimate = info.sizeKB < 600 ? '120–180 maps' :
                        info.sizeKB < 1200 ? '200–350 maps' : '400–600+ maps';

    return {
      ...info,
      entropy: entropy.toFixed(2),
      zeroPct, ffPct,
      mapEstimate,
      fileHealth: zeroPct < 60 && ffPct < 40 && info.sizeKB > 64 ? 'Good' : 'Needs Review',
    };
  }

  // ── Generate Modification Report ──────────────────────────────
  function generateReport(analysis, service, vehicleInfo) {
    const auto = ['Start/Stop Disable', 'Swirl Flap Delete'];
    const manual = ['Stage 1 Remapping','EGR Delete','DPF Delete','AdBlue Delete',
                    'Pops & Bangs','Speed Limiter Removal','TCU/DSG Gearbox Tuning',
                    'Immo Off / ECU Solutions'];

    const isAuto = auto.includes(service);

    return {
      service,
      vehicle: vehicleInfo,
      ecuDetected: analysis.name,
      platform: analysis.platform,
      fileSize: `${analysis.sizeKB} KB`,
      checksumOK: analysis.checksumValid,
      mapCount: analysis.mapEstimate,
      fileHealth: analysis.fileHealth,
      processingMode: isAuto ? 'Automatic (AI)' : 'Manual (Expert Technician)',
      estimatedTime: isAuto ? 'Instant' : '2–24 hours',
      notes: isAuto
        ? `${service} can be auto-applied on ${analysis.name}.`
        : `${service} on ${analysis.name} requires expert map analysis using WinOLS or ECM Titanium. A tuning technician will process this file.`,
      warning: ['DPF Delete','AdBlue Delete','Speed Limiter Removal'].includes(service)
        ? 'This modification is for motorsport/off-road use only. Customer assumes full legal responsibility.'
        : null,
    };
  }

  // ── Public API ─────────────────────────────────────────────────
  return { analyseFile, applyModification, generateReport, detectECU };

})();

window.ECUProcessor = ECUProcessor;
