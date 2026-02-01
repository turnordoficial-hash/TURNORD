// database.js

// Credenciales de Supabase.
const SUPABASE_URL = 'https://wjvwjirhxenotvdewbmm.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndqdndqaXJoeGVub3R2ZGV3Ym1tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5Mzc1MTEsImV4cCI6MjA4NTUxMzUxMX0.8tze0Dr0Js-aFpOMt7QKa5ImfcDnkZAUKomrjJXjcig';

let supabase;
let supabaseReadyResolve;
const supabaseReady = new Promise(r => { supabaseReadyResolve = r; });

function initializeSupabase() {
  try {
    if (window.supabase && typeof window.supabase.createClient === 'function') {
      const { createClient } = window.supabase;
      supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
      console.log("Supabase client initialized successfully.");
      supabaseReadyResolve && supabaseReadyResolve(supabase);
    } else {
      throw new Error('Supabase client not found on window object. Make sure the Supabase CDN script is loaded before this script.');
    }
  } catch (error) {
    console.error('Error initializing Supabase client:', error);
    document.body.innerHTML = '<div style="color: red; padding: 20px;">Error Crítico: No se pudo inicializar la conexión con la base de datos. Verifique la consola para más detalles.</div>';
  }
}

if (document.readyState !== 'loading') {
  initializeSupabase();
} else {
  document.addEventListener('DOMContentLoaded', initializeSupabase);
}

async function ensureSupabase() {
  if (supabase) return supabase;
  await supabaseReady;
  return supabase;
}

export { supabase, ensureSupabase };
