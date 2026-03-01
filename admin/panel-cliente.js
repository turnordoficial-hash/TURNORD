import { supabase, ensureSupabase } from '../database.js';
import { obtenerRecompensasDisponibles, RECOMPENSAS } from './promociones.js';

const negocioId = 'barberia005';

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
  const cacheKey = `cache_${negocioId}_${key}`;
  const payload = JSON.stringify({ data, expiry });

  try {
    localStorage.setItem(cacheKey, payload);
  } catch (e) {
    // Manejo de error si el LocalStorage está lleno (QuotaExceededError)
    if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
      console.warn('LocalStorage lleno. Limpiando caché antiguo de la aplicación...');
      // Limpiar solo las claves de esta app para hacer espacio
      Object.keys(localStorage).forEach(k => {
        if (k.startsWith(`cache_${negocioId}`)) localStorage.removeItem(k);
      });
      // Intentar guardar de nuevo
      try { localStorage.setItem(cacheKey, payload); } catch (e2) { console.error('Fallo crítico de caché', e2); }
    }
  }
}
// --------------------------------

function getSaludo() {
  const hora = new Date().getHours();
  if (hora < 12) return 'Buenos días';
  if (hora < 18) return 'Buenas tardes';
  return 'Buenas noches';
}

function calcularNivelInfo(puntos) {
  // Asumimos 50 puntos por servicio (Ticket promedio RD$500 * 0.1)
  const servicios = Math.floor((puntos || 0) / 50);
  
  const niveles = [
    { min: 0, max: 4, nombre: "Nuevo Cliente", icon: "💈", mensaje: "Bienvenido a la familia", color: "text-gray-500", bg: "bg-gray-500" },
    { min: 5, max: 9, nombre: "Cliente Activo", icon: "⭐", mensaje: "Gracias por confiar", color: "text-blue-500", bg: "bg-blue-500" },
    { min: 10, max: 19, nombre: "Cliente Frecuente", icon: "⭐⭐", mensaje: "Eres parte de la casa", color: "text-yellow-500", bg: "bg-yellow-500" },
    { min: 20, max: 39, nombre: "Cliente VIP", icon: "👑", mensaje: "Nivel preferencial", color: "text-purple-500", bg: "bg-purple-500" },
    { min: 40, max: 9999, nombre: "Leyenda", icon: "💎", mensaje: "Cliente histórico", color: "text-emerald-500", bg: "bg-emerald-500" }
  ];

  const nivelActual = niveles.find(n => servicios >= n.min && servicios <= n.max) || niveles[niveles.length - 1];
  const nextLevel = niveles[niveles.indexOf(nivelActual) + 1];
  
  const totalRange = nextLevel ? nextLevel.min - nivelActual.min : 1;
  const currentInLevel = servicios - nivelActual.min;
  const progress = nextLevel ? Math.min(100, (currentInLevel / totalRange) * 100) : 100;

  return { ...nivelActual, progress, servicios, nextLevel };
}

// --- MOTOR DE MARKETING INTELIGENTE ---
class SmartMarketingEngine {
  constructor(profile) {
    this.profile = profile;
    this.segment = this.calculateSegment();
    this.messageIndex = 0;
    this.rotationInterval = null;
  }

  calculateSegment() {
    if (!this.profile) return 'Nuevo';
    const visitas = this.profile.puntos ? Math.floor(this.profile.puntos / 10) : 0; // Estimado
    const lastVisit = this.profile.ultima_visita ? new Date(this.profile.ultima_visita) : null;
    const daysSince = lastVisit ? Math.floor((Date.now() - lastVisit.getTime()) / (1000 * 60 * 60 * 24)) : 999;

    if (visitas <= 1) return 'Nuevo';
    if (daysSince > 45) return 'Inactivo';
    if (daysSince > 21) return 'Regular';
    if (visitas > 20) return 'VIP';
    return 'Frecuente';
  }

  getMessages() {
    const points = this.profile?.puntos || 0;
    const nextRewardTier = RECOMPENSAS.find(r => points < r.pts);
    const nextRewardPts = nextRewardTier ? nextRewardTier.pts : (RECOMPENSAS.length > 0 ? RECOMPENSAS[RECOMPENSAS.length - 1].pts : 0);
    const pointsNeeded = Math.max(0, nextRewardPts - points);

    const commonMessages = [
      { title: "Tu estilo, tu regla.", subtitle: "Acumula puntos con cada corte y desbloquea recompensas.", badge: "💎 JBarber Club" },
      { title: "¿Sabías qué?", subtitle: "Cortar tu cabello cada 3 semanas mantiene tu estilo impecable.", badge: "💡 Tip Pro" }
    ];

    const segments = {
      'Nuevo': [
        { title: "¡Bienvenido al Club!", subtitle: "Tu primer corte acumula puntos dobles hoy.", badge: "🎉 Estreno" },
        { title: "Invita y Gana", subtitle: "Trae a un amigo y ambos reciben descuento.", badge: "👥 Referidos" }
      ],
      'Frecuente': [
        { title: "Mantén el Flow", subtitle: "Ya casi es hora de tu retoque habitual.", badge: "✂️ Estilo Fresh" },
        { title: `Estás cerca: ${points} pts`, subtitle: `Solo te faltan ${pointsNeeded} puntos para tu recompensa.`, badge: "🎯 Meta Cerca" }
      ],
      'Inactivo': [
        { title: "¡Te extrañamos!", subtitle: "Vuelve esta semana y recibe un trato especial.", badge: "🔥 Reactivación" },
        { title: "Tu silla te espera", subtitle: "No dejes que tu estilo se pierda. Reserva ahora.", badge: "💈 JBarber" }
      ],
      'VIP': [
        { title: "Nivel Leyenda", subtitle: "Gracias por ser parte de la élite de JBarber.", badge: "👑 VIP Member" },
        { title: "Prioridad Total", subtitle: "Agenda tu cita preferencial cuando quieras.", badge: "💎 Exclusivo" }
      ]
    };

    // Mezclar mensajes del segmento con comunes
    return [...(segments[this.segment] || segments['Nuevo']), ...commonMessages];
  }

