import { ensureSupabase } from '../database.js';

const negocioId = 'barberia005';
const supabase = await ensureSupabase();
const clienteId = localStorage.getItem(`cliente_id_${negocioId}`);
let serviciosCache = {};
let configCache = null;
let diasOperacionNum = [];

function animateNumber(el, to, duration = 500) {
  if (!el) return;
  const from = parseInt(el.textContent || '0', 10) || 0;
  const start = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - start) / duration);
    const val = Math.round(from + (to - from) * p);
    el.textContent = String(val);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

const bannerContentDefault = [
  { title: '✂️ Consejo del día', text: 'No te laves el cabello justo después del corte. Espera al menos 24 horas para que el estilo se asiente.', badge: 'Tip Pro' },
  { title: '🤯 ¿Sabías que...?', text: 'El cabello crece en promedio 1.25 cm al mes. ¡Mantén tu corte fresco cada 3 semanas!', badge: 'Curiosidad' },
  { title: '💈 Servicio Premium', text: 'Prueba nuestro tratamiento de toalla caliente. Relajación total para tu piel.', badge: 'Recomendado' },
  { title: '🌙 Dato Curioso', text: 'La barba crece más rápido de noche debido a la relajación del cuerpo.', badge: 'Sabías que' },
  { title: '🔥 Promoción', text: 'Trae a un amigo y obtén un 10% de descuento en tu próximo corte.', badge: 'Oferta' },
  { title: '🧔 Cuidado de Barba', text: 'Usa aceite para barba diariamente para evitar la picazón y mantenerla suave.', badge: 'Tip Barba' },
  { title: '🚿 Agua Fría', text: 'Enjuagar tu cabello con agua fría al final del baño ayuda a cerrar las cutículas y dar brillo.', badge: 'Tip Salud' }
];

function getSaludo() {
  const hora = new Date().getHours();
  if (hora < 12) return 'Buenos días';
  if (hora < 18) return 'Buenas tardes';
  return 'Buenas noches';
}

function updateBanner(mode = 'default') {
  const bannerInicio = document.getElementById('banner-inicio');
  if (!bannerInicio) return;

  let content;
  const bgDiv = bannerInicio.querySelector('.banner-bg');

  const nombreUsuario = document.getElementById('profile-name')?.textContent || 'Cliente';
  const primerNombre = nombreUsuario.split(' ')[0];
  const saludo = getSaludo();

  if (mode === 'active_turn') {
    content = {
      title: '✂️ Tu barbero está trabajando',
      text: 'Estamos avanzando con los turnos. Mantente atento a tu posición.',
      badge: 'En Curso 🔥'
    };
  } else if (mode === 'available') {
    content = {
      title: '✅ Barbero disponible',
      text: '✂️ Puedes venir ahora mismo. Estamos listos para atenderte sin espera.',
      badge: 'Sin Espera 🚀'
    };
  } else {
    const idx = Math.floor(Math.random() * bannerContentDefault.length);
    const defaultContent = bannerContentDefault[idx];
    content = {
        ...defaultContent,
        title: `${saludo}, ${primerNombre}`
    };
    if (Math.random() > 0.5) content.title = defaultContent.title;
  }

  if (bgDiv) {
    bgDiv.className = 'absolute inset-0 z-0 banner-bg transition-colors duration-500 bg-gradient-to-br from-black via-[#111113] to-[#1a1a1f]';
    if (mode === 'available') {
      // bgDiv.classList.add('bg-green-900/20'); // Opcional: tinte verde muy sutil
    } else {
    }
  }

  bannerInicio.querySelector('.banner-title').textContent = content.title;
  bannerInicio.querySelector('.banner-text').textContent = content.text;
  bannerInicio.querySelector('.banner-badge').textContent = content.badge;
}

const VAPID_PUBLIC_KEY = 'BCMJiXkuO_Q_y_JAMO56tAaJw1JVmSOejavwLsLC9OWCBihIxlGuHpgga6qEyuPQ2cF_KLuotZS7YzdUEzAiHlQ';

function showToast(message, type = 'success') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg><span class="font-medium text-gray-800 dark:text-white">' + message + '</span>';
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

if (!clienteId) {
  window.location.href = 'login_cliente.html';
}

window.toggleProfileMenu = () => {
  document.getElementById('profile-menu').classList.toggle('hidden');
};

window.toggleFab = () => {
  const menu = document.getElementById('fab-menu');
  const btn = document.getElementById('fab-main');
  menu.classList.toggle('active');
  btn.classList.toggle('active');
};

window.logout = async () => {
  localStorage.removeItem(`cliente_id_${negocioId}`);
  localStorage.removeItem(`cliente_telefono_${negocioId}`);
  await supabase.auth.signOut();
  window.location.href = 'login_cliente.html';
};

window.addEventListener('click', function (e) {
  const profileMenuContainer = document.querySelector('.relative');
  const profileMenu = document.getElementById('profile-menu');
  if (profileMenu && !profileMenu.classList.contains('hidden') && profileMenuContainer && !profileMenuContainer.contains(e.target)) {
    profileMenu.classList.add('hidden');
  }
});

function setupThemeToggle() {
  const btnMenu = document.getElementById('theme-toggle-menu');
  const btnFloating = document.getElementById('floating-theme-toggle');
  const iconContainerMenu = document.getElementById('theme-icon-container');
  const textSpanMenu = document.getElementById('theme-text');
  const root = document.documentElement;
  
  const moonIcon = '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-700 dark:text-gray-200" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>';
  const sunIcon = '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-700 dark:text-gray-200" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>';

  const updateUI = (isDark) => {
      // Actualizar botón del menú
      if (iconContainerMenu) iconContainerMenu.innerHTML = isDark ? sunIcon : moonIcon;
      if (textSpanMenu) textSpanMenu.textContent = isDark ? 'Modo Claro' : 'Modo Oscuro';
      
      // Actualizar botón flotante
      if (btnFloating) btnFloating.innerHTML = isDark ? sunIcon : moonIcon;
  };

  const saved = localStorage.getItem('theme');
  const isDark = saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches);
  
  if (isDark) root.classList.add('dark');
  else root.classList.remove('dark');
  updateUI(isDark);

  const toggleTheme = () => {
    root.classList.toggle('dark');
    const currentIsDark = root.classList.contains('dark');
    localStorage.setItem('theme', currentIsDark ? 'dark' : 'light');
    updateUI(currentIsDark);
  };

  btnMenu?.addEventListener('click', toggleTheme);
  btnFloating?.addEventListener('click', toggleTheme);
}

function setupStaticEventHandlers() {
  const profileToggle = document.getElementById('nav-profile-toggle');
  if (profileToggle) {
    profileToggle.addEventListener('click', () => {
      const menu = document.getElementById('profile-menu');
      if (menu) menu.classList.toggle('hidden');
    });
  }

  const menuTurno = document.getElementById('menu-go-turno');
  if (menuTurno) {
    menuTurno.addEventListener('click', (e) => {
      e.preventDefault();
      switchTab('turno');
      const menu = document.getElementById('profile-menu');
      if (menu) menu.classList.add('hidden');
    });
  }

  const menuPerfil = document.getElementById('menu-go-perfil');
  if (menuPerfil) {
    menuPerfil.addEventListener('click', (e) => {
      e.preventDefault();
      switchTab('perfil');
      const menu = document.getElementById('profile-menu');
      if (menu) menu.classList.add('hidden');
    });
  }

  const menuLogout = document.getElementById('menu-logout');
  if (menuLogout) {
    menuLogout.addEventListener('click', (e) => {
      e.preventDefault();
      if (window.logout) window.logout();
    });
  }

  const omitRatingBtn = document.getElementById('btn-rating-omit');
  if (omitRatingBtn) {
    omitRatingBtn.addEventListener('click', (e) => {
      e.preventDefault();
      cerrarModalCalificacion();
    });
  }

  const fabMain = document.getElementById('fab-main');
  if (fabMain) {
    fabMain.addEventListener('click', () => {
      if (window.toggleFab) window.toggleFab();
    });
  }

  document.querySelectorAll('.nav-item').forEach((el) => {
    el.addEventListener('click', () => {
      const tab = el.dataset.tab;
      if (tab) switchTab(tab);
    });
  });

  document.querySelectorAll('.nav-link').forEach((el) => {
    el.addEventListener('click', () => {
      const tab = el.dataset.tab;
      if (tab) switchTab(tab);
    });
  });
}

const turnoBtn = document.getElementById('tab-turno-btn');
const citaBtn = document.getElementById('tab-cita-btn');
const perfilBtn = document.getElementById('tab-perfil-btn');
const activeClasses = 'border-barberRed text-barberRed dark:text-barberRed font-bold';
const inactiveClasses = 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300 dark:hover:border-gray-600';

const slotsCache = {};
let lastSlotsParams = '';

const switchTab = (tab) => {
  const panels = ['inicio', 'turno', 'cita', 'perfil'];
  panels.forEach(p => {
    const el = document.getElementById(`tab-${p}-panel`);
    if (el) {
      el.classList.toggle('hidden', p !== tab);
    }
  });

  // Mobile Bottom Nav
  document.querySelectorAll('.nav-item').forEach(el => {
    const isSelected = el.dataset.tab === tab;
    el.classList.toggle('text-barberRed', isSelected);
    el.classList.toggle('scale-110', isSelected);
    el.classList.toggle('text-gray-400', !isSelected);
    if (isSelected) {
      if (tab === 'inicio') el.classList.add('text-blue-600');
      if (tab === 'turno') el.classList.add('text-red-600');
      if (tab === 'cita') el.classList.add('text-purple-600');
      if (tab === 'perfil') el.classList.add('text-green-600');
    } else {
      el.classList.remove('text-blue-600', 'text-red-600', 'text-purple-600', 'text-green-600');
    }
  });

  // Desktop Top Nav
  document.querySelectorAll('.nav-link').forEach(el => {
    const isSelected = el.dataset.tab === tab;
    el.classList.toggle('bg-[#C1121F]', isSelected);
    el.classList.toggle('text-white', isSelected); // Botón activo siempre blanco
    el.classList.toggle('text-gray-400', !isSelected);
    if (!isSelected) el.classList.add('hover:text-white');
  });

  // Controlar visibilidad del botón flotante de tema (Solo en Inicio)
  const themeBtn = document.getElementById('floating-theme-toggle');
  if (themeBtn) {
      if (tab === 'inicio') themeBtn.classList.remove('hidden');
      else themeBtn.classList.add('hidden');
  }

  if (turnoBtn && citaBtn && perfilBtn) {
    turnoBtn.className = `whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-all ${tab === 'turno' ? activeClasses : inactiveClasses}`;
    citaBtn.className = `whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-all ${tab === 'cita' ? activeClasses : inactiveClasses}`;
    perfilBtn.className = `whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-all ${tab === 'perfil' ? activeClasses : inactiveClasses}`;
  }
};

