// Se importa el cliente de Supabase desde el archivo de configuración central (database.js).
// Esto asegura que toda la aplicación utiliza la misma conexión segura.
import { supabase } from '../database.js';

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
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      throw error;
    }

    // Si estamos en un contexto de negocio específico (ej. login_barberia005.html),
    // se actualiza el metadata del usuario para asociarlo con ese negocio.
    if (data.user && negocioId) {
      const { error: updateError } = await supabase.auth.updateUser({
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
    errorElement.textContent = 'Email o contraseña incorrecta.';
    errorElement.classList.remove('hidden');
  }
});
