// database.js
import { createClient } from '@supabase/supabase-js';

// Cargar las variables de entorno de Supabase
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Validar que las variables de entorno estén presentes
if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Error: Las variables de entorno de Supabase (VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY) no están configuradas.');
  document.body.innerHTML = '<div style="color: red; padding: 20px;">Error Crítico: La configuración del servidor es incorrecta. Por favor, contacta al administrador.</div>';
  throw new Error('Supabase environment variables are not set.');
}

// Crear y exportar el cliente de Supabase
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
