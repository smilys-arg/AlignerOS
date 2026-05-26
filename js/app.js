// ==================== PWA ====================
(function() {
  const manifest = {
    name: "AlignerOS",
    short_name: "AlignerOS",
    start_url: location.href,
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#2563eb",
    icons: [{ src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'%3E%3Cpolygon points='256,32 464,160 464,352 256,480 48,352 48,160' fill='%232563eb'/%3E%3Ctext x='256' y='300' text-anchor='middle' font-family='Inter,sans-serif' font-weight='bold' font-size='140' fill='white'%3EOS%3C/text%3E%3C/svg%3E", sizes: "512x512", type: "image/svg+xml" }]
  };
  const blob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
  const manifestURL = URL.createObjectURL(blob);
  const link = document.createElement('link');
  link.rel = 'manifest';
  link.href = manifestURL;
  document.head.appendChild(link);
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister()));
  }
})();

// ==================== NOTIFICACIONES PUSH ====================
async function requestNotificationPermission() {
  if ('Notification' in window) {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') console.log('Notificaciones permitidas');
  }
}
setTimeout(requestNotificationPermission, 3000);

function checkUrgentNotifications() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const now = new Date(); now.setHours(0,0,0,0);
  state.cases.forEach(c => {
    const prio = getPrio(c.delivery);
    if (prio === 'urgente' && !isCaseCompletelyFinished(c)) {
      const d = daysUntil(c.delivery);
      if (d <= 0) {
        new Notification(`⚠ VENCIDO: ${c.patient}`, {body: `Fecha de entrega pasada`, icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Ccircle cx="50" cy="50" r="45" fill="%23dc2626"/%3E%3C/svg%3E'});
      } else if (d === 1) {
        new Notification(`🔴 MAÑANA: ${c.patient}`, {body: `Queda 1 día para la entrega`, icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Ccircle cx="50" cy="50" r="45" fill="%23f97316"/%3E%3C/svg%3E'});
      }
    }
  });
}
setInterval(checkUrgentNotifications, 3600000);

// ==================== VARIABLES GLOBALES ====================
let repCtx = null, editingCaseId = null, editingStockId = null;
let selection = { caseId:null, arcType:null, indices:new Set() };
let editingFinanzaId = null;
let pagoFinanzaId = null;
let modoEgreso = false;
let stlFiles = [];
let pdfFiles = [];   // <-- NUEVO para PDFs
const undoStack = [];
const activityLog = [];

// ==================== FUNCIONES AUXILIARES ====================
function daysFromNow(d){ const dt=new Date(); dt.setDate(dt.getDate()+d); return dt.toISOString().slice(0,10); }
function makeArc(t){ return t ? { total:t, alinStates:new Array(t).fill(-1) } : null; }
function makeCase(patient,doctor,doctorId,sup,inf,delivery,ingreso,egreso,obs){
  return { id:uid(), patient, doctor, doctorId:doctorId||'', delivery, montoTotal: parseFloat(ingreso) || 0, egreso: parseFloat(egreso) || 0, obs, arcadas:{sup:makeArc(sup), inf:makeArc(inf)}, open:false };
}
function getPrio(d){ const t=new Date(); t.setHours(0,0,0,0); const diff=Math.ceil((new Date(d+'T00:00:00')-t)/86400000); return diff<=2?'urgente':diff<=5?'proximo':'ok'; }
function daysUntil(d){ const t=new Date(); t.setHours(0,0,0,0); return Math.ceil((new Date(d+'T00:00:00')-t)/86400000); }
function formatRanges(indices){
  if(!indices.length) return '';
  const sorted=[...indices].sort((a,b)=>a-b);
  const parts=[]; let start=sorted[0], end=sorted[0];
  for(let i=1;i<sorted.length;i++){
    if(sorted[i]===end+1){ end=sorted[i]; }
    else{ parts.push(start===end?`${start}`:`${start}-${end}`); start=sorted[i]; end=sorted[i]; }
  }
  parts.push(start===end?`${start}`:`${start}-${end}`);
  return parts.join(',');
}
function isCaseCompletelyFinished(c) {
  return ['sup','inf'].every(at => {
    const arc = c.arcadas[at];
    if (!arc) return true;
    return arc.alinStates.every(st => st === FINAL_STAGE || st === -1);
  });
}

// ==================== GESTIÓN DE STOCK DE PLANCHAS ====================
function getPlanchaStock() {
  let plancha = state.stock.find(s => s.name.toLowerCase().includes('planchas 0.75'));
  if (!plancha) {
    plancha = { id: uid(), name: 'Planchas 0.75mm', type: 'Planchas', qty: 100, min: 30, unit: 'láminas', max: 200 };
    state.stock.push(plancha);
  }
  return plancha;
}

function adjustStockOnStageChange(arc, idx, oldStage, newStage) {
  if (oldStage === newStage) return;
  if (newStage === 2 && oldStage !== 2) {
    const plancha = getPlanchaStock();
    plancha.qty = Math.max(0, plancha.qty - 1);
  } else if (oldStage === 2 && newStage !== 2) {
    const plancha = getPlanchaStock();
    plancha.qty += 1;
  }
}

// ==================== ESTADO ====================
const state = {
  cases: [], stock: [], finanzas: [], lastModified: 0,
  kFilter: 'all', cFilter: 'all',
  patientFilter: '', doctorFilter: '', doctorKanbanFilter: '',
  finanzasGroup: false
};

// ==================== PILA DE DESHACER ====================
function pushUndo() {
  const snapshot = JSON.parse(JSON.stringify({ cases: state.cases, stock: state.stock }));
  undoStack.push(snapshot);
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  updateUndoButton();
}

function undo() {
  if (undoStack.length === 0) return;
  const prev = undoStack.pop();
  state.cases = prev.cases;
  state.stock = prev.stock;
  clearSelection();
  renderAll();
  addActivity('⏪ Deshacer último cambio');
  showToast('Cambio deshecho');
  updateUndoButton();
}

function updateUndoButton() {
  const btn = document.getElementById('btnUndo');
  btn.disabled = undoStack.length === 0;
  btn.textContent = `↩ Deshacer${undoStack.length ? ` (${undoStack.length})` : ''}`;
}
document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); }
});