turnoBtn?.addEventListener('click', () => switchTab('turno'));
citaBtn?.addEventListener('click', () => switchTab('cita'));
perfilBtn?.addEventListener('click', () => switchTab('perfil'));

window.mostrarSeccion = (seccion) => {
  switchTab(seccion);
  const menu = document.getElementById('profile-menu');
  if (menu) menu.classList.add('hidden');
};

async function init() {
  if (!clienteId) {
    window.location.href = 'login_cliente.html';
    return;
  }
  renderStructure();
  updateBanner();
  await cargarPerfil();
  await cargarServicios();
  await actualizarEstadoFila();
  await verificarTurnoActivo();
  await verificarCitaActiva();

  document.getElementById('date-picker')?.addEventListener('change', renderSlotsForSelectedDate);
  document.getElementById('select-servicio-cita')?.addEventListener('change', renderSlotsForSelectedDate);
  document.getElementById('select-barbero-cita')?.addEventListener('change', renderSlotsForSelectedDate);
  document.getElementById('btn-confirmar-reserva')?.addEventListener('click', confirmarReservaManual);

  const formPerfil = document.getElementById('form-perfil');
  if (formPerfil) {
    formPerfil.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nombre = document.getElementById('edit-nombre').value;
      const email = document.getElementById('edit-email').value;
      const { error } = await supabase.from('clientes').update({ nombre, email }).eq('id', clienteId);
      if (error) showToast('Error al actualizar el perfil', 'error');
      else {
        showToast('Perfil actualizado con éxito', 'success');
        cargarPerfil();
      }
    });
  }

  let refreshTimeout;
  const safeRefresh = () => {
    clearTimeout(refreshTimeout);
    refreshTimeout = setTimeout(() => {
      actualizarEstadoFila();
      verificarTurnoActivo();
      verificarCitaActiva();
      checkPendingRatings();
    }, 500);
  };

  supabase.channel('cliente-updates-v2')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'turnos', filter: `negocio_id=eq.${negocioId}` }, safeRefresh)
    .subscribe();

  registrarServiceWorker();

  const loader = document.getElementById('loading-screen');
  if (loader) {
    loader.classList.add('opacity-0', 'pointer-events-none');
    setTimeout(() => loader.remove(), 500);
  }

  checkPendingRatings();
}

