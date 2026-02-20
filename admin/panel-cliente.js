import { ensureSupabase } from '../database.js';

const negocioId = 'barberia005';
const supabase = await ensureSupabase();

// Estado centralizado para la aplicación, eliminando variables globales.
const appState = {
  user: null,
  profile: null,
  barbers: [],
  hasActiveTurn: false,
  hasActiveAppointment: false,
  selectedTimeSlot: null,
  suggestedTime: null,
  serviceDuration: 30,
};

// Obtener usuario desde la sesión como fuente de verdad, no desde localStorage.
const { data: { user }, error: sessionError } = await supabase.auth.getUser();

if (sessionError || !user) {
    console.error('Authentication error or no user session:', sessionError?.message);
    // Limpiar datos locales potencialmente corruptos.
    localStorage.removeItem(`cliente_id_${negocioId}`);
    localStorage.removeItem(`cliente_telefono_${negocioId}`);
    window.location.href = 'login_cliente.html';
    throw new Error("No user session found."); // Detener ejecución del script.
}

appState.user = user;
const clienteId = appState.user.id; // Usar ID de usuario desde la sesión segura.

let serviciosCache = {};
let preciosCache = {};
let configCache = null;
let diasOperacionNum = [];

// --- SISTEMA DE CACHÉ ROBUSTO ---
const CACHE_TTL = {
  PROFILE: 60,    // 1 hora
  SERVICES: 1440, // 24 horas
  CONFIG: 60,     // 1 hora
  BARBERS: 60     // 1 hora
};

function getCache(key) {
  const item = localStorage.getItem(`cache_${negocioId}_${key}`);
  if (!item) return null;
  try {
    const { data, expiry } = JSON.parse(item);
    if (Date.now() > expiry) {
      localStorage.removeItem(`cache_${negocioId}_${key}`);
      return null;
    }
    return data;
  } catch (e) { return null; }
}

function setCache(key, data, ttlMinutes) {
  const expiry = Date.now() + (ttlMinutes * 60 * 1000);
  localStorage.setItem(`cache_${negocioId}_${key}`, JSON.stringify({ data, expiry }));
}
// --------------------------------

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

function getSaludo() {
  const hora = new Date().getHours();
  if (hora < 12) return 'Buenos días';
  if (hora < 18) return 'Buenas tardes';
  return 'Buenas noches';
}

function updateBanner(mode = 'default') {
  const bannerInicio = document.getElementById('banner-inicio');
  if (!bannerInicio) return;

  const contentWrapper = bannerInicio.querySelector('.banner-content-wrapper');
  let htmlContent = '';
  const day = new Date().getDay(); // 0 = Domingo, 1 = Lunes...

  if (mode === 'active_turn') {
    htmlContent = `
        <div class="absolute inset-0 bg-gradient-to-r from-black/80 via-black/50 to-transparent z-0"></div>
        <div class="relative z-10">
            <div class="inline-flex items-center gap-2 bg-white/10 backdrop-blur-md text-white border border-white/20 rounded-full px-3 py-1 text-[10px] font-bold mb-4 shadow-lg uppercase tracking-widest"><span class="banner-badge">En Curso 🔥</span></div>
            <h2 class="banner-title text-3xl md:text-5xl font-display font-bold text-white mb-3 tracking-wide drop-shadow-xl leading-none">Tu barbero está <br><span class="text-transparent bg-clip-text bg-gradient-to-r from-white to-gray-400">trabajando</span></h2>
            <p class="banner-text text-white/80 text-sm md:text-base max-w-lg leading-relaxed font-medium drop-shadow-sm mb-2">Estamos avanzando con los turnos. Mantente atento.</p>
        </div>
    `;
  } else if (mode === 'available') {
    htmlContent = `
        <div class="absolute inset-0 bg-gradient-to-r from-green-900/80 via-black/50 to-transparent z-0"></div>
        <div class="relative z-10">
            <div class="inline-flex items-center gap-2 bg-green-500/20 backdrop-blur-md text-green-300 border border-green-500/30 rounded-full px-3 py-1 text-[10px] font-bold mb-4 shadow-lg uppercase tracking-widest"><span class="banner-badge">Sin Espera 🚀</span></div>
            <h2 class="banner-title text-3xl md:text-5xl font-display font-bold text-white mb-3 tracking-wide drop-shadow-xl leading-none">Barbero <br><span class="text-green-400">Disponible</span></h2>
            <p class="banner-text text-white/80 text-sm md:text-base max-w-lg leading-relaxed font-medium drop-shadow-sm">Puedes venir ahora mismo. Estamos listos.</p>
            <button onclick="switchTab('cita')" class="mt-6 bg-white text-black px-8 py-3 rounded-full font-bold shadow-[0_0_20px_rgba(255,255,255,0.3)] transition-all hover:scale-105 tap-scale flex items-center gap-2">
                <span>Reservar Ahora</span>
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
            </button>
        </div>
    `;
  } else {
    // Lógica de Marketing Dinámico por Día
    let title = "Tu estilo empieza aquí.";
    let text = "Reserva tu cita en segundos y asegura tu espacio con los mejores barberos.";
    let badge = "Agenda Pro";

    if (day === 1) { // Lunes
        title = "Empieza la semana con estilo.";
        text = "Un buen corte define tu semana. Agenda hoy y marca la diferencia.";
        badge = "Lunes de Estilo";
    } else if (day === 5) { // Viernes
        title = "Prepárate para el fin de semana.";
        text = "Últimos espacios disponibles para lucir impecable este finde.";
        badge = "Viernes Social";
        // Contador de escasez simulado para viernes
        text += " <span class='text-yellow-400 font-bold block mt-1'>⚠️ Quedan pocos espacios hoy.</span>";
    } else if (day === 0) { // Domingo
        title = "Domingo de relax y corte.";
        text = "Prepara tu imagen para la semana que viene.";
    }

    htmlContent = `
        <div class="absolute inset-0 bg-gradient-to-r from-barberBlack/90 via-barberBlack/60 to-transparent z-0"></div>
        <div class="relative z-10">
            <div class="flex flex-col gap-4">
              <span class="text-xs uppercase tracking-widest text-white/60">
                ${badge}
              </span>
              <h2 class="text-3xl md:text-5xl font-bold banner-title text-white">
                ${title}
              </h2>
              <p class="text-white/70 text-sm max-w-md">
                ${text}
              </p>
              <button onclick="switchTab('cita')" class="mt-2 px-6 py-3 rounded-xl font-bold btn-primary shadow-lg w-fit">
                Reservar Ahora
              </button>
            </div>
        </div>
    `;
  }

  if (contentWrapper) contentWrapper.innerHTML = htmlContent;
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

window.toggleFab = () => {
  const menu = document.getElementById('fab-menu');
  const btn = document.getElementById('fab-main');
  menu.classList.toggle('active');
  btn.classList.toggle('active');
};

window.logout = async () => {
  // Limpiar caché de la aplicación al cerrar sesión
  Object.keys(localStorage).filter(k => k.startsWith(`cache_${negocioId}`)).forEach(k => localStorage.removeItem(k));
  await supabase.auth.signOut();
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        try {
          await supabase.from('push_subscriptions')
            .delete()
            .eq('endpoint', sub.endpoint)
            .eq('negocio_id', negocioId);
        } catch {}
        await sub.unsubscribe();
      }
    }
  } catch {}
  window.location.href = 'login_cliente.html';
};

