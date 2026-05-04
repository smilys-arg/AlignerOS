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
const SCOLS = {imprimir:'#2563eb',termoformar:'#7c3aed',cutpolish:'#ea580c',listo:'#16a34a'};
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
