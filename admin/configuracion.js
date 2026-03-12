import { ensureSupabase } from '../database.js?v=2';

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
  try {
    const { data: sess } = await supabase.auth.getSession();

    if (!sess?.session) {
      await supabase.auth.signInAnonymously?.().catch(() => {});
    }

    const { data, error } = await supabase
      .from('barberos')
      .select('id,nombre,usuario,avatar_url,activo')
      .eq('negocio_id', negocioId)
      .order('nombre', { ascending: true });

    if (error) throw error;

    renderBarberos(data || []);

  } catch (error) {
    console.error('Error cargando barberos:', error);
    alert('Error cargando barberos');
  }
}

function renderBarberos(items) {
  const tbody = document.getElementById('barberos-lista');
  if (!tbody) return;
  tbody.innerHTML = items.map(b => {
    // Sanitización y fallback de avatar para evitar errores de blob o bucket no encontrado
    let avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(b.nombre || b.usuario)}&background=C1121F&color=fff`;
    if (b.avatar_url && b.avatar_url.startsWith('http')) {
      avatarUrl = b.avatar_url;
    }

    return `
    <tr>
      <td class="border-b p-2"><img src="${avatarUrl}" class="w-10 h-10 rounded-full object-cover bg-gray-200" onerror="this.src='https://ui-avatars.com/api/?name=U&background=ccc&color=333'"></td>
      <td class="border-b p-2">${b.nombre || ''}</td>
      <td class="border-b p-2">${b.usuario}</td>
      <td class="border-b p-2">${b.activo ? 'Activo' : 'Inactivo'}</td>
      <td class="border-b p-2">
        <button data-id="${b.id}" class="px-3 py-1 rounded bg-gray-900 text-white mr-2" data-action="edit">Editar</button>
        <button data-id="${b.id}" class="px-3 py-1 rounded bg-red-600 text-white" data-action="delete">Eliminar</button>
      </td>
    </tr>
  `;}).join('');
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
  
  const preview = document.getElementById('barber-avatar-preview');
  if (preview) {
    let avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(data.nombre || data.usuario)}&background=C1121F&color=fff`;
    if (data.avatar_url && data.avatar_url.startsWith('http')) {
      avatarUrl = data.avatar_url;
    }
    preview.src = avatarUrl;
  }
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

  if (!f || !usuario) return null;

  const safeName = f.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${negocioId}/${usuario}-${Date.now()}-${safeName}`;

  try {
    const { data: sessionData } = await supabase.auth.getSession();

    if (sessionData?.session) {
      await supabase.auth.refreshSession();
    }

    const { data, error } = await supabase
      .storage
      .from('avatars')
      .upload(path, f, {
        cacheControl: '3600',
        upsert: true,
        contentType: f.type || 'application/octet-stream'
      });

    if (error) throw error;

    const { data: pub } = supabase
      .storage
      .from('avatars')
      .getPublicUrl(data.path);

    return pub?.publicUrl || null;

  } catch (error) {
    console.error('Error subiendo avatar:', error);
    if (error.message.includes('Bucket not found')) {
        alert('Error: El bucket "avatars" no existe en Supabase. Por favor, créalo en el panel de Storage de Supabase.');
    } else {
        alert(`Error al subir el avatar: ${error.message}`);
    }
    return null;
  }
}

async function guardarBarbero() {
  const id = document.getElementById('barber-id').value;
  const nombre = document.getElementById('barber-nombre').value.trim();
  const usuario = document.getElementById('barber-usuario').value.trim();
  const password = document.getElementById('barber-password').value.trim();
  const activo = document.getElementById('barber-activo').checked;

  // 🔐 VALIDACIONES
  if (!nombre) {
    alert('El nombre es obligatorio.');
    return;
  }

  if (!usuario) {
    alert('El usuario es obligatorio.');
    return;
  }

  if (!id && !password) {
    alert('La contraseña es obligatoria para nuevos barberos.');
    return;
  }

  const payload = {
    negocio_id: negocioId,
    nombre,
    usuario,
    activo
  };

  if (password) {
    payload.password = password; // ⚠️ Idealmente esto debería ir hasheado desde backend
  }

  if (document.getElementById('barber-avatar').files.length > 0) {
    const newAvatarUrl = await subirAvatar(usuario);
    if (newAvatarUrl) {
      payload.avatar_url = newAvatarUrl;
    } else {
      alert('El guardado fue cancelado porque la subida del avatar falló.');
      return;
    }
  }

  try {
    if (id) {
      const { error } = await supabase
        .from('barberos')
        .update(payload)
        .eq('id', Number(id))
        .eq('negocio_id', negocioId);

      if (error) throw error;

    } else {
      const { error } = await supabase
        .from('barberos')
        .insert([payload]);

      if (error) throw error;
    }

    limpiarFormulario();
    await cargarBarberos();

  } catch (error) {
    console.error('Error guardando barbero:', error);

    if (error.code === '23505') {
      alert('Ese usuario ya existe.');
    } else {
      alert('Error al guardar: ' + error.message);
    }
  }
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
