import { supabase, ensureSupabase } from '../database.js';
import { obtenerRecompensasDisponibles, RECOMPENSAS } from './promociones.js';
import { OneSignalManager } from './onesignal.js';

// Manejo global de errores de promesas (específicamente para OneSignal/IndexedDB)
window.addEventListener('unhandledrejection', (e) => {
  if (e.reason && (
      e.reason.name === 'UnknownError' || 
      (e.reason.message && e.reason.message.includes('indexedDB'))
  )) {
      console.warn('Supressed OneSignal IndexedDB error to prevent crash.');
      e.preventDefault();
  }
});

/**
 * Obtiene el ID del negocio desde el atributo `data-negocio-id` en el body.
 */
function getNegocioId() {
  return document.body.dataset.negocioId || 'barberia005';
}

const negocioId = getNegocioId();
const CACHE_VERSION = 'v2'; // Control de versiones de caché

// Estado centralizado para la aplicación
const appState = {
  user: null,
  profile: null,
  barbers: [],
  hasActiveAppointment: false,
  selectedTimeSlot: null,
  suggestedTime: null,
  serviceDuration: 30,
  abortController: null, // Para cancelar peticiones de slots
  isBooking: false, // Protección anti-doble click
};

// Instancia única de Supabase para evitar mezclas
let sbInstance = null;
let realtimeChannel = null;
async function getSupabase() {
  if (!sbInstance) {
    await ensureSupabase();
    sbInstance = supabase;
  }
  return sbInstance;
}

// --- SISTEMA DE CACHÉ ROBUSTO (VERSIONADO) ---
const CACHE_TTL = {
  PROFILE: 60,    // 1 hora
  SERVICES: 1440, // 24 horas
  CONFIG: 60,     // 1 hora
  BARBERS: 60     // 1 hora
};

function getCache(key) {
  const item = localStorage.getItem(`cache_${negocioId}_${key}_${CACHE_VERSION}`);
  if (!item) return null;
  try {
    const { data, expiry } = JSON.parse(item);
    if (Date.now() > expiry) {
      localStorage.removeItem(`cache_${negocioId}_${key}_${CACHE_VERSION}`);
      return null;
    }
    return data;
  } catch (e) { return null; }
}

function setCache(key, data, ttlMinutes) {
  const expiry = Date.now() + (ttlMinutes * 60 * 1000);
  const cacheKey = `cache_${negocioId}_${key}_${CACHE_VERSION}`;
  const payload = JSON.stringify({ data, expiry });

  try {
    localStorage.setItem(cacheKey, payload);
  } catch (e) {
    if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
      console.warn('LocalStorage lleno. Limpiando caché antiguo...');
      Object.keys(localStorage).forEach(k => {
        if (k.startsWith('cache_')) localStorage.removeItem(k);
      });
      try { localStorage.setItem(cacheKey, payload); } catch (e2) {}
    }
  }
}
// --------------------------------

// --- MOTOR DE MARKETING INTELIGENTE (SINGLETON) ---
const SmartMarketingEngine = (function() {
  let instance = null;

  class Engine {
    constructor(profile) {
      this.profile = profile;
      this.segment = this.calculateSegment();
      this.messageIndex = 0;
      this.rotationInterval = null;
    }

    calculateSegment() {
      if (!this.profile) return 'Nuevo';
      const visitas = this.profile.puntos_actuales ? Math.floor(this.profile.puntos_actuales / 10) : 0;
      const lastVisit = this.profile.ultima_visita ? new Date(this.profile.ultima_visita) : null;
      const daysSince = lastVisit ? Math.floor((Date.now() - lastVisit.getTime()) / (1000 * 60 * 60 * 24)) : 999;

      if (visitas <= 1) return 'Nuevo';
      if (daysSince > 45) return 'Inactivo';
      if (daysSince > 21) return 'Regular';
      if (visitas > 20) return 'VIP';
      return 'Frecuente';
    }

    reset() {
      this.stopRotation();
      this.profile = null;
    }

    getMessages() {
      const points = this.profile?.puntos_actuales || 0;
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

      return [...(segments[this.segment] || segments['Nuevo']), ...commonMessages];
    }

    startRotation() {
      this.stopRotation();
      const messages = this.getMessages();
      if (messages.length === 0) return;

      const updateUI = () => {
        const msg = messages[this.messageIndex];
        const titleEl = document.getElementById('hero-title');
        const subEl = document.getElementById('hero-subtitle');
        const badgeEl = document.getElementById('hero-badge-text');
        
        if (titleEl && subEl && badgeEl) {
          titleEl.style.opacity = '0';
          subEl.style.opacity = '0';
          
          setTimeout(() => {
            // Sanitización contra XSS
            titleEl.textContent = msg.title;
            titleEl.innerHTML = titleEl.textContent.replace(/\n/g, '<br>');
            
            subEl.textContent = msg.subtitle;
            badgeEl.textContent = msg.badge;
            
            titleEl.style.opacity = '1';
            subEl.style.opacity = '1';
          }, 300);
        }
        
        this.messageIndex = (this.messageIndex + 1) % messages.length;
      };

      updateUI();
      this.rotationInterval = setInterval(updateUI, 8000);
    }

    stopRotation() {
      if (this.rotationInterval) {
        clearInterval(this.rotationInterval);
        this.rotationInterval = null;
      }
    }
  }

  return {
    getInstance: (profile) => {
      if (!instance && profile) {
        instance = new Engine(profile);
      } else if (instance && profile) {
        instance.profile = profile;
      }
      return instance;
    }
  };
})();

