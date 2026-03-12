// Se importa el cliente de Supabase desde el archivo de configuración central (database.js).
// Esto asegura que toda la aplicación utiliza la misma conexión segura.
import { ensureSupabase } from '../database.js?v=2';

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
    
    // 1. Intentar Login vía Supabase Auth (Fuente principal)
    const { data, error } = await client.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      // 2. Fallback informativo: ¿Existe en la tabla barberos pero con otra contraseña?
      // Esto ayuda al usuario a saber si su cuenta existe pero el login de Auth falla.
      const { data: barberData } = await client
        .from('barberos')
        .select('usuario, password')
        .eq('usuario', email)
        .eq('negocio_id', negocioId)
        .maybeSingle();

      if (barberData) {
        if (barberData.password === password) {
            throw new Error('Credenciales correctas en base de datos, pero el usuario no está registrado en el sistema de Autenticación (Supabase Auth). Contacte al administrador.');
        } else {
            throw new Error('Contraseña incorrecta para este usuario.');
        }
      }

      if (error.message.includes('fetch')) {
        throw new Error('No se pudo contactar al servidor. Verifique su conexión.');
      }
      throw error;
    }

    // Si el login fue exitoso, asegurar que el metadata tenga el negocio_id
    if (data.user && negocioId) {
      const currentNegocioId = data.user.user_metadata?.negocio_id;
      if (currentNegocioId !== negocioId) {
          await client.auth.updateUser({
            data: { negocio_id: negocioId }
          });
      }

      // VINCULACIÓN AUTOMÁTICA DE BARBERO
      // Si el usuario existe en la tabla 'barberos' por email pero no tiene user_id, lo vinculamos.
      const { data: barberMatch } = await client
        .from('barberos')
        .select('id, user_id')
        .eq('usuario', data.user.email)
        .eq('negocio_id', negocioId)
        .maybeSingle();

      if (barberMatch) {
        if (!barberMatch.user_id) {
          const { error: linkError } = await client
            .from('barberos')
            .update({ user_id: data.user.id })
            .eq('id', barberMatch.id);
          
          if (linkError) {
            console.error('Error vinculando barbero:', linkError.message);
          } else {
            console.log('Barbero vinculado automáticamente por email.');
          }
        }

        // AUTO-CREACIÓN DE ROL SI NO EXISTE
        const { data: roleCheck, error: roleCheckError } = await client
          .from('roles_negocio')
          .select('rol')
          .eq('user_id', data.user.id)
          .eq('negocio_id', negocioId)
          .maybeSingle();

        if (roleCheckError) {
          console.error('Error verificando rol:', roleCheckError.message);
        }

        if (!roleCheck) {
          // Si es el barbero principal o tiene el email del admin, le damos rol admin
          const isMainAdmin = data.user.email === 'jbarber.vip@gmail.com';
          const { error: insertError } = await client
            .from('roles_negocio')
            .insert({
              user_id: data.user.id,
              negocio_id: negocioId,
              rol: isMainAdmin ? 'admin' : 'staff'
            });
          
          if (insertError) {
            console.error('Error creando rol:', insertError.message);
          } else {
            console.log('Rol de negocio creado automáticamente para el barbero.');
          }
        }
      }
    }

    // 3. Verificar si el usuario tiene un rol asignado para este negocio
    if (data.user && negocioId) {
        // Obtenemos el rol actual
        const { data: roleData, error: roleError } = await client
            .from('roles_negocio')
            .select('rol')
            .eq('user_id', data.user.id)
            .eq('negocio_id', negocioId)
            .maybeSingle();

        if (roleError) {
            console.error('Error al verificar rol:', roleError.message);
            throw new Error(`Error de permisos (403): ${roleError.message}. Intente recargar la página.`);
        }

        if (!roleData) {
            console.warn('Usuario sin rol en roles_negocio. Reintentando auto-creación...');
            // Si por alguna razón el paso anterior falló pero no lanzó error, 
            // intentamos asegurar el rol una última vez.
            const isMainAdmin = data.user.email === 'jbarber.vip@gmail.com';
            await client.from('roles_negocio').insert({
                user_id: data.user.id,
                negocio_id: negocioId,
                rol: isMainAdmin ? 'admin' : 'staff'
            });
            
            // Un último intento de lectura
            const { data: finalRole } = await client
                .from('roles_negocio')
                .select('rol')
                .eq('user_id', data.user.id)
                .eq('negocio_id', negocioId)
                .maybeSingle();
                
            if (!finalRole) {
                throw new Error('Su usuario no tiene permisos para acceder a este panel de negocio. Contacte al administrador.');
            }
        }
    }

    // Redirigir al panel de administración correspondiente.
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
