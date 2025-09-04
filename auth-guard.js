


// auto.js
import { supabase } from './database.js';

(async () => {
  const {
    data: { session }
  } = await supabase.auth.getSession();

  if (!session) {
    // No hay sesión activa, redirigir al login
    window.location.replace('login.html');
    return;
  }

  // Hay sesión, obtenemos el usuario
  const user = session.user;

  // Guardamos el UUID de Supabase en localStorage
  localStorage.setItem('userId', user.id);

  // Si quieres usar un ID fijo de negocio (barberia0001)
  localStorage.setItem('businessId', 'barberia0001');

  console.log('Usuario autenticado:', user.email);
  console.log('UUID de usuario guardado:', user.id);
  console.log('ID de negocio guardado:', 'barberia0001');
})();
