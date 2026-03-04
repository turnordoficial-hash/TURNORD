import { ensureSupabase } from '../database.js';

function getNegocioId() {
  return document.body.dataset.negocioId || 'barberia005';
}

let supabase;
let negocioId;

async function init() {
  supabase = await ensureSupabase();
  negocioId = getNegocioId();
  bindEvents();
  await cargarBarberos();
  setupSidebar();
}

function bindEvents() {
  const fileInput = document.getElementById('barber-avatar');
  const preview = document.getElementById('barber-avatar-preview');
  const btnGuardar = document.getElementById('barber-guardar');
  const btnNuevo = document.getElementById('barber-nuevo');

  if (fileInput && preview) {
    fileInput.addEventListener('change', () => {
      const f = fileInput.files?.[0];
      if (f) {
        const reader = new FileReader();
        reader.onload = (e) => {
          if (preview && e.target) {
            preview.src = e.target.result;
          }
        };
        reader.readAsDataURL(f);
      }
    });
  }
  if (btnGuardar) btnGuardar.addEventListener('click', guardarBarbero);
  if (btnNuevo) btnNuevo.addEventListener('click', limpiarFormulario);
}

function limpiarFormulario() {
  document.getElementById('barber-id').value = '';
  document.getElementById('barber-nombre').value = '';
  document.getElementById('barber-usuario').value = '';
  document.getElementById('barber-password').value = '';
  document.getElementById('barber-activo').checked = true;
  document.getElementById('barber-avatar').value = '';
  document.getElementById('barber-avatar-preview').src = '';
}

async function cargarBarberos() {
  // Asegurar sesión anónima para evitar 401
  const { data: sess } = await supabase.auth.getSession();
  if (!sess?.session) {
    await supabase.auth.signInAnonymously?.().catch(()=>{});
  }
  const { data } = await supabase
    .from('barberos')
    .select('id,nombre,usuario,avatar_url,activo')
    .eq('negocio_id', negocioId)
    .order('nombre', { ascending: true });
  renderBarberos(data || []);
}

function renderBarberos(items) {
  const tbody = document.getElementById('barberos-lista');
  if (!tbody) return;
  tbody.innerHTML = items.map(b => `
    <tr>
      <td class="border-b p-2"><img src="${b.avatar_url || ''}" class="w-10 h-10 rounded-full object-cover bg-gray-200"></td>
      <td class="border-b p-2">${b.nombre || ''}</td>
      <td class="border-b p-2">${b.usuario}</td>
      <td class="border-b p-2">${b.activo ? 'Activo' : 'Inactivo'}</td>
      <td class="border-b p-2">
        <button data-id="${b.id}" class="px-3 py-1 rounded bg-gray-900 text-white mr-2" data-action="edit">Editar</button>
        <button data-id="${b.id}" class="px-3 py-1 rounded bg-red-600 text-white" data-action="delete">Eliminar</button>
      </td>
    </tr>
  `).join('');
  tbody.querySelectorAll('button').forEach(btn => {
    const id = Number(btn.dataset.id);
    const action = btn.dataset.action;
    if (action === 'edit') {
      btn.addEventListener('click', () => editarBarbero(id));
    } else if (action === 'delete') {
      btn.addEventListener('click', () => eliminarBarbero(id));
    }
  });
}

async function editarBarbero(id) {
  const { data } = await supabase
    .from('barberos')
    .select('*')
    .eq('id', id)
    .single();
  if (!data) return;
  document.getElementById('barber-id').value = data.id;
  document.getElementById('barber-nombre').value = data.nombre || '';
  document.getElementById('barber-usuario').value = data.usuario || '';
  document.getElementById('barber-password').value = data.password || '';
  document.getElementById('barber-activo').checked = !!data.activo;
  document.getElementById('barber-avatar-preview').src = data.avatar_url || '';
}

async function eliminarBarbero(id) {
  const { error } = await supabase
    .from('barberos')
    .delete()
    .eq('id', id)
    .eq('negocio_id', negocioId);
  await cargarBarberos();
}

async function subirAvatar(usuario) {
  const fileInput = document.getElementById('barber-avatar');
  const f = fileInput?.files?.[0];
  if (!f) return null;

  const safeName = f.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${negocioId}/${usuario}-${Date.now()}-${safeName}`;

  try {
    // Refrescar sesión para evitar error "exp claim timestamp check failed"
    await supabase.auth.refreshSession();

    const { data, error } = await supabase
      .storage
      .from('avatars')
      .upload(path, f, {
        cacheControl: '3600',
        upsert: true,
        contentType: f.type || 'application/octet-stream'
      });

    if (error) throw error;

    const { data: pub } = supabase.storage.from('avatars').getPublicUrl(data.path);
    return pub?.publicUrl || null;
  } catch (error) {
    console.error('Error subiendo avatar a Storage, usando fallback a Data URL:', error);
    // Fallback a Data URL si la subida a Storage falla (ej. bucket no existe)
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = (err) => reject(err);
        reader.readAsDataURL(f);
    });
  }
}

async function guardarBarbero() {
  const id = document.getElementById('barber-id').value;
  const nombre = document.getElementById('barber-nombre').value.trim();
  const usuario = document.getElementById('barber-usuario').value.trim();
  const password = document.getElementById('barber-password').value.trim();
  const activo = document.getElementById('barber-activo').checked;
  
  let avatar_url = document.getElementById('barber-avatar-preview').src || '';
  if (document.getElementById('barber-avatar').files.length > 0) {
    const uploaded = await subirAvatar(usuario);
    if (uploaded) avatar_url = uploaded;
  }

  const payload = { negocio_id: negocioId, nombre, usuario, avatar_url, activo };
  if (password) {
    payload.password = password;
  }
  
  try {
    if (id) {
      const { error } = await supabase.from('barberos').update(payload).eq('id', Number(id));
      if (error) throw error;
    } else {
      if (!password) {
        alert('La contraseña es obligatoria para nuevos barberos.');
        return;
      }
      const { error } = await supabase.from('barberos').insert([payload]);
      if (error) throw error;
    }
  } catch (error) {
    console.error('Error guardando barbero:', error);
    if (error.code === '23505' && error.message.includes('ux_barberos_neg_usuario')) {
        alert('Error: El nombre de usuario ya existe. Por favor, elige otro.');
    } else {
        alert('Error al guardar: ' + error.message);
    }
    return;
  }
  limpiarFormulario();
  await cargarBarberos();
}

function setupSidebar() {
    const btn = document.getElementById('mobile-menu-button');
    const toggleBtn = document.getElementById('sidebar-toggle-btn');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    
    if (!sidebar) return;

    if (btn) btn.addEventListener('click', () => {
        sidebar.classList.toggle('-translate-x-full');
        if (overlay) overlay.classList.toggle('opacity-0');
        if (overlay) overlay.classList.toggle('pointer-events-none');
    });
    if (overlay) overlay.addEventListener('click', () => {
        sidebar.classList.toggle('-translate-x-full');
        overlay.classList.toggle('opacity-0');
        overlay.classList.toggle('pointer-events-none');
    });
    if (toggleBtn) toggleBtn.addEventListener('click', () => {
        sidebar.classList.toggle('w-64');
        sidebar.classList.toggle('w-20');
        sidebar.querySelectorAll('.sidebar-text').forEach(el => el.classList.toggle('hidden'));
    });
}

document.addEventListener('DOMContentLoaded', init);