// ==================== REGISTRO DE ACTIVIDAD ====================
function addActivity(description) {
  const now = new Date();
  const time = now.toLocaleTimeString('es-ES', { hour:'2-digit', minute:'2-digit' });
  activityLog.unshift({ time, desc: description });
  if (activityLog.length > MAX_ACTIVITY) activityLog.pop();
  updateActivityBadge();
}

function updateActivityBadge() {
  const badge = document.getElementById('activityBadge');
  const count = activityLog.length;
  if (count > 0) {
    badge.style.display = 'flex';
    badge.textContent = Math.min(count, 99);
  } else {
    badge.style.display = 'none';
  }
}

function openActivityModal() {
  const content = document.getElementById('activityContent');
  content.innerHTML = activityLog.length ? activityLog.map(a =>
    `<div class="activity-item"><span class="activity-time">${a.time}</span><span class="activity-desc">${a.desc}</span></div>`
  ).join('') : '<div style="padding:20px;text-align:center;color:var(--text3)">Sin actividad registrada</div>';
  openModal('activityModal');
}

function clearActivity() {
  if (confirm('¿Limpiar todo el historial de actividad?')) {
    activityLog.length = 0;
    updateActivityBadge();
    closeModal('activityModal');
    showToast('Historial limpiado');
  }
}

// ==================== PERSISTENCIA ====================
function loadState(){
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data.cases && data.stock) {
        state.cases = data.cases;
        state.stock = data.stock;
        state.finanzas = data.finanzas || [];
        state.lastModified = data.lastModified || 0;
        return;
      }
    }
  } catch(e) {}
  state.cases = buildCasesFromCSV(csvRaw);
  state.stock = [
    {id:uid(),name:'Planchas 0.75mm',type:'Planchas',qty:100,min:30,unit:'láminas',max:200},
    {id:uid(),name:'Planchas 1.0mm',type:'Planchas',qty:12,min:20,unit:'láminas',max:100},
    {id:uid(),name:'Resina UV',type:'Resina',qty:3,min:2,unit:'kg',max:10},
    {id:uid(),name:'Bolsas',type:'Packaging',qty:180,min:50,unit:'unid',max:500},
  ];
  state.lastModified = Date.now();
  saveState();
}

function saveState(){
  try {
    const data = { cases: state.cases, stock: state.stock, finanzas: state.finanzas, lastModified: state.lastModified };
    localStorage.setItem(LS_KEY, JSON.stringify(data));
    if (db && isOnline && !writeLock) {
      writeLock = true;
      const rootRef = db.ref('/');
      rootRef.transaction(currentData => {
        if (currentData && currentData.lastModified > state.lastModified) return;
        return { ...data, lastModified: Date.now() };
      }, (error, committed, snapshot) => {
        writeLock = false;
        if (error) {
          console.error('Transacción fallida:', error);
          showToast('Error de sincronización');
        } else if (!committed) {
          db.ref('/').once('value').then(snap => {
            const remote = snap.val();
            if (remote && remote.cases && remote.stock) {
              state.cases = remote.cases;
              state.stock = remote.stock;
              state.lastModified = remote.lastModified || Date.now();
              renderAll();
              showToast('Datos actualizados desde otro dispositivo');
            }
          });
        } else {
          state.lastModified = snapshot.val().lastModified;
        }
      });
    }
  } catch(e) { console.error('Error al guardar', e); }
}

function setupFirebaseListener() {
  if (!db) return;
  db.ref('/').on('value', snap => {
    if (writeLock) return;
    const remote = snap.val();
    if (remote && remote.cases && remote.stock && (!state.lastModified || remote.lastModified >= state.lastModified)) {
      state.cases = remote.cases;
      state.stock = remote.stock;
      state.lastModified = remote.lastModified || Date.now();
      clearSelection();
      renderAll();
      updateSyncStatus(true);
    }
  });
  db.ref('.info/connected').on('value', snap => {
    isOnline = snap.val() === true;
    updateSyncStatus(isOnline);
  });
}

function syncFromFirebase() {
  if (db && isOnline) {
    db.ref('/').once('value').then(snap => {
      const remote = snap.val();
      if (remote && remote.cases && remote.stock) {
        state.cases = remote.cases;
        state.stock = remote.stock;
        state.lastModified = remote.lastModified || Date.now();
        clearSelection();
        renderAll();
        saveState();
        showToast('Sincronizado manualmente');
        updateSyncStatus(true);
      }
    }).catch(() => showToast('Error al sincronizar'));
  }
}

function updateSyncStatus(online) {
  const dot = document.getElementById('syncDot');
  const txt = document.getElementById('syncText');
  if (online) { dot.className = 'sync-dot'; txt.textContent = 'Sincronizado'; }
  else { dot.className = 'sync-dot offline'; txt.textContent = 'Offline'; }
}

// ==================== TIEMPO ESTIMADO ====================
function calculateEstimatedTime() {
  const timePerStage = [50/7, 5, 10, 0];
  let totalMin = 0;
  state.cases.forEach(c => {
    ['sup','inf'].forEach(at => {
      const arc = c.arcadas[at];
      if (!arc) return;
      arc.alinStates.forEach(st => { if (st >= 0 && st < FINAL_STAGE) totalMin += timePerStage[st] || 0; });
    });
  });
  const hours = Math.floor(totalMin / 60);
  const mins = Math.round(totalMin % 60);
  return { totalMin, hours, mins };
}

