// database.js

// Credenciales de Supabase.
const SUPABASE_URL = 'https://ujxasfligvocdqfuiyql.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVqeGFzZmxpZ3ZvY2RxZnVpeXFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY5OTE1NDMsImV4cCI6MjA3MjU2NzU0M30.fUMuAdcvG0LcWhF53KlS3XD5Xp1tq4uKQ6T8atBB2IE';

let supabase;

function initializeSupabase() {
  try {
    // createClient se carga globalmente desde el script del CDN en los HTML
    if (window.supabase && typeof window.supabase.createClient === 'function') {
      const { createClient } = window.supabase;
      supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
      console.log("Supabase client initialized successfully.");
    } else {
      throw new Error('Supabase client not found on window object. Make sure the Supabase CDN script is loaded before this script.');
    }
  } catch (error) {
    console.error('Error initializing Supabase client:', error);
    document.body.innerHTML = '<div style="color: red; padding: 20px;">Error Crítico: No se pudo inicializar la conexión con la base de datos. Verifique la consola para más detalles.</div>';
  }
}

// Esperar a que el DOM esté completamente cargado antes de inicializar Supabase.
// Esto asegura que el script del CDN de Supabase se haya ejecutado y previene errores.
document.addEventListener('DOMContentLoaded', initializeSupabase);

// Exportar la variable supabase. Otros módulos que la importen
// recibirán la instancia una vez que se haya inicializado.
export { supabase };
