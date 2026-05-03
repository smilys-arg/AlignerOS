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
setInterval(checkUrgentNotifications, 3600000); // cada hora

// ==================== VARIABLES GLOBALES ====================
let repCtx = null, editingCaseId = null, editingStockId = null;
let selection = { caseId:null, arcType:null, indices:new Set() };

// Historial de deshacer y actividad
const undoStack = [];
const activityLog = [];

// ==================== FUNCIONES AUXILIARES ====================
function daysFromNow(d){ const dt=new Date(); dt.setDate(dt.getDate()+d); return dt.toISOString().slice(0,10); }
function makeArc(t){ return t ? { total:t, alinStates:new Array(t).fill(-1) } : null; }
function makeCase(patient,doctor,doctorId,sup,inf,delivery,obs){
  return { id:uid(), patient, doctor, doctorId:doctorId||'', delivery, obs, arcadas:{sup:makeArc(sup), inf:makeArc(inf)}, open:false };
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

// ==================== ESTADO ====================
const state = {
  cases: [], stock: [], lastModified: 0,
  kFilter: 'all', cFilter: 'all',
  patientFilter: '', doctorFilter: ''
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
        state.lastModified = data.lastModified || 0;
        return;
      }
    }
  } catch(e) {}
  // Si no hay datos locales o son inválidos, cargar desde CSV
  state.cases = buildCasesFromCSV(csvRaw);
  state.stock = [
    {id:uid(),name:'Planchas 0.75mm',type:'Planchas',qty:45,min:30,unit:'láminas',max:200},
    {id:uid(),name:'Planchas 1.0mm',type:'Planchas',qty:12,min:20,unit:'láminas',max:100},
    {id:uid(),name:'Resina UV',type:'Resina',qty:3,min:2,unit:'kg',max:10},
    {id:uid(),name:'Bolsas',type:'Packaging',qty:180,min:50,unit:'unid',max:500},
  ];
  state.lastModified = Date.now();
  saveState();
}