async function iniciarMotorMarketing() {
  if (!appState.profile) return;
  const engine = SmartMarketingEngine.getInstance(appState.profile);
  if (engine) engine.startRotation();
}

// Sanitización Universal
function sanitizeHTML(str) {
  const temp = document.createElement('div');
  temp.textContent = str;
  return temp.innerHTML;
}

async function enviarCorreoConfirmacion(startISO, servicio, barberId) {
  try {
    const sb = await getSupabase();
    const { data: cliente } = await sb
      .from('clientes')
      .select('email, nombre')
      .eq('id', appState.user.id)
      .maybeSingle();
      
    if (!cliente?.email) return;

    // Validación básica anti-spam (Rate limit frontend)
    const lastSent = localStorage.getItem(`last_email_sent_${negocioId}`);
    if (lastSent && Date.now() - parseInt(lastSent) < 30000) return; // 30s min

    const hora = startISO ? new Date(startISO).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const html = `
      <div style="font-family: sans-serif; color: #111; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px; overflow: hidden;">
        <div style="background-color: #C1121F; padding: 20px; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 24px;">✅ Cita Confirmada</h1>
        </div>
        <div style="padding: 20px;">
          <p style="font-size: 16px;">Hola <strong>${sanitizeHTML(cliente.nombre || 'Cliente')}</strong>,</p>
          <p style="font-size: 16px;">Tu cita ha sido confirmada${hora ? ` para las <strong>${hora}</strong>` : ''}.</p>
          <p style="font-size: 16px;">Servicio: <strong>${sanitizeHTML(servicio || 'Cita')}</strong></p>
          <p style="font-size: 14px; color: #555;">Gracias por elegir JBarber.</p>
        </div>
      </div>`;
    
    await sb.rpc('enviar_correo_rpc', {
        p_to: cliente.email,
        p_subject: '✅ Cita confirmada',
        p_body: html
    });
    localStorage.setItem(`last_email_sent_${negocioId}`, Date.now().toString());

  } catch (e) {
    console.warn('No se pudo enviar correo de confirmación:', e.message || e);
  }
}

function getSaludo() {
  const hora = new Date().getHours();
  if (hora < 12) return 'Buenos días';
  if (hora < 18) return 'Buenas tardes';
  return 'Buenas noches';
}

function calcularNivelInfo(puntos) {
  const pts = puntos || 0;

  const niveles = [
    { minPts: 0,     nombre: "Nuevo Cliente",     icon: "💈", mensaje: "Bienvenido a la familia",   color: "text-gray-500",   bg: "bg-gray-500" },
    { minPts: 100,   nombre: "Cliente Activo",    icon: "⭐",  mensaje: "Gracias por confiar",      color: "text-blue-500",   bg: "bg-blue-500" },
    { minPts: 250,   nombre: "Cliente Frecuente", icon: "⭐⭐", mensaje: "Eres parte de la casa",     color: "text-yellow-500", bg: "bg-yellow-500" },
    { minPts: 500,   nombre: "Cliente VIP",       icon: "👑", mensaje: "Nivel preferencial",        color: "text-purple-500", bg: "bg-purple-500" },
    { minPts: 900,   nombre: "Leyenda",           icon: "💎", mensaje: "Cliente histórico",         color: "text-emerald-500",bg: "bg-emerald-500" }
  ];

  let nivelActual = niveles[0];
  for (let i = niveles.length - 1; i >= 0; i--) {
    if (pts >= niveles[i].minPts) { nivelActual = niveles[i]; break; }
  }
  const idx = niveles.indexOf(nivelActual);
  const nextLevel = idx >= 0 && idx < niveles.length - 1 ? niveles[idx + 1] : null;

  const levelMin = nivelActual.minPts;
  const levelMax = nextLevel ? nextLevel.minPts : levelMin + 1;
  const range = Math.max(1, levelMax - levelMin);
  const progress = nextLevel ? Math.min(100, ((pts - levelMin) / range) * 100) : 100;
  const faltanPts = nextLevel ? Math.max(0, nextLevel.minPts - pts) : 0;

  return { ...nivelActual, progress, puntos: pts, nextLevel, faltanPts };
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
  const banner = document.getElementById('banner-marketing');
  if (!banner) return;
  
  if (mode === 'default') {
    banner.classList.add('hidden');
  } else {
    banner.classList.remove('hidden');
  }
}

// Notificaciones Push con OneSignal
const ONESIGNAL_APP_ID = '85f98db3-968a-4580-bb02-8821411a6bee';

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
  toast.className = `toast ${type}`;
  
  // Icono según tipo
  const icon = document.createElement('div');
  icon.innerHTML = type === 'success' 
    ? '<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>'
    : '<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>';
  
  const text = document.createElement('span');
  text.className = 'font-medium text-gray-800 dark:text-white';
  text.textContent = message;

  toast.appendChild(icon.firstChild);
  toast.appendChild(text);
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

window.toggleFab = () => {
  const menu = document.getElementById('fab-menu');
  const btn = document.getElementById('fab-main');
  menu?.classList.toggle('active');
  btn?.classList.toggle('active');
};

window.logout = async () => {
  const engine = SmartMarketingEngine.getInstance();
  if (engine) engine.reset();
  await cleanupRealtime();
  Object.keys(localStorage).filter(k => k.includes(`_${negocioId}_`)).forEach(k => localStorage.removeItem(k));
  if (window.OneSignal) await OneSignalManager.logout();
  const sb = await getSupabase();
  await sb.auth.signOut();
  window.location.href = 'login_cliente.html';
};