// ==================== RENDERIZADOS ====================
function renderAll() {
  renderStats();
  renderProgressBar();
  renderAlerts();
  renderKanban();
  renderCases();
  renderStock();
  saveState();
  renderFinanzas();
}
const render = renderAll;

function countByStage() {
  const cnt = {0:0,1:0,2:0,3:0};
  state.cases.forEach(c => ['sup','inf'].forEach(at => {
    const a = c.arcadas[at]; if(!a) return;
    a.alinStates.forEach(st => { if(st>=0 && st<4) cnt[st]++; });
  }));
  return cnt;
}

function renderProgressBar() {
  let totalAlin = 0, finishedAlin = 0;
  state.cases.forEach(c => {
    ['sup','inf'].forEach(at => {
      const arc = c.arcadas[at];
      if (!arc) return;
      totalAlin += arc.total;
      finishedAlin += arc.alinStates.filter(st => st === FINAL_STAGE).length;
    });
  });
  const pct = totalAlin ? Math.round((finishedAlin / totalAlin) * 100) : 0;
  const time = calculateEstimatedTime();
  let timeStr = '';
  if (time.hours > 0) timeStr += `${time.hours}h `;
  timeStr += `${time.mins}min`;

  document.getElementById('progressBarContainer').innerHTML = `
    <div class="progress-bar-label">
      <span>Progreso general</span>
      <span>${finishedAlin} / ${totalAlin} alineadores (${pct}%)</span>
    </div>
    <div class="progress-bar-bg"><div class="progress-bar-fill" style="width:${pct}%"></div></div>
    <div class="time-estimate">⏱ Tiempo estimado de trabajo: <strong>${timeStr}</strong></div>
  `;
}

function renderStats() {
  const urg = state.cases.filter(c => getPrio(c.delivery)==='urgente' && !isCaseCompletelyFinished(c)).length;
  const prox = state.cases.filter(c => getPrio(c.delivery)==='proximo' && !isCaseCompletelyFinished(c)).length;
  const cnt = countByStage();
  document.getElementById('statsGrid').innerHTML = `
    <div class="stat-card"><div class="stat-label">Urgentes</div><div class="stat-value ${urg>0?'urgent':''}">${urg}</div></div>
    <div class="stat-card"><div class="stat-label">Próximos</div><div class="stat-value ${prox>0?'warning':''}">${prox}</div></div>
    <div class="stat-card"><div class="stat-label">Casos</div><div class="stat-value">${state.cases.length}</div></div>
    <div class="stat-card"><div class="stat-label">Imprimir</div><div class="stat-value" style="color:var(--sp)">${cnt[0]}</div></div>
    <div class="stat-card"><div class="stat-label">Termo.</div><div class="stat-value" style="color:var(--st)">${cnt[1]}</div></div>
    <div class="stat-card"><div class="stat-label">Corte/Pul</div><div class="stat-value" style="color:var(--sc)">${cnt[2]}</div></div>
    <div class="stat-card"><div class="stat-label">Listo</div><div class="stat-value" style="color:var(--senv)">${cnt[3]}</div></div>`;
}

function renderAlerts() {
  const a = [];
  state.cases.forEach(c => {
    const prio = getPrio(c.delivery);
    if (!isCaseCompletelyFinished(c)) {
      const d = daysUntil(c.delivery);
      if (d <= 0) a.push({t:'critical', m:`☠ VENCIDO: ${c.patient.split(',')[0]}`});
      else if (d === 1) a.push({t:'red', m:`🔴 MAÑANA: ${c.patient.split(',')[0]}`});
      else if (d === 2) a.push({t:'orange', m:`🟠 2 días: ${c.patient.split(',')[0]}`});
      else if (prio === 'proximo') a.push({t:'yellow', m:`🟡 ${d} días: ${c.patient.split(',')[0]}`});
    }
  });
  state.stock.forEach(s => { if(s.qty<=s.min) a.push({t:'yellow', m:`⬡ ${s.name} (${s.qty} ${s.unit})`}); });
  if(!a.length) a.push({t:'green', m:'✓ Sin alertas'});
  document.getElementById('alertsBar').innerHTML = a.map(x => `<div class="alert-pill ${x.t}"><div class="alert-dot"></div>${x.m}</div>`).join('');
}

