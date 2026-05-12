// ==================== FIREBASE ====================
const firebaseConfig = {
  apiKey: "AIzaSyCSsY1tA5AFzIVj-Tbg-XjxoKY73W0YPZs",
  authDomain: "alingneros.firebaseapp.com",
  databaseURL: "https://alingneros-default-rtdb.firebaseio.com",
  projectId: "alingneros",
  storageBucket: "alingneros.firebasestorage.app",
  messagingSenderId: "868408246733",
  appId: "1:868408246733:web:4affa1c056767283b10484"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// ==================== CONSTANTES ====================
const STAGES = ['Imprimir','Termoformar','Cortar/Pulir','Listo'];
const SKEYS = ['imprimir','termoformar','cutpolish','listo'];
const SCOLS = {
  imprimir: '#dc2626',     // rojo
  termoformar: '#06b6d4',     // cian
  cutpolish: '#2563eb',    // azul
  listo: '#16a34a'         // verde
};
const FINAL_STAGE = 4;
const LS_KEY = 'aligner_data_v1';
const MAX_UNDO = 20;
const MAX_ACTIVITY = 100;

let isOnline = false;
let writeLock = false;

// Función de utilidad para generar IDs
function uid() {
  return Math.random().toString(36).slice(2,9);
}