async function cleanupRealtime() {
  if (realtimeChannel) {
    const sb = await getSupabase();
    await sb.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
}

async function setupRealtime() {
  const sb = await getSupabase();
  await cleanupRealtime();

  const telefono = appState.profile?.telefono;
  if (!telefono) return;
  const safeTel = encodeURIComponent(telefono);

  const safeRefresh = () => {
    verificarCitaActiva();
    checkPendingRatings();
    cargarPerfil();
  };

  realtimeChannel = sb.channel(`cliente-updates-${negocioId}-${appState.user.id}`)
    .on('postgres_changes', { 
      event: '*', 
      schema: 'public', 
      table: 'citas', 
      filter: `cliente_telefono=eq.${safeTel}` 
    }, safeRefresh)
    .subscribe();
}

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
      if (iconContainerMenu) iconContainerMenu.innerHTML = isDark ? sunIcon : moonIcon;
      if (textSpanMenu) textSpanMenu.textContent = isDark ? 'Modo Claro' : 'Modo Oscuro';
      if (btnFloating) {
          btnFloating.innerHTML = isDark ? sunIcon : moonIcon;
          btnFloating.classList.remove('hidden');
      }
  };

  const saved = localStorage.getItem('theme');
  const isDark = saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches);
  
  if (isDark) root.classList.add('dark');
  else root.classList.remove('dark');
  updateUI(isDark);

  const toggleTheme = () => {
    const currentIsDark = root.classList.toggle('dark');
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
      document.getElementById('profile-menu')?.classList.add('hidden');
    });
  }

  const menuLogout = document.getElementById('menu-logout');
  if (menuLogout) {
    menuLogout.addEventListener('click', (e) => {
      e.preventDefault();
      window.logout();
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
      window.toggleFab();
    });
  }

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