function renderStructure() {
  const bannerTemplate = document.getElementById('banner-marketing-template');
  const inicioContainer = document.getElementById('inicio-promo-container');
  const turnoContainer = document.getElementById('turno-promo-container');

  const createBanner = (title, text, badge) => {
    const clone = bannerTemplate.cloneNode(true);
    clone.id = '';
    clone.classList.remove('hidden');
    clone.querySelector('.banner-title').textContent = title;
    clone.querySelector('.banner-text').textContent = text;
    clone.querySelector('.banner-badge').textContent = badge;
    return clone;
  };

  if (bannerTemplate && inicioContainer) {
    const banner1 = bannerTemplate.cloneNode(true);
    banner1.id = 'banner-inicio';
    banner1.classList.remove('hidden');
    inicioContainer.appendChild(banner1);
  }

  const statusContainer = document.getElementById('inicio-status-container');
  if (statusContainer) {
    statusContainer.innerHTML = `
          <div class="bento-card p-6 relative overflow-hidden group">
            <div class="flex justify-between items-start mb-4">
                <div class="p-3 bg-gray-100 dark:bg-white/5 rounded-2xl text-[#C1121F]">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>
                </div>
                <span class="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-white/60">Tu Estado</span>
            </div>
            <div id="dash-card-1">
               <span class="text-5xl font-display font-bold text-gray-900 dark:text-white block tracking-wide leading-none">Sin turno</span>
               <span class="text-sm text-gray-500 dark:text-white/60 font-medium mt-2 block">No estás en la fila</span>
            </div>
          </div>

          <div class="bento-card p-6 relative overflow-hidden group">
            <div class="flex justify-between items-start mb-4">
                <div class="p-3 bg-gray-100 dark:bg-white/5 rounded-2xl text-[#C1121F]">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="currentColor" viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>
                </div>
                <span class="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-white/60">Estimado</span>
            </div>
            <div id="dash-card-2">
               <span class="text-5xl font-display font-bold text-gray-900 dark:text-white block tracking-wide leading-none">-- min</span>
               <span class="text-sm text-gray-500 dark:text-white/60 font-medium mt-2 block">Tiempo de espera</span>
            </div>
          </div>

          <div class="bento-card p-6 relative overflow-hidden group">
            <div class="flex justify-between items-start mb-4">
                <div class="p-3 bg-gray-100 dark:bg-white/5 rounded-2xl text-[#C1121F]">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="currentColor" viewBox="0 0 24 24"><path d="M3.5 18.49l6-6.01 4 4L22 6.92l-1.41-1.41-7.09 7.97-4-4L2 16.99z"/></svg>
                </div>
                <span class="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-white/60">Demanda</span>
            </div>
            <div id="dash-card-3">
               <span class="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-white/80 text-lg font-bold animate-pulse">Calculando...</span>
            </div>
          </div>
        `;
  }

  const turnoPanel = document.getElementById('tab-turno-panel');
  if (turnoPanel) {
    turnoPanel.innerHTML = `
            <div id="card-turno-activo" class="hidden bento-card p-8 relative overflow-hidden mb-8 group" style="border-left: 4px solid #C1121F; background: linear-gradient(90deg, rgba(193,18,31,0.08), transparent 40%);">
                <div class="absolute top-0 right-0 p-4 opacity-10 text-[#C1121F]">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-24 w-24" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>
                </div>
                <h3 class="text-sm font-bold text-gray-500 dark:text-white/60 uppercase tracking-wider mb-2">Tu Turno en Curso</h3>
                <div class="flex items-baseline gap-3">
                  <span id="mi-numero-turno" class="text-7xl font-display font-bold text-gray-900 dark:text-white tracking-wide">--</span>
                  <span id="mi-estado-turno" class="px-4 py-1.5 rounded-full bg-yellow-500/10 text-yellow-400 text-xs font-bold border border-yellow-500/20">En Espera</span>
                </div>
                <p id="mi-servicio-turno" class="text-gray-700 dark:text-white/80 mt-3 font-medium text-lg">Servicio...</p>
                <div class="mt-6 pt-6 border-t border-gray-200 dark:border-white/5 flex justify-between items-center">
                  <div id="mi-info-extra" class="text-sm text-gray-500 dark:text-white/60 w-full">Calculando...</div>
                  <button onclick="cancelarTurno()" class="bg-[#C1121F]/10 text-[#C1121F] hover:bg-[#C1121F]/20 text-sm font-semibold transition-colors px-4 py-2 rounded-lg border border-[#C1121F]/20">Cancelar</button>
                </div>
            </div>

            <div id="seccion-tomar-turno" class="bento-card p-8">
                <h3 class="text-3xl font-display font-bold mb-8 flex items-center gap-3 text-gray-900 dark:text-white tracking-wide">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-[#C1121F]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  Reservar Nuevo Turno
                </h3>
                <div id="bloqueado-msg" class="hidden mb-6 bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded-xl text-yellow-800 dark:text-yellow-300 text-sm font-medium border border-yellow-100 dark:border-yellow-800/30 flex items-center gap-3">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                  <span id="bloqueado-texto">Ya tienes un turno activo.</span>
                </div>
                <div class="grid grid-cols-1 gap-6">
                  <div><label class="block text-sm font-semibold mb-2 text-gray-500 dark:text-white/60">Servicio</label><select id="select-servicio" class="w-full p-4 rounded-xl border bg-gray-50 dark:bg-[#111113] border-gray-200 dark:border-white/10 text-gray-900 dark:text-white focus:border-[#C1121F] focus:ring-1 focus:ring-[#C1121F] transition outline-none"><option value="">Cargando...</option></select></div>
                  <div><label class="block text-sm font-semibold mb-2 text-gray-500 dark:text-white/60">Barbero</label><select id="select-barbero-turno" class="w-full p-4 rounded-xl border bg-gray-50 dark:bg-[#111113] border-gray-200 dark:border-white/10 text-gray-900 dark:text-white focus:border-[#C1121F] focus:ring-1 focus:ring-[#C1121F] transition outline-none"><option value="">Cargando...</option></select></div>
                </div>
                <button onclick="tomarTurno()" id="btn-tomar-turno" class="mt-8 w-full bg-[#C1121F] hover:bg-[#A40E1A] text-white font-bold py-4 rounded-xl shadow-lg shadow-[#C1121F]/20 flex justify-center items-center gap-3 text-lg transition-all">Confirmar Turno</button>
            </div>
        `;
  }

  const citaPanel = document.getElementById('tab-cita-panel');
  if (citaPanel) {
    citaPanel.innerHTML = `
            <div id="cita-promo-container" class="mb-6"></div>
            
            <div id="card-cita-activa" class="hidden bento-card p-8 relative overflow-hidden mb-8 group" style="border-left: 4px solid #C1121F; background: linear-gradient(90deg, rgba(193,18,31,0.08), transparent 40%);">
                <div class="absolute top-0 right-0 p-4 opacity-10 text-[#C1121F]">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-24 w-24" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                </div>
                <h3 class="text-sm font-bold text-[#C1121F] uppercase tracking-wider mb-2">📅 Tu Cita Programada</h3>
                <div class="flex flex-col gap-1">
                  <span id="cita-fecha-hora" class="text-4xl font-display font-bold tracking-wide text-gray-900 dark:text-white">--</span>
                  <span id="cita-barbero" class="text-lg font-medium text-gray-700 dark:text-white/80">--</span>
                </div>
                <p id="cita-servicio" class="text-gray-500 dark:text-white/60 mt-3 font-medium">Cita Reservada</p>
                <div class="mt-6 pt-6 border-t border-gray-200 dark:border-white/5 flex justify-between items-center">
                  <div class="text-sm text-gray-500 dark:text-white/60">Llega 5 min antes</div>
                  <button onclick="cancelarCita()" class="bg-[#C1121F]/10 text-[#C1121F] hover:bg-[#C1121F]/20 text-sm font-semibold transition-colors px-4 py-2 rounded-lg border border-[#C1121F]/20">Cancelar Cita</button>
                </div>
            </div>
            
            <div id="seccion-cita-inteligente" class="bento-card p-8">
                <h3 class="text-3xl font-display font-bold mb-2 flex items-center gap-2 text-gray-900 dark:text-white tracking-wide">Agendar cita</h3>
                <p class="text-sm text-gray-500 dark:text-white/60 mb-6" id="texto-sugerencia">Consulta disponibilidad y reserva.</p>
                <div id="bloqueado-cita-msg" class="hidden mb-6 bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded-xl text-yellow-800 dark:text-yellow-300 text-sm font-medium border border-yellow-100 dark:border-yellow-800/30">
                    No puedes agendar cita si tienes un turno activo.
                </div>
                <div id="form-cita-container">
                    <div class="flex flex-col sm:flex-row gap-3">
                      <button id="btn-ver-horarios" onclick="verHorariosLibres()" class="flex-1 px-6 py-4 bg-[#C1121F] hover:bg-[#A40E1A] text-white font-bold rounded-xl shadow-lg shadow-[#C1121F]/20 focus:outline-none transition-all">Ver horarios libres</button>
                    </div>
                    <div id="horarios-libres" class="mt-6 hidden">
                        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div><label class="block text-sm font-semibold mb-2 text-gray-500 dark:text-white/60">Fecha</label><input id="date-picker" type="date" class="w-full p-3 rounded-xl border bg-gray-50 dark:bg-[#111113] border-gray-200 dark:border-white/10 text-gray-900 dark:text-white focus:border-[#C1121F] focus:ring-1 focus:ring-[#C1121F] transition outline-none"></div>
                            <div><label class="block text-sm font-semibold mb-2 text-gray-500 dark:text-white/60">Barbero</label><select id="select-barbero-cita" class="w-full p-3 rounded-xl border bg-gray-50 dark:bg-[#111113] border-gray-200 dark:border-white/10 text-gray-900 dark:text-white focus:border-[#C1121F] focus:ring-1 focus:ring-[#C1121F] transition outline-none"><option value="">Cargando...</option></select></div>
                            <div><label class="block text-sm font-semibold mb-2 text-gray-500 dark:text-white/60">Servicio</label><select id="select-servicio-cita" class="w-full p-3 rounded-xl border bg-gray-50 dark:bg-[#111113] border-gray-200 dark:border-white/10 text-gray-900 dark:text-white focus:border-[#C1121F] focus:ring-1 focus:ring-[#C1121F] transition outline-none"><option value="">Selecciona...</option></select></div>
                        </div>
                        
                        <div id="barber-info-card" class="hidden mt-4 flex items-center gap-4 p-4 bg-gray-50 dark:bg-white/5 rounded-2xl border border-gray-200 dark:border-white/10 shadow-sm transition-all animate-fade-in">
                            <img id="barber-avatar-display" src="" class="w-12 h-12 rounded-full object-cover border-2 border-barberRed shadow-sm">
                            <div>
                                <p id="barber-name-display" class="font-bold text-gray-900 dark:text-white text-lg leading-tight"></p>
                                <p class="text-xs text-gray-500 dark:text-white/60 font-medium uppercase tracking-wider">Barbero seleccionado</p>
                            </div>
                        </div>

                        <div id="rango-horario-display"></div>
                        <div class="mt-6 bg-gray-50 dark:bg-black/30 p-6 rounded-2xl border border-gray-200 dark:border-white/5">
                            <div id="slots-container" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3"></div>
                            <div id="action-container" class="mt-6 hidden flex justify-center animate-fade-in">
                                <button id="btn-confirmar-reserva" class="bg-[#C1121F] text-white font-bold py-3 px-8 rounded-xl shadow-lg shadow-[#C1121F]/20 focus:outline-none hover:bg-[#A40E1A] transition-colors">Confirmar Reserva</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
  }

  const perfilPanel = document.getElementById('tab-perfil-panel');
  if (perfilPanel) {
    perfilPanel.innerHTML = `
          <div id="perfil-promo-container" class="mb-6"></div>

          <div class="bento-card p-8 max-w-2xl mx-auto">
            <div class="flex flex-col sm:flex-row items-center gap-6">
              <div class="relative flex-shrink-0">
                <img id="profile-avatar" src="https://ui-avatars.com/api/?name=U" class="w-32 h-32 rounded-full border-4 bg-white dark:bg-[#111113] border-gray-200 dark:border-[#111113] shadow-2xl object-cover ring-2 ring-barberRed">
                <button onclick="document.getElementById('avatar-upload').click()" class="absolute bottom-0 right-0 bg-[#C1121F] text-white p-2.5 rounded-full hover:bg-[#A40E1A] shadow-lg border-4 border-white dark:border-[#111113] transition-colors">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                </button>
                <input type="file" id="avatar-upload" class="hidden" accept="image/*" onchange="subirAvatar(this)">
              </div>
              <div class="text-center sm:text-left">
                <h3 id="profile-name" class="text-4xl font-display font-bold text-gray-900 dark:text-white tracking-wide">Cargando...</h3>
                <p id="profile-phone" class="text-gray-500 dark:text-white/60 text-lg mt-1">...</p>
                <span class="inline-block mt-2 px-4 py-1 rounded-full bg-[#C1121F]/10 text-[#C1121F] text-xs font-bold border border-[#C1121F]/20">
                  Cliente frecuente ⭐
                </span>
              </div>
            </div>
            <form id="form-perfil" class="mt-10 space-y-6">
              <div><label class="text-sm font-semibold mb-2 block text-gray-500 dark:text-white/60">Nombre Completo</label><input type="text" id="edit-nombre" class="w-full p-4 rounded-xl border bg-gray-50 dark:bg-[#111113] border-gray-200 dark:border-white/10 text-gray-900 dark:text-white focus:border-[#C1121F] focus:ring-1 focus:ring-[#C1121F] transition outline-none"></div>
              <div><label class="text-sm font-semibold mb-2 block text-gray-500 dark:text-white/60">Correo Electrónico</label><input type="email" id="edit-email" class="w-full p-4 rounded-xl border bg-gray-50 dark:bg-[#111113] border-gray-200 dark:border-white/10 text-gray-900 dark:text-white focus:border-[#C1121F] focus:ring-1 focus:ring-[#C1121F] transition outline-none"></div>
              <button type="submit" class="w-full bg-[#C1121F] hover:bg-[#A40E1A] text-white font-bold py-4 rounded-xl shadow-lg shadow-[#C1121F]/20 flex justify-center items-center gap-2 mt-4 transition-all">Actualizar Datos</button>
            </form>
          </div>
        `;
  }

  if (bannerTemplate) {
    const bannerCita = createBanner('Planifica tu Estilo', 'Reserva con anticipación y asegura tu lugar con tu barbero favorito.', 'Agenda Pro');
    const citaPromo = document.getElementById('cita-promo-container');
    if (citaPromo) citaPromo.appendChild(bannerCita);

    const bannerPerfil = createBanner('Tu Identidad', 'Mantén tu información actualizada para recibir las mejores ofertas.', 'Mi Cuenta');
    const perfilPromo = document.getElementById('perfil-promo-container');
    if (perfilPromo) perfilPromo.appendChild(bannerPerfil);
  }
}

function registrarServiceWorker() {
  if ('serviceWorker' in navigator) {
    const swPath = location.pathname.replace(/[^/]*$/, '') + 'sw.js';
    navigator.serviceWorker.register(swPath).then(async () => {
      if (Notification.permission === 'default') {
        await solicitarPermisoNotificacion();
      }
    }).catch(err => console.error('SW error:', err));
  }
}

async function solicitarPermisoNotificacion() {
  const permission = await Notification.requestPermission();
  if (permission === 'granted') {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    });
    await guardarSuscripcion(subscription);
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

async function guardarSuscripcion(subscription) {
  const telefono = localStorage.getItem(`cliente_telefono_${negocioId}`);
  if (telefono) await supabase.from('push_subscriptions').upsert({
    user_id: telefono,
    subscription,
    negocio_id: negocioId,
    endpoint: subscription.endpoint
  }, { onConflict: 'user_id, negocio_id' });
}

function calcularTiempoEsperaReal(turnosEnEspera, turnosEnAtencion, activeBarbers) {
  const barberos = Math.max(1, activeBarbers);
  let tiempoTotalMinutos = 0;

  turnosEnAtencion.forEach(t => {
    const duracion = serviciosCache[t.servicio] || 30;
    const inicio = t.started_at ? new Date(t.started_at) : new Date();
    const transcurrido = (Date.now() - inicio.getTime()) / 60000;
    const restante = Math.max(0, duracion - transcurrido);
    tiempoTotalMinutos += restante;
  });

  turnosEnEspera.forEach(t => {
    const duracion = serviciosCache[t.servicio] || 30;
    tiempoTotalMinutos += duracion;
  });

  const tiempoEstimado = tiempoTotalMinutos / barberos;
  return Math.ceil(tiempoEstimado);
}

async function cargarPerfil() {
  const { data, error } = await supabase.from('clientes').select('*').eq('id', clienteId).single();
  if (error) {
    if (error.message && (error.message.includes('AbortError') || error.message.includes('signal is aborted'))) {
      console.warn('Carga de perfil interrumpida (navegación o recarga).');
      return;
    }
    console.error('Error cargando perfil:', error);
    if (error.code === 'PGRST116') {
      logout();
    }
    return;
  }
  if (data) {
    const navName = document.getElementById('nav-name');
    if (navName) navName.textContent = data.nombre.split(' ')[0];
    const menuProfileName = document.getElementById('menu-profile-name');
    if (menuProfileName) menuProfileName.textContent = data.nombre;
    const menuProfilePhone = document.getElementById('menu-profile-phone');
    if (menuProfilePhone) menuProfilePhone.textContent = data.telefono;

    const profileName = document.getElementById('profile-name');
    if (profileName) profileName.textContent = data.nombre;
    const profilePhone = document.getElementById('profile-phone');
    if (profilePhone) profilePhone.textContent = data.telefono;
    const editNombre = document.getElementById('edit-nombre');
    if (editNombre) editNombre.value = data.nombre;
    const editEmail = document.getElementById('edit-email');
    if (editEmail) editEmail.value = data.email || '';

    const avatarUrl = data.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(data.nombre)}&background=C1121F&color=fff&bold=true`;
    const navAvatar = document.getElementById('nav-avatar');
    if (navAvatar) navAvatar.src = avatarUrl;
    const profileAvatar = document.getElementById('profile-avatar');
    if (profileAvatar) profileAvatar.src = avatarUrl;
  }
}