  startRotation() {
    const messages = this.getMessages();
    if (messages.length === 0) return;

    const updateUI = () => {
      const msg = messages[this.messageIndex];
      const titleEl = document.getElementById('hero-title');
      const subEl = document.getElementById('hero-subtitle');
      const badgeEl = document.getElementById('hero-badge-text');
      
      if (titleEl && subEl && badgeEl) {
        // Fade out
        titleEl.style.opacity = '0';
        subEl.style.opacity = '0';
        
        setTimeout(() => {
          // Update content
          titleEl.innerHTML = msg.title.replace(/\n/g, '<br>');
          subEl.textContent = msg.subtitle;
          badgeEl.textContent = msg.badge;
          
          // Fade in
          titleEl.style.opacity = '1';
          subEl.style.opacity = '1';
        }, 300);
      }
      
      this.messageIndex = (this.messageIndex + 1) % messages.length;
    };

    updateUI(); // Initial run
    if (this.rotationInterval) clearInterval(this.rotationInterval);
    this.rotationInterval = setInterval(updateUI, 8000); // Rotar cada 8 segundos
  }
}

let marketingEngine = null;

async function iniciarMotorMarketing() {
  if (!appState.profile) return;
  marketingEngine = new SmartMarketingEngine(appState.profile);
  marketingEngine.startRotation();
}

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

function updateBanner(mode = 'default') {
  // Función eliminada por solicitud
  return;
}

// Notificaciones Push con OneSignal
const ONESIGNAL_APP_ID = '85f98db3-968a-4580-bb02-8821411a6bee';

/**
 * Solicita permiso para notificaciones push usando OneSignal
 */
async function solicitarPermisoNotificacion() {
  return new Promise((resolve) => {
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    OneSignalDeferred.push(async function(OneSignal) {
      try {
        if (!OneSignal.Notifications.permission) {
          await OneSignal.Notifications.requestPermission();
        }
        resolve(OneSignal.Notifications.permission);
      } catch (err) {
        console.warn('Error al solicitar permiso OneSignal:', err);
        resolve(false);
      }
    });
  });
}

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
  
  // OneSignal logout
  if (window.OneSignal) {
    window.OneSignal.logout();
  }

  await supabase.auth.signOut();
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
  
  const moonIcon = '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>';
  const sunIcon = '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>';

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

/**
 * Sistema de Caché Profesional con TTL
 */
function setSlotsCache(key, data) {
  slotsCache[key] = {
    data,
    timestamp: Date.now()
  };
  // Limpieza preventiva si el caché crece demasiado
  if (Object.keys(slotsCache).length > 100) {
    const oldestKey = Object.keys(slotsCache).sort((a, b) => slotsCache[a].timestamp - slotsCache[b].timestamp)[0];
    delete slotsCache[oldestKey];
  }
}

