(function() {
  // CSS de variables de color y temas
  var css = `
  :root {
    --color-primary-500: #0ea5e9;
    --color-primary-600: #0284c7;
    --color-primary-700: #0369a1;
  }
  .theme-red    { --color-primary-500:#ef4444; --color-primary-600:#dc2626; --color-primary-700:#b91c1c; }
  .theme-orange { --color-primary-500:#f97316; --color-primary-600:#ea580c; --color-primary-700:#c2410c; }
  .theme-blue   { --color-primary-500:#0ea5e9; --color-primary-600:#0284c7; --color-primary-700:#0369a1; }
  .theme-black  { --color-primary-500:#334155; --color-primary-600:#1f2937; --color-primary-700:#0f172a; }
  .theme-green  { --color-primary-500:#22c55e; --color-primary-600:#16a34a; --color-primary-700:#15803d; }
  .theme-pink   { --color-primary-500:#ec4899; --color-primary-600:#db2777; --color-primary-700:#be185d; }
  .theme-purple { --color-primary-500:#8b5cf6; --color-primary-600:#7c3aed; --color-primary-700:#6d28d9; }

  /* Ejemplos de utilitarios opcionales basados en variables */
  .text-primary-500 { color: var(--color-primary-500); }
  .text-primary-600 { color: var(--color-primary-600); }
  .text-primary-700 { color: var(--color-primary-700); }
  .bg-primary-500 { background-color: var(--color-primary-500); }
  .bg-primary-600 { background-color: var(--color-primary-600); }
  .bg-primary-700 { background-color: var(--color-primary-700); }
  `;

  // Inyectar el <style> lo antes posible
  try {
    var styleEl = document.getElementById('theme-vars');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'theme-vars';
      styleEl.textContent = css;
      // Insertar al final del head para que tenga prioridad sobre Tailwind
      (document.head || document.documentElement).appendChild(styleEl);
    }
  } catch (e) {
    // Si algo falla, intentar un append simple
    var s = document.createElement('style');
    s.id = 'theme-vars';
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }

  // Migración: modoOscuro -> theme_mode
  try {
    var legacy = localStorage.getItem('modoOscuro');
    if (legacy !== null && localStorage.getItem('theme_mode') === null) {
      localStorage.setItem('theme_mode', legacy === 'true' ? 'dark' : 'light');
      // Opcional: limpiar la clave antigua
      // localStorage.removeItem('modoOscuro');
    }
  } catch (_) {}

  // Helpers
  function getTheme() {
    var primary = 'blue';
    var mode = 'light';
    try {
      primary = localStorage.getItem('theme_primary') || primary;
      mode = localStorage.getItem('theme_mode') || mode;
    } catch (_) {}
    return { primary: primary, mode: mode };
  }

  function removeThemeClasses(root) {
    var themes = ['theme-red','theme-orange','theme-blue','theme-black','theme-green','theme-pink','theme-purple'];
    themes.forEach(function(c){ root.classList.remove(c); });
  }

  function applyTheme(primary, mode) {
    var root = document.documentElement;
    removeThemeClasses(root);
    root.classList.add('theme-' + (primary || 'blue'));
    if (mode === 'dark') root.classList.add('dark'); else root.classList.remove('dark');
  }

  function setThemePrimary(primary) {
    try { localStorage.setItem('theme_primary', primary); } catch (_) {}
    var mode = getTheme().mode;
    applyTheme(primary, mode);
  }

  function setThemeMode(mode) {
    try { localStorage.setItem('theme_mode', mode); } catch (_) {}
    var primary = getTheme().primary;
    applyTheme(primary, mode);
  }

  function toggleThemeMode() {
    var current = getTheme().mode;
    var next = current === 'dark' ? 'light' : 'dark';
    setThemeMode(next);
    return next;
  }

  // Aplicar tema al cargar lo más pronto posible
  var initial = getTheme();
  applyTheme(initial.primary, initial.mode);

  // Exponer utilidades en window
  window.theme = {
    get: getTheme,
    apply: applyTheme,
    setPrimary: setThemePrimary,
    setMode: setThemeMode,
    toggleMode: toggleThemeMode
  };

  // Sincronizar entre pestañas (opcional)
  window.addEventListener('storage', function(e) {
    if (e.key === 'theme_primary' || e.key === 'theme_mode') {
      var t = getTheme();
      applyTheme(t.primary, t.mode);
    }
  });
})();