function saveState(){
  try {
    const data = { cases: state.cases, stock: state.stock, lastModified: state.lastModified };
    localStorage.setItem(LS_KEY, JSON.stringify(data));
    if (db && isOnline && !writeLock) {
      writeLock = true;
      const rootRef = db.ref('/');
      rootRef.transaction(currentData => {
        // Si el remote lastModified es mayor, abortamos para no sobrescribir cambios más nuevos
        if (currentData && currentData.lastModified > state.lastModified) {
          return; // abort
        }
        return { ...data, lastModified: Date.now() };
      }, (error, committed, snapshot) => {
        writeLock = false;
        if (error) {
          console.error('Transacción fallida:', error);
          showToast('Error de sincronización');
        } else if (!committed) {
          // Conflicto: recargar datos remotos
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
    if (writeLock) return; // no sobrescribir mientras escribimos
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

// ==================== COMANDOS POR VOZ (mejorado) ====================
let recognition;
let pendingVoiceActions = null;

function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    alert('Tu navegador no soporta reconocimiento de voz. Probá con Chrome.');
    return;
  }
  recognition = new SpeechRecognition();
  recognition.lang = 'es-ES';
  recognition.interimResults = false;
  recognition.maxAlternatives = 3; // más alternativas para mejor precisión

  recognition.onresult = (event) => {
    // Elegir la transcripción con más espacios (normalmente la más completa)
    let bestTranscript = '';
    for (let i = 0; i < event.results[0].length; i++) {
      const alt = event.results[0][i].transcript.trim();
      if (alt.split(' ').length > bestTranscript.split(' ').length) {
        bestTranscript = alt;
      }
    }
    if (!bestTranscript) bestTranscript = event.results[0][0].transcript.trim();
    processVoiceCommand(bestTranscript.toLowerCase());
  };

  recognition.onerror = (event) => {
    showToast('Error de voz: ' + event.error);
    updateMicButton(false);
  };

  recognition.onend = () => {
    updateMicButton(false);
  };
}

function updateMicButton(active) {
  const btn = document.querySelector('.btn-undo[title*="Cmd"]');
  if (btn) btn.style.background = active ? 'var(--red)' : '';
}

function startVoiceCommand() {
  if (!recognition) initSpeechRecognition();
  if (!recognition) return;

  updateMicButton(true);
  recognition.start();
  showToast('🎤 Te escucho...');
}

// Vocabulario de etapas (mucho más completo)
const voiceStageMap = {
  // Impresión
  'imprimí':0, 'imprimir':0, 'impresión':0, 'impresion':0, 'imprimiendo':0, 'estoy imprimiendo':0,
  'ya imprimí':0, 'se imprimió':0, 'se imprimio':0, 'imprimio':0,
  // Termoformado
  'termoformé':1, 'termoformar':1, 'termoformado':1, 'termoformando':1, 'termoforme':1,
  'ya termoformé':1, 'los termoformé':1, 'termoformo':1, 'termoformó':1, 'termoformo':1,
  // Corte / Pulido
  'corté':2, 'cortar':2, 'corte':2, 'cortando':2, 'ya corté':2, 'corto':2,
  'pulí':2, 'pulir':2, 'pulido':2, 'puliendo':2, 'ya pulí':2, 'pulio':2, 'pulió':2,
  'corté y pulí':2, 'corte y pulido':2,
  // Envío
  'envíe':3, 'enviar':3, 'envío':3, 'envio':3, 'enviado':3, 'envié':3, 'envie':3,
  'lo mandé':3, 'los mandé':3, 'mandar':3, 'mandé':3,
  // Finalizado
  'entregué':4, 'entregar':4, 'entregado':4, 'entregue':4, 'finalicé':4, 'finalizar':4,
  'finalizado':4, 'finalice':4, 'listo':4, 'terminé':4, 'termine':4, 'listos':4
};

function extractNumbers(text) {
  // Extrae todos los números del texto, incluyendo aquellos dentro de rangos como "5-8", "5 a 8", "del 5 al 8"
  const numbers = [];
  // Primero buscamos patrones de rango explícito
  const rangeRegex = /(?:del\s+)?(\d+)\s*(?:al?|a|hasta|-)\s*(\d+)/g;
  let match;
  while ((match = rangeRegex.exec(text)) !== null) {
    const start = parseInt(match[1]);
    const end = parseInt(match[2]);
    for (let i = Math.min(start, end); i <= Math.max(start, end); i++) {
      numbers.push(i);
    }
  }
  // Luego números sueltos (que no formen parte de un rango ya capturado)
  const allMatches = text.match(/\d+/g);
  if (allMatches) {
    allMatches.forEach(numStr => {
      const num = parseInt(numStr);
      if (!numbers.includes(num) && !text.match(new RegExp(`del\\s+${num}\\s+al?\\s+\\d+`))) {
        numbers.push(num);
      }
    });
  }
  return [...new Set(numbers)]; // únicos
}

function extractArcType(text) {
  // Devuelve 'sup', 'inf', o 'ambas'
  const supWords = ['superior', 'superiores', 'arriba', 'maxilar superior', 'los de arriba', 'sup', 's'];
  const infWords = ['inferior', 'inferiores', 'abajo', 'maxilar inferior', 'los de abajo', 'inf', 'i'];
  const hasSup = supWords.some(w => text.includes(w));
  const hasInf = infWords.some(w => text.includes(w));
  if (hasSup && hasInf) return 'ambas';
  if (hasSup) return 'sup';
  if (hasInf) return 'inf';
  return null;
}

function findPatient(nameFragment) {
  if (!nameFragment || nameFragment.length < 2) return null;
  const lower = nameFragment.toLowerCase();
  const matches = state.cases.filter(c =>
    c.patient.toLowerCase().includes(lower) ||
    (c.doctorId && c.doctorId.toLowerCase().includes(lower)) ||
    (c.doctor && c.doctor.toLowerCase().includes(lower))
  );
  return matches.length > 0 ? matches : null;
}

function processVoiceCommand(transcript) {
  console.log('Transcripción:', transcript);

  // Detectar etapa (primera palabra clave que coincida)
  let targetStage = -1;
  for (const [word, stage] of Object.entries(voiceStageMap)) {
    if (transcript.includes(word)) {
      targetStage = stage;
      break;
    }
  }
  if (targetStage === -1) {
    showToast('No entendí la etapa. Probá decir: "imprimí", "termoformé", "corté/pulí", "envié" o "entregué".');
    return;
  }

  // Detectar arcada
  let arcType = extractArcType(transcript);
  if (!arcType) arcType = 'ambas'; // por defecto mover en ambas si no se especifica

  // Extraer números
  const numbers = extractNumbers(transcript);
  if (numbers.length === 0) {
    showToast('No escuché números. Decí "del 1 al 5" o "el 3 y el 7".');
    return;
  }

  // Buscar paciente (antes o después de números)
  const patientRegex = /(?:paciente|de|del|para|a|al)\s+([a-záéíóúñ]+\s?[a-záéíóúñ]*)/i;
  const patientMatch = transcript.match(patientRegex);
  let patientName = null;
  if (patientMatch) {
    patientName = patientMatch[1].trim();
  } else {
    // Intentar usar palabras que suenen a nombre propio (primera palabra con mayúscula en el estado)
    const words = transcript.split(' ');
    for (const word of words) {
      const matches = state.cases.filter(c => c.patient.toLowerCase().includes(word));
      if (matches.length === 1) { patientName = word; break; }
    }
  }
  if (!patientName) {
    showToast('No reconocí el paciente. Decí "paciente Carlos" o "de Lucía".');
    return;
  }

  const matchedCases = findPatient(patientName);
  if (!matchedCases || matchedCases.length === 0) {
    showToast(`Paciente "${patientName}" no encontrado.`);
    return;
  }
  const matchedCase = matchedCases[0]; // si hay varios, usar el primero

  // Construir acciones
  pendingVoiceActions = {
    targetStage,
    matchedCase,
    actions: []
  };

  if (arcType === 'ambas') {
    if (matchedCase.arcadas.sup) pendingVoiceActions.actions.push({ arcType: 'sup', numbers: [...numbers] });
    if (matchedCase.arcadas.inf) pendingVoiceActions.actions.push({ arcType: 'inf', numbers: [...numbers] });
  } else {
    if (matchedCase.arcadas[arcType]) pendingVoiceActions.actions.push({ arcType, numbers: [...numbers] });
  }

  renderVoiceConfirmation(patientName, targetStage);
}

function renderVoiceConfirmation(patientName, targetStage) {
  if (!pendingVoiceActions) return;
  const content = document.getElementById('voiceConfirmContent');
  const stageNames = STAGES.concat(['Finalizado']);
  let html = `<p>Paciente: <strong>${pendingVoiceActions.matchedCase.patient}</strong></p>`;
  html += `<p>Etapa: <strong>${stageNames[targetStage]}</strong></p>`;
  html += '<p>Alineadores:</p><ul>';
  pendingVoiceActions.actions.forEach(a => {
    const arcName = a.arcType === 'sup' ? 'Superior' : 'Inferior';
    html += `<li>${arcName}: ${a.numbers.join(', ')}</li>`;
  });
  html += '</ul>';
  content.innerHTML = html;
  openModal('voiceConfirmModal');
}

function executeVoiceCommand() {
  if (!pendingVoiceActions) return;
  const { matchedCase, actions, targetStage } = pendingVoiceActions;
  let movedCount = 0;

  actions.forEach(action => {
    const arc = matchedCase.arcadas[action.arcType];
    if (!arc) return;
    action.numbers.forEach(i => {
      if (i >= 0 && i < arc.total) {
        arc.alinStates[i] = targetStage;
        movedCount++;
      }
    });
  });

  if (movedCount > 0) {
    addActivity(`🎤 Voz: ${matchedCase.patient} - ${movedCount} alin. → ${STAGES[targetStage] || 'Finalizado'}`);
    renderAll();
    showToast(`${movedCount} alin. movidos por voz ✓`);
  } else {
    showToast('No se pudo mover ningún alineador. Verificá los números.');
  }

  closeModal('voiceConfirmModal');
  pendingVoiceActions = null;
}

// Atajo Ctrl+M para activar micrófono
document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.key === 'm') {
    e.preventDefault();
    startVoiceCommand();
  }
});


function extractRanges(text) {
  // Patrón: número (al|a|-|hasta) número o número suelto
  const ranges = [];
  const rangeRegex = /(\d+)\s*(?:al|a|hasta|-)\s*(\d+)/g;
  let match;
  while ((match = rangeRegex.exec(text)) !== null) {
    ranges.push({ start: parseInt(match[1]), end: parseInt(match[2]) });
  }
  // Buscar números sueltos que no sean parte de un rango
  const singleNumbers = [];
  const allNumbers = text.match(/\d+/g);
  if (allNumbers) {
    allNumbers.forEach(num => {
      const n = parseInt(num);
      if (!ranges.some(r => r.start === n || r.end === n)) {
        singleNumbers.push(n);
      }
    });
  }
  return { ranges, singles: singleNumbers };
}

function processVoiceCommand(transcript) {
  console.log('Transcripción:', transcript);

  // Detectar etapa
  let targetStage = -1;
  let stageWord = '';
  for (const [word, stage] of Object.entries(voiceStageMap)) {
    if (transcript.includes(word)) {
      targetStage = stage;
      stageWord = word;
      break;
    }
  }
  if (targetStage === -1) {
    showToast('No entendí la etapa. Decí "imprimí", "termoformé", "corté", "envié" o "entregué".');
    return;
  }

  // Detectar arcada y rangos
  const arcadaPatterns = {
    'superior': ['superior', 'arriba'],
    'inferior': ['inferior', 'abajo']
  };

  let actions = [];

  for (const [arcType, keywords] of Object.entries(arcadaPatterns)) {
    // Buscar la parte del texto relacionada con esta arcada
    let relevantText = transcript;
    // Intentar encontrar la sección: desde la arcada hacia atrás hasta otra arcada o inicio
    const arcRegex = new RegExp(`(.*?)(?:${keywords.join('|')})`);
    const match = relevantText.match(arcRegex);
    if (match) {
      const { ranges, singles } = extractRanges(match[1] + ' ' + transcript.slice(transcript.indexOf(match[0]) + match[0].length));
      if (ranges.length > 0 || singles.length > 0) {
        actions.push({ arcType, ranges, singles });
      }
    }
  }

  // Si no se detectó arcada explícita, asumimos que aplica a ambas si el paciente solo tiene una arcada
  if (actions.length === 0) {
    const { ranges, singles } = extractRanges(transcript);
    if (ranges.length > 0 || singles.length > 0) {
      // Aplicar a ambas arcadas si existen
      actions.push({ arcType: 'sup', ranges, singles });
      actions.push({ arcType: 'inf', ranges, singles });
    }
  }

  // Detectar paciente
  const patientKeywords = ['paciente', 'de', 'del', 'para', 'a'];
  const patientRegex = new RegExp(`(?:${patientKeywords.join('|')})\\s+([a-záéíóúñ]+\\s*[a-záéíóúñ]*)`, 'i');
  const patientMatch = transcript.match(patientRegex);
  let patientName = '';
  if (patientMatch) {
    patientName = patientMatch[1].trim();
  } else {
    // Buscar nombre propio sin preposición (poco frecuente)
    const words = transcript.split(' ');
    // Tomar palabras con mayúscula inicial en la app
  }

  // Buscar el paciente en state.cases
  let matchedCase = null;
  if (patientName) {
    const lowerName = patientName.toLowerCase();
    const matches = state.cases.filter(c =>
      c.patient.toLowerCase().includes(lowerName) ||
      (c.doctorId && c.doctorId.toLowerCase().includes(lowerName))
    );
    if (matches.length === 1) {
      matchedCase = matches[0];
    } else if (matches.length > 1) {
      // Mostrar ambigüedad en el modal
      pendingVoiceActions = { targetStage, actions, ambiguous: matches };
      renderVoiceConfirmation(patientName, targetStage, actions, matches);
      return;
    } else {
      // Sin coincidencia, mostrar mensaje
      showToast(`Paciente "${patientName}" no encontrado.`);
      return;
    }
  } else {
    showToast('Decí el nombre del paciente. Ej: "del paciente Carlos"');
    return;
  }

  pendingVoiceActions = { targetStage, actions, matchedCase };
  renderVoiceConfirmation(patientName, targetStage, actions, [matchedCase]);
}

function renderVoiceConfirmation(patientName, targetStage, actions, matches) {
  const content = document.getElementById('voiceConfirmContent');
  const stageNames = STAGES.concat(['Finalizado']);
  let html = `<p>Paciente: <strong>${matches[0].patient}</strong></p>`;
  html += `<p>Etapa: <strong>${stageNames[targetStage]}</strong></p>`;
  html += '<p>Cambios:</p><ul>';
  if (actions.length === 0) {
    html += '<li>No se detectaron alineadores específicos.</li>';
  } else {
    actions.forEach(a => {
      const arcName = a.arcType === 'sup' ? 'Superior' : 'Inferior';
      let rangesStr = '';
      if (a.ranges.length > 0) {
        rangesStr += a.ranges.map(r => `${r.start}-${r.end}`).join(', ');
      }
      if (a.singles.length > 0) {
        if (rangesStr) rangesStr += ', ';
        rangesStr += a.singles.join(', ');
      }
      html += `<li>${arcName}: ${rangesStr}</li>`;
    });
  }
  html += '</ul>';
  if (matches.length > 1) {
    html += '<p style="color:var(--red)">⚠ Múltiples coincidencias, se usará la primera.</p>';
  }
  content.innerHTML = html;
  openModal('voiceConfirmModal');
}

function executeVoiceCommand() {
  if (!pendingVoiceActions) return;
  const { targetStage, actions, matchedCase } = pendingVoiceActions;
  if (!matchedCase) return;

  // Ejecutar movimientos
  let movedCount = 0;
  actions.forEach(action => {
    const arc = matchedCase.arcadas[action.arcType];
    if (!arc) return;
    // Convertir rangos a índices
    const indices = new Set();
    action.ranges.forEach(r => {
      for (let i = Math.min(r.start, r.end); i <= Math.max(r.start, r.end); i++) {
        if (i >= 0 && i < arc.total) indices.add(i);
      }
    });
    action.singles.forEach(i => {
      if (i >= 0 && i < arc.total) indices.add(i);
    });
    // Mover cada índice
    indices.forEach(i => {
      if (arc.alinStates[i] !== undefined) {
        arc.alinStates[i] = targetStage;
        movedCount++;
      }
    });
  });

  if (movedCount > 0) {
    addActivity(`🎤 Voz: ${matchedCase.patient} - ${movedCount} alin. → ${STAGES[targetStage] || 'Finalizado'}`);
    renderAll();
    showToast(`${movedCount} alin. movidos por voz ✓`);
  } else {
    showToast('No se pudo mover ningún alineador. Verificá los números.');
  }

  closeModal('voiceConfirmModal');
  pendingVoiceActions = null;
}

// Atajo Ctrl+M para activar micrófono
document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.key === 'm') {
    e.preventDefault();
    startVoiceCommand();
  }
});