async function cargarServicios() {
  const { data } = await supabase.from('servicios').select('*').eq('negocio_id', negocioId).eq('activo', true);
  const select = document.getElementById('select-servicio');
  if (select) {
    select.innerHTML = '<option value="">Selecciona un servicio...</option>';
  }
  if (data && select) {
    data.forEach(s => {
      serviciosCache[s.nombre] = s.duracion_min;
      const option = document.createElement('option');
      option.value = s.nombre;
      option.textContent = s.nombre;
      select.appendChild(option);
    });
  }
  const svcCita = document.getElementById('select-servicio-cita');
  if (svcCita) {
    svcCita.innerHTML = '<option value="">Selecciona un servicio...</option>';
    (data || []).forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.nombre;
      opt.textContent = s.nombre;
      svcCita.appendChild(opt);
    });
  }
}

async function cargarConfigNegocio() {
  const { data } = await supabase
    .from('configuracion_negocio')
    .select('*')
    .eq('negocio_id', negocioId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  configCache = data || null;

  let diasOp = data?.dias_operacion || [];
  if (typeof diasOp === 'string') {
    try { diasOp = JSON.parse(diasOp); } catch (e) { diasOp = []; }
  }

  const map = { 'Domingo': 0, 'Lunes': 1, 'Martes': 2, 'Miércoles': 3, 'Jueves': 4, 'Viernes': 5, 'Sábado': 6 };
  diasOperacionNum = diasOp.map(n => map[n]).filter(v => typeof v === 'number');
}

async function actualizarEstadoFila() {
  const hoy = new Date().toISOString().slice(0, 10);

  const [turnosRes, barberosRes] = await Promise.all([
      supabase.from('turnos')
        .select('id, estado, servicio, started_at, created_at')
        .eq('negocio_id', negocioId)
        .eq('fecha', hoy)
        .in('estado', ['En espera', 'En atención']),
      supabase.from('barberos')
        .select('*', { count: 'exact', head: true })
        .eq('negocio_id', negocioId)
        .eq('activo', true)
  ]);

  const turnosActivos = turnosRes.data || [];
  const enEspera = turnosActivos.filter(t => t.estado === 'En espera');
  const enAtencion = turnosActivos.filter(t => t.estado === 'En atención');
  const activeBarbers = barberosRes.count || 1;

  const ba = document.getElementById('barberos-activos');
  if (ba) ba.textContent = activeBarbers;
  const baCita = document.getElementById('barberos-activos-cita');
  if (baCita) baCita.textContent = activeBarbers;

  const personasEnCola = enEspera.length;

  const pd = document.getElementById('personas-delante');
  if (pd) animateNumber(pd, personasEnCola);
  const pdCita = document.getElementById('personas-delante-cita');
  if (pdCita) animateNumber(pdCita, personasEnCola);

  if (!window.hasActiveTurn && !window.hasActiveAppointment) {
    if (personasEnCola === 0 && enAtencion.length < activeBarbers) {
      updateBanner('available');
    } else {
      updateBanner('default');
    }
  }

  const tiempoEstimado = calcularTiempoEsperaReal(enEspera, enAtencion, activeBarbers);

  let tiempoTexto = '';
  let estado = 'Fluida';
  let badgeClass = 'bg-green-100 text-green-700';
  let demandaTexto = '🟢 Baja';

  if (tiempoEstimado <= 0) {
    tiempoTexto = 'Atención inmediata';
    estado = 'Libre';
  } else {
    tiempoTexto = `${tiempoEstimado} min`;
    if (tiempoEstimado > 20) {
      estado = 'Media';
      badgeClass = 'bg-yellow-100 text-yellow-700';
      demandaTexto = '🟡 Media';
    }
    if (tiempoEstimado > 45) {
      estado = 'Alta';
      badgeClass = 'bg-red-100 text-red-700';
      demandaTexto = '🔴 Alta';
    }
  }

  const te = document.getElementById('tiempo-espera');
  if (te) te.textContent = tiempoTexto;
  const teCita = document.getElementById('tiempo-espera-cita');
  if (teCita) teCita.textContent = tiempoTexto;

  const badge = document.getElementById('estado-barberia-badge');
  if (badge) {
    badge.textContent = estado;
    badge.className = `text-xs font-bold px-2 py-1 rounded ${badgeClass}`;
  }

  const dashCard1 = document.getElementById('dash-card-1');
  if (dashCard1 && !window.hasActiveTurn && !window.hasActiveAppointment) {
    dashCard1.innerHTML = `
             <span class="text-5xl font-display font-bold text-gray-900 dark:text-white block tracking-wide leading-none">${personasEnCola}</span>
             <span class="text-sm text-gray-500 dark:text-white/60 font-medium mt-2 block">Personas en espera</span>
          `;
  }

  const dashCard2 = document.getElementById('dash-card-2');
  if (dashCard2 && !window.hasActiveTurn && !window.hasActiveAppointment) {
    const horaAprox = new Date(Date.now() + tiempoEstimado * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    dashCard2.innerHTML = `
             <span class="text-5xl font-display font-bold text-gray-900 dark:text-white block tracking-wide leading-none">${tiempoTexto}</span>
             <span class="text-sm text-gray-500 dark:text-white/60 font-medium mt-2 block">Atención aprox: ${horaAprox}</span>
          `;
  }

  const dashCard3 = document.getElementById('dash-card-3');
  if (dashCard3) {
    dashCard3.innerHTML = `
             <span class="inline-flex items-center gap-2 px-4 py-2 rounded-xl ${badgeClass} bg-opacity-10 border border-gray-200 dark:border-white/10 text-lg font-bold">
                ${demandaTexto}
             </span>
          `;
  }

  const badgeCita = document.getElementById('estado-barberia-badge-cita');
  if (badgeCita) {
    badgeCita.textContent = estado;
    badgeCita.className = `text-xs font-bold px-2 py-1 rounded ${badgeClass}`;
  }

  const textoSug = document.getElementById('texto-sugerencia');
  if (textoSug) textoSug.textContent = 'Consulta disponibilidad y reserva.';

  window.__duracionServicio__ = 30;
}

async function verificarTurnoActivo() {
  const hoy = new Date().toISOString().slice(0, 10);
  const telefono = localStorage.getItem(`cliente_telefono_${negocioId}`);

  const { data } = await supabase.from('turnos')
    .select('*')
    .eq('negocio_id', negocioId)
    .eq('fecha', hoy)
    .in('estado', ['En espera', 'En atención'])
    .eq('telefono', telefono)
    .maybeSingle();

  const card = document.getElementById('card-turno-activo');
  const form = document.getElementById('seccion-tomar-turno');

  if (data && card) {
    window.hasActiveTurn = true;
    updateBanner('active_turn');
    card.classList.remove('hidden');
    if (form) form.classList.add('hidden');
    const numeroEl = document.getElementById('mi-numero-turno');
    if (numeroEl) numeroEl.textContent = data.turno;
    const servEl = document.getElementById('mi-servicio-turno');
    if (servEl) servEl.textContent = data.servicio;
    const bloqueadoMsg = document.getElementById('bloqueado-msg');
    if (bloqueadoMsg) bloqueadoMsg.classList.remove('hidden');
    const bloqueadoTexto = document.getElementById('bloqueado-texto');
    if (bloqueadoTexto) bloqueadoTexto.textContent = 'Ya tienes un turno activo. Cuando finalice, podrás tomar otro 👌';

    const estadoEl = document.getElementById('mi-estado-turno');
    const infoExtra = document.getElementById('mi-info-extra');

    const dashCard1 = document.getElementById('dash-card-1');
    if (dashCard1) {
      dashCard1.innerHTML = `
               <span class="text-7xl font-display font-bold text-[#C1121F] block tracking-wide leading-none">${data.turno}</span>
               <span class="text-sm text-gray-500 dark:text-white/60 font-bold mt-2 block">TU TURNO ACTUAL</span>
            `;
    }

    if (data.estado === 'En atención') {
      if (estadoEl) {
        estadoEl.textContent = 'En Atención ⚡';
        estadoEl.className = 'px-4 py-1.5 rounded-full bg-[#C1121F]/10 text-[#C1121F] text-xs font-bold border border-[#C1121F]/20 animate-pulse';
      }
      const h3 = card.querySelector('h3');
      if (h3) h3.textContent = '🔥 Te están atendiendo';
      if (infoExtra) {
        infoExtra.innerHTML = '<span class="text-lg font-medium text-gray-900 dark:text-white">Relájate y disfruta 😌</span>';
      }
      const dashCard2 = document.getElementById('dash-card-2');
      if (dashCard2) {
        dashCard2.innerHTML = `
                   <span class="text-5xl font-display font-bold text-[#C1121F] block tracking-wide leading-none">AHORA</span>
                   <span class="text-sm text-gray-500 dark:text-white/60 font-medium mt-2 block">Te están atendiendo</span>
                `;
      }
    } else {
      if (estadoEl) {
        estadoEl.textContent = 'En Espera';
        estadoEl.className = 'px-4 py-1.5 rounded-full bg-yellow-500/10 text-yellow-400 text-xs font-bold border border-yellow-500/20';
      }
      const h3 = card.querySelector('h3');
      if (h3) h3.textContent = '🕒 Tu turno está en cola';

      const { data: allTurns } = await supabase.from('turnos')
        .select('id, estado, servicio, started_at, created_at')
        .eq('negocio_id', negocioId)
        .eq('fecha', hoy)
        .in('estado', ['En espera', 'En atención']);

      const enAtencion = (allTurns || []).filter(t => t.estado === 'En atención');
      const enEsperaAntes = (allTurns || []).filter(t => t.estado === 'En espera' && t.created_at < data.created_at);

      const { count: barberosCount } = await supabase.from('barberos').select('*', { count: 'exact', head: true }).eq('negocio_id', negocioId).eq('activo', true);
      const activeBarbers = barberosCount || 1;

      const personasDelante = enEsperaAntes.length;
      const tiempoEstimado = calcularTiempoEsperaReal(enEsperaAntes, enAtencion, activeBarbers);

      let mensajeTiempo = '';
      if (personasDelante === 0 && enAtencion.length < activeBarbers) {
        mensajeTiempo = '🚀 ¡Es tu turno ahora mismo!';
      } else {
        mensajeTiempo = `⏳ Tiempo estimado: ~${tiempoEstimado} min`;
      }

      const dashCard2 = document.getElementById('dash-card-2');
      if (dashCard2) {
        const horaAprox = new Date(Date.now() + tiempoEstimado * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        dashCard2.innerHTML = `
                   <span class="text-5xl font-display font-bold text-gray-900 dark:text-white block tracking-wide leading-none">${tiempoEstimado} min</span>
                   <span class="text-sm text-gray-500 dark:text-white/60 font-medium mt-2 block">Atención aprox: ${horaAprox}</span>
                `;
      }

      const porcentaje = Math.max(5, 100 - (personasDelante * 15));

      if (infoExtra) {
        infoExtra.innerHTML = `
                <div class="flex flex-col w-full mr-4">
                    <div class="flex justify-between items-end mb-3">
                        <span class="font-bold text-lg text-gray-900 dark:text-white">${personasDelante} personas delante</span>
                        <span class="text-xs font-bold text-[#C1121F] bg-[#C1121F]/10 px-2 py-1 rounded">${mensajeTiempo}</span>
                    </div>
                    <div class="w-full bg-gray-200 dark:bg-black/50 rounded-full h-4 overflow-hidden shadow-inner border border-gray-300 dark:border-white/10">
                        <div class="bg-[#C1121F] h-full rounded-full transition-all duration-1000 relative progress-striped shadow-lg" style="width: ${porcentaje}%">
                        </div>
                    </div>
                    <p class="text-xs text-gray-500 dark:text-white/60 mt-1 text-right">
                        ${personasDelante === 0 ? '🚀 ¡Es tu turno ahora mismo!' : 'La fila avanza...'}
                    </p>
                </div>
            `;
      }

      if (personasDelante <= 1 && !window.notificacionCercaEnviada) {
        sendPushNotification('🔔 ¡Ya casi!', `Solo queda ${personasDelante} persona delante. Acércate al local.`);
        window.notificacionCercaEnviada = true;
      }
    }

    const citaForm = document.getElementById('form-cita-container');
    const citaMsg = document.getElementById('bloqueado-cita-msg');
    if (citaForm) citaForm.classList.add('hidden');
    if (citaMsg) citaMsg.classList.remove('hidden');
  } else {
    window.hasActiveTurn = false;
    if (card) card.classList.add('hidden');
    if (form) form.classList.remove('hidden');
    const bloqueadoMsg = document.getElementById('bloqueado-msg');
    if (bloqueadoMsg) bloqueadoMsg.classList.add('hidden');
    checkPendingRatings();
  }
}

async function verificarCitaActiva() {
  const telefono = localStorage.getItem(`cliente_telefono_${negocioId}`);
  const nombreCliente = localStorage.getItem(`cliente_nombre_${negocioId}`) || 'Cliente';
  if (!telefono) return;

  const nowISO = new Date().toISOString();
  const { data: cita } = await supabase
    .from('citas')
    .select('*, barberos(nombre)')
    .eq('negocio_id', negocioId)
    .eq('cliente_telefono', telefono)
    .neq('estado', 'Cancelada')
    .gt('end_at', nowISO)
    .order('start_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  const cardCita = document.getElementById('card-cita-activa');
  const seccionTurno = document.getElementById('seccion-tomar-turno');
  const inicioCitaContainer = document.getElementById('inicio-cita-card-container');
  const seccionCita = document.getElementById('seccion-cita-inteligente');

  if (cita && cardCita) {
    window.hasActiveAppointment = true;
    cardCita.classList.remove('hidden');

    if (seccionTurno) seccionTurno.classList.add('hidden');
    if (seccionCita) seccionCita.classList.add('hidden');
    const bloqueadoMsg = document.getElementById('bloqueado-msg');
    if (bloqueadoMsg) bloqueadoMsg.classList.remove('hidden');
    const bloqueadoTexto = document.getElementById('bloqueado-texto');
    if (bloqueadoTexto) bloqueadoTexto.textContent = 'Tienes una cita programada. No puedes tomar turno.';

    const date = new Date(cita.start_at);
    const today = new Date();
    const isToday = date.toDateString() === today.toDateString();
    const dateStr = isToday ? 'Hoy' : date.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric' });
    const timeStr = date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

    const citaFechaHora = document.getElementById('cita-fecha-hora');
    if (citaFechaHora) citaFechaHora.textContent = `${dateStr} – ${timeStr}`;

    let barberName = 'Barbero asignado';
    if (cita.barberos) {
      barberName = cita.barberos.nombre;
    } else if (cita.barber_id) {
      const { data: b } = await supabase.from('barberos').select('nombre').eq('id', cita.barber_id).single();
      if (b) barberName = b.nombre;
    }
    const citaBarbero = document.getElementById('cita-barbero');
    if (citaBarbero) citaBarbero.textContent = `Barbero: ${barberName}`;
    const servicioTexto = cita.servicio || 'Servicio General';
    cardCita.dataset.id = cita.id;

    const cardHTML = `
                <div class="bento-card p-6 relative overflow-hidden mb-6 animate-fade-in" style="border-left: 4px solid #C1121F;">
                    <div class="absolute top-0 right-0 p-4 opacity-10 text-[#C1121F] pointer-events-none">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-32 w-32 transform rotate-12" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    </div>
                    
                    <div class="relative z-10">
                        <div class="flex justify-between items-start mb-4">
                            <div class="bg-[#C1121F]/10 border border-[#C1121F]/20 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider text-[#C1121F]">
                                📅 Cita Confirmada
                            </div>
                            <div class="text-right">
                                <p class="text-xs text-gray-500 dark:text-white/60 uppercase tracking-wider font-bold">Barbero</p>
                                <p class="font-bold text-gray-900 dark:text-white text-lg leading-none">${barberName}</p>
                            </div>
                        </div>

                        <div class="mb-6">
                            <p class="text-5xl font-display font-bold tracking-tight text-gray-900 dark:text-white mb-1">${timeStr}</p>
                            <p class="text-lg text-gray-700 dark:text-white/80 font-medium capitalize">${dateStr}</p>
                        </div>

                        <div class="flex items-center justify-between border-t border-gray-200 dark:border-white/10 pt-4">
                            <div>
                                <p class="text-xs text-gray-500 dark:text-white/60 uppercase tracking-wider font-bold">Cliente</p>
                                <p class="font-bold text-gray-900 dark:text-white">${nombreCliente}</p>
                                <p class="text-xs text-[#C1121F] mt-0.5">${servicioTexto}</p>
                            </div>
                            <button onclick="cancelarCita(${cita.id})" class="bg-[#C1121F]/10 hover:bg-[#C1121F]/20 text-[#C1121F] text-xs font-bold px-4 py-2.5 rounded-xl transition-colors border border-[#C1121F]/20 flex items-center gap-2">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                                Cancelar
                            </button>
                        </div>
                    </div>
                </div>
            `;

    if (inicioCitaContainer) {
      inicioCitaContainer.innerHTML = cardHTML;
    }

    cardCita.outerHTML = `<div id="card-cita-activa">${cardHTML}</div>`;

    const dashCard1 = document.getElementById('dash-card-1');
    if (dashCard1) {
      dashCard1.innerHTML = `
                   <span class="text-5xl font-display font-bold text-[#C1121F] block tracking-wide leading-none">CITA</span>
                   <span class="text-sm text-gray-500 dark:text-white/60 font-bold mt-2 block">PROGRAMADA</span>
                `;
    }
    const dashCard2 = document.getElementById('dash-card-2');
    if (dashCard2) {
      dashCard2.innerHTML = `
                   <span class="text-5xl font-display font-bold text-gray-900 dark:text-white block tracking-wide leading-none">${timeStr}</span>
                   <span class="text-sm text-gray-500 dark:text-white/60 font-medium mt-2 block">Hora de atención</span>
                `;
    }
  } else {
    window.hasActiveAppointment = false;
    if (inicioCitaContainer) inicioCitaContainer.innerHTML = '';
    const cardCitaEl = document.getElementById('card-cita-activa');
    if (cardCitaEl) cardCitaEl.innerHTML = '';
    if (!window.hasActiveTurn && seccionTurno) {
      seccionTurno.classList.remove('hidden');
      const msg = document.getElementById('bloqueado-msg');
      if (msg) msg.classList.add('hidden');
    }
    if (seccionCita) seccionCita.classList.remove('hidden');
  }
}

async function sendPushNotification(title, body) {
  const phoneEl = document.getElementById('profile-phone');
  const telefono = phoneEl ? phoneEl.textContent : null;
  if (!telefono || telefono === '...') return;
  try {
    const { error } = await supabase.functions.invoke('send-push-notification', {
      body: { telefono, negocio_id: negocioId, title, body }
    });
    if (error) throw error;
  } catch (e) {
    console.error('Error enviando push:', e);
  }
}

function confirmarAccion(titulo, mensaje, onConfirm) {
  const modal = document.getElementById('modal-confirmacion');
  const content = document.getElementById('modal-confirmacion-content');
  const titleEl = document.getElementById('confirm-title');
  const msgEl = document.getElementById('confirm-message');
  const btnOk = document.getElementById('btn-confirm-ok');
  const btnCancel = document.getElementById('btn-confirm-cancel');

  if (!modal || !content || !titleEl || !msgEl || !btnOk || !btnCancel) {
    if (confirm(mensaje)) onConfirm();
    return;
  }

  titleEl.textContent = titulo;
  msgEl.textContent = mensaje;

  const newBtnOk = btnOk.cloneNode(true);
  btnOk.parentNode.replaceChild(newBtnOk, btnOk);
  const newBtnCancel = btnCancel.cloneNode(true);
  btnCancel.parentNode.replaceChild(newBtnCancel, btnCancel);

  newBtnOk.addEventListener('click', () => { cerrarModalConfirmacion(); onConfirm(); });
  newBtnCancel.addEventListener('click', cerrarModalConfirmacion);

  modal.classList.remove('hidden');
  setTimeout(() => {
    modal.classList.remove('opacity-0');
    content.classList.remove('scale-95');
    content.classList.add('scale-100');
  }, 10);
}

function cerrarModalConfirmacion() {
  const modal = document.getElementById('modal-confirmacion');
  const content = document.getElementById('modal-confirmacion-content');
  if (!modal || !content) return;
  modal.classList.add('opacity-0');
  content.classList.remove('scale-100');
  content.classList.add('scale-95');
  setTimeout(() => modal.classList.add('hidden'), 300);
}

window.tomarTurno = async () => {
  if (Notification.permission === 'default') await solicitarPermisoNotificacion();

  if (configCache) {
    const ahora = new Date();
    const dia = ahora.getDay();
    const hora = ahora.getHours() * 60 + ahora.getMinutes();

    if (diasOperacionNum.length > 0 && !diasOperacionNum.includes(dia)) {
      showToast('Hoy no laboramos. Por favor revisa nuestros días de operación.', 'error');
      return;
    }

    if (configCache.hora_apertura && configCache.hora_cierre) {
      const [hAp, mAp] = configCache.hora_apertura.split(':').map(Number);
      const [hCi, mCi] = configCache.hora_cierre.split(':').map(Number);
      const minAp = hAp * 60 + mAp;
      let minCi = hCi * 60 + mCi;

      if (minCi <= minAp) {
        if (hora < minAp && hora >= minCi) {
          showToast(`Nuestro horario es de ${configCache.hora_apertura} a ${configCache.hora_cierre}.`, 'error');
          return;
        }
      } else {
        if (hora < minAp || hora >= minCi) {
          showToast(`Nuestro horario es de ${configCache.hora_apertura} a ${configCache.hora_cierre}.`, 'error');
          return;
        }
      }
    }
  }

  const { data: estadoNegocio } = await supabase.from('estado_negocio').select('en_break, break_end_time').eq('negocio_id', negocioId).maybeSingle();
  if (estadoNegocio && estadoNegocio.en_break) {
    const finBreak = new Date(estadoNegocio.break_end_time);
    if (finBreak > new Date()) {
      showToast(`Estamos en break hasta las ${finBreak.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`, 'warning');
      return;
    }
  }

  const servicioEl = document.getElementById('select-servicio');
  const barberEl = document.getElementById('select-barbero-turno');
  const servicio = servicioEl ? servicioEl.value : '';
  if (!servicio) return showToast('Selecciona un servicio', 'error');
  const barberSel = barberEl ? barberEl.value : '';
  if (!barberSel) return showToast('Selecciona un barbero', 'error');

  const nombreEl = document.getElementById('profile-name');
  const phoneEl = document.getElementById('profile-phone');
  const nombre = nombreEl ? nombreEl.textContent : '';
  const telefono = phoneEl ? phoneEl.textContent : '';

  const btn = document.getElementById('btn-tomar-turno');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="flex items-center gap-2"><svg class="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Reservando...</span>';
  }

  try {
    const { data, error } = await supabase.rpc('registrar_turno', {
      p_negocio_id: negocioId,
      p_nombre: nombre,
      p_telefono: telefono,
      p_servicio: servicio,
      p_barber_id: Number(barberSel)
    });

    if (error) throw error;
    if (!data.success) throw new Error(data.message);

    const nuevoTurno = data.turno;
    showToast(`¡Turno ${nuevoTurno} reservado!`);
    sendPushNotification('🎉 ¡Estás en la lista!', `Tu turno ${nuevoTurno} está confirmado. Relájate, nosotros te avisamos.`);

    if (navigator.vibrate) navigator.vibrate(200);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    verificarTurnoActivo();
  } catch (error) {
    showToast('Error: ' + error.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = 'Confirmar Turno';
    }
  }
};

function roundToSlot(date, slotMin = 30) {
  const d = new Date(date);
  const mins = d.getMinutes();
  const rounded = Math.ceil(mins / slotMin) * slotMin;
  d.setMinutes(rounded, 0, 0);
  return d;
}

function sugerirHora(ahora, tiempoEstimado, duracion, estado) {
  let base = new Date(ahora);
  if (estado === 'Alta') {
    base.setMinutes(base.getMinutes() + Math.max(tiempoEstimado, 120));
  } else {
    base.setMinutes(base.getMinutes() + Math.max(tiempoEstimado, duracion));
  }
  return roundToSlot(base, 30);
}

async function cargarBarberos() {
  const { data } = await supabase.from('barberos').select('id,nombre,usuario,avatar_url').eq('negocio_id', negocioId).eq('activo', true).order('nombre', { ascending: true });
  window.barbersData = data || [];
  const select = document.getElementById('select-barbero-cita');
  if (select) {
    select.innerHTML = '<option value="">Selecciona un barbero...</option>';
    (data || []).forEach(b => {
      const opt = document.createElement('option');
      opt.value = b.id;
      opt.textContent = b.nombre || b.usuario;
      select.appendChild(opt);
    });
  }
  const selectTurno = document.getElementById('select-barbero-turno');
  if (selectTurno) {
    selectTurno.innerHTML = '<option value="">Selecciona un barbero...</option>';
    (data || []).forEach(b => {
      const opt = document.createElement('option');
      opt.value = b.id;
      opt.textContent = b.nombre || b.usuario;
      selectTurno.appendChild(opt);
    });
  }
}

window.reservarCitaInteligente = async () => {
  const phoneEl = document.getElementById('profile-phone');
  const telefono = phoneEl ? phoneEl.textContent : '';
  const start = window.__sugeridaHora__;
  if (!start) {
    showToast('Por favor, obtén una hora sugerida primero.', 'error');
    return;
  }
  const end = new Date(start);
  end.setMinutes(end.getMinutes() + (window.__duracionServicio__ || 30));
  const barberSel = document.getElementById('select-barbero-cita').value;
  const barberId = barberSel ? Number(barberSel) : null;
  const btn = document.querySelector('button[onclick="reservarCitaInteligente()"]');

  if (!barberId) {
    showToast('No hay barberos seleccionados', 'error');
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="flex items-center gap-2"><svg class="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Reservando Cita...</span>';
  }

  try {
    const { error } = await supabase.rpc('programar_cita', {
      p_negocio_id: negocioId,
      p_barber_id: barberId,
      p_cliente_telefono: telefono,
      p_start: start.toISOString(),
      p_end: end.toISOString()
    });

    if (error) throw error;

    showToast('¡Cita inteligente reservada!');
    await sendPushNotification('¡Cita Reservada!', `Tu cita inteligente para hoy a las ${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ha sido confirmada.`);

    setTimeout(() => window.location.reload(), 2000);
  } catch (e) {
    showToast('No se pudo reservar la cita: ' + e.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = 'Agendar Cita Inteligente';
    }
  }
};

window.reservarMasTarde = async () => {
  const ahora = new Date();
  const duracion = window.__duracionServicio__ || 30;
  const sugerida = sugerirHora(ahora, 120, duracion, 'Alta');
  window.__sugeridaHora__ = sugerida;
  const txt = document.getElementById('texto-sugerencia');
  if (txt) {
    txt.textContent =
      `Te recomendamos reservar para más tarde: ${sugerida.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
  }
};

window.verHorariosLibres = () => {
  const cont = document.getElementById('horarios-libres');
  if (cont) cont.classList.remove('hidden');
  const today = new Date();
  const offset = today.getTimezoneOffset();
  const localDate = new Date(today.getTime() - (offset * 60 * 1000));
  const d = localDate.toISOString().slice(0, 10);
  const dp = document.getElementById('date-picker');
  if (dp) {
    if (!dp.value) dp.value = d;
    dp.min = d;
  }
  renderSlotsForSelectedDate();
};

function slotDisponible(slotStart, duracion, citas = [], breaks = []) {
  const slotEnd = new Date(slotStart);
  slotEnd.setMinutes(slotEnd.getMinutes() + duracion);
  const startMs = slotStart.getTime();
  const endMs = slotEnd.getTime();

  const conflictCita = citas.some(c => {
    const cStart = new Date(c.start_at).getTime();
    const cEnd = new Date(c.end_at).getTime();
    return startMs < cEnd && endMs > cStart;
  });
  if (conflictCita) return false;

  const conflictBreak = breaks.some(b => {
    const [bStart, bEnd] = b;
    return startMs < bEnd && endMs > bStart;
  });
  if (conflictBreak) return false;

  return true;
}

async function renderSlotsForSelectedDate() {
  await cargarConfigNegocio();
  const dp = document.getElementById('date-picker');
  const barberSelEl = document.getElementById('select-barbero-cita');
  const servicioSelEl = document.getElementById('select-servicio-cita');
  const servicioAltEl = document.getElementById('select-servicio');
  const dateStr = dp ? dp.value : '';
  const barberSel = barberSelEl ? barberSelEl.value : '';
  const servicioSel = servicioSelEl?.value || servicioAltEl?.value;

  const slotsContainer = document.getElementById('slots-container');
  const rangoDisplay = document.getElementById('rango-horario-display');
  const actionContainer = document.getElementById('action-container');

  const infoCard = document.getElementById('barber-info-card');
  if (infoCard && window.barbersData) {
    const barber = window.barbersData.find(b => b.id == barberSel);
    if (barber) {
      infoCard.classList.remove('hidden');
      infoCard.classList.add('flex');
      const nameDisplay = document.getElementById('barber-name-display');
      if (nameDisplay) nameDisplay.textContent = barber.nombre || barber.usuario || 'Barbero';
      const avatarDisplay = document.getElementById('barber-avatar-display');
      if (avatarDisplay) avatarDisplay.src = barber.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(barber.nombre || barber.usuario || 'B')}&background=C1121F&color=fff&bold=true`;
    } else {
      infoCard.classList.add('hidden');
      infoCard.classList.remove('flex');
    }
  }

  if (!negocioId) { console.error('negocioId es undefined'); return; }
  if (!barberSel) {
    if (slotsContainer) slotsContainer.innerHTML = '<div class="col-span-full text-center text-barberRed font-bold py-4 bg-barberRed/10 rounded-xl border border-barberRed/20">👆 Por favor selecciona un barbero arriba</div>';
    return;
  }
  if (!dateStr) {
    if (slotsContainer) slotsContainer.innerHTML = '<div class="col-span-full text-center text-gray-500 py-4">Selecciona una fecha.</div>';
    return;
  }

  const cacheKey = `${dateStr}_${barberSel}`;

  window.__horaSeleccionada__ = null;
  if (actionContainer) actionContainer.classList.add('hidden');

  if (!dateStr || !barberSel || !servicioSel) {
    if (slotsContainer) slotsContainer.innerHTML = '';
    if (rangoDisplay) rangoDisplay.textContent = '';
    return;
  }

  if (slotsCache[cacheKey]) {
    renderSlotsFromData(slotsCache[cacheKey], dateStr, serviciosCache[servicioSel] || 30);
    return;
  }

  if (slotsContainer) slotsContainer.innerHTML = '<div class="col-span-full text-center text-gray-500 py-8 animate-pulse">Buscando disponibilidad...</div>';

  const promises = [];

  const dur = serviciosCache[servicioSel] || 30;

  const apStr = configCache?.hora_apertura || '08:00';
  const ciStr = configCache?.hora_cierre || '21:00';
  const ap = apStr.split(':').map(Number);
  const ci = ciStr.split(':').map(Number);

  if (rangoDisplay) {
    rangoDisplay.textContent = `Horario disponible: ${apStr} - ${ciStr}`;
    rangoDisplay.className = 'mt-4 text-center text-sm font-medium text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-black/30 py-2 rounded-lg border border-gray-200 dark:border-white/10';
  }

  const startDay = new Date(dateStr + 'T00:00:00');
  const dayNum = startDay.getDay();

  if (diasOperacionNum.length && !diasOperacionNum.includes(dayNum)) {
    if (slotsContainer) {
      slotsContainer.innerHTML = '<div class="col-span-full flex flex-col items-center justify-center text-gray-500 py-8"><svg xmlns="http://www.w3.org/2000/svg" class="h-10 w-10 mb-2 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg><span>El negocio no opera este día.</span></div>';
    }
    return;
  }

  const startDayISO = new Date(dateStr + 'T00:00:00').toISOString();
  const endDayISO = new Date(dateStr + 'T23:59:59').toISOString();

  startDay.setHours(ap[0], ap[1], 0, 0);

  const endDay = new Date(dateStr + 'T00:00:00');
  if (ci[0] === 0 && ci[1] === 0) {
    endDay.setHours(24, 0, 0, 0);
  } else {
    endDay.setHours(ci[0], ci[1], 0, 0);
  }

  if (endDay <= startDay) endDay.setDate(endDay.getDate() + 1);

  const phoneEl = document.getElementById('profile-phone');
  const telefono = phoneEl ? phoneEl.textContent : '';
  let misCitas = [];
  if (telefono && telefono !== '...') {
    const pMisCitas = supabase
      .from('citas')
      .select('id')
      .eq('negocio_id', negocioId)
      .eq('cliente_telefono', telefono)
      .neq('estado', 'Cancelada')
      .gte('start_at', startDayISO)
      .lte('start_at', endDayISO);
    promises.push(pMisCitas.then(r => { misCitas = r.data || []; }));
  }

  let citas = [];
  const pCitas = supabase
    .from('citas')
    .select('start_at, end_at')
    .eq('negocio_id', negocioId)
    .eq('barber_id', Number(barberSel))
    .neq('estado', 'Cancelada')
    .gte('start_at', startDayISO)
    .lte('start_at', endDayISO);
  promises.push(pCitas.then(r => { citas = r.data || []; }));

  let estadoNegocio = null;
  const pEstado = supabase.from('estado_negocio').select('weekly_breaks').eq('negocio_id', negocioId).maybeSingle();
  promises.push(pEstado.then(r => { estadoNegocio = r.data; }));

  let turnosActivos = [];
  const pTurnos = supabase
    .from('turnos')
    .select('started_at, hora, servicio')
    .eq('negocio_id', negocioId)
    .eq('barber_id', Number(barberSel))
    .eq('estado', 'En atención')
    .eq('fecha', dateStr);
  promises.push(pTurnos.then(r => { turnosActivos = r.data || []; }));

  await Promise.all(promises);

  if (misCitas.length > 0) {
    if (slotsContainer) {
      slotsContainer.innerHTML = `
              <div class="col-span-full flex flex-col items-center justify-center p-6 bg-amber-50 dark:bg-amber-900/10 rounded-2xl border border-amber-100 dark:border-amber-800/30">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 text-amber-500 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <h3 class="text-lg font-bold text-amber-800 dark:text-amber-400 mb-1">Ya tienes una cita</h3>
                  <p class="text-sm text-amber-700 dark:text-amber-300 text-center">Solo se permite una reserva por día.</p>
              </div>
          `;
    }
    return;
  }

  const wb = estadoNegocio?.weekly_breaks || [];
  const brk = wb.find(x => x.day === dayNum);
  const breaks = [];
  if (brk && brk.start && brk.end) {
    const bs = new Date(dateStr + 'T00:00:00'); const be = new Date(dateStr + 'T00:00:00');
    const s = brk.start.split(':').map(Number); const e = brk.end.split(':').map(Number);
    bs.setHours(s[0], s[1], 0, 0); be.setHours(e[0], e[1], 0, 0);
    breaks.push([bs.getTime(), be.getTime()]);
  }

  (turnosActivos || []).forEach(t => {
    const s = t.started_at ? new Date(t.started_at) : new Date(`${dateStr}T${t.hora}`);
    const d = serviciosCache[t.servicio] || 30;
    const e = new Date(s);
    e.setMinutes(e.getMinutes() + d);
    breaks.push([s.getTime(), e.getTime()]);
  });

  const dataToCache = { startDay, endDay, citas, breaks, isToday: (dateStr === new Date().toISOString().slice(0, 10)) };
  slotsCache[cacheKey] = dataToCache;

  renderSlotsFromData(dataToCache, dateStr, dur);
}

function renderSlotsFromData(data, dateStr, dur) {
  const { startDay, endDay, citas, breaks, isToday } = data;
  const slotsContainer = document.getElementById('slots-container');
  if (!slotsContainer) return;

  slotsContainer.innerHTML = '';

  const step = 30;
  const tmp = new Date(startDay);
  const now = new Date();

  while (tmp < endDay) {
    const currentSlot = new Date(tmp);

    let isPast = false;
    if (isToday && currentSlot.getTime() < now.getTime()) isPast = true;

    const slotEnd = new Date(currentSlot);
    slotEnd.setMinutes(slotEnd.getMinutes() + dur);
    if (slotEnd > endDay) break;

    const disponible = !isPast && slotDisponible(currentSlot, dur, citas || [], breaks);

    const btn = document.createElement('button');
    const baseClass = 'slot-enter py-3 rounded-xl font-bold text-sm border transition-all duration-200 relative overflow-hidden flex flex-col items-center justify-center shadow-sm';

    if (disponible) {
      btn.className = `${baseClass} bg-gray-50 dark:bg-transparent border-gray-200 dark:border-white/10 hover:border-barberRed dark:hover:bg-barberRed/10 cursor-pointer group`;
      btn.onclick = () => seleccionarHora(currentSlot, btn);
    } else {
      btn.className = `${baseClass} bg-gray-100 dark:bg-[#1E1E22] border-transparent text-gray-400 dark:text-gray-600 cursor-not-allowed opacity-50`;
      btn.disabled = true;
    }

    const timeStr = currentSlot.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

    btn.innerHTML = `
            <span class="${disponible ? 'text-gray-900 dark:text-gray-200 group-hover:text-barberRed' : ''}">${timeStr}</span>
            ${disponible ? `<span class="text-[10px] text-green-600 dark:text-green-400 font-medium mt-1">Libre</span>` : '<span class="text-[10px] mt-1">Ocupado</span>'}
        `;

    slotsContainer.appendChild(btn);
    tmp.setMinutes(tmp.getMinutes() + step);
  }

  if (slotsContainer.children.length === 0) {
    slotsContainer.innerHTML = '<div class="col-span-full text-center text-gray-500 py-4">No hay horarios disponibles.</div>';
  }
}

function seleccionarHora(date, btnElement) {
  window.__horaSeleccionada__ = date;

  const container = document.getElementById('slots-container');
  if (container) {
    Array.from(container.children).forEach(c => {
      if (!c.disabled) {
        c.classList.remove('slot-selected');
        c.classList.remove('bg-barberRed', 'text-white', 'border-barberRed');
      }
    });
  }

  btnElement.classList.remove('dark:bg-transparent');
  btnElement.classList.add('slot-selected');

  const actionContainer = document.getElementById('action-container');
  if (actionContainer) {
    actionContainer.classList.remove('hidden');
    actionContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

async function confirmarReservaManual() {
  if (Notification.permission === 'default') {
    await solicitarPermisoNotificacion();
  }

  if (!window.__horaSeleccionada__) return;

  const date = window.__horaSeleccionada__;
  const barberSel = document.getElementById('select-barbero-cita').value;

  if (!barberSel) {
    showToast('Error: Debes seleccionar un barbero.', 'error');
    return;
  }

  const servicioSel = document.getElementById('select-servicio-cita').value || document.getElementById('select-servicio').value;
  const phoneEl = document.getElementById('profile-phone');
  const telefono = phoneEl ? phoneEl.textContent : '';
  const dur = serviciosCache[servicioSel] || 30;

  const slotEnd = new Date(date);
  slotEnd.setMinutes(slotEnd.getMinutes() + dur);

  const timeStr = date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

  confirmarAccion(
    'Confirmar Cita',
    `¿Reservar para las ${timeStr}?\nServicio: ${servicioSel}`,
    async () => {
      try {
        const { error } = await supabase.rpc('programar_cita', {
          p_negocio_id: negocioId,
          p_barber_id: Number(barberSel),
          p_cliente_telefono: telefono,
          p_start: date.toISOString(),
          p_end: slotEnd.toISOString()
        });

        if (error) throw error;

        showToast('¡Cita reservada con éxito!');

        if (typeof confetti === 'function') {
          confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 }, colors: ['#C1121F', '#111113', '#ffffff'] });
        }

        Object.keys(slotsCache).forEach(k => delete slotsCache[k]);

        sendPushNotification('¡Cita Confirmada!', `Tu cita para las ${timeStr} ha sido agendada.`);

        window.__horaSeleccionada__ = null;
        const actionContainer = document.getElementById('action-container');
        if (actionContainer) actionContainer.classList.add('hidden');
        renderSlotsForSelectedDate();
      } catch (e) {
        console.error(e);
        const msg = (e.message && e.message.length < 150) ? e.message : 'Ese horario acaba de ocuparse o hubo un error. Por favor selecciona otro.';
        showToast(msg, 'error');
        renderSlotsForSelectedDate();
      }
    }
  );
}

window.cancelarTurno = async () => {
  confirmarAccion('Cancelar Turno', '¿Estás seguro de que deseas cancelar tu turno actual?', async () => {
    const telefono = localStorage.getItem(`cliente_telefono_${negocioId}`);
    const hoy = new Date().toISOString().slice(0, 10);

    if (!telefono) {
      showToast('No se pudo identificar al usuario', 'error');
      return;
    }

    const { error } = await supabase.from('turnos')
      .update({ estado: 'Cancelado' })
      .eq('negocio_id', negocioId)
      .eq('fecha', hoy)
      .eq('telefono', telefono)
      .in('estado', ['En espera']);

    if (error) showToast('Error al cancelar', 'error');
    else {
      showToast('Turno cancelado');
      verificarTurnoActivo();
    }
  });
};

window.cancelarCita = async (idCita = null) => {
  const card = document.getElementById('card-cita-activa');
  const id = idCita || (card ? card.dataset.id : null);
  if (!id) return;

  confirmarAccion(
    '¿Cancelar Cita?',
    'Esta acción liberará el horario para otros clientes.',
    async () => {
      const { error } = await supabase.from('citas').update({ estado: 'Cancelada' }).eq('id', id);
      if (error) {
        showToast('Error al cancelar cita', 'error');
      } else {
        showToast('Tu cita ha sido cancelada.', 'success');
        verificarCitaActiva();
      }
    }
  );
};

window.subirAvatar = async (input) => {
  const file = input.files[0];
  if (!file) return;

  const bucketName = 'avatars';
  const fileName = `public/${clienteId}-${Date.now()}`;

  try {
    // Refrescar sesión para evitar error "exp claim timestamp check failed"
    await supabase.auth.refreshSession();

    const { error: uploadError } = await supabase.storage
      .from(bucketName)
      .upload(fileName, file, {
        cacheControl: '3600',
        upsert: true
      });

    if (uploadError) throw uploadError;

    const { data: publicData } = supabase.storage
      .from(bucketName)
      .getPublicUrl(fileName);

    const publicUrl = publicData?.publicUrl;
    if (!publicUrl) throw new Error('No se pudo obtener la URL pública.');

    const { error: dbError } = await supabase.from('clientes')
      .update({ avatar_url: publicUrl })
      .eq('id', clienteId);

    if (dbError) throw dbError;

    showToast('Avatar actualizado con éxito.', 'success');
    await cargarPerfil();
  } catch (error) {
    console.warn('Fallo subida a Storage, intentando fallback Data URL:', error);

    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const dataUrl = e.target.result;

        const { error: dbError } = await supabase.from('clientes')
          .update({ avatar_url: dataUrl })
          .eq('id', clienteId);

        if (dbError) {
          console.error('Error guardando Data URL:', dbError);
          showToast('No se pudo guardar la imagen. Contacta al administrador.', 'error');
          return;
        }

        const navAvatar = document.getElementById('nav-avatar');
        if (navAvatar) navAvatar.src = dataUrl;
        const profileAvatar = document.getElementById('profile-avatar');
        if (profileAvatar) profileAvatar.src = dataUrl;
        showToast('Avatar guardado correctamente (modo local).', 'success');
      };
      reader.readAsDataURL(file);
    } catch (e2) {
      console.error('Error fatal al procesar imagen:', e2);
      showToast('No se pudo procesar la imagen.', 'error');
    }
  }
};

