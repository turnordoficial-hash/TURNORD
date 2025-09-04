// config.js - Configuración centralizada
const Config = {
  // === CONFIGURACIÓN DE SUPABASE ===
  supabaseUrl: 'https://fhequkvqxsbdkmgmoftp.supabase.co', // superbase url
  supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZoZXF1a3ZxeHNiZGttZ21vZnRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM5MTM3NzAsImV4cCI6MjA2OTQ4OTc3MH0.tVXmyBG39oxWJVlmFwHXAaYDBWxakssZ7g-BywmlZEM', // superbase llave

  // === CONFIGURACIÓN DE RUTAS ===
  routes: {
    login: './login.html',
    panel: './panel.html',
    usuario: './usuario.html',
    configuracion: './configuracion.html'
  },

  // === CONFIGURACIÓN DE CDN ===
  cdn: {
    supabase: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm',
    tailwind: 'https://cdn.tailwindcss.com'
  },

  // === CONFIGURACIÓN DE RUTAS BASE ===
  basePath: '',

  // === MÉTODOS DE CONFIGURACIÓN ===
  getSupabaseConfig: function() {
    const url = this.supabaseUrl;
    const key = this.supabaseKey;
    return { url, key };
  },

  getRoute: function(routeName) {
    const route = this.routes[routeName] || routeName;
    return route;
  },

  getCDN: function(service) {
    return this.cdn[service];
  },

  // Método para obtener configuración completa
  getFullConfig: function() {
    return {
      supabase: this.getSupabaseConfig(),
      routes: this.routes,
      cdn: this.cdn,
      basePath: this.basePath
    };
  }
};

export default Config;
