import { supabase } from '../database.js';

/**
 * Obtiene el ID del negocio desde el atributo `data-negocio-id` en el body.
 * @returns {string|null} El ID del negocio o null si no está presente.
 */
function getNegocioId() {
    const id = document.body.dataset.negocioId;
    if (!id) {
        console.error('Error crítico: Atributo data-negocio-id no encontrado en el body.');
        alert('Error de configuración: No se pudo identificar el negocio.');
    }
    return id;
}

const negocioId = getNegocioId();

async function loadThemeFromDB() {
    if (!negocioId) return;

    try {
        const { data, error } = await supabase
            .from('configuracion_negocio')
            .select('theme_primary, theme_mode')
            .eq('negocio_id', negocioId)
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) throw error;

        if (data) {
            const primary = data.theme_primary || 'blue';
            const mode = data.theme_mode || 'light';
            window.theme.apply(primary, mode);

            // Update the dropdowns to reflect the loaded theme
            document.getElementById('theme-primary').value = primary;
            document.getElementById('theme-mode').value = mode;
        }
    } catch (error) {
        console.error('Error cargando el tema desde la base de datos:', error.message);
    }
}

async function saveThemeToDB() {
    if (!negocioId) return;

    const primary = document.getElementById('theme-primary').value;
    const mode = document.getElementById('theme-mode').value;
    const statusEl = document.getElementById('status');

    try {
        statusEl.textContent = 'Guardando...';
        const { error } = await supabase
            .from('configuracion_negocio')
            .upsert({
                negocio_id: negocioId,
                theme_primary: primary,
                theme_mode: mode,
            }, { onConflict: 'negocio_id' });

        if (error) throw error;

        statusEl.textContent = 'Guardado ✅';
        setTimeout(() => { statusEl.textContent = ''; }, 2000);

    } catch (error) {
        statusEl.textContent = 'Error al guardar ❌';
        console.error('Error guardando el tema en la base de datos:', error.message);
    }
}

function setupThemePage() {
    const themePrimarySelect = document.getElementById('theme-primary');
    const themeModeSelect = document.getElementById('theme-mode');
    const saveButton = document.getElementById('btn-guardar');
    const themeToggleBtn = document.getElementById('theme-toggle');

    if (!themePrimarySelect || !themeModeSelect || !saveButton) {
        console.error('No se encontraron todos los elementos de configuración del tema.');
        return;
    }

    // Live preview
    themePrimarySelect.addEventListener('change', () => {
        window.theme.setPrimary(themePrimarySelect.value);
    });

    themeModeSelect.addEventListener('change', () => {
        window.theme.setMode(themeModeSelect.value);
    });

    // Save to DB
    saveButton.addEventListener('click', saveThemeToDB);

    // Sync main toggle button
    themeToggleBtn?.addEventListener('click', () => {
        setTimeout(() => {
            const currentMode = window.theme.get().mode;
            themeModeSelect.value = currentMode;
        }, 50);
    });
}

function setupSidebar() {
    const btn = document.getElementById('mobile-menu-button');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    
    if (!sidebar || !btn) return;

    const toggle = () => {
        sidebar.classList.toggle('-translate-x-full');
        if (overlay) {
            overlay.classList.toggle('opacity-0');
            overlay.classList.toggle('pointer-events-none');
        }
    };

    btn.addEventListener('click', toggle);
    if (overlay) overlay.addEventListener('click', toggle);
}

document.addEventListener('DOMContentLoaded', () => {
    if (!negocioId) return;
    setupThemePage();
    loadThemeFromDB();
    setupSidebar();
});