async function checkPendingRatings() {
  const telefono = localStorage.getItem(`cliente_telefono_${negocioId}`);
  if (!telefono) return;

  const { data: turnos } = await supabase
    .from('turnos')
    .select('id, barber_id, servicio, barberos(nombre)')
    .eq('negocio_id', negocioId)
    .eq('telefono', telefono)
    .eq('estado', 'Atendido')
    .eq('fecha', new Date().toISOString().slice(0, 10))
    .order('updated_at', { ascending: false })
    .limit(1);

  if (turnos && turnos.length > 0) {
    const turno = turnos[0];

    const { data: comments } = await supabase
      .from('comentarios')
      .select('id')
      .eq('turno_id', turno.id)
      .maybeSingle();

    if (!comments) {
      mostrarModalCalificacion(turno);
    }
  }
}

function mostrarModalCalificacion(turno) {
  const modal = document.getElementById('modal-calificacion');
  const content = document.getElementById('modal-calificacion-content');
  if (!modal || !content) return;

  const barberName = turno.barberos?.nombre || 'el barbero';
  const barberNameEl = document.getElementById('rating-barber-name');
  if (barberNameEl) barberNameEl.textContent = barberName;
  const turnoIdEl = document.getElementById('rating-turno-id');
  if (turnoIdEl) turnoIdEl.value = turno.id;

  modal.classList.remove('hidden');

  setTimeout(() => {
    modal.classList.remove('opacity-0');
    content.classList.remove('scale-95');
    content.classList.add('scale-100');
  }, 10);
}