// ==================== KANBAN ====================
function renderKanban() {
  const f = state.kFilter;
  const patientFilter = state.patientFilter.toLowerCase();
  const doctorKanbanFilter = state.doctorKanbanFilter;
  document.getElementById('kanban').innerHTML = SKEYS.map((key, stageIdx) => {
    const color = Object.values(SCOLS)[stageIdx];
    let cards = [];
    state.cases.forEach(c => ['sup','inf'].forEach(at => {
      const arc = c.arcadas[at]; if(!arc) return;
      const indices = [];
      arc.alinStates.forEach((st,i) => { if(st===stageIdx) indices.push(i); });
      if(!indices.length) return;
      if (doctorKanbanFilter && !(c.doctorId || '').toLowerCase().includes(doctorKanbanFilter)) return;
      if (patientFilter && !c.patient.toLowerCase().includes(patientFilter)) return;
      const p = getPrio(c.delivery);
      if(f==='urgente' && p!=='urgente') return;
      if(f==='proximo' && p!=='proximo') return;
      if(f==='sup' && at!=='sup') return;
      if(f==='inf' && at!=='inf') return;
      cards.push({c,at,p,indices,arc});
    }));
    cards.sort((a,b)=> ( {urgente:0,proximo:1,ok:2}[a.p] - {urgente:0,proximo:1,ok:2}[b.p] ));
    const body = cards.length ? cards.map(it => {
      const d = daysUntil(it.c.delivery);
      const rangeStr = formatRanges(it.indices);
      const cardId = `${it.c.id}-${it.at}-${stageIdx}`;
      return `<div class="arc-card ${it.p}">
        <div class="arc-top"><div style="min-width:0;flex:1"><div class="arc-patient">${it.c.patient.split(',')[0]}</div><div class="arc-doctor">${it.c.doctorId||it.c.doctor}</div></div><span class="arc-type ${it.at}">${it.at.toUpperCase()}</span></div>
        <div class="alin-range">
          ${it.indices.map(i => {
            const url = it.c.arcadas[it.at]?.stlUrls?.[i];
            if (url) return `<a href="${url}" target="_blank" title="Descargar STL ${i}" style="text-decoration:none;color:var(--accent);font-weight:600" onclick="event.stopPropagation()">${i}</a>`;
            return i;
          }).join(' ')} (${it.indices.length} uds)
        </div>
        <div class="arc-bottom"><span class="delivery-chip ${it.p}">📅 ${d<=0?'VENCIDO':d+'d'}</span>
        <div class="quick-btns">
         <button class="qbtn" onmousedown="event.preventDefault(); toggleKanbanSelector('${cardId}','${it.c.id}','${it.at}',${stageIdx})">Seleccionar</button>
          <button class="qbtn done-btn" onclick="event.stopPropagation(); completeStage('${it.c.id}','${it.at}',${stageIdx})">✓</button>
        </div></div>
        <div class="kanban-alin-selector" id="ksel-${cardId}" data-open-time="0">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px">
            <span style="font-size:10px; color:var(--text3)">Seleccioná alineadores</span>
            <button onclick="event.stopPropagation(); document.getElementById('ksel-${cardId}').classList.remove('open')" style="background:none; border:none; color:var(--text3); cursor:pointer; font-size:14px">&times;</button>
          </div>
          <div style="margin-bottom:4px; display:flex; gap:4px">
            <button onclick="event.stopPropagation(); selectAllInKanban('${cardId}', true)" style="font-size:10px; padding:2px 6px;">Todos</button>
            <button onclick="event.stopPropagation(); selectAllInKanban('${cardId}', false)" style="font-size:10px; padding:2px 6px;">Ninguno</button>
          </div>
          <div class="alin-grid" id="ksel-grid-${cardId}" style="max-height:100px;overflow-y:auto;margin-bottom:6px"></div>
          <select id="ksel-stage-${cardId}" class="form-input" style="margin-right:6px;padding:4px 8px;font-size:10px">
            <option value="0">Imprimir</option><option value="1">Termoformar</option>
            <option value="2">Corte/Pulido</option><option value="3">Listo</option>
            <option value="4">Finalizado</option>
          </select>
          <button class="qbtn" style="color:var(--accent);border-color:var(--accent)" onclick="event.stopPropagation(); moveSelectedFromKanban('${cardId}','${it.c.id}','${it.at}',${stageIdx})">Mover</button>
        </div>
      </div>`;
    }).join('') : `<div class="empty-col"><div class="empty-icon">◌</div>Sin pendientes</div>`;
    return `<div class="kanban-col"><div class="col-header"><div class="col-title"><div class="col-dot" style="background:${color}"></div>${STAGES[stageIdx]}</div><span class="col-count">${cards.length}</span></div><div class="col-body">${body}</div></div>`;
  }).join('');
}

function filterByPatient() {
  state.patientFilter = document.getElementById('patientFilterInput').value;
  renderKanban();
}

function filterByDoctorKanban() {
  state.doctorKanbanFilter = document.getElementById('doctorKanbanFilter')?.value?.toLowerCase() || '';
  renderKanban();
}

function selectAllInKanban(cardId, select) {
  const items = document.querySelectorAll(`#ksel-grid-${cardId} .kanban-alin-item`);
  items.forEach(el => el.classList.toggle('selected', select));
}

function toggleKanbanSelector(cardId, caseId, arcType, stageIdx) {
  stageIdx = parseInt(stageIdx, 10);
  const selector = document.getElementById(`ksel-${cardId}`);
  if (!selector) return;
  if (selector.classList.contains('open')) { selector.classList.remove('open'); return; }
  document.querySelectorAll('.kanban-alin-selector.open').forEach(s => s.classList.remove('open'));
  const c = state.cases.find(x => x.id === caseId);
  if (!c) return;
  const arc = c.arcadas[arcType];
  if (!arc) return;
  const indices = [];
  arc.alinStates.forEach((st, i) => { if (st === stageIdx) indices.push(i); });
  const grid = document.getElementById(`ksel-grid-${cardId}`);
  grid.innerHTML = indices.map(i =>
    `<span class="kanban-alin-item" data-idx="${i}" onclick="event.stopPropagation(); this.classList.toggle('selected')">${i}</span>`
  ).join('');
  selector.dataset.openTime = Date.now();
  selector.classList.add('open');
}