window.switchTab = (tab) => {
  const panels = ['inicio', 'cita', 'perfil'];
  panels.forEach(p => {
    const el = document.getElementById(`tab-${p}-panel`);
    if (!el) return;
    if (p === tab) {
      el.classList.remove('hidden');
      requestAnimationFrame(() => el.classList.add('active'));
    } else {
      el.classList.remove('active', 'hidden');
      el.classList.add('hidden');
    }
  });

  document.querySelectorAll('[data-tab]').forEach(el => {
    el.classList.toggle('active', el.dataset.tab === tab);
    el.classList.toggle('text-white', el.dataset.tab === tab);
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

async function init() {
    const sb = await getSupabase();
    const { data: { user }, error: sessionError } = await sb.auth.getUser();
    if (sessionError || !user) {
        window.location.href = 'login_cliente.html';
        return;
    }
    appState.user = user;

    renderStructure();
    setupStaticEventHandlers();
    setupThemeToggle();
    
    await Promise.allSettled([
        cargarConfigNegocio(),
        cargarPerfil(),
        cargarServicios(),
        cargarBarberos()
    ]);
    
    if (appState.profile?.telefono) {
        await setupRealtime();
        window.OneSignalDeferred = window.OneSignalDeferred || [];
        window.OneSignalDeferred.push(async () => {
            await OneSignalManager.init();
            await OneSignalManager.login(appState.profile.telefono, {
                negocio_id: negocioId,
                role: 'cliente'
            });
        });
    }

    const dp = document.getElementById('date-picker');
    if (dp) {
        const today = new Date().toLocaleDateString('en-CA');
        dp.value = today;
        dp.min = today;
    }

    await verificarCitaActiva();
    iniciarMotorMarketing();

    switchTab('inicio');

    document.getElementById('btn-ver-horarios')?.addEventListener('click', cargarSlotsInteligente);
    document.getElementById('btn-confirmar-reserva')?.addEventListener('click', confirmarReservaManual);

    document.getElementById('share-referral')?.addEventListener('click', compartirReferido);

    const formPerfil = document.getElementById('form-perfil');
    if (formPerfil) {
        const telInput = document.getElementById('edit-telefono');
        telInput?.addEventListener('input', function() {
            this.value = this.value.replace(/[^0-9]/g, '').slice(0, 10);
        });

        formPerfil.addEventListener('submit', async (e) => {
            e.preventDefault();
            const nombre = document.getElementById('edit-nombre').value.trim();
            const email = document.getElementById('edit-email').value.trim();
            const telefono = document.getElementById('edit-telefono').value.trim();

            if (telefono.length !== 10) return showToast('El teléfono debe tener 10 dígitos.', 'error');
            if (nombre.length < 3) return showToast('El nombre es muy corto.', 'error');

            const client = await getSupabase();
            const { error } = await client.from('clientes').update({ nombre, email, telefono }).eq('id', appState.user.id);
            if (error) showToast('Error al actualizar el perfil', 'error');
            else {
                showToast('Perfil actualizado con éxito', 'success');
                cargarPerfil();
            }
        });
    }

    registrarServiceWorker();

    checkPendingRatings();
    setupPosterTilt();
}

function renderStructure() {
  const statusContainer = document.getElementById('inicio-status-container');
  if (statusContainer) {
    statusContainer.innerHTML = `
      <div class="grid grid-cols-1 gap-4">
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
                            <span id="profile-points-total">${puntosHist}</span> <span class="text-sm font-medium text-gray-500">pts</span>
                        </p>
                    </div>
                    <div class="text-right">
                        <p class="text-xs font-bold text-gray-400">Siguiente Nivel</p>
                        <p id="profile-next-level-name" class="text-sm font-bold ${nivelInfo.color}">${nivelInfo.nextLevel ? nivelInfo.nextLevel.nombre : 'Máximo'}</p>
                    </div>
                </div>
                
                <div class="w-full h-4 bg-gray-100 dark:bg-white/5 rounded-full overflow-hidden mb-2">
                    <div id="profile-progress-bar" class="h-full bg-[#C1121F] transition-all duration-1000 ease-out relative" style="width: ${nivelInfo.progress}%">
                        <div class="absolute inset-0 bg-white/20 animate-pulse"></div>
                    </div>
                </div>
                <p id="profile-missing-text" class="text-xs text-center text-gray-500 dark:text-gray-400 font-medium">
                    ${nivelInfo.nextLevel ? `Te faltan ${nivelInfo.faltanPts} puntos para subir de nivel` : '¡Has alcanzado la cima!'}
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

            <div class="mt-6 p-6 bg-white dark:bg-[#141416] rounded-3xl border border-gray-100 dark:border-white/5 shadow-sm">
                <p class="text-xs font-bold uppercase tracking-widest text-gray-400">Progreso hacia próxima recompensa</p>
                <div class="w-full h-4 bg-gray-100 dark:bg-white/5 rounded-full overflow-hidden mb-2 mt-2">
                    <div id="reward-progress-bar" class="h-full bg-[#C1121F] transition-all duration-1000 ease-out"></div>
                </div>
                <p id="reward-progress-text" class="text-xs text-center text-gray-500 dark:text-gray-400 font-medium"></p>
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

    const saludoEl = document.getElementById('saludo-usuario');
    if (saludoEl) saludoEl.textContent = `${getSaludo()}, ${data.nombre.split(' ')[0]}`;
 
    const avatarUrl = (data.avatar_url && data.avatar_url.includes('supabase.co'))
        ? `${data.avatar_url}?width=256&height=256&resize=cover&quality=80`
        : (data.avatar_url && !data.avatar_url.startsWith('blob:'))
            ? data.avatar_url
        : `https://ui-avatars.com/api/?name=${encodeURIComponent(data.nombre)}&background=C1121F&color=fff&bold=true`;

    const navAvatar = document.getElementById('nav-avatar');
    if (navAvatar) navAvatar.src = avatarUrl;
    const profileAvatar = document.getElementById('profile-avatar');
    if (profileAvatar) profileAvatar.src = avatarUrl;

    const nivelInfo = calcularNivelInfo(data.puntos_totales_historicos || 0);
    const badge = document.getElementById('profile-level-badge');
    if (badge) badge.textContent = `${nivelInfo.icon} ${nivelInfo.nombre}`;
    const recompensas = obtenerRecompensasDisponibles(data.puntos_actuales || 0);

    const ptsTotal = document.getElementById('profile-points-total');
    if (ptsTotal) animateNumber(ptsTotal, nivelInfo.puntos);

    const nextLevelName = document.getElementById('profile-next-level-name');
    if (nextLevelName) {
        nextLevelName.textContent = nivelInfo.nextLevel ? nivelInfo.nextLevel.nombre : 'Máximo';
        nextLevelName.className = `text-sm font-bold ${nivelInfo.color}`;
    }

    const progressBar = document.getElementById('profile-progress-bar');
    if (progressBar) {
        progressBar.style.width = `${nivelInfo.progress}%`;
        progressBar.className = `h-full bg-[#C1121F] transition-all duration-1000 ease-out relative`;
        progressBar.innerHTML = '<div class="absolute inset-0 bg-white/20 animate-pulse"></div>';
    }

    const missingText = document.getElementById('profile-missing-text');
    if (missingText) {
        missingText.textContent = nivelInfo.nextLevel 
            ? `Te faltan ${nivelInfo.faltanPts} puntos para subir de nivel` 
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

    const puntosAct = data.puntos_actuales || 0;
    const siguiente = RECOMPENSAS.find(r => puntosAct < r.pts) || null;
    const rewardBar = document.getElementById('reward-progress-bar');
    const rewardText = document.getElementById('reward-progress-text');
    if (rewardBar && rewardText) {
        if (siguiente) {
            const prog = Math.min(100, Math.floor((puntosAct / siguiente.pts) * 100));
            rewardBar.style.width = `${prog}%`;
            rewardText.textContent = `Te faltan ${siguiente.pts - puntosAct} puntos para ${siguiente.label}`;
        } else {
            rewardBar.style.width = '100%';
            rewardText.textContent = 'Tienes recompensas canjeables';
        }
    }
}

window.copiarLinkReferido = () => {
    const link = `${window.location.origin}/login_cliente.html?ref=${appState.user.id}`;
    
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(link).then(() => {
            showToast('Enlace copiado al portapapeles', 'success');
        }).catch(() => fallbackCopyTextToClipboard(link));
    } else {
        fallbackCopyTextToClipboard(link);
    }
};

function fallbackCopyTextToClipboard(text) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-9999px";
    textArea.style.top = "0";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
        document.execCommand('copy');
        showToast('Enlace copiado al portapapeles', 'success');
    } catch (err) {
        console.error('Error al copiar:', err);
    }
    document.body.removeChild(textArea);
}

window.compartirReferido = async () => {
    const link = `${window.location.origin}/login_cliente.html?ref=${appState.user.id}`;
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
    const sb = await getSupabase();
    const container = document.getElementById('historial-puntos-list');
    if (!container) return;

    const { data, error } = await sb
        .from('movimientos_puntos')
        .select('*')
        .eq('cliente_id', appState.user.id)
        .order('created_at', { ascending: false })
        .limit(5);

    if (error || !data || data.length === 0) {
        container.innerHTML = '<p class="text-xs text-gray-500 text-center italic">No hay movimientos recientes.</p>';
        return;
    }

    container.innerHTML = data.map(item => `
        <div class="flex justify-between items-center p-3 bg-gray-50 dark:bg-white/5 rounded-xl border border-gray-100 dark:border-white/5">
            <div>
                <p class="text-xs font-bold text-gray-900 dark:text-white">${sanitizeHTML(item.descripcion || 'Movimiento de puntos')}</p>
                <p class="text-[10px] text-gray-500">${new Date(item.created_at).toLocaleDateString()}</p>
            </div>
            <span class="text-sm font-bold ${item.tipo === 'GANADO' ? 'text-green-500' : 'text-red-500'}">
                ${item.tipo === 'GANADO' ? '+' : '-'}${item.puntos}
            </span>
        </div>
    `).join('');
}

async function cargarPerfil() {
  const sb = await getSupabase();
  const cached = getCache('PROFILE');
  if (cached) {
    appState.profile = cached;
    renderProfile(cached);
  }

  try {
    // FIX: Usar maybeSingle() para evitar error 406/PGRST116 si el perfil no existe
    const { data, error } = await sb.from('clientes')
      .select('*, puntos_actuales, puntos_totales_historicos, ultima_visita')
      .eq('id', appState.user.id)
      .maybeSingle();
    
    if (error) {
      console.error('Error cargando perfil:', error);
      return;
    }

    if (data) {
      processProfileData(data);
    } else {
      console.warn('Perfil no encontrado. Es posible que se esté creando...');
      // Si no existe, esperamos 2 segundos y reintentamos una vez
      setTimeout(async () => {
        const { data: retryData } = await sb.from('clientes')
          .select('*, puntos_actuales, puntos_totales_historicos, ultima_visita')
          .eq('id', appState.user.id)
          .maybeSingle();
        if (retryData) {
          processProfileData(retryData);
        }
      }, 2000);
    }
  } catch (err) {
    console.error('Excepción en cargarPerfil:', err);
  }
}

function processProfileData(data) {
    const oldPoints = appState.profile?.puntos_actuales || 0;
    const newPoints = data.puntos_actuales || 0;
    const oldLevel = calcularNivelInfo(appState.profile?.puntos_totales_historicos || 0);
    const newLevel = calcularNivelInfo(data.puntos_totales_historicos || 0);

    if (newPoints > oldPoints) {
        const unlocked = RECOMPENSAS.some(r => oldPoints < r.pts && newPoints >= r.pts);
        const levelUp = newLevel.nombre !== oldLevel.nombre;
        if ((unlocked || levelUp) && typeof confetti === 'function') {
            confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 }, colors: ['#C1121F', '#FFD700', '#ffffff'] });
            if (levelUp) showToast(`¡Felicidades! Has subido al nivel ${newLevel.icon} ${newLevel.nombre}`, 'success');
        }
    }

    setCache('PROFILE', data, 15);
    appState.profile = data;
    renderProfile(data);
    if (data.telefono) OneSignalManager.login(data.telefono, { negocio_id: negocioId, role: 'cliente' });
    iniciarMotorMarketing();
    cargarHistorialPuntos();
    setupRealtime();
}