// ==================== RENDERIZADOS ====================
function renderAll() {
  renderStats();
  renderProgressBar();
  renderAlerts();
  renderKanban();
  renderCases();
  renderStock();
  saveState();
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
  document.getElementById('progressBarContainer').innerHTML = `
    <div class="progress-bar-label">
      <span>Progreso general</span>
      <span>${finishedAlin} / ${totalAlin} alineadores (${pct}%)</span>
    </div>
    <div class="progress-bar-bg"><div class="progress-bar-fill" style="width:${pct}%"></div></div>
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
    <div class="stat-card"><div class="stat-label">Impresión</div><div class="stat-value" style="color:var(--sp)">${cnt[0]}</div></div>
    <div class="stat-card"><div class="stat-label">Termo.</div><div class="stat-value" style="color:var(--st)">${cnt[1]}</div></div>
    <div class="stat-card"><div class="stat-label">Corte/Pul</div><div class="stat-value" style="color:var(--sc)">${cnt[2]}</div></div>
    <div class="stat-card"><div class="stat-label">Envío</div><div class="stat-value" style="color:var(--senv)">${cnt[3]}</div></div>`;
}

function renderAlerts() {
  const a = [];
  state.cases.forEach(c => {
    const prio = getPrio(c.delivery);
    if (!isCaseCompletelyFinished(c)) {
      const d = daysUntil(c.delivery);
      if (d <= 0) {
        a.push({t:'critical', m:`☠ VENCIDO: ${c.patient.split(',')[0]}`});
      } else if (d === 1) {
        a.push({t:'red', m:`🔴 MAÑANA: ${c.patient.split(',')[0]}`});
      } else if (d === 2) {
        a.push({t:'orange', m:`🟠 2 días: ${c.patient.split(',')[0]}`});
      } else if (prio === 'proximo') {
        a.push({t:'yellow', m:`🟡 ${d} días: ${c.patient.split(',')[0]}`});
      }
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
  document.getElementById('kanban').innerHTML = SKEYS.map((key, stageIdx) => {
    const color = Object.values(SCOLS)[stageIdx];
    let cards = [];
    state.cases.forEach(c => ['sup','inf'].forEach(at => {
      const arc = c.arcadas[at]; if(!arc) return;
      const indices = [];
      arc.alinStates.forEach((st,i) => { if(st===stageIdx) indices.push(i); });
      if(!indices.length) return;
      if (patientFilter && !c.patient.toLowerCase().includes(patientFilter)) return;
      const p = getPrio(c.delivery);
      if(f==='urgente' && p!=='urgente') return;
      if(f==='proximo' && p!=='proximo') return;
      if(f==='sup' && at!=='sup') return;
      if(f==='inf' && at!=='inf') return;
      cards.push({c,at,p,indices});
    }));
    cards.sort((a,b)=> ( {urgente:0,proximo:1,ok:2}[a.p] - {urgente:0,proximo:1,ok:2}[b.p] ));
    const body = cards.length ? cards.map(it => {
      const d = daysUntil(it.c.delivery);
      const rangeStr = formatRanges(it.indices);
      const cardId = `${it.c.id}-${it.at}-${stageIdx}`;
      return `<div class="arc-card ${it.p}">
        <div class="arc-top"><div style="min-width:0;flex:1"><div class="arc-patient">${it.c.patient.split(',')[0]}</div><div class="arc-doctor">${it.c.doctorId||it.c.doctor}</div></div><span class="arc-type ${it.at}">${it.at.toUpperCase()}</span></div>
        <div class="alin-range">${rangeStr} (${it.indices.length} uds)</div>
        <div class="arc-bottom"><span class="delivery-chip ${it.p}">📅 ${d<=0?'VENCIDO':d+'d'}</span>
        <div class="quick-btns">
          <button class="qbtn" onclick="event.stopPropagation(); toggleKanbanSelector('${cardId}','${it.c.id}','${it.at}',${stageIdx})">Seleccionar</button>
          <button class="qbtn done-btn" onclick="event.stopPropagation(); completeStage('${it.c.id}','${it.at}',${stageIdx})">✓</button>
        </div></div>
        <div class="kanban-alin-selector" id="ksel-${cardId}">
          <div class="alin-grid" id="ksel-grid-${cardId}" style="max-height:100px;overflow-y:auto;margin-bottom:6px"></div>
          <select id="ksel-stage-${cardId}" class="form-input" style="margin-right:6px;padding:4px 8px;font-size:10px">
            <option value="0">Impresión</option><option value="1">Termoformado</option>
            <option value="2">Corte/Pulido</option><option value="3">Envío</option>
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

function toggleKanbanSelector(cardId, caseId, arcType, stageIdx) {
  stageIdx = parseInt(stageIdx, 10);
  const selector = document.getElementById(`ksel-${cardId}`);
  if (!selector) return;
  const isOpen = selector.classList.contains('open');
  document.querySelectorAll('.kanban-alin-selector.open').forEach(s => s.classList.remove('open'));
  if (isOpen) return;
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
  selector.classList.add('open');
}

function moveSelectedFromKanban(cardId, caseId, arcType, currentStageIdx) {
  currentStageIdx = parseInt(currentStageIdx, 10);
  const selector = document.getElementById(`ksel-${cardId}`);
  if (!selector) return;
  const selected = selector.querySelectorAll('.kanban-alin-item.selected');
  if (selected.length === 0) { alert('Seleccioná al menos un alineador'); return; }
  // Sin confirmación: mueve directamente
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
      arc.alinStates[idx] = targetStage;
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

function completeStage(caseId, arcType, stageIdx) {
  const c = state.cases.find(x=>x.id===caseId); if(!c) return;
  const arc = c.arcadas[arcType]; if(!arc) return;
  if(stageIdx !== null && stageIdx !== undefined) {
    const next = stageIdx < 3 ? stageIdx + 1 : FINAL_STAGE;
    const indicesToMove = [];
    arc.alinStates.forEach((st,i) => { if(st===stageIdx) indicesToMove.push(i); });
    // Se mantiene la confirmación solo para la acción de completar etapa
    if (!confirm(`¿Mover ${indicesToMove.length} alineadores a ${next===FINAL_STAGE?'Finalizado':STAGES[next]}?`)) return;
    pushUndo();
    let count = 0;
    arc.alinStates.forEach((st,i) => { if(st===stageIdx) { arc.alinStates[i]=next; count++; } });
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
      if(st>=0 && st<3) { arc.alinStates[i]=st+1; count++; }
      else if(st===3) { arc.alinStates[i]=FINAL_STAGE; count++; }
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
  const clsMap = ['print','thermo','cutpolish','ship'];
  document.getElementById('casesList').innerHTML = list.map(c => {
    const p = getPrio(c.delivery); const d = daysUntil(c.delivery);
    const arcHtml = ['sup','inf'].map(at => {
      const arc = c.arcadas[at];
      if (!arc) return '';
      const lbl = at==='sup'?'▲ Superior':'▼ Inferior';
      const selSame = selection.caseId===c.id && selection.arcType===at;
      const chips = arc.alinStates.map((st,i) => {
        let cls = 'pendiente';
        if(st>=0 && st<4) cls = clsMap[st];
        else if(st===FINAL_STAGE) cls = 'done';
        const sel = selSame && selection.indices.has(i) ? ' selected' : '';
        return `<span class="alin-chip ${cls}${sel}" onclick="event.stopPropagation();toggleAlin('${c.id}','${at}',${i})">${i}${st===FINAL_STAGE?'✓':''}</span>`;
      }).join('');
      const selCount = selSame ? selection.indices.size : 0;
      const actHtml = selCount > 0 ? `
        <div class="arcada-actions">
          <select id="moveTarget-${c.id}-${at}" class="form-input" style="width:auto;padding:4px 8px;font-size:10px">
            <option value="0">Impresión</option><option value="1">Termoformado</option>
            <option value="2">Corte/Pulido</option><option value="3">Envío</option>
            <option value="4">Finalizado</option>
          </select>
          <button class="qbtn" style="color:var(--accent);border-color:var(--accent)" onclick="moveSelected('${c.id}','${at}')">Mover ${selCount}</button>
          <button class="qbtn" style="color:var(--text3)" onclick="clearSelection()">✕</button>
        </div>` : '';
      return `<div class="arcada-block">
        <div class="arcada-title"><span class="arc-badge ${at}">${lbl}</span><span class="arc-total-lbl">${arc.total} alin.</span></div>
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
      ${c.open ? `<div class="case-body"><div class="arcadas-grid">${arcHtml}</div>${c.obs ? `<div class="obs-note">📝 ${c.obs}</div>` : ''}</div>` : ''}
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
  if(!sel) return;
  const target = parseInt(sel.value);
  const c = state.cases.find(x=>x.id===caseId); if(!c) return;
  const arc = c.arcadas[arcType]; if(!arc) return;
  pushUndo();
  selection.indices.forEach(i => { arc.alinStates[i] = target; });
  clearSelection();
  addActivity(`✏️ Mover ${selection.indices.size} alin. de ${c.patient}`);
  renderAll();
  showToast(`${selection.indices.size} alin. → ${target===FINAL_STAGE?'Finalizado':STAGES[target]}`);
}

// ==================== CRUD CASOS ====================
function openNewCase() {
  editingCaseId = null;
  document.getElementById('caseModalTitle').textContent = 'Nuevo caso';
  document.getElementById('caseSubmitBtn').textContent = 'Crear';
  ['f-patient','f-doctor','f-doctorId','f-sup','f-inf','f-obs'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('f-date').value = daysFromNow(7);
  openModal('newCaseModal');
}
function submitNewCase() {
  const p = document.getElementById('f-patient').value.trim();
  const dr = document.getElementById('f-doctor').value.trim();
  const did = document.getElementById('f-doctorId').value.trim();
  const s = parseInt(document.getElementById('f-sup').value) || 0;
  const inf = parseInt(document.getElementById('f-inf').value) || 0;
  const d = document.getElementById('f-date').value;
  const ob = document.getElementById('f-obs').value.trim();
  if(!p || !dr || !d) { alert('Completá paciente, doctor y fecha'); return; }
  pushUndo();
  if(editingCaseId) {
    const c = state.cases.find(x=>x.id===editingCaseId);
    if(c) {
      c.patient = p; c.doctor = dr; c.doctorId = did; c.delivery = d; c.obs = ob;
      if(s>0) { if(!c.arcadas.sup) c.arcadas.sup = makeArc(s); else c.arcadas.sup.total = s; }
      else c.arcadas.sup = null;
      if(inf>0) { if(!c.arcadas.inf) c.arcadas.inf = makeArc(inf); else c.arcadas.inf.total = inf; }
      else c.arcadas.inf = null;
    }
    addActivity(`✎ Caso editado: ${p}`);
  } else {
    state.cases.unshift(makeCase(p,dr,did,s,inf,d,ob));
    addActivity(`➕ Nuevo caso: ${p}`);
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
  document.getElementById('f-obs').value = c.obs || '';
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
function renderStock() {
  document.getElementById('stockGrid').innerHTML = state.stock.map(s => {
    const pct = Math.min(100, (s.qty/s.max)*100);
    const lv = s.qty <= s.min ? 'low' : s.qty <= s.min*1.5 ? 'medium' : 'good';
    return `<div class="stock-card">
      <button class="stock-edit-btn" onclick="editStock('${s.id}')">✎</button>
      <div class="stock-name">${s.name}</div><div class="stock-type-lbl">${s.type}</div>
      <div class="stock-level-row"><span class="stock-qty ${lv}">${s.qty}</span><span class="stock-unit-lbl">${s.unit}</span></div>
      <div class="stock-bar-bg"><div class="stock-bar ${lv}" style="width:${pct}%"></div></div>
      <div class="stock-min-lbl">Mínimo: ${s.min} ${s.unit}</div>
      ${lv==='low'?`<div class="stock-alert-msg">⚠ Stock bajo</div>`:''}
      <div class="stock-actions">
        <button class="stock-btn" onclick="adjStock('${s.id}',-1)">−1</button>
        <button class="stock-btn" onclick="adjStock('${s.id}',-5)">−5</button>
        <button class="stock-btn primary" onclick="adjStock('${s.id}',10)">+10</button>
        <button class="stock-btn primary" onclick="openReponer('${s.id}')">↑ Rep.</button>
        <button class="stock-btn danger" onclick="deleteStock('${s.id}')">🗑</button>
      </div>
    </div>`;
  }).join('');
}
function openStockModal() {
  editingStockId = null;
  document.getElementById('stockModalTitle').textContent = 'Agregar material';
  document.getElementById('stockSubmitBtn').textContent = 'Guardar';
  ['sm-name','sm-unit','sm-qty','sm-min'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('sm-type').value = 'Planchas';
  openModal('stockModal');
}
function editStock(id) {
  const s = state.stock.find(x=>x.id===id);
  if (!s) return;
  editingStockId = id;
  document.getElementById('stockModalTitle').textContent = 'Editar material';
  document.getElementById('stockSubmitBtn').textContent = 'Guardar cambios';
  document.getElementById('sm-name').value = s.name;
  document.getElementById('sm-type').value = s.type;
  document.getElementById('sm-unit').value = s.unit;
  document.getElementById('sm-qty').value = s.qty;
  document.getElementById('sm-min').value = s.min;
  openModal('stockModal');
}
function submitStock() {
  const name = document.getElementById('sm-name').value.trim();
  if (!name) { alert('Nombre requerido'); return; }
  pushUndo();
  const type = document.getElementById('sm-type').value;
  const unit = document.getElementById('sm-unit').value.trim() || 'unid';
  const qty = parseInt(document.getElementById('sm-qty').value) || 0;
  const min = parseInt(document.getElementById('sm-min').value) || 10;

  if (editingStockId) {
    const s = state.stock.find(x=>x.id===editingStockId);
    if (s) { s.name = name; s.type = type; s.unit = unit; s.qty = qty; s.min = min; }
    editingStockId = null;
    addActivity(`✎ Material editado: ${name}`);
  } else {
    state.stock.push({ id:uid(), name, type, unit, qty, min, max: 200 });
    addActivity(`➕ Material agregado: ${name}`);
  }
  closeModal('stockModal');
  renderAll();
  showToast(editingStockId ? 'Material actualizado ✓' : 'Material agregado ✓');
}
function adjStock(id, delta) { pushUndo(); const s = state.stock.find(x=>x.id===id); if(s) { s.qty = Math.max(0, s.qty+delta); addActivity(`🔢 Stock: ${s.name} ${delta>=0?'+'+delta:delta}`); renderAll(); } }
function deleteStock(id) { if(confirm('Eliminar?')) { pushUndo(); const s = state.stock.find(x=>x.id===id); state.stock = state.stock.filter(s=>s.id!==id); addActivity(`🗑 Material eliminado: ${s? s.name : id}`); renderAll(); } }
function openReponer(id) {
  repCtx = id;
  const s = state.stock.find(x=>x.id===id); if(!s) return;
  document.getElementById('rm-title').textContent = `Reponer: ${s.name}`;
  document.getElementById('rm-sub').textContent = `Actual: ${s.qty} ${s.unit}`;
  openModal('reponerModal');
}
function addRepQty(n) { const i=document.getElementById('rm-inp'); i.value = (parseInt(i.value)||0) + n; }
function confirmReponer() {
  const n = parseInt(document.getElementById('rm-inp').value);
  if(!n || n<=0) { alert('Ingresá cantidad'); return; }
  pushUndo();
  const s = state.stock.find(x=>x.id===repCtx);
  if(s) { s.qty += n; addActivity(`📦 Reponer: ${s.name} +${n} ${s.unit}`); closeModal('reponerModal'); renderAll(); showToast(`+${n} ${s.unit}`); }
}

// ==================== NAVEGACIÓN Y MODALES ====================
function switchView(v, el) {
  document.querySelectorAll('.desktop-nav .tab, .bnav-item').forEach(b => b.classList.remove('active'));
  if(el) el.classList.add('active');
  ['kanban','casos','stock'].forEach(x => document.getElementById('view-'+x).style.display = x===v ? '' : 'none');
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