function moveSelectedFromKanban(cardId, caseId, arcType, currentStageIdx) {
  currentStageIdx = parseInt(currentStageIdx, 10);
  const selector = document.getElementById(`ksel-${cardId}`);
  if (!selector) return;
  const selected = selector.querySelectorAll('.kanban-alin-item.selected');
  if (selected.length === 0) { alert('Seleccioná al menos un alineador'); return; }
  const targetStage = parseInt(document.getElementById(`ksel-stage-${cardId}`).value, 10);
  if (isNaN(targetStage)) return;
  const c = state.cases.find(x => x.id === caseId);
  if (!c) return;
  const arc = c.arcadas[arcType];
  if (!arc) return;
  pushUndo();
  let count = 0;
  selected.forEach(el => {
    const idx = parseInt(el.dataset.idx, 10);
    if (!isNaN(idx) && arc.alinStates[idx] === currentStageIdx) {
      const oldStage = arc.alinStates[idx];
      arc.alinStates[idx] = targetStage;
      adjustStockOnStageChange(arc, idx, oldStage, targetStage);
      count++;
    }
  });
  if (count > 0) {
    selected.forEach(el => el.classList.remove('selected'));
    selector.classList.remove('open');
    addActivity(`✏️ Mover ${count} alin. de ${c.patient} a ${targetStage === FINAL_STAGE ? 'Finalizado' : STAGES[targetStage]}`);
    renderAll();
    showToast(`${count} alin. → ${targetStage === FINAL_STAGE ? 'Finalizado' : STAGES[targetStage]}`);
  } else {
    alert('Ninguno de los alineadores seleccionados está en la etapa actual.');
  }
}

document.addEventListener('click', function(e) {
  const openSelectors = document.querySelectorAll('.kanban-alin-selector.open');
  if (!openSelectors.length) return;
  if (e.target.closest('.kanban-alin-selector.open') || e.target.closest('.quick-btns')) return;
  openSelectors.forEach(s => {
    const openTime = parseInt(s.dataset.openTime) || 0;
    if (Date.now() - openTime > 200) s.classList.remove('open');
  });
});

document.querySelectorAll('.quick-btns .qbtn').forEach(btn => {
  btn.addEventListener('touchstart', function(e) { e.preventDefault(); }, {passive: false});
});

function completeStage(caseId, arcType, stageIdx) {
  const c = state.cases.find(x=>x.id===caseId); if(!c) return;
  const arc = c.arcadas[arcType]; if(!arc) return;
  if(stageIdx !== null && stageIdx !== undefined) {
    const next = stageIdx < 3 ? stageIdx + 1 : FINAL_STAGE;
    const indicesToMove = [];
    arc.alinStates.forEach((st,i) => { if(st===stageIdx) indicesToMove.push(i); });
    if (!confirm(`¿Mover ${indicesToMove.length} alineadores a ${next===FINAL_STAGE?'Finalizado':STAGES[next]}?`)) return;
    pushUndo();
    let count = 0;
    arc.alinStates.forEach((st,i) => {
      if(st===stageIdx) {
        const oldStage = arc.alinStates[i];
        arc.alinStates[i] = next;
        adjustStockOnStageChange(arc, i, oldStage, next);
        count++;
      }
    });
    if(count>0) {
      addActivity(`✓ ${c.patient}: ${count} uds → ${next===FINAL_STAGE?'Finalizado':STAGES[next]}`);
      renderAll();
      showToast(`${count} uds → ${next===FINAL_STAGE?'Finalizado ✓':STAGES[next]}`);
    } else showToast('Sin alineadores en esa etapa');
  } else {
    let count = 0;
    if (!confirm(`¿Avanzar todos los alineadores posibles de ${c.patient}?`)) return;
    pushUndo();
    arc.alinStates.forEach((st,i) => {
      const old = st;
      if(st>=0 && st<3) { arc.alinStates[i]=st+1; adjustStockOnStageChange(arc,i,old,st+1); count++; }
      else if(st===3) { arc.alinStates[i]=FINAL_STAGE; adjustStockOnStageChange(arc,i,old,FINAL_STAGE); count++; }
    });
    if(count>0) { addActivity(`✓ ${c.patient}: ${count} alineadores avanzados`); renderAll(); showToast(`${count} alineadores avanzados`); }
    else showToast('Nada para avanzar');
  }
}

