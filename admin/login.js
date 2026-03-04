// Se importa el cliente de Supabase desde el archivo de configuración central (database.js).
// Esto asegura que toda la aplicación utiliza la misma conexión segura.
import { ensureSupabase } from '../database.js';

/**
 * Obtiene el ID del negocio desde el atributo `data-negocio-id` en el body.
 * @returns {string|undefined} El ID del negocio o undefined si no se encuentra.
 */
function getNegocioId() {
  return document.body.dataset.negocioId;
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const errorElement = document.getElementById('error');
  const negocioId = getNegocioId();

  try {
    // Verificar conexión antes de intentar login
    if (!navigator.onLine) {
      throw new Error('Sin conexión a internet. Verifique su red.');
    }

    const client = await ensureSupabase();
    const { data, error } = await client.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      // Manejar errores específicos de Supabase/Red
      if (error.message.includes('fetch')) {
        throw new Error('No se pudo contactar al servidor. Verifique su conexión.');
      }
      throw error;
    }

    // Si estamos en un contexto de negocio específico (ej. login_barberia005.html),
    // se actualiza el metadata del usuario para asociarlo con ese negocio.
    if (data.user && negocioId) {
      const { error: updateError } = await client.auth.updateUser({
        data: { negocio_id: negocioId }
      });
      
      if (updateError) {
        // No es un error fatal, pero es bueno registrarlo para depuración.
        console.warn('No se pudo actualizar el negocio_id del usuario:', updateError.message);
      }
    }

    // Redirigir al panel de administración correspondiente.
    // Si hay un negocioId, va a `panel_NEGOCIO.html`, si no, a `panel.html`.
    const panelUrl = negocioId ? `panel_${negocioId}.html` : 'panel.html';
    window.location.replace(panelUrl);

  } catch (error) {
    console.error('Error en el inicio de sesión:', error.message);
    
    // Diferenciar mensaje según el tipo de error
    if (error.message.includes('Sin conexión') || error.message.includes('servidor')) {
      errorElement.textContent = error.message;
    } else {
      errorElement.textContent = 'Email o contraseña incorrecta.';
    }
    
    errorElement.classList.remove('hidden');
  }
});