function cerrarModalCalificacion() {
  const modal = document.getElementById('modal-calificacion');
  const content = document.getElementById('modal-calificacion-content');

  if (!modal || !content) return;

  modal.classList.add('opacity-0');
  content.classList.remove('scale-100');
  content.classList.add('scale-95');

  try {
    document.querySelectorAll('input[name="rating"]').forEach(r => { r.checked = false; });
    const txt = document.getElementById('rating-comment');
    if (txt) txt.value = '';
  } catch (e) {
  }

  setTimeout(() => {
    modal.classList.add('hidden');
  }, 300);
}

async function enviarCalificacion(turnoId, rating, comment) {
  const telefono = localStorage.getItem(`cliente_telefono_${negocioId}`);
  const nameEl = document.getElementById('profile-name');
  const nombre = nameEl ? nameEl.textContent : '';

  const { error } = await supabase.from('comentarios').insert([{
    negocio_id: negocioId,
    turno_id: turnoId,
    calificacion: parseInt(rating, 10),
    comentario: comment,
    nombre_cliente: nombre,
    telefono_cliente: telefono
  }]);

  if (error) {
    showToast('Error al enviar calificación', 'error');
  } else {
    showToast('¡Gracias por tu opinión!');
    cerrarModalCalificacion();
  }
}

const formCal = document.getElementById('form-calificacion');
if (formCal) {
  formCal.addEventListener('submit', async (e) => {
    e.preventDefault();
    const selected = document.querySelector('input[name="rating"]:checked');
    if (!selected) {
      showToast('Selecciona una calificación primero', 'error');
      return;
    }
    const turnoIdEl = document.getElementById('rating-turno-id');
    const turnoId = turnoIdEl ? turnoIdEl.value : null;
    const commentEl = document.getElementById('rating-comment');
    const comment = commentEl ? commentEl.value : '';
    if (turnoId) await enviarCalificacion(turnoId, selected.value, comment);
  });
}

init();
cargarBarberos();
cargarConfigNegocio();
document.querySelectorAll('a[href^="https://wa.me/"]').forEach(a => a.addEventListener('click', () => { if (navigator.vibrate) navigator.vibrate(20); }));
setupThemeToggle();
setupStaticEventHandlers();