function getSlotsCache(key, ttl = CACHE_TTL_MS) {
  const cached = slotsCache[key];
  if (!cached) return null;
  if (Date.now() - cached.timestamp > ttl) {
    delete slotsCache[key];
    return null;
  }
  return cached.data;
}

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
  
  // 🔥 CRÍTICO: Cargar configuración antes que nada para tener diasOperacionNum
  await cargarConfigNegocio();
  // await cargarServicios(); // Ya se llama abajo, redundante

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
  iniciarMotorMarketing(); // Iniciar motor de marketing

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

  // Evento Compartir Referido
  document.getElementById('share-referral')?.addEventListener('click', () => {
    const text = `¡Ven a JBarber! Agenda tu turno aquí: ${window.location.origin}/login_cliente.html y menciona mi número ${appState.profile?.telefono || ''} para ganar puntos.`;
    if (navigator.share) {
      navigator.share({
        title: 'Referido JBarber',
        text: text,
        url: window.location.origin
      }).catch(() => {});
    } else {
      navigator.clipboard.writeText(text);
      showToast('Enlace de referido copiado al portapapeles', 'info');
    }
  });

  const formPerfil = document.getElementById('form-perfil');
  if (formPerfil) {
    formPerfil.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nombre = document.getElementById('edit-nombre').value;
      const email = document.getElementById('edit-email').value;
      const telefono = document.getElementById('edit-telefono').value;
      const { error } = await supabase.from('clientes').update({ nombre, email, telefono }).eq('id', clienteId);
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
      cargarPerfil(); // 🔥 Recargar perfil para actualizar puntos visualmente
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
  const statusContainer = document.getElementById('inicio-status-container');
  if (statusContainer) {
    statusContainer.innerHTML = `
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <!-- Card Estado (Ultra Design) -->
          <div onclick="switchTab('cita')" class="cursor-pointer relative overflow-hidden rounded-3xl bg-white dark:bg-gradient-to-br dark:from-[#111] dark:to-black border border-gray-200 dark:border-white/10 shadow-xl dark:shadow-2xl group hover:scale-[1.02] transition-transform">
              <div class="absolute top-0 right-0 w-32 h-32 bg-[#C1121F]/10 dark:bg-[#C1121F]/20 rounded-full blur-3xl -mr-16 -mt-16 transition-all group-hover:bg-[#C1121F]/20 dark:group-hover:bg-[#C1121F]/30"></div>
              <div class="absolute bottom-0 left-0 w-24 h-24 bg-yellow-500/10 rounded-full blur-2xl -ml-10 -mb-10"></div>
              
              <div class="relative z-10 p-6">
                  <div class="flex justify-between items-start mb-4">
                      <div class="p-3 rounded-2xl bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/10 text-gray-900 dark:text-white shadow-inner">
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                      </div>
                      <span class="px-3 py-1 rounded-full bg-[#C1121F]/10 dark:bg-[#C1121F]/20 border border-[#C1121F]/20 dark:border-[#C1121F]/30 text-[#C1121F] text-[10px] font-bold uppercase tracking-widest">
                          Tu Estado
                      </span>
                  </div>
                  
                  <div id="dash-card-1">
                      <span class="text-4xl md:text-5xl font-black text-gray-900 dark:text-white tracking-tight">Sin cita</span>
                      <p class="text-gray-500 dark:text-gray-400 text-sm mt-1 font-medium">Reserva tu espacio</p>
                  </div>
              </div>
          </div>

          <!-- Card Estimado (Ultra Design) -->
          <div class="relative overflow-hidden rounded-3xl bg-white dark:bg-[#111] border border-gray-200 dark:border-white/10 shadow-xl group">
              <div class="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-5"></div>
              <div class="absolute top-0 right-0 w-20 h-20 bg-yellow-500/20 rounded-full blur-2xl transition-all group-hover:scale-150"></div>
              
              <div class="relative z-10 p-6">
                  <div class="flex justify-between items-start mb-4">
                      <div class="p-3 rounded-2xl bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 text-black dark:text-white">
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      </div>
                      <span class="px-3 py-1 rounded-full bg-yellow-500/20 border border-yellow-500/30 text-yellow-600 dark:text-yellow-400 text-[10px] font-bold uppercase tracking-widest">
                          Tiempo
                      </span>
                  </div>
                  
                  <div id="dash-card-2">
                       <span class="text-4xl md:text-5xl font-black text-gray-900 dark:text-white tracking-tight">-- min</span>
                       <p class="text-gray-500 dark:text-gray-400 text-sm mt-1 font-medium">Tiempo estimado</p>
                       <div class="mt-3">
                          <div class="w-full h-2.5 rounded-full bg-gray-200 dark:bg-white/10 overflow-hidden">
                             <div id="turno-progress" class="h-full bg-[#C1121F] rounded-full" style="width:40%;"></div>
                          </div>
                          <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">Progreso de tu turno</p>
                       </div>
                  </div>
              </div>
          </div>
      </div>
        `;
  }

  const citaPanel = document.getElementById('tab-cita-panel');
  if (citaPanel) {
    citaPanel.innerHTML = `
            <div id="cita-promo-container" class="mb-6"></div>
            
            <!-- Card Cita Activa (Hidden by default) - Fixed Dark Mode -->
            <div id="card-cita-activa" class="hidden relative overflow-hidden rounded-3xl bg-white dark:bg-black border border-gray-200 dark:border-white/10 shadow-xl dark:shadow-2xl mb-8 group">
                <div class="absolute inset-0 bg-gradient-to-r from-[#C1121F]/20 to-transparent opacity-50"></div>
                <div class="absolute -right-10 -top-10 w-40 h-40 bg-yellow-500/10 rounded-full blur-3xl"></div>
                
                <div class="relative z-10 p-8">
                    <div class="flex justify-between items-start mb-6">
                        <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-gray-100 dark:bg-white/10 border border-gray-200 dark:border-white/20 backdrop-blur-md">
                            <span class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                            <span class="text-[10px] font-bold uppercase tracking-widest text-gray-900 dark:text-white">Confirmada</span>
                        </div>
                        <div class="text-right">
                            <p class="text-[10px] uppercase tracking-widest text-gray-500 dark:text-gray-400 font-bold">Barbero</p>
                            <p id="cita-barbero" class="text-lg font-bold text-gray-900 dark:text-white">--</p>
                        </div>
                    </div>

                    <div class="mb-8">
                        <h3 id="cita-fecha-hora" class="text-4xl md:text-5xl font-black text-gray-900 dark:text-white tracking-tight leading-none mb-1">--</h3>
                        <p id="cita-servicio" class="text-lg text-gray-600 dark:text-gray-300 font-medium">--</p>
                    </div>

                    <div class="flex items-center justify-between pt-6 border-t border-white/10">
                        <p class="text-xs text-gray-500 dark:text-gray-400 font-medium">Llega 5 min antes</p>
                        <button onclick="cancelarCita()" class="px-4 py-2 rounded-xl bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 border border-gray-200 dark:border-white/10 text-gray-900 dark:text-white text-xs font-bold transition-all flex items-center gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                            Cancelar
                        </button>
                    </div>
                </div>
            </div>
            
            <!-- Sección Agenda Inteligente -->
            <div id="seccion-cita-inteligente" class="relative overflow-hidden rounded-3xl bg-white dark:bg-[#111] shadow-xl border border-gray-100 dark:border-white/5">
                <!-- Header Premium -->
                <div class="relative bg-[#0B0B0B] p-8 overflow-hidden">
                    <div class="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-30"></div>
                    <div class="absolute top-0 right-0 w-64 h-64 bg-[#C1121F]/20 rounded-full blur-[60px] transform translate-x-1/2 -translate-y-1/2"></div>
                    
                    <div class="relative z-10">
                        <h3 class="text-3xl font-black text-white mb-2 tracking-tight">AGENDA <span class="text-[#C1121F]">PRO</span></h3>
                        <p class="text-gray-400 text-sm font-medium">Reserva tu espacio con estilo y precisión.</p>
                    </div>
                </div>

                <div id="form-cita-container" class="p-6 md:p-8 space-y-8">
                    <!-- Step 1 -->
                    <div class="space-y-3">
                        <label class="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-gray-400">
                            <span class="w-5 h-5 rounded-full bg-[#C1121F] text-white flex items-center justify-center text-[10px]">1</span>
                            Selecciona Servicio
                        </label>
                        <div class="relative group">
                            <select id="select-servicio-cita" class="w-full p-4 pl-5 rounded-2xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-gray-900 dark:text-white font-bold focus:ring-2 focus:ring-[#C1121F] outline-none transition-all appearance-none cursor-pointer hover:bg-gray-100 dark:hover:bg-white/10">
                                <option value="">Elegir servicio...</option>
                            </select>
                            <div class="absolute inset-y-0 right-0 flex items-center px-4 pointer-events-none text-gray-500">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                            </div>
                        </div>
                    </div>

                    <!-- Step 2 & 3 Grid -->
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                         <div class="space-y-3">
                            <label class="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-gray-400">
                                <span class="w-5 h-5 rounded-full bg-[#C1121F] text-white flex items-center justify-center text-[10px]">2</span>
                                Profesional
                            </label>
                            <div class="relative group">
                                <select id="select-barbero-cita" class="w-full p-4 pl-5 rounded-2xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-gray-900 dark:text-white font-bold focus:ring-2 focus:ring-[#C1121F] outline-none transition-all appearance-none cursor-pointer hover:bg-gray-100 dark:hover:bg-white/10">
                                    <option value="">Cargando...</option>
                                </select>
                                <div class="absolute inset-y-0 right-0 flex items-center px-4 pointer-events-none text-gray-500">
                                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                                </div>
                            </div>
                        </div>
                        <div class="space-y-3">
                            <label class="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-gray-400">
                                <span class="w-5 h-5 rounded-full bg-[#C1121F] text-white flex items-center justify-center text-[10px]">3</span>
                                Fecha
                            </label>
                            <input id="date-picker" type="date" class="w-full p-4 pl-5 rounded-2xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-gray-900 dark:text-white font-bold focus:ring-2 focus:ring-[#C1121F] outline-none transition-all cursor-pointer hover:bg-gray-100 dark:hover:bg-white/10">
                        </div>
                    </div>

                    <button id="btn-ver-horarios" class="w-full py-5 bg-[#C1121F] hover:bg-red-700 text-white font-black tracking-wide rounded-2xl shadow-lg shadow-red-600/30 hover:shadow-red-600/50 hover:scale-[1.02] transition-all flex justify-center items-center gap-3 group">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 group-hover:animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                        BUSCAR HORARIOS
                    </button>

                    <div id="horarios-libres" class="mt-4 hidden animate-fade-in">
                        <!-- Barber Info -->
                        <div id="barber-info-card" class="hidden mb-6 flex items-center gap-4 p-4 bg-gray-50 dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/5">
                            <img id="barber-avatar-display" src="" class="w-14 h-14 rounded-full object-cover border-2 border-[#C1121F] shadow-md">
                            <div>
                                <p id="barber-name-display" class="font-black text-lg leading-tight text-gray-900 dark:text-white"></p>
                                <p class="text-xs font-bold uppercase tracking-wider text-gray-500">Seleccionado</p>
                            </div>
                        </div>

                        <div id="slots-section" class="pt-6 border-t border-gray-100 dark:border-white/10">
                            <div class="flex items-center justify-between mb-5">
                                <label class="text-xs font-black uppercase tracking-widest text-gray-400">Disponibilidad</label>
                                <span id="rango-horario-display" class="text-[10px] font-bold text-white bg-black px-3 py-1 rounded-full"></span>
                            </div>
                            
                            <div id="slots-container" class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3"></div>

                            <div class="mt-8 p-5 bg-yellow-50 dark:bg-yellow-900/10 border-l-4 border-yellow-500 rounded-r-xl flex gap-4 items-start">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-yellow-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                                <p class="text-xs text-yellow-800 dark:text-yellow-200 font-medium leading-relaxed">
                                    <strong>Nota:</strong> Llega 10 minutos antes. Retrasos cancelan la cita automáticamente.
                                </p>
                            </div>

                            <div id="action-container" class="hidden pt-6 animate-fade-in">
                                 <div class="bg-black text-white p-6 rounded-2xl mb-4 shadow-xl relative overflow-hidden">
                                    <div class="absolute top-0 right-0 w-32 h-32 bg-[#C1121F]/30 rounded-full blur-3xl -mr-10 -mt-10"></div>
                                    <div class="relative z-10">
                                        <div class="flex justify-between items-center mb-2">
                                            <span class="text-xs font-bold uppercase tracking-widest text-gray-400">Servicio</span>
                                            <span id="summary-service" class="text-sm font-bold text-right">--</span>
                                        </div>
                                        <div class="flex justify-between items-center pt-4 border-t border-white/10 mt-2">
                                            <span class="text-xs font-bold uppercase tracking-widest text-gray-400">Total</span>
                                            <span id="summary-price" class="text-2xl font-black text-[#C1121F]">RD$ 0.00</span>
                                        </div>
                                    </div>
                                 </div>
                                <button id="btn-confirmar-reserva" class="w-full py-5 bg-black dark:bg-white text-white dark:text-black font-black tracking-wide rounded-2xl shadow-xl hover:scale-[1.02] transition-all flex justify-center items-center gap-2">
                                    CONFIRMAR RESERVA
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
  }

  const perfilPanel = document.getElementById('tab-perfil-panel');
  if (perfilPanel) {
    const puntosHist = appState.profile?.puntos_totales_historicos || 0;    
    const nivelInfo = calcularNivelInfo(puntosHist);
    const puntos = appState.profile?.puntos_actuales || 0;

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
                <div class="mt-3 flex items-center gap-2">
                    <span class="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-black/5 dark:bg-white/10 ${nivelInfo.color} text-xs font-bold border border-black/10 dark:border-white/10">
                      ${nivelInfo.icon} ${nivelInfo.nombre}
                    </span>
                    <span class="text-xs text-gray-400 font-medium">"${nivelInfo.mensaje}"</span>
                </div>
              </div>
            </div>

            <!-- Sección de Nivel y Progreso -->
            <div class="mt-8 p-6 bg-white dark:bg-[#141416] rounded-3xl border border-gray-100 dark:border-white/5 shadow-sm relative overflow-hidden">
                <div class="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-${nivelInfo.bg.split('-')[1]}-500/10 to-transparent rounded-full blur-2xl -mr-10 -mt-10"></div>
                
                <div class="flex justify-between items-end mb-2">
                    <div>
                        <p class="text-xs font-bold uppercase tracking-widest text-gray-400">Progreso de Nivel</p>
                        <p class="text-2xl font-black text-gray-900 dark:text-white mt-1">
                            <span id="profile-services-count">${nivelInfo.servicios}</span> <span class="text-sm font-medium text-gray-500">servicios</span>
                        </p>
                    </div>
                    <div class="text-right">
                        <p class="text-xs font-bold text-gray-400">Siguiente Nivel</p>
                        <p id="profile-next-level-name" class="text-sm font-bold ${nivelInfo.color}">${nivelInfo.nextLevel ? nivelInfo.nextLevel.nombre : 'Máximo'}</p>
                    </div>
                </div>
                
                <div class="w-full h-4 bg-gray-100 dark:bg-white/5 rounded-full overflow-hidden mb-2">
                    <div id="profile-progress-bar" class="h-full ${nivelInfo.bg} transition-all duration-1000 ease-out relative" style="width: ${nivelInfo.progress}%">
                        <div class="absolute inset-0 bg-white/20 animate-pulse"></div>
                    </div>
                </div>
                <p id="profile-missing-text" class="text-xs text-center text-gray-500 dark:text-gray-400 font-medium">
                    ${nivelInfo.nextLevel ? `Te faltan ${nivelInfo.nextLevel.min - nivelInfo.servicios} servicios para subir de nivel` : '¡Has alcanzado la cima!'}
                </p>
            </div>

            <!-- Recompensas -->
            <div class="mt-6">
                <h4 class="text-sm font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-[#C1121F]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" /></svg>
                    Premios Disponibles
                </h4>
                <div id="profile-rewards-grid" class="grid grid-cols-3 gap-3">
                    ${RECOMPENSAS.map(r => {
                        const unlocked = puntos >= r.pts;
                        return `
                        <div class="flex flex-col items-center justify-center p-3 rounded-2xl border ${unlocked ? 'bg-[#C1121F] border-[#C1121F] text-white shadow-lg shadow-red-900/20 animate-pulse' : 'bg-gray-50 dark:bg-white/5 border-gray-100 dark:border-white/5 text-gray-400 grayscale'} transition-all">
                            <span class="text-2xl mb-1">${r.icon}</span>
                            <span class="text-[10px] font-bold uppercase tracking-wider mb-1">${r.pts} pts</span>
                            <span class="text-xs font-bold text-center leading-tight">${r.label}</span>
                            ${unlocked ? '<div class="mt-1 text-[10px] bg-white/20 px-2 py-0.5 rounded-full">Desbloqueado</div>' : ''}
                        </div>
                        `;
                    }).join('')}
                </div>
            </div>

            <!-- Sistema de Referidos -->
            <div class="mt-8 p-6 bg-blue-50 dark:bg-blue-900/10 rounded-3xl border border-blue-100 dark:border-blue-800 relative overflow-hidden">
                <div class="absolute -right-6 -top-6 w-24 h-24 bg-blue-500/20 rounded-full blur-2xl"></div>
                <h4 class="text-sm font-bold text-blue-900 dark:text-blue-100 mb-2 flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                    Gana 50 Puntos por Amigo
                </h4>
                <p class="text-xs text-blue-700 dark:text-blue-300 mb-4 leading-relaxed">
                    Comparte tu enlace. Cuando tu amigo complete su primer servicio, ambos ganan.
                </p>
                <div class="flex gap-2">
                    <button onclick="copiarLinkReferido()" class="flex-1 bg-white dark:bg-blue-900/50 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 py-2.5 rounded-xl text-xs font-bold hover:bg-blue-50 transition-colors flex items-center justify-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                        Copiar Link
                    </button>
                    <button onclick="compartirReferido()" class="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-xl text-xs font-bold shadow-lg shadow-blue-600/20 transition-all flex items-center justify-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
                        Compartir
                    </button>
                </div>
            </div>

            <!-- Historial de Puntos -->
            <div class="mt-8">
                <h4 class="text-sm font-bold text-gray-900 dark:text-white mb-4">Historial de Puntos</h4>
                <div id="historial-puntos-list" class="space-y-3">
                    <div class="text-center py-4"><svg class="animate-spin h-5 w-5 mx-auto text-gray-400" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg></div>
                </div>
            </div>

            <form id="form-perfil" class="mt-10 space-y-6 text-gray-900 dark:text-white">
              <div><label class="text-sm font-semibold mb-2 block subtitle-text text-gray-600 dark:text-gray-400">Nombre Completo</label><input type="text" id="edit-nombre" class="w-full p-4 rounded-xl border bg-[#F8F8F9] dark:bg-[#111113] border-black/5 dark:border-white/10 text-[#111111] dark:text-white focus:border-black dark:focus:border-white focus:ring-1 focus:ring-black dark:focus:ring-white transition outline-none"></div>
              <div><label class="text-sm font-semibold mb-2 block subtitle-text text-gray-600 dark:text-gray-400">Teléfono</label><input type="tel" id="edit-telefono" class="w-full p-4 rounded-xl border bg-[#F8F8F9] dark:bg-[#111113] border-black/5 dark:border-white/10 text-[#111111] dark:text-white focus:border-black dark:focus:border-white focus:ring-1 focus:ring-black dark:focus:ring-white transition outline-none"></div>
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
    .then(() => {})
    .catch(err => console.warn('SW no registrado:', err.message || err));
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
    const editTelefono = document.getElementById('edit-telefono');
    if (editTelefono) editTelefono.value = data.telefono || '';
    const editNombre = document.getElementById('edit-nombre');
    if (editNombre) editNombre.value = data.nombre;
    const editEmail = document.getElementById('edit-email');
    if (editEmail) editEmail.value = data.email || '';

    // 🔥 Saludo Dinámico
    const saludoEl = document.getElementById('saludo-usuario');
    if (saludoEl) {
       saludoEl.textContent = `${getSaludo()}, ${data.nombre.split(' ')[0]}`;
    }

    const nivelInfo = calcularNivelInfo(data.puntos_totales_historicos || 0);
    const badge = document.getElementById('profile-level-badge');
    if (badge) badge.textContent = `${nivelInfo.icon} ${nivelInfo.nombre}`;

    const avatarUrl = data.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(data.nombre)}&background=C1121F&color=fff&bold=true`;
    const navAvatar = document.getElementById('nav-avatar');
    if (navAvatar) navAvatar.src = avatarUrl;
    const profileAvatar = document.getElementById('profile-avatar');
    if (profileAvatar) profileAvatar.src = avatarUrl;

    const recompensas = obtenerRecompensasDisponibles(data.puntos_actuales || 0);
    const badge2 = document.getElementById('profile-level-badge');
    if (badge2) badge2.innerHTML = `${nivelInfo.icon} ${nivelInfo.nombre}`;

    const servicesCount = document.getElementById('profile-services-count');
    if (servicesCount) animateNumber(servicesCount, nivelInfo.servicios);

    const nextLevelName = document.getElementById('profile-next-level-name');
    if (nextLevelName) {
        nextLevelName.textContent = nivelInfo.nextLevel ? nivelInfo.nextLevel.nombre : 'Máximo';
        nextLevelName.className = `text-sm font-bold ${nivelInfo.color}`;
    }

    const progressBar = document.getElementById('profile-progress-bar');
    if (progressBar) {
        progressBar.style.width = `${nivelInfo.progress}%`;
        progressBar.className = `h-full ${nivelInfo.bg} transition-all duration-1000 ease-out relative`;
        progressBar.innerHTML = '<div class="absolute inset-0 bg-white/20 animate-pulse"></div>';
    }

    const missingText = document.getElementById('profile-missing-text');
    if (missingText) {
        missingText.textContent = nivelInfo.nextLevel 
            ? `Te faltan ${nivelInfo.nextLevel.min - nivelInfo.servicios} servicios para subir de nivel` 
            : '¡Has alcanzado la cima!';
    }

    const rewardsGrid = document.getElementById('profile-rewards-grid');
    if (rewardsGrid) {
        rewardsGrid.innerHTML = recompensas.map(r => `
            <div class="flex flex-col items-center justify-center p-3 rounded-2xl border ${r.desbloqueado ? 'bg-[#C1121F] border-[#C1121F] text-white shadow-lg shadow-red-900/20 animate-pulse' : 'bg-gray-50 dark:bg-white/5 border-gray-100 dark:border-white/5 text-gray-400 grayscale'} transition-all relative overflow-hidden">
                ${!r.desbloqueado ? `<div class="absolute bottom-0 left-0 h-1 bg-red-500/20 w-full"><div class="h-full bg-red-500" style="width: ${r.progreso}%"></div></div>` : ''}
                <span class="text-2xl mb-1">${r.icon}</span>
                <span class="text-[10px] font-bold uppercase tracking-wider mb-1">${r.pts} pts</span>
                <span class="text-xs font-bold text-center leading-tight">${r.label}</span>
                ${r.desbloqueado ? '<div class="mt-1 text-[10px] bg-white/20 px-2 py-0.5 rounded-full">Canjeable</div>' : ''}
            </div>
        `).join('');
    }
}

window.copiarLinkReferido = () => {
    const link = `${window.location.origin}/login_cliente.html?ref=${clienteId}`;
    navigator.clipboard.writeText(link).then(() => {
        showToast('Enlace copiado al portapapeles', 'success');
    });
};

window.compartirReferido = async () => {
    const link = `${window.location.origin}/login_cliente.html?ref=${clienteId}`;
    const data = {
        title: 'Te invito a JBarber',
        text: 'Reserva tu turno sin filas y gana puntos. ¡Usa mi enlace!',
        url: link
    };

    if (navigator.share) {
        try { await navigator.share(data); } catch (err) {}
    } else {
        window.copiarLinkReferido();
    }
};

async function cargarHistorialPuntos() {
    const container = document.getElementById('historial-puntos-list');
    if (!container) return;

    const { data, error } = await supabase
        .from('movimientos_puntos')
        .select('*')
        .eq('cliente_id', clienteId)
        .order('created_at', { ascending: false })
        .limit(5);

    if (error || !data || data.length === 0) {
        container.innerHTML = '<p class="text-xs text-gray-500 text-center italic">No hay movimientos recientes.</p>';
        return;
    }

    container.innerHTML = data.map(item => `
        <div class="flex justify-between items-center p-3 bg-gray-50 dark:bg-white/5 rounded-xl border border-gray-100 dark:border-white/5">
            <div>
                <p class="text-xs font-bold text-gray-900 dark:text-white">${item.descripcion || 'Movimiento de puntos'}</p>
                <p class="text-[10px] text-gray-500">${new Date(item.created_at).toLocaleDateString()}</p>
            </div>
            <span class="text-sm font-bold ${item.tipo === 'GANADO' ? 'text-green-500' : 'text-red-500'}">
                ${item.tipo === 'GANADO' ? '+' : '-'}${item.puntos}
            </span>
        </div>
    `).join('');
}

async function cargarPerfil() {
  // 1. Renderizar desde caché inmediatamente
  const cached = getCache('PROFILE');
  if (cached) {
    appState.profile = cached;
    renderProfile(cached);
  }

  // 2. Obtener datos frescos
  const { data, error } = await supabase.from('clientes').select('*, puntos_actuales, puntos_totales_historicos, ultima_visita').eq('id', clienteId).single();
  
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
    // Detectar si se desbloqueó una recompensa
    const oldPoints = appState.profile?.puntos_actuales || 0;
    const newPoints = data.puntos_actuales || 0;
    if (newPoints > oldPoints) {
        const unlocked = RECOMPENSAS.some(r => oldPoints < r.pts && newPoints >= r.pts);
        if (unlocked && typeof confetti === 'function') {
            confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 }, colors: ['#C1121F', '#FFD700', '#ffffff'] });
            showToast('¡Felicidades! Has desbloqueado una recompensa 🎉', 'success');
        }
    }
    setCache('PROFILE', data, 60); // 1 hora de caché
    appState.profile = data;
    renderProfile(data);
    iniciarMotorMarketing(); // Reiniciar motor con datos frescos
    cargarHistorialPuntos(); // Cargar historial
  }
}