// ==================== CASOS ====================
function renderCases() {
  const f = state.cFilter;
  let list = state.cases;
  if (f !== 'all') list = list.filter(c => getPrio(c.delivery) === f);
  if (state.doctorFilter) {
    const df = state.doctorFilter.toLowerCase();
    list = list.filter(c => c.doctorId.toLowerCase().startsWith(df));
  }
  const bmap = {urgente:'<span class="case-badge urgente">⚠ URGENTE</span>',proximo:'<span class="case-badge proximo">● PRÓXIMO</span>',ok:'<span class="case-badge ok">✓ OK</span>'};
  const dcol = {urgente:'var(--red)',proximo:'var(--yellow)',ok:'var(--green)'};
  const clsMap = ['print','thermo','cutpolish','listo'];
  document.getElementById('casesList').innerHTML = list.map(c => {
    const p = getPrio(c.delivery); const d = daysUntil(c.delivery);
    const arcHtml = ['sup','inf'].map(at => {
      const arc = c.arcadas[at];
      if (!arc) return '';
      const lbl = at==='sup'?'▲ Superior':'▼ Inferior';
      const stageCounts = {0:0,1:0,2:0,3:0};
      arc.alinStates.forEach(st => { if(st>=0 && st<4) stageCounts[st]++; });
      const summaryStr = `Impr:${stageCounts[0]} T:${stageCounts[1]} C/P:${stageCounts[2]} Listo:${stageCounts[3]}`;
      const selSame = selection.caseId===c.id && selection.arcType===at;
      const chips = arc.alinStates.map((st,i) => {
        let cls = 'pendiente';
        if(st>=0 && st<4) cls = clsMap[st];
        else if(st===FINAL_STAGE) cls = 'done';
        const sel = selSame && selection.indices.has(i) ? ' selected' : '';
        const stlButton = (arc.stlUrls && arc.stlUrls[i]) 
          ? `<a href="${arc.stlUrls[i]}" target="_blank" title="Descargar STL ${i}" onclick="event.stopPropagation()" class="stl-download-btn">📎</a>` 
          : '';
        return `<div style="display:inline-flex; align-items:center; gap:2px">
          <span class="alin-chip ${cls}${sel}" onclick="event.stopPropagation();toggleAlin('${c.id}','${at}',${i})">${i}${st===FINAL_STAGE?'✓':''}</span>
          ${stlButton}
        </div>`;
      }).join('');
      const selCount = selSame ? selection.indices.size : 0;
      const actHtml = selCount > 0 ? `
        <div class="arcada-actions">
          <select id="moveTarget-${c.id}-${at}" class="form-input" style="width:auto;padding:4px 8px;font-size:10px">
            <option value="0">Imprimir</option><option value="1">Termoformar</option>
            <option value="2">Corte/Pulido</option><option value="3">Listo</option>
            <option value="4">Finalizado</option>
          </select>
          <button class="qbtn" style="color:var(--accent);border-color:var(--accent)" onclick="moveSelected('${c.id}','${at}')">Mover ${selCount}</button>
          <button class="qbtn" style="color:var(--text3)" onclick="clearSelection()">✕</button>
        </div>` : '';
      return `<div class="arcada-block">
        <div class="arcada-title">
          <span class="arc-badge ${at}">${lbl}</span>
          <span class="arc-total-lbl">${arc.total} alin.</span>
          <span style="font-size:9px;color:var(--text3);margin-left:8px">${summaryStr}</span>
        </div>
        <div class="alin-grid">${chips}</div>
        ${actHtml}
        <div style="margin-top:6px"><button class="qbtn" onclick="event.stopPropagation();completeStage('${c.id}','${at}',null)">✓ Completar todo posible</button></div>
      </div>`;
    }).join('');
    return `<div class="case-card ${c.open?'open':''}" id="case-${c.id}">
      <div class="case-header">
        <div class="case-info" onclick="toggleCase('${c.id}')">
          <div class="case-prio-dot" style="background:${dcol[p]}"></div>
          <div><div class="case-name">${c.patient}</div><div class="case-doctor">${c.doctorId||c.doctor}</div></div>
        </div>
        <div class="case-right">
          ${bmap[p]} <span class="case-days" style="${d<=0?'color:var(--red)':''}">${d<=0?'VENCIDO':d+'d'}</span>
          <button class="delete-case-btn" onclick="event.stopPropagation();editCase('${c.id}')">✎</button>
          <button class="delete-case-btn" onclick="event.stopPropagation();deleteCase('${c.id}')">🗑</button>
          <span class="chevron" onclick="toggleCase('${c.id}')">▶</span>
        </div>
      </div>
      ${c.open ? `<div class="case-body"><div class="arcadas-grid">${arcHtml}</div>${(c.obs || (c.pdfUrls && c.pdfUrls.length)) ? `<div class="obs-note">${c.obs ? `📝 ${c.obs}` : ''}${(c.pdfUrls && c.pdfUrls.length) ? c.pdfUrls.map(p => `<div><a href="${p.url}" target="_blank" title="Descargar PDF">📎 ${p.name}</a></div>`).join('') : ''}</div>` : ''}</div>` : ''}
    </div>`;
  }).join('');
}

function filterByDoctor() { state.doctorFilter = document.getElementById('doctorFilterInput').value; renderCases(); }
function clearSelection() { selection={caseId:null,arcType:null,indices:new Set()}; renderCases(); }
function toggleAlin(caseId, arcType, idx) {
  if(selection.caseId!==caseId || selection.arcType!==arcType) {
    selection = {caseId, arcType, indices: new Set([idx])};
  } else {
    if(selection.indices.has(idx)) selection.indices.delete(idx);
    else selection.indices.add(idx);
    if(selection.indices.size===0) clearSelection();
  }
  renderCases();
}
function moveSelected(caseId, arcType) {
  const sel = document.getElementById(`moveTarget-${caseId}-${arcType}`);
  if (!sel) { showToast('Error con el selector de etapa. Refresque el caso.'); return; }
  const target = parseInt(sel.value);
  if (isNaN(target)) return;
  const c = state.cases.find(x => x.id === caseId); if(!c) return;
  const arc = c.arcadas[arcType]; if(!arc) return;
  if (selection.indices.size === 0) { showToast('Seleccioná al menos un alineador'); return; }
  if (!confirm(`¿Mover ${selection.indices.size} alineador(es) a ${target===FINAL_STAGE?'Finalizado':STAGES[target]}?`)) return;
  pushUndo();
  let count = 0;
  selection.indices.forEach(i => {
    const oldStage = arc.alinStates[i];
    arc.alinStates[i] = target;
    adjustStockOnStageChange(arc, i, oldStage, target);
    count++;
  });
  clearSelection();
  addActivity(`✏️ Mover ${count} alin. de ${c.patient}`);
  renderAll();
  showToast(`${count} alin. → ${target===FINAL_STAGE?'Finalizado':STAGES[target]}`);
}

