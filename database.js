// database.js

// Credenciales de Supabase.
const SUPABASE_URL = 'https://wjvwjirhxenotvdewbmm.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndqdndqaXJoeGVub3R2ZGV3Ym1tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5Mzc1MTEsImV4cCI6MjA4NTUxMzUxMX0.8tze0Dr0Js-aFpOMt7QKa5ImfcDnkZAUKomrjJXjcig';

let supabase;
let supabaseReadyResolve;
const supabaseReady = new Promise(r => { supabaseReadyResolve = r; });

async function initializeSupabase() {
  try {
    if (!navigator.onLine) {
      handleOfflineStatus(true);
    }

    let createClientFn = null;
    if (window.supabase && typeof window.supabase.createClient === 'function') {
      createClientFn = window.supabase.createClient;
    } else {
      const mod = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
      createClientFn = mod.createClient;
    }

    supabase = createClientFn(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      },
      // Fija explícitamente la URL de Edge Functions para evitar URLs vacías
      functions: {
        url: `${SUPABASE_URL}/functions/v1`
      },
      global: {
        headers: {
          apikey: SUPABASE_KEY
        }
      },
      realtime: {
        params: {
          eventsPerSecond: 10
        }
      }
    });
    // Expone la anon key en el cliente para usos de respaldo en fetch manual
    supabase.supabaseKey = SUPABASE_KEY;
    supabaseReadyResolve && supabaseReadyResolve(supabase);
  } catch (error) {
    console.error('Error initializing Supabase client:', error);
    if (navigator.onLine) {
      document.body.innerHTML = '<div style="color: red; padding: 20px; text-align: center; font-family: sans-serif;">' +
        '<h2 style="margin-bottom: 10px;">Error de Conexión</h2>' +
        '<p>No se pudo establecer conexión con el servidor de base de datos.</p>' +
        '<button onclick="location.reload()" style="margin-top: 15px; padding: 8px 16px; cursor: pointer;">Reintentar</button>' +
        '</div>';
    }
  }
}

// Manejo de estado Online/Offline
function handleOfflineStatus(isOffline) {
  let banner = document.getElementById('offline-banner');
  
  if (isOffline) {
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'offline-banner';
      banner.innerHTML = `
        <div style="position: fixed; top: 0; left: 0; right: 0; background: #ea4335; color: white; text-align: center; padding: 10px; z-index: 9999; font-family: sans-serif; font-weight: bold;">
          ⚠️ Sin conexión a Internet. Algunas funciones pueden no estar disponibles.
        </div>
      `;
      document.body.prepend(banner);
    }
  } else {
    if (banner) banner.remove();
  }
}

window.addEventListener('online', () => {
  handleOfflineStatus(false);
  console.log('Conexión restaurada.');
  // Si no se había inicializado, intentar de nuevo
  if (!supabase) initializeSupabase();
});

window.addEventListener('offline', () => {
  handleOfflineStatus(true);
  console.warn('Conexión perdida.');
});

if (document.readyState !== 'loading') {
  initializeSupabase();
} else {
  document.addEventListener('DOMContentLoaded', initializeSupabase);
}

async function ensureSupabase() {
  if (supabase) return supabase;
  await supabaseReady;
  return supabase;
}

// Función para inyectar Favicon en todas las páginas automáticamente
function injectFavicon() {
  if (!document.querySelector("link[rel*='icon']")) {
    const link = document.createElement('link');
    link.type = 'image/png';
    link.rel = 'shortcut icon';
    link.href = 'imegenlogin/favicon-32x32.png'; // Asegúrate que esta ruta sea correcta relativa a tu estructura
    document.getElementsByTagName('head')[0].appendChild(link);
  }
}

if (document.readyState !== 'loading') injectFavicon();
else document.addEventListener('DOMContentLoaded', injectFavicon);

// --- SISTEMA DE CACHÉ GLOBAL INTELIGENTE ---
const GlobalCache = {
  prefix: 'jbarber_cache_v1_',
  
  _key(key) {
    return this.prefix + key;
  },

  get(key) {
    try {
      const record = JSON.parse(localStorage.getItem(this._key(key)));
      if (!record) return null;
      if (Date.now() > record.expiry) {
        localStorage.removeItem(this._key(key));
        return null;
      }
      return record.data;
    } catch (e) {
      return null;
    }
  },

  set(key, data, ttlMinutes = 5) {
    try {
      const record = {
        data,
        expiry: Date.now() + (ttlMinutes * 60 * 1000),
        timestamp: Date.now()
      };
      localStorage.setItem(this._key(key), JSON.stringify(record));
    } catch (e) {
      this.prune();
    }
  },

  remove(key) {
    localStorage.removeItem(this._key(key));
  },

  clear() {
    Object.keys(localStorage).forEach(k => {
      if (k.startsWith(this.prefix)) localStorage.removeItem(k);
    });
  },

  prune() {
    Object.keys(localStorage).forEach(k => {
      if (k.startsWith(this.prefix)) {
        try {
          const record = JSON.parse(localStorage.getItem(k));
          if (Date.now() > record.expiry) {
            localStorage.removeItem(k);
          }
        } catch (e) {
          localStorage.removeItem(k);
        }
      }
    });
  },

  async smartQuery(key, fetcher, ttlMinutes = 5) {
    const cached = this.get(key);
    if (cached) {
      return { data: cached, error: null, fromCache: true };
    }

    try {
      const result = await fetcher();
      if (result && result.error) throw result.error;
      
      // Soporte para respuestas de Supabase { data, error } o datos directos
      const dataToCache = result.data !== undefined ? result.data : result;
      
      if (dataToCache) {
        this.set(key, dataToCache, ttlMinutes);
      }
      
      return { data: dataToCache, error: null, fromCache: false };
    } catch (error) {
      console.error(`Error en smartQuery (${key}):`, error);
      return { data: null, error, fromCache: false };
    }
  }
};

export { supabase, ensureSupabase, GlobalCache };