function renderServices(data) {
  const select = document.getElementById('select-servicio-cita');
  if (select) {
    select.innerHTML = '<option value="">Elegir servicio...</option>';
    (data || []).forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.nombre;
      opt.textContent = `${s.nombre} - RD$ ${s.precio}`;
      select.appendChild(opt);
    });
  }
}

async function cargarServicios() {
  const sb = await getSupabase();
  const cached = getCache('SERVICES');
  if (cached) renderServices(cached);

  const { data } = await sb.from('servicios').select('*').eq('negocio_id', negocioId).eq('activo', true);
  if (data) {
    setCache('SERVICES', data, 1440);
    renderServices(data);
  }
}

function processConfig(data) {
  configCache = data || null;
}

async function cargarConfigNegocio() {
  const sb = await getSupabase();
  const cached = getCache('CONFIG');
  if (cached) processConfig(cached);

  const { data, error } = await sb.from('configuracion_negocio').select('*').eq('negocio_id', negocioId).order('updated_at', { ascending: false }).limit(1).maybeSingle();
  if (data) {
    setCache('CONFIG', data, 60);
    processConfig(data);
  }
}

async function verificarCitaActiva() {
  const sb = await getSupabase();
  const telefono = appState.profile?.telefono || appState.user?.phone;
  const nombreCliente = appState.profile?.nombre || appState.user?.user_metadata?.nombre || 'Cliente';
  if (!telefono) return;

  const nowISO = new Date().toISOString();
  const { data: cita } = await sb.from('citas').select('*, barberos(nombre)').eq('negocio_id', negocioId).eq('cliente_telefono', telefono).gt('end_at', nowISO).order('start_at', { ascending: true }).limit(1).maybeSingle();

  const estadosNoActivos = ['Cancelada', 'Atendida', 'Cita Atendida', 'Completada', 'Finalizada'];
  const cardCita = document.getElementById('card-cita-activa');
  const inicioCitaContainer = document.getElementById('inicio-cita-card-container');
  const seccionCita = document.getElementById('seccion-cita-inteligente');

  if (cita && !estadosNoActivos.includes(cita.estado) && cardCita) {
    appState.hasActiveAppointment = true;
    cardCita.classList.remove('hidden');
    const date = new Date(cita.start_at);
    const today = new Date();
    const isToday = date.toDateString() === today.toDateString();
    const dateStr = isToday ? 'Hoy' : date.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric' });
    const timeStr = date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    
    let barberName = cita.barberos?.nombre || 'Barbero asignado';
    const cardHTML = `
                <div class="bento-card p-6 relative overflow-hidden mb-6 animate-fade-in bg-white dark:bg-[#111113] border border-gray-100 dark:border-white/5 shadow-sm rounded-2xl" style="border-left: 4px solid #000;">
                    <div class="absolute top-0 right-0 p-4 opacity-5 text-black dark:text-white pointer-events-none">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-32 w-32 transform rotate-12" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    </div>
                    <div class="relative z-10">
                        <div class="flex justify-between items-start mb-4">
                            <div class="bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/10 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider text-gray-900 dark:text-white">📅 Cita Confirmada</div>
                            <div class="text-right">
                                <p class="text-xs subtitle-text uppercase tracking-wider font-bold text-gray-500 dark:text-gray-400">Barbero</p>
                                <p class="font-bold title-text text-lg leading-none text-gray-900 dark:text-white">${sanitizeHTML(barberName)}</p>
                            </div>
                        </div>
                        <div class="mb-6">
                            <p class="text-5xl font-display font-bold tracking-tight title-text mb-1 text-gray-900 dark:text-white">${timeStr}</p>
                            <p class="text-lg subtitle-text font-medium capitalize text-gray-600 dark:text-gray-400">${dateStr}</p>
                        </div>
                        <div class="flex items-center justify-between border-t border-black/5 dark:border-white/10 pt-4">
                            <div>
                                <p class="text-xs subtitle-text uppercase tracking-wider font-bold text-gray-500 dark:text-gray-400">Cliente</p>
                                <p class="font-bold title-text text-gray-900 dark:text-white">${sanitizeHTML(nombreCliente)}</p>
                                <p class="text-xs subtitle-text mt-0.5 text-gray-600 dark:text-gray-400">${sanitizeHTML(cita.servicio || 'Servicio General')}</p>
                            </div>
                            <button onclick="cancelarCita(${cita.id})" class="bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20 text-black dark:text-white text-xs font-bold px-4 py-2.5 rounded-xl transition-colors border border-black/10 dark:border-white/10 flex items-center gap-2">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg> Cancelar
                            </button>
                        </div>
                    </div>
                </div>`;
    if (inicioCitaContainer) inicioCitaContainer.innerHTML = cardHTML;
    cardCita.innerHTML = cardHTML;
  } else {
    appState.hasActiveAppointment = false;
    if (inicioCitaContainer) inicioCitaContainer.innerHTML = '';
    if (cardCita) cardCita.innerHTML = '';
  }
}