window.addEventListener('click', function (e) {
  const profileMenu = document.getElementById('profile-menu');
  const profileToggle = document.getElementById('nav-profile-toggle');
  if (!profileMenu || profileMenu.classList.contains('hidden')) return;
  const clickDentroMenu = profileMenu.contains(e.target);
  const clickEnToggle = profileToggle && profileToggle.contains(e.target);
  if (!clickDentroMenu && !clickEnToggle) {
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
      if (btnFloating) {
          btnFloating.innerHTML = isDark ? sunIcon : moonIcon;
          btnFloating.classList.remove('hidden'); // Asegurar visibilidad
      }
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

  // Reemplazo con delegación de eventos para navegación robusta
  document.addEventListener('click', (e) => {
    const navItem = e.target.closest('[data-tab]');
    if (!navItem) return;

    const tab = navItem.dataset.tab;
    if (tab) {
      e.preventDefault();
      switchTab(tab);
    }
  });
}

const slotsCache = {};
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutos de vida para el caché
let lastSlotsParams = '';

window.switchTab = (tab) => {
  const panels = ['inicio', 'cita', 'perfil'];

  panels.forEach(p => {
    const el = document.getElementById(`tab-${p}-panel`);
    if (!el) return;

    if (p === tab) {
      el.classList.remove('hidden');
      requestAnimationFrame(() => {
        el.classList.add('active');
      });
    } else {
      el.classList.remove('active');
      el.classList.add('hidden');
    }
  });

  // actualizar estilos nav móvil
  document.querySelectorAll('[data-tab]').forEach(el => {
    el.classList.remove('active', 'text-white', 'scale-110');
    if (el.dataset.tab === tab) {
      el.classList.add('active', 'text-white');
    }
  });
};

function setupPosterTilt() {
  const poster = document.querySelector('.barber-poster-3d');
  if (!poster) return;
  poster.addEventListener('mousemove', (e) => {
    const rect = poster.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const rotateX = (y - centerY) / 20;
    const rotateY = (centerX - x) / 20;
    poster.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-10px)`;
  });
  poster.addEventListener('mouseleave', () => {
    poster.style.transform = 'rotateX(0deg) rotateY(0deg) translateY(0)';
  });
}

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
  setupStaticEventHandlers();
  setupThemeToggle();
  updateBanner();
  await cargarPerfil();
  await cargarServicios(); 
  await cargarBarberos(); // Cargar barberos para el select

  // Configurar fecha por defecto a HOY
  const dp = document.getElementById('date-picker');
  if (dp) {
      const today = new Date();
      const d = today.toLocaleDateString('en-CA'); // Formato YYYY-MM-DD
      dp.value = d;
      dp.min = d;
  }

  await verificarCitaActiva();

  if (localStorage.getItem('cita_reservada') === 'true') {
    localStorage.removeItem('cita_reservada');
    switchTab('cita');
    showToast('¡Cita reservada con éxito!', 'success');
  } else {
    switchTab('inicio'); // Vista de Inicio por defecto
  }

  document.getElementById('select-barbero-cita')?.addEventListener('change', updateBarberInfo);
  document.getElementById('btn-ver-horarios')?.addEventListener('click', renderSlotsForSelectedDate);
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
      // actualizarEstadoFila();
      // verificarTurnoActivo();
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
  setupPosterTilt();
  
  // Auto-actualizar minutos cada 30 segundos
  // setInterval(() => { actualizarEstadoFila(); }, 30000);
}

function renderStructure() {
  const bannerTemplate = document.getElementById('banner-marketing-template');
  const inicioContainer = document.getElementById('inicio-promo-container');

  if (bannerTemplate && inicioContainer) {
    const banner1 = bannerTemplate.cloneNode(true);
    banner1.id = 'banner-inicio';
    banner1.classList.remove('hidden');
    inicioContainer.appendChild(banner1);
  }

  const statusContainer = document.getElementById('inicio-status-container');
  if (statusContainer) {
    statusContainer.innerHTML = `
          <div class="bento-card p-6 relative overflow-hidden group tap-scale bg-white dark:bg-[#111113] border border-gray-100 dark:border-white/5 shadow-sm rounded-2xl">
            <div class="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-barberRed to-barberGold"></div>
            <div class="absolute -right-6 -top-6 text-black/5 dark:text-white/5 transform rotate-12 group-hover:scale-110 transition-transform duration-500">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-32 w-32" viewBox="0 0 24 24" fill="currentColor"><path d="M19,3L13,9L15,11L21,5V3M19,5L15,9L17,11L21,7V5M19,7L17,9L19,11L21,9V7M19,9L18,10L19,11L20,10V9M19,11L19,11L19,11L19,11M12,10.5C12,9.67 11.33,9 10.5,9C9.67,9 9,9.67 9,10.5C9,11.33 9.67,12 10.5,12C11.33,12 12,11.33 12,10.5M10.5,7C10.5,7 10.5,7 10.5,7M10.5,14C10.5,14 10.5,14 10.5,14M7.5,10.5C7.5,9.67 6.83,9 6,9C5.17,9 4.5,9.67 4.5,10.5C4.5,11.33 5.17,12 6,12C6.83,12 7.5,11.33 7.5,10.5M6,7C6,7 6,7 6,7M6,14C6,14 6,14 6,14"/></svg>
            </div>
            <div class="relative z-10">
                <div class="flex justify-between items-start mb-4">
                    <div class="p-3 bg-black/5 dark:bg-white/10 rounded-2xl text-black dark:text-white">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" /></svg>
                    </div>
                    <span class="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">Tu Estado</span>
                </div>
                <div id="dash-card-1">
                   <span class="text-5xl font-display font-bold title-text block tracking-wide leading-none text-gray-900 dark:text-white">Sin turno</span>
                   <span class="text-sm subtitle-text font-medium mt-2 block text-gray-600 dark:text-gray-400">No estás en la fila</span>
                </div>
            </div>
          </div>

          <div class="bento-card p-6 relative overflow-hidden group tap-scale bg-white dark:bg-[#111113] border border-gray-100 dark:border-white/5 shadow-sm rounded-2xl">
            <div class="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-barberRed to-barberGold"></div>
            <div class="absolute -right-6 -top-6 text-black/5 dark:text-white/5 transform rotate-12 group-hover:scale-110 transition-transform duration-500">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-32 w-32" viewBox="0 0 24 24" fill="currentColor"><path d="M12,20A8,8 0 0,0 20,12A8,8 0 0,0 12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20M12,2A10,10 0 0,1 22,12A10,10 0 0,1 12,22C6.47,22 2,17.5 2,12A10,10 0 0,1 12,2M12.5,7V12.25L17,14.92L16.25,16.15L11,13V7H12.5Z"/></svg>
            </div>
            <div class="relative z-10">
                <div class="flex justify-between items-start mb-4">
                    <div class="p-3 bg-black/5 dark:bg-white/10 rounded-2xl text-black dark:text-white">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    </div>
                    <span class="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">Estimado</span>
                </div>
                <div id="dash-card-2">
                   <span class="text-5xl font-display font-bold title-text block tracking-wide leading-none text-gray-900 dark:text-white">-- min</span>
                   <span class="text-sm subtitle-text font-medium mt-2 block text-gray-600 dark:text-gray-400">Tiempo de espera</span>
                </div>
            </div>
          </div>

          <div class="bento-card p-6 relative overflow-hidden group tap-scale bg-white dark:bg-[#111113] border border-gray-100 dark:border-white/5 shadow-sm rounded-2xl">
            <div class="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-barberRed to-barberGold"></div>
            <div class="absolute -right-6 -top-6 text-black/5 dark:text-white/5 transform rotate-12 group-hover:scale-110 transition-transform duration-500">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-32 w-32" viewBox="0 0 24 24" fill="currentColor"><path d="M16,11.78L20.24,4.45L21.97,5.45L19.23,10.22L21.23,13.68L19.5,14.68L17.5,11.22L15.5,14.68L13.77,13.68L15.77,10.22L13.03,5.45L14.76,4.45L19,11.78M12,5V19H10V5H12M16,19H14V11H16V19M8,19H6V11H8V19M4,19H2V11H4V19M16,7H14V5H16V7M8,7H6V5H8V7M4,7H2V5H4V7Z"/></svg>
            </div>
            <div class="relative z-10">
                <div class="flex justify-between items-start mb-4">
                    <div class="p-3 bg-black/5 dark:bg-white/10 rounded-2xl text-black dark:text-white">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
                    </div>
                    <span class="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">Demanda</span>
                </div>
                <div id="dash-card-3">
                   <span class="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-black/5 dark:bg-white/10 subtitle-text text-lg font-bold animate-pulse text-gray-900 dark:text-white">Calculando...</span>
                </div>
            </div>
          </div>
        `;
  }

  const citaPanel = document.getElementById('tab-cita-panel');
  if (citaPanel) {
    citaPanel.innerHTML = `
            <div id="cita-promo-container" class="mb-6"></div>
            
            <div id="card-cita-activa" class="hidden bento-card p-8 relative overflow-hidden mb-8 group bg-white dark:bg-[#111113] border border-gray-100 dark:border-white/5 shadow-lg rounded-2xl" style="border-left: 4px solid #000;">
                <div class="absolute top-0 right-0 p-4 opacity-5 text-black dark:text-white">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-24 w-24" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                </div>
                <h3 class="text-sm font-bold title-text uppercase tracking-wider mb-2 text-gray-900 dark:text-white">📅 Tu Cita Programada</h3>
                <div class="flex flex-col gap-1">
                  <span id="cita-fecha-hora" class="text-4xl font-display font-bold tracking-wide title-text text-gray-900 dark:text-white">--</span>
                  <span id="cita-barbero" class="text-lg font-medium subtitle-text text-gray-600 dark:text-gray-300">--</span>
                </div>
                <p id="cita-servicio" class="subtitle-text mt-3 font-medium text-gray-600 dark:text-gray-400">Cita Reservada</p>
                <div class="mt-6 pt-6 border-t border-black/5 dark:border-white/10 flex justify-between items-center">
                  <div class="text-sm subtitle-text text-gray-500 dark:text-gray-400">Llega 5 min antes</div>
                  <button onclick="cancelarCita()" class="bg-black/5 dark:bg-white/10 text-black dark:text-white hover:bg-black/10 dark:hover:bg-white/20 text-sm font-semibold transition-colors px-4 py-2 rounded-lg border border-black/10 dark:border-white/10">Cancelar Cita</button>
                </div>
            </div>
            
            <div id="seccion-cita-inteligente" class="bento-card p-0 overflow-hidden bg-white dark:bg-[#111113] shadow-xl border border-gray-100 dark:border-white/5">
                <!-- Header Azul Oscuro -->
                <div class="bg-gradient-to-r from-barberBlack to-[#1e293b] p-6 md:p-8 text-white relative overflow-hidden">
                    <div class="absolute top-0 right-0 p-4 opacity-10">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-24 w-24" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    </div>
                    <h3 class="text-2xl md:text-3xl font-display font-bold mb-2 relative z-10">Agenda Inteligente</h3>
                    <p class="text-blue-200 text-sm relative z-10">Reserva tu espacio en segundos.</p>
                </div>

                <div id="form-cita-container" class="p-6 md:p-8 space-y-6">
                    <!-- Step 1: Service -->
                    <div>
                        <label class="block text-xs font-bold subtitle-text mb-2 uppercase tracking-wider">1. Selecciona tu Servicio</label>
                        <select id="select-servicio-cita" class="w-full p-4 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-gray-900 dark:text-white font-medium focus:ring-2 focus:ring-blue-900 outline-none transition-all appearance-none">
                            <option value="">Elegir servicio...</option>
                        </select>
                    </div>

                    <!-- Step 2 & 3 -->
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                         <div>
                            <label class="block text-xs font-bold subtitle-text mb-2 uppercase tracking-wider">2. Elige Profesional</label>
                            <div class="relative">
                                <select id="select-barbero-cita" class="w-full p-4 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-gray-900 dark:text-white font-medium focus:ring-2 focus:ring-blue-900 outline-none transition-all appearance-none">
                                    <option value="">Cargando...</option>
                                </select>
                                <div class="absolute inset-y-0 right-0 flex items-center px-4 pointer-events-none text-gray-500">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                                </div>
                            </div>
                        </div>
                        <div>
                            <label class="block text-xs font-bold subtitle-text mb-2 uppercase tracking-wider">3. Selecciona Fecha</label>
                            <input id="date-picker" type="date" class="w-full p-4 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-gray-900 dark:text-white font-medium focus:ring-2 focus:ring-blue-900 outline-none transition-all">
                        </div>
                    </div>

                <button id="btn-ver-horarios" class="w-full py-4 bg-barberBlack dark:bg-white text-white dark:text-black font-bold rounded-xl shadow-lg hover:scale-[1.01] transition-transform flex justify-center items-center gap-2 tap-scale">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        Ver Horarios Libres
                    </button>

                    <div id="horarios-libres" class="mt-2 hidden">
                        <div id="barber-info-card" class="hidden mt-4 flex items-center gap-4 p-4 bg-[#F8F8F9] dark:bg-white/5 rounded-2xl border border-black/5 dark:border-white/10 shadow-sm transition-all animate-fade-in">
                            <img id="barber-avatar-display" src="" class="w-12 h-12 rounded-full object-cover border-2 border-barberRed shadow-sm">
                            <div>
                                <p id="barber-name-display" class="font-bold title-text text-lg leading-tight text-gray-900 dark:text-white"></p>
                                <p class="text-xs subtitle-text font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Barbero seleccionado</p>
                            </div>
                        </div>

                        <div id="slots-section" class="pt-4 border-t border-gray-100 dark:border-white/5">
                            <div class="flex items-center justify-between mb-4">
                                <label class="block text-xs font-bold subtitle-text uppercase tracking-wider text-gray-500 dark:text-gray-400">Horarios Disponibles</label>
                                <span id="rango-horario-display" class="text-[10px] font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-3 py-1 rounded-full"></span>
                            </div>
                            
                            <div id="slots-container" class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3"></div>

                            <div class="mt-6 p-4 bg-blue-50 dark:bg-blue-900/10 border-l-4 border-blue-600 rounded-r-xl flex gap-3 items-start">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                <p class="text-xs text-blue-800 dark:text-blue-200 leading-relaxed">
                                    <strong>Política de puntualidad:</strong> Llega 10 minutos antes. Retrasos de 10 min cancelan la cita automáticamente.
                                </p>
                            </div>

                            <div id="action-container" class="hidden pt-4 animate-fade-in mt-4">
                                 <div class="bg-gray-50 dark:bg-white/5 p-5 rounded-xl mb-4 border border-gray-100 dark:border-white/5">
                                    <div class="flex justify-between items-center mb-2">
                                        <span class="text-xs subtitle-text uppercase tracking-wider text-gray-500 dark:text-gray-400">Servicio</span>
                                        <span id="summary-service" class="text-sm font-bold text-gray-900 dark:text-white text-right">--</span>
                                    </div>
                                    <div class="flex justify-between items-center pt-2 border-t border-gray-200 dark:border-white/10 mt-2">
                                        <span class="text-xs subtitle-text uppercase tracking-wider text-gray-500 dark:text-gray-400">Total</span>
                                        <span id="summary-price" class="text-lg font-black text-blue-600 dark:text-blue-400">RD$ 0.00</span>
                                    </div>
                                 </div>
                                <button id="btn-confirmar-reserva" class="w-full py-4 btn-primary font-bold rounded-xl shadow-xl transition-all transform hover:scale-[1.01] flex justify-center items-center gap-2 tap-scale">Confirmar Cita</button>
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

          <div class="bento-card p-8 max-w-2xl mx-auto bg-white dark:bg-[#111113] border border-gray-100 dark:border-white/5 shadow-lg rounded-2xl">
            <div class="flex flex-col sm:flex-row items-center gap-6">
              <div class="relative flex-shrink-0">
                <img id="profile-avatar" src="https://ui-avatars.com/api/?name=U" class="w-32 h-32 rounded-full border-4 bg-white dark:bg-[#111113] border-black/5 dark:border-[#111113] shadow-2xl object-cover ring-2 ring-black/10 dark:ring-white/10">
                <button onclick="document.getElementById('avatar-upload').click()" class="absolute bottom-0 right-0 bg-black dark:bg-white text-white dark:text-black p-2.5 rounded-full hover:bg-black/80 dark:hover:bg-white/90 shadow-lg border-4 border-white dark:border-[#111113] transition-colors">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                </button>
                <input type="file" id="avatar-upload" class="hidden" accept="image/*" onchange="subirAvatar(this)">
              </div>
              <div class="text-center sm:text-left">
                <h3 id="profile-name" class="text-4xl font-display font-bold title-text tracking-wide text-gray-900 dark:text-white">Cargando...</h3>
                <p id="profile-phone" class="subtitle-text text-lg mt-1 text-gray-600 dark:text-gray-400">...</p>
                <span class="inline-block mt-2 px-4 py-1 rounded-full bg-black/5 dark:bg-white/10 text-black dark:text-white text-xs font-bold border border-black/10 dark:border-white/10">
                  Cliente frecuente ⭐
                </span>
              </div>
            </div>
            <form id="form-perfil" class="mt-10 space-y-6 text-gray-900 dark:text-white">
              <div><label class="text-sm font-semibold mb-2 block subtitle-text text-gray-600 dark:text-gray-400">Nombre Completo</label><input type="text" id="edit-nombre" class="w-full p-4 rounded-xl border bg-[#F8F8F9] dark:bg-[#111113] border-black/5 dark:border-white/10 text-[#111111] dark:text-white focus:border-black dark:focus:border-white focus:ring-1 focus:ring-black dark:focus:ring-white transition outline-none"></div>
              <div><label class="text-sm font-semibold mb-2 block subtitle-text text-gray-600 dark:text-gray-400">Correo Electrónico</label><input type="email" id="edit-email" class="w-full p-4 rounded-xl border bg-[#F8F8F9] dark:bg-[#111113] border-black/5 dark:border-white/10 text-[#111111] dark:text-white focus:border-black dark:focus:border-white focus:ring-1 focus:ring-black dark:focus:ring-white transition outline-none"></div>
              <button type="submit" class="w-full bg-black dark:bg-white hover:bg-black/80 dark:hover:bg-white/90 text-white dark:text-black font-bold py-4 rounded-xl shadow-lg flex justify-center items-center gap-2 mt-4 transition-all">Actualizar Datos</button>
            </form>
          </div>
        `;
  }

}

function registrarServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const swPath = location.pathname.replace(/[^/]*$/, '') + 'sw.js';
  navigator.serviceWorker.register(swPath)
    .then(async () => {
      try {
        if ('Notification' in window && 'PushManager' in window && Notification.permission === 'granted') {
          await crearOSincronizarSuscripcionPush();
        }
      } catch (err) {
        console.error('SW error al sincronizar suscripción push:', err);
      }
    })
    .catch(err => console.error('SW error:', err));
}

async function crearOSincronizarSuscripcionPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    });
  }
  await guardarSuscripcion(subscription);
}

async function solicitarPermisoNotificacion() {
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('Las notificaciones push no son soportadas por este navegador.');
    return;
  }

  if (Notification.permission === 'denied') {
    console.log('Permiso para notificaciones previamente denegado por el usuario.');
    return;
  }

  if (Notification.permission === 'granted') {
    try {
      await crearOSincronizarSuscripcionPush();
    } catch (err) {
      console.error('Error al sincronizar la suscripción push:', err);
    }
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    console.log('Permiso para notificaciones no concedido.');
    return;
  }

  try {
    await crearOSincronizarSuscripcionPush();
  } catch (err) {
    console.error('Error al crear la suscripción push:', err);
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

  (turnosEnAtencion || []).forEach(t => {
    const duracion = serviciosCache[t.servicio] || 30;
    const inicio = t.started_at ? new Date(t.started_at) : new Date();
    const transcurrido = (Date.now() - inicio.getTime()) / 60000;
    const restante = Math.max(0, duracion - transcurrido);
    tiempoTotalMinutos += restante;
  });

  (turnosEnEspera || []).forEach(t => {
    const duracion = serviciosCache[t.servicio] || 30;
    tiempoTotalMinutos += duracion;
  });

  const tiempoEstimado = tiempoTotalMinutos / barberos;
  return Math.ceil(tiempoEstimado);
}

function renderProfile(data) {
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

async function cargarPerfil() {
  // 1. Renderizar desde caché inmediatamente
  const cached = getCache('PROFILE');
  if (cached) renderProfile(cached);

  // 2. Obtener datos frescos
  const { data, error } = await supabase.from('clientes').select('*').eq('id', clienteId).single();
  
  if (error) {
    if (error.message && (error.message.includes('AbortError') || error.message.includes('signal is aborted'))) return;
    console.error('Error cargando perfil:', error);
    // CORRECCIÓN: No cerrar sesión si falta el perfil, usar datos locales
    if (appState.user.user_metadata?.nombre) {
        renderProfile({ nombre: appState.user.user_metadata.nombre, telefono: appState.user.phone || '', email: appState.user.email });
    }
    return;
  }
  
  if (data) {
    setCache('PROFILE', data, 60); // 1 hora de caché
    appState.profile = data;
    renderProfile(data);
  }
}

function renderServices(data) {
  const select = document.getElementById('select-servicio');
  if (select) {
    select.innerHTML = '<option value="">Selecciona un servicio...</option>';
    data.forEach(s => {
      serviciosCache[s.nombre] = s.duracion_min;
      preciosCache[s.nombre] = s.precio;
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

async function cargarServicios() {
  const cached = getCache('SERVICES');
  if (cached) {
    cached.forEach(s => {
        serviciosCache[s.nombre] = s.duracion_min;
        preciosCache[s.nombre] = s.precio;
    });
    renderServices(cached);
  }

  const { data } = await supabase.from('servicios').select('*').eq('negocio_id', negocioId).eq('activo', true);
  if (data) {
    setCache('SERVICES', data, 1440); // 24 horas de caché
    renderServices(data);
  }
}

function processConfig(data) {
  configCache = data || null;
  let diasOp = data?.dias_operacion || [];
  if (typeof diasOp === 'string') {
    try { diasOp = JSON.parse(diasOp); } catch (e) { diasOp = []; }
  }
  const map = { 'Domingo': 0, 'Lunes': 1, 'Martes': 2, 'Miércoles': 3, 'Jueves': 4, 'Viernes': 5, 'Sábado': 6 };
  diasOperacionNum = diasOp.map(n => map[n]).filter(v => typeof v === 'number');
}

async function cargarConfigNegocio() {
  const cached = getCache('CONFIG');
  if (cached) processConfig(cached);

  const { data, error } = await supabase
    .from('configuracion_negocio')
    .select('*')
    .eq('negocio_id', negocioId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  
  if (error) {
    console.error('Error cargando configuración:', error);
    return;
  }

  if (data) {
    setCache('CONFIG', data, 60); // 1 hora de caché
    processConfig(data);
  }
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

  if (!appState.hasActiveTurn && !appState.hasActiveAppointment) {
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
  if (dashCard1 && !appState.hasActiveTurn && !appState.hasActiveAppointment) {
    dashCard1.innerHTML = `
             <span class="text-5xl font-display font-bold title-text block tracking-wide leading-none text-gray-900 dark:text-white">${personasEnCola}</span>
             <span class="text-sm subtitle-text font-medium mt-2 block text-gray-600 dark:text-gray-400">Personas en espera</span>
          `;
  }

  const dashCard2 = document.getElementById('dash-card-2');
  if (dashCard2 && !appState.hasActiveTurn && !appState.hasActiveAppointment) {
    const horaAprox = new Date(Date.now() + tiempoEstimado * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    let detalleAtencion = '';
    if (enAtencion.length > 0) {
        const citasCount = enAtencion.filter(t => t.servicio === 'Cita Programada').length;
        const turnosCount = enAtencion.length - citasCount;
        let partes = [];
        if (citasCount > 0) partes.push(`${citasCount} Cita${citasCount > 1 ? 's' : ''}`);
        if (turnosCount > 0) partes.push(`${turnosCount} Turno${turnosCount > 1 ? 's' : ''}`);
        detalleAtencion = `<span class="text-xs text-blue-600 dark:text-blue-400 font-bold block mt-1 animate-pulse">En curso: ${partes.join(' y ')}</span>`;
    }

    dashCard2.innerHTML = `
             <span class="text-5xl font-display font-bold title-text block tracking-wide leading-none text-gray-900 dark:text-white">${tiempoTexto}</span>
             <div class="mt-2">
                <span class="text-sm subtitle-text font-medium block text-gray-600 dark:text-gray-400">Atención aprox: ${horaAprox}</span>
                ${detalleAtencion}
             </div>
          `;
  }

  const dashCard3 = document.getElementById('dash-card-3');
  if (dashCard3) {
    dashCard3.innerHTML = `
             <span class="inline-flex items-center gap-2 px-4 py-2 rounded-xl ${badgeClass} bg-opacity-10 border border-black/5 dark:border-white/10 text-lg font-bold subtitle-text text-gray-900 dark:text-white">
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
  const telefono = appState.profile?.telefono || appState.user?.phone;

  const { data } = await supabase.from('turnos')
    .select('*')
    .eq('negocio_id', negocioId)
    .eq('fecha', hoy)
    .in('estado', ['En espera', 'En atención'])
    .eq('telefono', telefono)
    .maybeSingle();

  // Buscar tarjeta en el panel de citas (ahora es el principal)
  let card = document.getElementById('card-turno-activo');
  const form = document.getElementById('seccion-tomar-turno');

  // Si no existe la tarjeta (porque ocultamos el panel turno), la inyectamos en citas
  if (!card) {
      const citaPanel = document.getElementById('tab-cita-panel');
      if (citaPanel) {
          const div = document.createElement('div');
          div.id = 'card-turno-activo';
          div.className = 'hidden mb-6';
          citaPanel.prepend(div);
          card = div;
      }
  }

  if (data && card) {
    appState.hasActiveTurn = true;
    updateBanner('active_turn');
    card.classList.remove('hidden');
    if (form) form.classList.add('hidden');
    
    const bloqueadoMsg = document.getElementById('bloqueado-msg');
    if (bloqueadoMsg) bloqueadoMsg.classList.remove('hidden');

    if (data.estado === 'En atención') {
      // Diseño Premium para "En Atención"
      card.innerHTML = `
        <div class="bento-card p-8 relative overflow-hidden group bg-gradient-to-br from-green-500 to-emerald-700 text-white shadow-2xl shadow-green-500/30 border-none">
            <div class="absolute top-0 right-0 p-4 opacity-20">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-32 w-32 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </div>
            <div class="relative z-10 text-center">
                <div class="inline-block px-4 py-1 rounded-full bg-white/20 backdrop-blur-md border border-white/30 text-xs font-bold uppercase tracking-widest mb-4 animate-bounce">
                    🔥 En este momento
                </div>
                <h3 class="text-4xl font-display font-bold mb-2">Te están atendiendo</h3>
                <p class="text-lg text-white/90 font-medium">Relájate y disfruta del servicio.</p>
                <div class="mt-6 pt-6 border-t border-white/20 flex justify-center gap-4">
                    <div class="text-center">
                        <p class="text-xs uppercase tracking-wider opacity-70">Turno</p>
                        <p class="text-2xl font-bold">${data.turno}</p>
                    </div>
                    <div class="w-px bg-white/20"></div>
                    <div class="text-center">
                        <p class="text-xs uppercase tracking-wider opacity-70">Servicio</p>
                        <p class="text-xl font-bold truncate max-w-[150px]">${data.servicio}</p>
                    </div>
                </div>
            </div>
        </div>
      `;
    } else {
      // Diseño para "En Espera" (si llegara a mostrarse, aunque el foco es citas)
      card.innerHTML = `
        <div class="bento-card p-6 relative overflow-hidden bg-white dark:bg-[#111113] border-l-4 border-yellow-400 shadow-sm rounded-2xl">
            <div class="flex justify-between items-center">
                <div>
                    <p class="text-xs font-bold text-yellow-500 uppercase tracking-wider mb-1">En cola de espera</p>
                    <h3 class="text-3xl font-display font-bold title-text text-gray-900 dark:text-white">Turno ${data.turno}</h3>
                    <p class="text-sm subtitle-text mt-1 text-gray-600 dark:text-gray-400">${data.servicio}</p>
                </div>
                <button onclick="cancelarTurno()" class="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-3 rounded-xl hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
            </div>
        </div>
      `;

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
        
        let detalleAtencion = '';
        if (enAtencion.length > 0) {
            const citasCount = enAtencion.filter(t => t.servicio === 'Cita Programada').length;
            const turnosCount = enAtencion.length - citasCount;
            let partes = [];
            if (citasCount > 0) partes.push(`${citasCount} Cita${citasCount > 1 ? 's' : ''}`);
            if (turnosCount > 0) partes.push(`${turnosCount} Turno${turnosCount > 1 ? 's' : ''}`);
            detalleAtencion = `<span class="text-xs text-blue-600 dark:text-blue-400 font-bold block mt-1 animate-pulse">En curso: ${partes.join(' y ')}</span>`;
        }

        dashCard2.innerHTML = `
                   <span class="text-5xl font-display font-bold title-text block tracking-wide leading-none text-gray-900 dark:text-white">${tiempoEstimado} min</span>
                   <div class="mt-2">
                      <span class="text-sm subtitle-text font-medium block text-gray-600 dark:text-gray-400">Atención aprox: ${horaAprox}</span>
                      ${detalleAtencion}
                   </div>
                `;
      }

      const porcentaje = Math.max(5, 100 - (personasDelante * 15));

      if (personasDelante <= 1 && !appState.notificacionCercaEnviada) {
        sendPushNotification('🔔 ¡Ya casi!', `Solo queda ${personasDelante} persona delante. Acércate al local.`);
        window.notificacionCercaEnviada = true;
      }
    }

    const citaForm = document.getElementById('form-cita-container');
    const citaMsg = document.getElementById('bloqueado-cita-msg');
    if (citaForm) citaForm.classList.add('hidden');
    if (citaMsg) citaMsg.classList.remove('hidden');
  } else {
    appState.hasActiveTurn = false;
    if (card) card.classList.add('hidden');
    if (form) form.classList.remove('hidden');
    const bloqueadoMsg = document.getElementById('bloqueado-msg');
    if (bloqueadoMsg) bloqueadoMsg.classList.add('hidden');
    checkPendingRatings();
  }
}

async function verificarCitaActiva() {
  const telefono = appState.profile?.telefono || appState.user?.phone;
  const nombreCliente = appState.profile?.nombre || appState.user?.user_metadata?.nombre || 'Cliente';
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
    appState.hasActiveAppointment = true;
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
                <div class="bento-card p-6 relative overflow-hidden mb-6 animate-fade-in bg-white dark:bg-[#111113] border border-gray-100 dark:border-white/5 shadow-sm rounded-2xl" style="border-left: 4px solid #000;">
                    <div class="absolute top-0 right-0 p-4 opacity-5 text-black dark:text-white pointer-events-none">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-32 w-32 transform rotate-12" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    </div>
                    
                    <div class="relative z-10">
                        <div class="flex justify-between items-start mb-4">
                            <div class="bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/10 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider text-black dark:text-white">
                                📅 Cita Confirmada
                            </div>
                            <div class="text-right">
                                <p class="text-xs subtitle-text uppercase tracking-wider font-bold text-gray-500 dark:text-gray-400">Barbero</p>
                                <p class="font-bold title-text text-lg leading-none text-gray-900 dark:text-white">${barberName}</p>
                            </div>
                        </div>

                        <div class="mb-6">
                            <p class="text-5xl font-display font-bold tracking-tight title-text mb-1 text-gray-900 dark:text-white">${timeStr}</p>
                            <p class="text-lg subtitle-text font-medium capitalize text-gray-600 dark:text-gray-400">${dateStr}</p>
                        </div>

                        <div class="flex items-center justify-between border-t border-black/5 dark:border-white/10 pt-4">
                            <div>
                                <p class="text-xs subtitle-text uppercase tracking-wider font-bold text-gray-500 dark:text-gray-400">Cliente</p>
                                <p class="font-bold title-text text-gray-900 dark:text-white">${nombreCliente}</p>
                                <p class="text-xs subtitle-text mt-0.5 text-gray-600 dark:text-gray-400">${servicioTexto}</p>
                            </div>
                            <button onclick="cancelarCita(${cita.id})" class="bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20 text-black dark:text-white text-xs font-bold px-4 py-2.5 rounded-xl transition-colors border border-black/10 dark:border-white/10 flex items-center gap-2">
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

    cardCita.innerHTML = cardHTML;

    const dashCard1 = document.getElementById('dash-card-1');
    if (dashCard1) {
      dashCard1.innerHTML = `
                   <span class="text-5xl font-display font-bold title-text block tracking-wide leading-none text-gray-900 dark:text-white">CITA</span>
                   <span class="text-sm subtitle-text font-bold mt-2 block text-gray-600 dark:text-gray-400">PROGRAMADA</span>
                `;
    }
    const dashCard2 = document.getElementById('dash-card-2');
    if (dashCard2) {
      dashCard2.innerHTML = `
                   <span class="text-5xl font-display font-bold title-text block tracking-wide leading-none text-gray-900 dark:text-white">${timeStr}</span>
                   <span class="text-sm subtitle-text font-medium mt-2 block text-gray-600 dark:text-gray-400">Hora de atención</span>
                `;
    }
  } else {
    appState.hasActiveAppointment = false;
    if (inicioCitaContainer) inicioCitaContainer.innerHTML = '';
    const cardCitaEl = document.getElementById('card-cita-activa');
    if (cardCitaEl) cardCitaEl.innerHTML = '';
    
    if (seccionCita) seccionCita.classList.remove('hidden');
  }
}

async function sendPushNotification(title, body) {
  const telefono = appState.profile?.telefono;
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

function renderBarbersList(data) {
  window.barbersData = data || [];
  const select = document.getElementById('select-barbero-cita');
  if (select) {
    const val = select.value;
    select.innerHTML = '<option value="">Selecciona un barbero...</option>';
    (data || []).forEach(b => {
      const opt = document.createElement('option');
      opt.value = b.id;
      opt.textContent = b.nombre || b.usuario;
      select.appendChild(opt);
    });
    if (val) select.value = val;
  }
  const selectTurno = document.getElementById('select-barbero-turno');
  if (selectTurno) {
    const val = selectTurno.value;
    selectTurno.innerHTML = '<option value="">Selecciona un barbero...</option>';
    (data || []).forEach(b => {
      const opt = document.createElement('option');
      opt.value = b.id;
      opt.textContent = b.nombre || b.usuario;
      selectTurno.appendChild(opt);
    });
    if (val) selectTurno.value = val;
  }
}

async function cargarBarberos() {
  const cached = getCache('barberos');
  if (cached) renderBarbersList(cached);

  const { data } = await supabase.from('barberos').select('id,nombre,usuario,avatar_url').eq('negocio_id', negocioId).eq('activo', true).order('nombre', { ascending: true });
  
  if (data) {
    setCache('barberos', data, CACHE_TTL.BARBERS);
    renderBarbersList(data);
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
  const d = today.toLocaleDateString('en-CA'); // Formato YYYY-MM-DD local seguro
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

function updateBarberInfo() {
  const barberSel = document.getElementById('select-barbero-cita')?.value;  const barbers = appState.barbers || [];
  const infoCard = document.getElementById('barber-info-card');
  
  if (infoCard && barbers.length > 0) {
    const barber = barbers.find(b => b.id == barberSel);
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

  // Asegurar que la info del barbero esté actualizada
  updateBarberInfo();

  if (!negocioId) { console.error('negocioId es undefined'); return; }
  if (!barberSel && barberSelEl?.options.length > 1) { // No mostrar si no hay barberos o no se ha seleccionado
    showToast('Por favor selecciona un barbero', 'error');
    if (slotsContainer) slotsContainer.innerHTML = '';
    return; 
  }
  if (!dateStr) {
    showToast('Por favor selecciona una fecha', 'error');
    if (slotsContainer) slotsContainer.innerHTML = '<div class="col-span-full text-center text-gray-500 py-4">Selecciona una fecha.</div>';
    return;
  }

  const dur = serviciosCache[servicioSel] || 30;
  const cacheKey = `${dateStr}_${barberSel}_${dur}`;

  appState.selectedTimeSlot = null;
  if (actionContainer) actionContainer.classList.add('hidden');

  if (!dateStr || !barberSel || !servicioSel) {
    if (slotsContainer) slotsContainer.innerHTML = '';
    if (rangoDisplay) rangoDisplay.textContent = '';
    return;
  }

  // Lógica de limpieza de caché
  if (Object.keys(slotsCache).length > 50) {
    slotsCache = {}; // Reiniciar caché si excede el límite
  }

  // Validación de caché con TTL (Evita datos sucios)
  if (slotsCache[cacheKey] && (Date.now() - slotsCache[cacheKey].timestamp < CACHE_TTL_MS)) {
    renderSlotsFromData(slotsCache[cacheKey].data, dateStr, serviciosCache[servicioSel] || 30);
    return;
  }

  // Mostrar contenedor de horarios
  const horariosLibres = document.getElementById('horarios-libres');
  if (horariosLibres) horariosLibres.classList.remove('hidden');

  if (slotsContainer) slotsContainer.innerHTML = '<div class="col-span-full text-center text-gray-500 py-8 animate-pulse">Buscando disponibilidad...</div>';

  const promises = [];

  const apStr = configCache?.hora_apertura || '08:00';
  const ciStr = configCache?.hora_cierre || '21:00';
  const ap = apStr.split(':').map(Number);
  const ci = ciStr.split(':').map(Number);

  if (rangoDisplay) {
    rangoDisplay.textContent = `Horario disponible: ${apStr} - ${ciStr}`;
    // rangoDisplay.className = 'mt-4 text-center text-sm font-medium text-black/60 dark:text-white/60 bg-[#F8F8F9] dark:bg-black/30 py-2 rounded-lg border border-black/5 dark:border-white/10';
  }

  // Corrección Timezone: Construir fecha localmente sin UTC shift
  const parts = dateStr.split('-');
  const baseDay = new Date(parts[0], parts[1] - 1, parts[2]); // Fecha base limpia
  const startDay = new Date(baseDay);

  const dayNum = startDay.getDay();

  if (diasOperacionNum.length && !diasOperacionNum.includes(dayNum)) {
    if (slotsContainer) {
      slotsContainer.innerHTML = '<div class="col-span-full flex flex-col items-center justify-center text-gray-500 py-8"><svg xmlns="http://www.w3.org/2000/svg" class="h-10 w-10 mb-2 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg><span>El negocio no opera este día.</span></div>';
    }
    return;
  }

  // Rangos para DB (ISO UTC)
  const startDayDB = new Date(startDay);
  const endDayDB = new Date(startDay); endDayDB.setHours(23, 59, 59, 999);
  const startDayISO = startDayDB.toISOString();
  const endDayISO = endDayDB.toISOString();

  startDay.setHours(ap[0], ap[1], 0, 0);
  const endDay = new Date(startDay); // Clonar para fin de jornada local
  if (ci[0] === 0 && ci[1] === 0) {
    endDay.setHours(24, 0, 0, 0);
  } else {
    endDay.setHours(ci[0], ci[1], 0, 0);
  }

  if (endDay <= startDay) endDay.setDate(endDay.getDate() + 1);

  const telefono = appState.profile?.telefono;
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
  // Obtener breaks desde estado_negocio para definir horario real del barbero
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
  
  // Construir breaks usando la fecha base local correcta
  if (brk && brk.start && brk.end) {
    const bs = new Date(baseDay); bs.setHours(0,0,0,0);
    const be = new Date(baseDay); be.setHours(0,0,0,0);
    const s = brk.start.split(':').map(Number); 
    const e = brk.end.split(':').map(Number);
    bs.setHours(s[0], s[1], 0, 0); be.setHours(e[0], e[1], 0, 0);
    breaks.push([bs.getTime(), be.getTime()]);
  }

  (turnosActivos || []).forEach(t => {
    // Convertir hora de turno a objeto Date seguro
    let s;
    if (t.started_at) {
      s = new Date(t.started_at);
    } else {
      if (t.hora) {
          const [h, m] = t.hora.split(':');
          s = new Date(startDay);
          s.setHours(h, m, 0, 0);
      } else {
          return; // Saltar si no hay hora
      }
    }
    const d = serviciosCache[t.servicio] || 30;
    const e = new Date(s);
    e.setMinutes(e.getMinutes() + d);
    breaks.push([s.getTime(), e.getTime()]);
  });

  // Comparación segura de "Hoy" usando localDateString
  const isToday = dateStr === new Date().toLocaleDateString('en-CA');
  const dataToCache = { startDay, endDay, citas, breaks, isToday };
  
  // Guardar en caché con timestamp
  slotsCache[cacheKey] = { data: dataToCache, timestamp: Date.now() };

  renderSlotsFromData(dataToCache, dateStr, dur);
}

function renderSlotsFromData(data, dateStr, dur) {
  const { startDay, endDay, citas, breaks, isToday } = data;
  const slotsContainer = document.getElementById('slots-container');
  if (!slotsContainer) return;

  slotsContainer.innerHTML = '';

  const step = 15; // Intervalo de 15 minutos para agenda inteligente
  const tmp = new Date(startDay);
  const now = new Date();
  
  // Buffer de seguridad configurable
  const bufferMinutes = configCache?.reserva_buffer_min || 10;
  const bufferTime = new Date(now.getTime() + bufferMinutes * 60000);

  while (tmp < endDay) {
    const currentSlot = new Date(tmp);

    // Filtro estricto de horas pasadas
    if (isToday && currentSlot < bufferTime) {
        tmp.setMinutes(tmp.getMinutes() + step);
        continue;
    }

    const slotEnd = new Date(currentSlot);
    slotEnd.setMinutes(slotEnd.getMinutes() + dur);
    if (slotEnd > endDay) break;

    const disponible = slotDisponible(currentSlot, dur, citas || [], breaks);

    const btn = document.createElement('button');
    const baseClass = 'slot-enter py-3 rounded-xl font-bold text-sm border transition-all duration-200 relative overflow-hidden flex flex-col items-center justify-center shadow-sm outline-none focus:ring-2 focus:ring-blue-500 active:scale-95';

    if (disponible) {
      btn.className = `${baseClass} bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 hover:border-blue-500 dark:hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400 cursor-pointer group`;
      btn.onclick = () => seleccionarHora(currentSlot, btn);
      // Highlight first available
      if (slotsContainer.children.length === 0) {
          // Optional: Add "Next" badge logic here if needed
      }
    } else {
      btn.className = `${baseClass} bg-gray-50 dark:bg-white/5 border-transparent text-gray-300 dark:text-gray-700 cursor-not-allowed`;
      btn.disabled = true;
    }

    const timeStr = currentSlot.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

    btn.innerHTML = `
            <span class="${disponible ? 'text-gray-900 dark:text-gray-200 group-hover:text-blue-600 dark:group-hover:text-blue-400' : ''}">${timeStr}</span>
        `;

    slotsContainer.appendChild(btn);
    tmp.setMinutes(tmp.getMinutes() + step);
  }

  if (slotsContainer.children.length === 0) {
    slotsContainer.innerHTML = '<div class="col-span-full text-center text-black/50 dark:text-white/50 py-4">No hay horarios disponibles.</div>';
  }
}

function seleccionarHora(date, btnElement) {
  appState.selectedTimeSlot = date;

  const container = document.getElementById('slots-container');
  if (container) {
    Array.from(container.children).forEach(c => {
      if (!c.disabled) {
        c.classList.remove('slot-selected');
        c.classList.remove('bg-blue-600', 'text-white', 'border-blue-600', 'shadow-lg', 'shadow-blue-600/30');
        c.classList.add('bg-white', 'dark:bg-white/5', 'text-gray-900', 'dark:text-gray-200');
      }
    });
  }

  btnElement.classList.remove('bg-white', 'dark:bg-white/5', 'text-gray-900', 'dark:text-gray-200');
  btnElement.classList.add('bg-blue-600', 'text-white', 'border-blue-600', 'shadow-lg', 'shadow-blue-600/30', 'slot-selected');

  // Update Summary
  const servicioSel = document.getElementById('select-servicio-cita').value;
  const precio = preciosCache[servicioSel] || 0;
  const duracion = serviciosCache[servicioSel] || 30;
  
  document.getElementById('summary-service').textContent = servicioSel;
  document.getElementById('summary-price').textContent = `RD$ ${Number(precio).toFixed(2)}`;
  // document.getElementById('summary-duration').textContent = `${duracion} min`;

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

  const date = appState.selectedTimeSlot;
  const barberSel = document.getElementById('select-barbero-cita').value;

  if (!date) return;

  if (!date) {
    showToast('Error: Debes seleccionar una hora.', 'error');
    return;
  }

  if (!barberSel) {
    showToast('Error: Debes seleccionar un barbero.', 'error');
    return;
  }

  const servicioSel = document.getElementById('select-servicio-cita').value || document.getElementById('select-servicio').value;
  const telefono = appState.profile?.telefono;

  if (!servicioSel) {
    showToast('Error: Debes seleccionar un servicio.', 'error');
    return;
  }
  const dur = serviciosCache[servicioSel] || 30;

  // Validación de doble reserva en el frontend
  if (appState.hasActiveAppointment || appState.hasActiveTurn) {
    showToast('Ya tienes una reserva activa para hoy.', 'error');
    return;
  }

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
          p_end: slotEnd.toISOString(),
          p_servicio: servicioSel
        });

        if (error) throw error;

        localStorage.setItem('cita_reservada', 'true');

        if (typeof confetti === 'function') {
          confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 }, colors: ['#C1121F', '#111113', '#ffffff'] });
        }

        // Limpiar caché para forzar recarga de datos frescos
        Object.keys(slotsCache).forEach(k => delete slotsCache[k]); 

        sendPushNotification('¡Cita Confirmada!', `Tu cita para las ${timeStr} ha sido agendada.`);

        window.location.reload();
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
  confirmarAccion('Cancelar Turno', '¿Estás seguro de que deseas cancelar tu turno actual?', async () => {    const telefono = appState.profile?.telefono;
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
  const card = document.querySelector('#card-cita-activa .bento-card'); // Selector más específico
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
        slotsCache = {}; // Limpiar caché de slots
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
  const telefono = appState.profile?.telefono;
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
  const telefono = appState.profile?.telefono;
  const nombre = appState.profile?.nombre;

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

if (typeof init === 'function') init();
if (typeof cargarBarberos === 'function') cargarBarberos();
if (typeof cargarConfigNegocio === 'function') cargarConfigNegocio();

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('a[href^="https://wa.me/"]').forEach(a => a.addEventListener('click', () => { if (navigator.vibrate) navigator.vibrate(20); }));
    setupThemeToggle();
    setupStaticEventHandlers();
});