// ==================== CRUD CASOS (con Ingreso/Egreso y STL/PDF) ====================
function openNewCase() {
  editingCaseId = null;
  document.getElementById('caseModalTitle').textContent = 'Nuevo caso';
  document.getElementById('caseSubmitBtn').textContent = 'Crear';
  ['f-patient','f-doctor','f-doctorId','f-sup','f-inf','f-obs'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('f-date').value = daysFromNow(7);
  document.getElementById('f-ingreso').value = '';
  document.getElementById('f-egreso').value = '';
  stlFiles = [];
  pdfFiles = [];
  document.getElementById('stlPreview').innerHTML = '';
  document.getElementById('pdfPreview').innerHTML = '';
  document.getElementById('stlDropZone')?.classList.remove('dragover');
  document.getElementById('pdfDropZone')?.classList.remove('dragover');
  openModal('newCaseModal');
}

async function submitNewCase() {
  const p = document.getElementById('f-patient').value.trim();
  const dr = document.getElementById('f-doctor').value.trim();
  const did = document.getElementById('f-doctorId').value.trim();
  const s = parseInt(document.getElementById('f-sup').value) || 0;
  const inf = parseInt(document.getElementById('f-inf').value) || 0;
  const d = document.getElementById('f-date').value;
  const ob = document.getElementById('f-obs').value.trim();
  const ingreso = parseFloat(document.getElementById('f-ingreso')?.value) || 0;
  const egreso = parseFloat(document.getElementById('f-egreso')?.value) || 0;

  if (!p || !dr || !d) { alert('Completá paciente, doctor y fecha'); return; }

  const resizeArc = (arc, newTotal) => {
    if (!arc) return;
    const oldTotal = arc.alinStates.length;
    if (newTotal > oldTotal) { for (let i = oldTotal; i < newTotal; i++) arc.alinStates.push(-1); }
    else if (newTotal < oldTotal) { arc.alinStates = arc.alinStates.slice(0, newTotal); }
    arc.total = newTotal;
  };

  pushUndo();

  if (editingCaseId) {
    const c = state.cases.find(x => x.id === editingCaseId);
    if (c) {
      c.patient = p; c.doctor = dr; c.doctorId = did; c.delivery = d; c.obs = ob;
      const tieneSup = stlFiles.some(f => f.arc === 'sup');
      const tieneInf = stlFiles.some(f => f.arc === 'inf');
      if (s > 0 || tieneSup) {
        if (!c.arcadas.sup) c.arcadas.sup = makeArc(0);
        resizeArc(c.arcadas.sup, Math.max(s, tieneSup ? Math.max(...stlFiles.filter(f=>f.arc==='sup').map(f=>f.step)) + 1 : 0));
      } else if (!tieneSup) c.arcadas.sup = null;
      if (inf > 0 || tieneInf) {
        if (!c.arcadas.inf) c.arcadas.inf = makeArc(0);
        resizeArc(c.arcadas.inf, Math.max(inf, tieneInf ? Math.max(...stlFiles.filter(f=>f.arc==='inf').map(f=>f.step)) + 1 : 0));
      } else if (!tieneInf) c.arcadas.inf = null;
      c.montoTotal = ingreso; c.egreso = egreso;
    }
    addActivity(`✎ Caso editado: ${p}`);
  } else {
    state.cases.unshift(makeCase(p, dr, did, s, inf, d, ingreso, egreso, ob));
    addActivity(`➕ Nuevo caso: ${p}`);
  }
  const caseId = editingCaseId || (state.cases[0]?.id);
  if (caseId) {
    await uploadSTLFiles(caseId);
    await uploadPDFFiles(caseId);
  }
  closeModal('newCaseModal');
  editingCaseId = null;
  renderAll();
  showToast('Caso guardado ✓');
}

function editCase(id) {
  const c = state.cases.find(x=>x.id===id); if(!c) return;
  editingCaseId = id;
  document.getElementById('caseModalTitle').textContent = 'Editar caso';
  document.getElementById('caseSubmitBtn').textContent = 'Guardar cambios';
  document.getElementById('f-patient').value = c.patient;
  document.getElementById('f-doctor').value = c.doctor;
  document.getElementById('f-doctorId').value = c.doctorId || '';
  document.getElementById('f-sup').value = c.arcadas.sup?.total || '';
  document.getElementById('f-inf').value = c.arcadas.inf?.total || '';
  document.getElementById('f-date').value = c.delivery;
  document.getElementById('f-ingreso').value = c.montoTotal || '';
  document.getElementById('f-egreso').value = c.egreso || '';
  document.getElementById('f-obs').value = c.obs || '';
  stlFiles = [];
  pdfFiles = [];
  document.getElementById('stlPreview').innerHTML = '';
  document.getElementById('pdfPreview').innerHTML = '';
  document.getElementById('stlDropZone')?.classList.remove('dragover');
  document.getElementById('pdfDropZone')?.classList.remove('dragover');
  openModal('newCaseModal');
}

function deleteCase(id) {
  if(!confirm('¿Eliminar este caso?')) return;
  pushUndo();
  const c = state.cases.find(c => c.id === id);
  state.cases = state.cases.filter(c => c.id!==id);
  clearSelection();
  addActivity(`🗑 Caso eliminado: ${c ? c.patient : id}`);
  renderAll();
  showToast('Caso eliminado');
}

// ==================== STOCK ====================
// ... (funciones de stock igual que antes) ...

// ==================== TAREAS DIARIAS ====================
function renderDailyTasks() {
  const tasks = {};
  const prioOrder = { urgente: 0, proximo: 1, ok: 2 };
  state.cases.forEach(c => {
    ['sup','inf'].forEach(at => {
      const arc = c.arcadas[at];
      if (!arc) return;
      const indices = [];
      arc.alinStates.forEach((st, i) => { if (st >= 0 && st < FINAL_STAGE) indices.push(i); });
      if (indices.length === 0) return;
      const stages = {};
      indices.forEach(i => {
        const st = arc.alinStates[i];
        if (!stages[st]) stages[st] = [];
        stages[st].push(i);
      });
      for (const [st, nums] of Object.entries(stages)) {
        const stageIdx = parseInt(st);
        if (!tasks[stageIdx]) tasks[stageIdx] = [];
        tasks[stageIdx].push({
          patient: c.patient, doctorId: c.doctorId, arcType: at,
          numbers: nums, prio: getPrio(c.delivery), delivery: c.delivery
        });
      }
    });
  });

  let html = '';
  const stageColors = ['#2563eb','#7c3aed','#ea580c','#16a34a'];
  for (let si = 0; si < SKEYS.length; si++) {
    const list = tasks[si] || [];
    list.sort((a, b) => si === 3 ? a.numbers.length - b.numbers.length : 0);
    const totalAlin = list.reduce((sum, t) => sum + t.numbers.length, 0);
    html += `<div class="task-stage-group">
      <div class="task-stage-header" style="border-left:4px solid ${stageColors[si]}">
        ${STAGES[si]} <span style="margin-left:auto;font-size:12px;color:var(--text2)">${totalAlin} alin.</span>
      </div>`;
    if (list.length === 0) {
      html += '<div class="task-item"><span style="color:var(--text3)">Sin pendientes</span></div>';
    } else {
      list.forEach(t => {
        const rangeStr = formatRanges(t.numbers);
        const badgeClass = t.prio === 'urgente' ? 'urgent' : (t.prio === 'proximo' ? 'warning' : '');
        const arcLabel = t.arcType === 'sup' ? '▲' : '▼';
        html += `<div class="task-item">
          <span class="task-patient">${arcLabel} ${t.patient.split(',')[0]}</span>
          <span class="task-range">${rangeStr}</span>
          <span class="task-count">${t.numbers.length} uds</span>
          ${badgeClass ? `<span class="task-badge ${badgeClass}">${t.prio.toUpperCase()}</span>` : ''}
        </div>`;
      });
    }
    html += '</div>';
  }
  document.getElementById('dailyTasks').innerHTML = html;
}

// ==================== COMANDOS POR VOZ ====================
// (se mantiene igual, no se incluye por brevedad pero debe estar)

// ==================== FINANZAS (con agrupación) ====================
// ... (todo el bloque de finanzas, incluyendo toggleFinanzasGroup, renderFinanzas con agrupamiento, etc.)
// (copialo de tu versión anterior, no ha cambiado)

// ==================== SUBIDA STL (Supabase) ====================
async function handleSTLDrop(e) { /* igual */ }
async function handleSTLFiles(inputFiles) { /* igual */ }
async function processSTLFiles(files) { /* igual */ }
async function uploadSTLFiles(caseId) { /* igual */ }

// ==================== SUBIDA PDFs (NUEVO) ====================
async function handlePDFDrop(e) {
  e.preventDefault();
  document.getElementById('pdfDropZone').classList.remove('dragover');
  const files = e.dataTransfer.files;
  if (files.length) await processPDFFiles(files);
}

async function handlePDFFiles(inputFiles) {
  await processPDFFiles(inputFiles);
}

async function processPDFFiles(files) {
  const fileList = Array.from(files).filter(f => f.name.toLowerCase().endsWith('.pdf'));
  if (!fileList.length) { showToast('Solo se permiten archivos .pdf'); return; }
  if (fileList.length > 3) { showToast('Máximo 3 archivos PDF'); return; }
  pdfFiles = fileList.map(file => ({ file }));
  document.getElementById('pdfPreview').innerHTML = pdfFiles.map(f => `📄 ${f.file.name}`).join('<br>');
  showToast(`${pdfFiles.length} PDF(s) listos`);
}

async function uploadPDFFiles(caseId) {
  if (!pdfFiles.length) return;
  const c = state.cases.find(x => x.id === caseId);
  if (!c) return;
  if (!c.pdfUrls) c.pdfUrls = [];
  for (const {file} of pdfFiles) {
    const path = `pdfs/${caseId}/${file.name}`;
    const { error } = await supabaseClient.storage.from('stl-files').upload(path, file, { upsert: true });
    if (!error) {
      const { data: urlData } = supabaseClient.storage.from('stl-files').getPublicUrl(path);
      c.pdfUrls.push({ name: file.name, url: urlData.publicUrl });
    } else console.error('Error al subir PDF:', error);
  }
  pdfFiles = [];
  document.getElementById('pdfPreview').innerHTML = '';
}

// ==================== NAVEGACIÓN Y MODALES ====================
function switchView(v, el) {
  document.querySelectorAll('.desktop-nav .tab, .bnav-item').forEach(b => b.classList.remove('active'));
  if(el) el.classList.add('active');
  ['kanban','casos','stock','tareas','finanzas'].forEach(x => document.getElementById('view-'+x).style.display = x===v ? '' : 'none');
  if (v === 'tareas') renderDailyTasks();
  if (v === 'finanzas') renderFinanzas();
}
function setFilter(f, el) { state.kFilter=f; document.querySelectorAll('#view-kanban .filter-btn').forEach(b=>b.classList.remove('active')); el.classList.add('active'); renderKanban(); }
function setCasosFilter(f, el) { state.cFilter=f; document.querySelectorAll('#view-casos .filter-btn').forEach(b=>b.classList.remove('active')); el.classList.add('active'); renderCases(); }
function toggleCase(id) { const c = state.cases.find(x=>x.id===id); if(c){ c.open=!c.open; clearSelection(); renderCases(); } }

function openModal(id) { document.getElementById(id).classList.add('open'); document.body.classList.add('modal-open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); if(!document.querySelector('.modal-overlay.open')) document.body.classList.remove('modal-open'); }
document.addEventListener('keydown', e => { if(e.key==='Escape') { document.querySelectorAll('.modal-overlay.open').forEach(m=>m.classList.remove('open')); document.body.classList.remove('modal-open'); } });
document.addEventListener('click', e => { if(e.target.classList.contains('modal-overlay')) { e.target.classList.remove('open'); if(!document.querySelector('.modal-overlay.open')) document.body.classList.remove('modal-open'); } });

let toastT;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 2500);
}

// ==================== INICIAR ====================
document.getElementById('bn-kanban').classList.add('active');
loadState();
renderAll();
setupFirebaseListener();
requestNotificationPermission();