async function sendPushNotification(title, body, url) {
  const sb = await getSupabase();
  const telefono = appState.profile?.telefono;
  if (!telefono) return;
  await sb.rpc('enviar_notificacion_rpc', { p_telefono: telefono, p_negocio_id: negocioId, p_title: title, p_body: body, p_url: url || '/panel_cliente.html' });
}

function confirmarAccion(titulo, mensaje, onConfirm) {
  const modal = document.getElementById('modal-confirmacion');
  const titleEl = document.getElementById('confirm-title');
  const msgEl = document.getElementById('confirm-message');
  const btnOk = document.getElementById('btn-confirm-ok');
  const btnCancel = document.getElementById('btn-confirm-cancel');
  if (!modal) { if (confirm(mensaje)) onConfirm(); return; }
  titleEl.textContent = titulo;
  msgEl.textContent = mensaje;
  const newOk = btnOk.cloneNode(true);
  btnOk.parentNode.replaceChild(newOk, btnOk);
  newOk.onclick = () => { modal.classList.add('hidden'); onConfirm(); };
  btnCancel.onclick = () => modal.classList.add('hidden');
  modal.classList.remove('hidden');
}

function renderBarbersList(data) {
  const select = document.getElementById('select-barbero-cita');
  if (select) {
    select.innerHTML = '<option value="">Selecciona un barbero...</option>';
    data.forEach(b => {
      const opt = document.createElement('option');
      opt.value = b.id;
      opt.textContent = sanitizeHTML(b.nombre || b.usuario);
      select.appendChild(opt);
    });
  }
}

async function cargarBarberos() {
  const sb = await getSupabase();
  const cached = getCache('barberos');
  if (cached) { renderBarbersList(cached); appState.barbers = cached; }
  const { data } = await sb.from('barberos').select('id,nombre,usuario,avatar_url').eq('negocio_id', negocioId).eq('activo', true).order('nombre', { ascending: true });
  if (data) { setCache('barberos', data, 60); renderBarbersList(data); appState.barbers = data; }
}