function renderServices(data) {
  // 1. Llenar caché incondicionalmente para cálculos
  data.forEach(s => {
      serviciosCache[s.nombre] = s.duracion_min;
      preciosCache[s.nombre] = s.precio;
  });

  const select = document.getElementById('select-servicio');
  if (select) {
    select.innerHTML = '<option value="">Selecciona un servicio...</option>';
    data.forEach(s => {
      const option = document.createElement('option');
      option.value = s.nombre;
      option.textContent = `${s.nombre} - RD$ ${s.precio}`;
      select.appendChild(option);
    });
  }
  const svcCita = document.getElementById('select-servicio-cita');
  if (svcCita) {
    svcCita.innerHTML = '<option value="">Elegir servicio...</option>';
    (data || []).forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.nombre;
      opt.textContent = `${s.nombre} - RD$ ${s.precio}`;
      svcCita.appendChild(opt);
    });
  }
}

async function cargarServicios() {
  const cached = getCache('SERVICES');
  if (cached) {
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
             <span class="text-4xl md:text-5xl font-black text-gray-900 dark:text-white tracking-tight block">Sin cita</span>
             <p class="text-gray-400 text-sm mt-1 font-medium">Reserva tu espacio</p>
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
        detalleAtencion = `<div class="mt-3 inline-block px-3 py-1 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400 text-xs font-bold animate-pulse">En curso: ${partes.join(' y ')}</div>`;
    }

    dashCard2.innerHTML = `
             <span class="text-4xl md:text-5xl font-black text-gray-900 dark:text-white tracking-tight block">${tiempoTexto}</span>
             <div class="mt-2">
                <p class="text-gray-500 dark:text-gray-400 text-sm font-medium">Atención aprox: <span class="text-gray-900 dark:text-white font-bold">${horaAprox}</span></p>
                ${detalleAtencion}
             </div>
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
                   <span class="text-4xl md:text-5xl font-black text-gray-900 dark:text-white tracking-tight block">${tiempoEstimado} min</span>
                   <div class="mt-2">
                      <p class="text-gray-500 dark:text-gray-400 text-sm font-medium">Atención aprox: <span class="text-gray-900 dark:text-white font-bold">${horaAprox}</span></p>
                      ${detalleAtencion}
                   </div>
                `;
      }

    if (personasDelante <= 1 && !appState.notificacionCercaEnviada) {
        sendPushNotification('💈 JBarber - ¡Ya casi!', `Solo queda ${personasDelante} persona delante. Acércate al local.`, '/panel_cliente.html#turno');
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
    .gt('end_at', nowISO)
    .order('start_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  const estadosNoActivos = ['Cancelada', 'Atendida', 'Cita Atendida', 'Completada', 'Finalizada'];

  const cardCita = document.getElementById('card-cita-activa');
  const seccionTurno = document.getElementById('seccion-tomar-turno');
  const inicioCitaContainer = document.getElementById('inicio-cita-card-container');
  const seccionCita = document.getElementById('seccion-cita-inteligente');

  if (cita && !estadosNoActivos.includes(cita.estado) && cardCita) {
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
                            <div class="bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/10 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider text-gray-900 dark:text-white">
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
                   <span class="text-4xl md:text-5xl font-black text-gray-900 dark:text-white tracking-tight block">CITA</span>
                   <p class="text-gray-400 text-sm mt-1 font-bold uppercase tracking-wide">PROGRAMADA</p>
                `;
    }
    const dashCard2 = document.getElementById('dash-card-2');
    if (dashCard2) {
      dashCard2.innerHTML = `
                   <span class="text-4xl md:text-5xl font-black text-gray-900 dark:text-white tracking-tight block">${timeStr}</span>
                   <p class="text-gray-500 dark:text-gray-400 text-sm mt-1 font-bold uppercase tracking-wide">Hora de atención</p>
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

async function sendPushNotification(title, body, url) {
  const telefono = appState.profile?.telefono || appState.user?.user_metadata?.telefono;
  if (!telefono || telefono === '...') {
    console.warn('No se puede enviar push: teléfono no disponible en el perfil');
    return;
  }
  
  console.log(`Intentando enviar notificación push a ${telefono}...`);
  try {
    const { data, error } = await supabase.functions.invoke('send-push-notification', {
      body: { telefono, negocio_id: negocioId, title, body, url }
    });
    if (error) throw error;
    console.log('✅ Notificación push enviada con éxito:', data);
  } catch (e) {
    console.error('❌ Error enviando push:', e.message || e);
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

  // SEGURIDAD: No confiar en el DOM para datos del usuario
  const nombre = appState.profile?.nombre || 'Cliente';
  const telefono = appState.profile?.telefono;

  if (!telefono) {
    showToast('No se pudo identificar tu número de teléfono. Reingresa a la aplicación.', 'error');
    return;
  }

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
    sendPushNotification('💈 JBarber - Turno confirmado', `Tu turno ${nuevoTurno} está confirmado. Te avisaremos cuando se acerque tu momento.`, '/panel_cliente.html#turno');

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
    await sendPushNotification(
      '💈 JBarber - Cita reservada',
      `Tu cita inteligente para hoy a las ${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ha sido confirmada.`,
      '/panel_cliente.html#cita'
    );

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

  // Buffer de seguridad (Limpieza/Preparación)
  const bufferMinutes = configCache?.reserva_buffer_min || 5;
  const bufferMs = bufferMinutes * 60 * 1000;

  const conflictCita = citas.some(c => {
    const cStart = new Date(c.start_at).getTime();
    const cEnd = new Date(c.end_at).getTime();
    
    // Lógica de Buffer Estricta:
    // 1. El nuevo turno no puede empezar antes de que termine la cita anterior + buffer
    // 2. El nuevo turno + buffer no puede terminar después de que empiece la siguiente cita
    return startMs < (cEnd + bufferMs) && (endMs + bufferMs) > cStart;
  });
  if (conflictCita) return false;

  const conflictBreak = breaks.some(b => {
    const [bStart, bEnd] = b;
    // Para breaks/turnos activos, aseguramos que nuestro servicio + buffer no choque con el inicio del break
    // y que no empecemos antes de que termine el break.
    return startMs < bEnd && (endMs + bufferMs) > bStart;
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

/**
 * CAPA 1: DATOS - Obtiene toda la información necesaria de Supabase para un día
 */
async function fetchDayData(negocioId, barberId, dateStr, telefono) {
  const parts = dateStr.split('-');
  const baseDay = new Date(parts[0], parts[1] - 1, parts[2]);
  
  const startDayDB = new Date(baseDay);
  const endDayDB = new Date(baseDay); 
  endDayDB.setHours(23, 59, 59, 999);
  
  const startDayISO = startDayDB.toISOString();
  const endDayISO = endDayDB.toISOString();

  const promises = [];
  
  // 1. Citas del barbero
  const pCitas = supabase
    .from('citas')
    .select('start_at, end_at')
    .eq('negocio_id', negocioId)
    .eq('barber_id', Number(barberId))
    .neq('estado', 'Cancelada')
    .gte('start_at', startDayISO)
    .lte('start_at', endDayISO);
  
  // 2. Mi cita del día (limitación de una por día)
  let pMisCitas = Promise.resolve({ data: [] });
  if (telefono && telefono !== '...') {
    pMisCitas = supabase
      .from('citas')
      .select('id')
      .eq('negocio_id', negocioId)
      .eq('cliente_telefono', telefono)
      .neq('estado', 'Cancelada')
      .gte('start_at', startDayISO)
      .lte('start_at', endDayISO);
  }

  // 3. Configuración de breaks/horarios
  const pEstado = supabase.from('estado_negocio').select('weekly_breaks').eq('negocio_id', negocioId).maybeSingle();

  // 4. Turnos activos del barbero (En atención)
  const pTurnos = supabase
    .from('turnos')
    .select('started_at, hora, servicio')
    .eq('negocio_id', negocioId)
    .eq('barber_id', Number(barberId))
    .eq('estado', 'En atención')
    .eq('fecha', dateStr);

  const [resCitas, resMisCitas, resEstado, resTurnos] = await Promise.all([pCitas, pMisCitas, pEstado, pTurnos]);

  return {
    citas: resCitas.data || [],
    misCitas: resMisCitas.data || [],
    estadoNegocio: resEstado.data,
    turnosActivos: resTurnos.data || [],
    baseDay
  };
}

/**
 * CAPA 2: LÓGICA - Genera los slots disponibles basados en las reglas de negocio
 */
function calculateAvailableSlots({ baseDay, apStr, ciStr, duracion, citas, turnosActivos, weeklyBreaks, isToday }) {
  const slots = [];
  const ap = apStr.split(':').map(Number);
  const ci = ciStr.split(':').map(Number);
  
  const startDay = new Date(baseDay);
  startDay.setHours(ap[0], ap[1], 0, 0);
  
  const endDay = new Date(baseDay);
  if (ci[0] === 0 && ci[1] === 0) endDay.setHours(24, 0, 0, 0);
  else endDay.setHours(ci[0], ci[1], 0, 0);

  if (endDay <= startDay) endDay.setDate(endDay.getDate() + 1);

  // Consolidar bloqueos (breaks + turnos activos)
  const blockages = [];
  
  // Breaks semanales
  const dayNum = baseDay.getDay();
  const brk = weeklyBreaks.find(x => x.day === dayNum);
  if (brk && brk.start && brk.end) {
    const bs = new Date(baseDay); const be = new Date(baseDay);
    const s = brk.start.split(':').map(Number); const e = brk.end.split(':').map(Number);
    bs.setHours(s[0], s[1], 0, 0); be.setHours(e[0], e[1], 0, 0);
    blockages.push([bs.getTime(), be.getTime()]);
  }

  // Turnos en atención
  const bufferMin = configCache?.reserva_buffer_min || 5;
  turnosActivos.forEach(t => {
    let s;
    if (t.started_at) s = new Date(t.started_at);
    else if (t.hora) {
      const [h, m] = t.hora.split(':');
      s = new Date(baseDay); s.setHours(h, m, 0, 0);
    } else return;
    
    const d = serviciosCache[t.servicio] || 30;
    const e = new Date(s);
    e.setMinutes(e.getMinutes() + d + bufferMin);
    blockages.push([s.getTime(), e.getTime()]);
  });

  const step = duracion + bufferMin;
  const now = new Date();
  const bufferTime = new Date(now.getTime() + (configCache?.reserva_buffer_min || 10) * 60000);

  const tmp = new Date(startDay);
  while (tmp < endDay) {
    const currentSlot = new Date(tmp);
    if (isToday && currentSlot < bufferTime) {
      tmp.setMinutes(tmp.getMinutes() + step);
      continue;
    }

    const slotEnd = new Date(currentSlot);
    slotEnd.setMinutes(slotEnd.getMinutes() + duracion);
    if (slotEnd > endDay) break;

    if (slotDisponible(currentSlot, duracion, citas, blockages)) {
      slots.push(new Date(currentSlot));
    }
    tmp.setMinutes(tmp.getMinutes() + step);
  }

  return slots;
}

/**
 * CAPA 3: RENDER - Dibuja los slots en el DOM
 */
function renderSlotsToUI(slots, dateStr) {
  const container = document.getElementById('slots-container');
  if (!container) return;

  container.innerHTML = '';
  if (slots.length === 0) {
    container.innerHTML = '<div class="col-span-full text-center text-gray-500 py-8">No hay horarios disponibles para este servicio hoy.</div>';
    return;
  }

  slots.forEach(slot => {
    const btn = document.createElement('button');
    btn.className = 'slot-enter py-3 rounded-xl font-bold text-sm border transition-all duration-200 relative overflow-hidden flex flex-col items-center justify-center shadow-sm outline-none focus:ring-2 focus:ring-[#C1121F] active:scale-95 bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 hover:border-[#C1121F] dark:hover:border-[#C1121F] hover:text-[#C1121F] dark:hover:text-[#C1121F] cursor-pointer group';
    
    const timeStr = slot.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    btn.innerHTML = `
      <span class="text-gray-900 dark:text-gray-200 group-hover:text-[#C1121F] dark:group-hover:text-[#C1121F] transition-colors">${timeStr}</span>
    `;
    
    btn.onclick = () => seleccionarHora(slot, btn);
    container.appendChild(btn);
  });

  // Scroll automático a la sección de horarios cargados
  const horariosSection = document.getElementById('horarios-libres');
  if (horariosSection) {
      setTimeout(() => {
          horariosSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
  }
}

/**
 * CAPA 4: ORQUESTADOR - Coordina el flujo de carga de slots
 */
async function cargarSlotsInteligente() {
  const dp = document.getElementById('date-picker');
  const barberSelEl = document.getElementById('select-barbero-cita');
  const servicioSelEl = document.getElementById('select-servicio-cita');
  const servicioAltEl = document.getElementById('select-servicio');
  
  const dateStr = dp?.value;
  const barberId = barberSelEl?.value;
  const servicioSel = servicioSelEl?.value || servicioAltEl?.value;
  const duracion = serviciosCache[servicioSel] || 30;

  if (!barberId || !dateStr || !servicioSel) return;

  const cacheKey = `${dateStr}_${barberId}_${duracion}`;
  const cachedData = getSlotsCache(cacheKey);

  if (cachedData) {
    renderSlotsToUI(cachedData, dateStr);
    return;
  }

  // UI Loading
  const container = document.getElementById('slots-container');
  if (container) container.innerHTML = '<div class="col-span-full text-center text-gray-500 py-8 animate-pulse">Buscando disponibilidad...</div>';
  document.getElementById('horarios-libres')?.classList.remove('hidden');

  try {
    const telefono = appState.profile?.telefono;
    const { citas, misCitas, estadoNegocio, turnosActivos, baseDay } = await fetchDayData(negocioId, barberId, dateStr, telefono);

    if (misCitas.length > 0) {
      if (container) container.innerHTML = '<div class="col-span-full p-6 bg-amber-50 dark:bg-amber-900/10 rounded-2xl border border-amber-100 dark:border-amber-800/30 text-center text-amber-800 dark:text-amber-400 font-bold">Ya tienes una cita hoy.</div>';
      return;
    }

    const slots = calculateAvailableSlots({
      baseDay,
      apStr: configCache?.hora_apertura || '08:00',
      ciStr: configCache?.hora_cierre || '21:00',
      duracion,
      citas,
      turnosActivos,
      weeklyBreaks: estadoNegocio?.weekly_breaks || [],
      isToday: dateStr === new Date().toLocaleDateString('en-CA')
    });

    setSlotsCache(cacheKey, slots);
    renderSlotsToUI(slots, dateStr);

  } catch (err) {
    console.error('Error cargando slots:', err);
    showToast('Error al buscar disponibilidad', 'error');
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

  // Asegurar que la info del barbero esté actualizada
  updateBarberInfo();

  if (!negocioId) { console.error('negocioId es undefined'); return; }
  
  if (!barberSel) {
    showToast('Por favor selecciona un barbero', 'error');
    if (slotsContainer) slotsContainer.innerHTML = '';
    return; 
  }
  if (!dateStr) {
    showToast('Por favor selecciona una fecha', 'error');
    if (slotsContainer) slotsContainer.innerHTML = '<div class="col-span-full text-center text-gray-500 py-4">Selecciona una fecha.</div>';
    return;
  }

  if (!servicioSel) {
    showToast('Por favor selecciona un servicio', 'error');
    return;
  }

  appState.selectedTimeSlot = null;
  const actionContainer = document.getElementById('action-container');
  if (actionContainer) actionContainer.classList.add('hidden');

  await cargarSlotsInteligente();
}

function seleccionarHora(date, btnElement) {
  appState.selectedTimeSlot = date;

  const container = document.getElementById('slots-container');
  if (container) {
    Array.from(container.children).forEach(c => {
      if (!c.disabled) {
        c.classList.remove('slot-selected');
        c.classList.remove('bg-[#C1121F]', 'text-white', 'border-[#C1121F]', 'shadow-lg', 'shadow-red-600/30');
        c.classList.add('bg-white', 'dark:bg-white/5', 'text-gray-900', 'dark:text-gray-200');
      }
    });
  }

  btnElement.classList.remove('bg-white', 'dark:bg-white/5', 'text-gray-900', 'dark:text-gray-200');
  btnElement.classList.add('bg-[#C1121F]', 'text-white', 'border-[#C1121F]', 'shadow-lg', 'shadow-red-600/30', 'slot-selected');

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

        Object.keys(slotsCache).forEach(k => delete slotsCache[k]); 

        sendPushNotification(
          '💈 JBarber - Cita confirmada',
          `Tu cita para las ${timeStr} ha sido agendada.`,
          '/panel_cliente.html#cita'
        );

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
    
    // 🎉 Animación de Confeti al calificar
    if (typeof confetti === 'function') {
        confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 }, colors: ['#C1121F', '#FFD700', '#ffffff'] });
    }

    try {
      await verificarCitaActiva();
      await cargarPerfil(); // Actualizar puntos visualmente
    } catch (e) {
      console.error('Error actualizando estado de cita después de calificación:', e);
    }
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
