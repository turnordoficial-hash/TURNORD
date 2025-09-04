// configuracion.js

// Nota: La lógica de Supabase ha sido eliminada.
// El tema se maneja ahora 100% en el lado del cliente usando localStorage
// a través del helper global `window.theme` que viene de `assets/theme.js`.

function setupThemePage() {
  const themePrimarySelect = document.getElementById('theme-primary');
  const themeModeSelect = document.getElementById('theme-mode');
  const saveButton = document.getElementById('btn-guardar');
  const statusEl = document.getElementById('status');
  const themeToggleBtn = document.getElementById('theme-toggle');

  if (!themePrimarySelect || !themeModeSelect || !saveButton || !statusEl) {
    console.error('No se encontraron todos los elementos de configuración del tema.');
    return;
  }

  // 1. Cargar la configuración guardada en localStorage al iniciar
  const currentTheme = window.theme.get();
  themePrimarySelect.value = currentTheme.primary;
  themeModeSelect.value = currentTheme.mode;

  // 2. Implementar la vista previa en vivo
  themePrimarySelect.addEventListener('change', () => {
    window.theme.setPrimary(themePrimarySelect.value);
  });

  themeModeSelect.addEventListener('change', () => {
    window.theme.setMode(themeModeSelect.value);
  });

  // 3. El botón de guardar ahora solo da feedback, ya que los cambios se aplican y guardan al instante.
  saveButton.addEventListener('click', () => {
    statusEl.textContent = 'Guardado ✅';
    setTimeout(() => {
      statusEl.textContent = '';
    }, 2000);
  });

  // 4. Sincronizar el botón de toggle principal con el select
  themeToggleBtn?.addEventListener('click', () => {
      // Damos un pequeño delay para asegurar que theme.js actualice el localStorage primero
      setTimeout(() => {
        const currentMode = window.theme.get().mode;
        themeModeSelect.value = currentMode;
      }, 50);
  });
}

// Cargar la configuración de la página cuando el DOM esté listo.
// El helper `window.theme` de `assets/theme.js` se carga antes que este script,
// por lo que debería estar disponible.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupThemePage);
} else {
    setupThemePage();
}