async function fetchDayData(negocioId, barberId, dateStr) {
  const sb = await getSupabase();
  const parts = dateStr.split('-');
  const baseDay = new Date(parts[0], parts[1] - 1, parts[2]);
  const startDayISO = new Date(baseDay).toISOString();
  const endDay = new Date(baseDay); endDay.setHours(23, 59, 59, 999);
  const endDayISO = endDay.toISOString();

  if (appState.abortController) appState.abortController.abort();
  appState.abortController = new AbortController();

  const pCitas = sb.from('citas')
    .select('start_at, end_at')
    .eq('negocio_id', negocioId)
    .eq('barber_id', Number(barberId))
    .not('estado', 'in', '("Cancelada")')
    .gte('start_at', startDayISO)
    .lte('start_at', endDayISO)
    .abortSignal(appState.abortController.signal);

  const pEstado = sb.from('estado_negocio')
    .select('weekly_breaks')
    .eq('negocio_id', negocioId)
    .maybeSingle()
    .abortSignal(appState.abortController.signal);

  const pConfig = sb.from('configuracion_negocio')
    .select('hora_apertura, hora_cierre, dias_operacion')
    .eq('negocio_id', negocioId)
    .maybeSingle()
    .abortSignal(appState.abortController.signal);

  const [resCitas, resEstado, resConfig] = await Promise.all([pCitas, pEstado, pConfig]);
  
  appState.abortController = null;

  return { 
    citas: resCitas.data || [], 
    weeklyBreaks: resEstado.data?.weekly_breaks || [], 
    config: resConfig.data || { hora_apertura: '09:00', hora_cierre: '18:00', dias_operacion: ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"] },
    baseDay 
  };
}

function calculateAvailableSlots(baseDay, config, citas, weeklyBreaks, durationMin = 30) {
  const dayName = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"][baseDay.getDay()];
  if (!config.dias_operacion.includes(dayName)) return [];

  const [hOpen, mOpen] = (config.hora_apertura || '09:00').split(':').map(Number);
  const [hClose, mClose] = (config.hora_cierre || '18:00').split(':').map(Number);

  const start = new Date(baseDay); start.setHours(hOpen, mOpen, 0, 0);
  const end = new Date(baseDay); end.setHours(hClose, mClose, 0, 0);
  
  const now = new Date();
  const slots = [];
  let current = new Date(start);

  // Pre-procesar citas para mejor rendimiento
  const citasRanges = (citas || []).map(c => ({
    start: new Date(c.start_at).getTime(),
    end: new Date(c.end_at).getTime()
  }));

  // Pre-procesar breaks para mejor rendimiento
  const breaksToday = (weeklyBreaks || [])
    .filter(b => b.day === dayName)
    .map(b => {
      const [bhS, bmS] = b.start.split(':').map(Number);
      const [bhE, bmE] = b.end.split(':').map(Number);
      const bStart = new Date(baseDay); bStart.setHours(bhS, bmS, 0, 0);
      const bEnd = new Date(baseDay); bEnd.setHours(bhE, bmE, 0, 0);
      return { start: bStart.getTime(), end: bEnd.getTime() };
    });

  while (current.getTime() + durationMin * 60000 <= end.getTime()) {
    const slotStart = current.getTime();
    const slotEnd = slotStart + durationMin * 60000;
    
    // 1. No en el pasado
    if (slotStart > now.getTime()) {
      // 2. No solapa con citas
      const overlapsCita = citasRanges.some(c => 
        (slotStart < c.end && slotEnd > c.start)
      );

      // 3. No solapa con breaks
      const overlapsBreak = breaksToday.some(b => 
        (slotStart < b.end && slotEnd > b.start)
      );

      if (!overlapsCita && !overlapsBreak) {
        slots.push(new Date(slotStart));
      }
    }
    current = new Date(slotStart + durationMin * 60000);
  }
  return slots;
}

async function cargarSlotsInteligente() {
  const dp = document.getElementById('date-picker');
  const barberId = document.getElementById('select-barbero-cita')?.value;
  const servicioName = document.getElementById('select-servicio-cita')?.value;
  if (!barberId || !dp?.value || !servicioName) return;

  const dateStr = dp.value;
  const cacheKey = `slots_${dateStr}_${barberId}_${servicioName}`;
  const cached = getCache(cacheKey);
  if (cached) { renderSlotsToUI(cached.map(s => new Date(s))); return; }

  const slotsContainer = document.getElementById('slots-container');
  if (slotsContainer) slotsContainer.innerHTML = '<div class="col-span-full text-center py-8"><svg class="animate-spin h-8 w-8 mx-auto text-[#C1121F]" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg></div>';

  try {
    const data = await fetchDayData(negocioId, barberId, dateStr);
    const { citas, weeklyBreaks, config, baseDay } = data;
    
    // Buscar duración del servicio
    const cachedServices = getCache('SERVICES') || [];
    const serv = cachedServices.find(s => s.nombre === servicioName);
    const duration = serv ? serv.duracion_min : 30;
    appState.serviceDuration = duration;

    const slots = calculateAvailableSlots(baseDay, config, citas, weeklyBreaks, duration);
    setCache(cacheKey, slots, 5);
    renderSlotsToUI(slots);
  } catch (err) { 
    if (err.name !== 'AbortError') {
      console.error(err);
      showToast('Error al buscar horarios', 'error'); 
    }
  }
}

function renderSlotsToUI(slots) {
  const container = document.getElementById('slots-container');
  if (!container) return;
  container.innerHTML = slots.length ? '' : '<div class="col-span-full text-center py-8">No hay horarios.</div>';
  slots.forEach(slot => {
    const btn = document.createElement('button');
    btn.className = 'slot-btn p-3 border rounded-xl font-bold hover:border-[#C1121F] transition-all';
    btn.textContent = slot.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    btn.onclick = () => seleccionarHora(slot, btn);
    container.appendChild(btn);
  });
}

function seleccionarHora(slot, btn) {
  appState.selectedTimeSlot = slot;
  document.querySelectorAll('.slot-btn').forEach(b => b.classList.remove('bg-[#C1121F]', 'text-white'));
  btn.classList.add('bg-[#C1121F]', 'text-white');
  document.getElementById('action-container')?.classList.remove('hidden');
}

async function confirmarReservaManual() {
  if (appState.isBooking) return;
  const sb = await getSupabase();
  const date = appState.selectedTimeSlot;
  const barberId = document.getElementById('select-barbero-cita')?.value;
  const servicio = document.getElementById('select-servicio-cita')?.value;

  if (!date || !barberId || !servicio) { 
    showToast('Faltan datos', 'error'); 
    return; 
  }

  if (!appState.profile?.telefono) {
    showToast('Perfil incompleto (Falta teléfono)', 'error');
    return;
  }

  confirmarAccion('Confirmar', '¿Deseas reservar esta cita?', async () => {
    if (appState.isBooking) return; // Doble seguridad
    appState.isBooking = true;
    try {
      const duration = appState.serviceDuration || 30;
      const endAt = new Date(date.getTime() + duration * 60000);

      const { error } = await sb.rpc('programar_cita', { 
        p_negocio_id: negocioId, 
        p_barber_id: Number(barberId), 
        p_cliente_telefono: appState.profile.telefono, 
        p_start: date.toISOString(), 
        p_end: endAt.toISOString(), 
        p_servicio: servicio 
      });

      if (error) throw error;
      
      showToast('Cita agendada correctamente');
      const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      await sendPushNotification('Cita Confirmada', `Tu cita para las ${timeStr} ha sido agendada.`);
      await enviarCorreoConfirmacion(date.toISOString(), servicio, barberId);

      if (navigator.vibrate) {
        navigator.vibrate(50);
      }
      
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) { 
      showToast(e.message || 'Error al reservar', 'error'); 
      appState.isBooking = false; 
    }
  });
}

function resizeImage(file, maxSize = 512) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        if (width > height) { if (width > maxSize) { height *= maxSize/width; width = maxSize; } }
        else { if (height > maxSize) { width *= maxSize/height; height = maxSize; } }
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        canvas.toBlob(blob => resolve(new File([blob], file.name, { type: file.type })), file.type, 0.9);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

window.subirAvatar = async (input) => {
  let file = input.files[0]; 
  if (!file || appState.isUploading) return;
  
  appState.isUploading = true;
  const sb = await getSupabase();
  
  try {
    // Refrescar sesión para evitar errores de timeout en storage
    await sb.auth.refreshSession();
    
    file = await resizeImage(file, 512);
    const fileName = `public/${appState.user.id}-${Date.now()}`;
    
    const { error: uploadError } = await sb.storage
      .from('avatars')
      .upload(fileName, file, { cacheControl: '3600', upsert: false });
      
    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = sb.storage.from('avatars').getPublicUrl(fileName);
    
    const { error: updateError } = await sb.from('clientes')
      .update({ avatar_url: publicUrl })
      .eq('id', appState.user.id);
      
    if (updateError) throw updateError;

    showToast('Avatar actualizado correctamente');
    await cargarPerfil();
  } catch (e) { 
    console.error(e);
    showToast('Error al subir imagen', 'error'); 
  } finally {
    appState.isUploading = false;
    input.value = ''; // Reset input
  }
};

async function checkPendingRatings() {
  const sb = await getSupabase();
  const { data } = await sb.from('turnos').select('id, servicio').eq('negocio_id', negocioId).eq('telefono', appState.profile?.telefono).eq('estado', 'Atendido').limit(1).maybeSingle();
  if (data) {
    const { data: comm } = await sb.from('comentarios').select('id').eq('turno_id', data.id).maybeSingle();
    if (!comm) mostrarModalCalificacion(data);
  }
}

function mostrarModalCalificacion(turno) {
  const modal = document.getElementById('modal-calificacion');
  if (modal) {
    document.getElementById('rating-turno-id').value = turno.id;
    modal.classList.remove('hidden');
  }
}

async function enviarCalificacion() {
  if (appState.isSubmittingRating) return;
  const sb = await getSupabase();
  const id = document.getElementById('rating-turno-id').value;
  const rating = document.querySelector('input[name="rating"]:checked')?.value;
  const comment = document.getElementById('rating-comment').value;
  
  if (!rating) {
    showToast('Por favor selecciona una calificación', 'error');
    return;
  }

  appState.isSubmittingRating = true;
  try {
    const { error } = await sb.from('comentarios').insert([{ 
      negocio_id: negocioId, 
      turno_id: id, 
      calificacion: parseInt(rating), 
      comentario: comment, 
      nombre_cliente: appState.profile.nombre, 
      telefono_cliente: appState.profile.telefono 
    }]);

    if (error) throw error;

    showToast('¡Gracias por tu calificación!', 'success');
    cerrarModalCalificacion();
  } catch (e) {
    showToast('Error al enviar calificación', 'error');
  } finally {
    appState.isSubmittingRating = false;
  }
}

function cerrarModalCalificacion() {
  const modal = document.getElementById('modal-calificacion');
  if (modal) {
    modal.classList.add('hidden');
    // Reset form
    const ratingInputs = modal.querySelectorAll('input[name="rating"]');
    ratingInputs.forEach(i => i.checked = false);
    const commentInput = document.getElementById('rating-comment');
    if (commentInput) commentInput.value = '';
  }
}

init();

document.addEventListener('DOMContentLoaded', () => {
    setupThemeToggle();
    setupStaticEventHandlers();
});
