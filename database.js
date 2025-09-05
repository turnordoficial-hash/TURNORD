// database.js

// Las credenciales de Supabase se cargan desde el CDN en los archivos HTML.
// Este archivo crea y exporta una única instancia del cliente de Supabase.

const SUPABASE_URL = 'https://sdicbmfdtsojcgquifom.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNkaWNibWZkdHNvamNncXVpZm9tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MjMyODc5MjUsImV4cCI6MjAzODg2MzkyNX0.835N3Vd-0s2N1k6c3c6fH5S4SNlT4x3n3N022S6k6iQ';

let supabase;

try {
  // createClient se carga globalmente desde el script del CDN en los HTML
  const { createClient } = window.supabase;
  if (!createClient) {
    throw new Error('Supabase client not found on window object. Make sure the Supabase CDN script is loaded in your HTML file.');
  }
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
} catch (error) {
  console.error('Error initializing Supabase client:', error);
  // Opcional: Mostrar un error al usuario
  document.body.innerHTML = '<div style="color: red; padding: 20px;">Error Crítico: No se pudo inicializar la conexión con la base de datos.</div>';
}

export { supabase };