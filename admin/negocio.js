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

// Variables para el control de break
let breakActivo = false;
let breakEndTime = null;
let breakInterval = null;

document.addEventListener('DOMContentLoaded', () => {
    if (!negocioId) return;

    initThemeToggle();
    actualizarFechaHora();
    setInterval(actualizarFechaHora, 60000);
    setupMobileMenu();
    initDayButtons();
    mostrarTotales();
    cargarConfiguracion();
    inicializarGrafico();
    initBreakControl();
    verificarEstadoBreak();

    const btnExport = document.getElementById('exportExcel');
    if (btnExport) btnExport.addEventListener('click', exportarAExcel);
    const formConfig = document.getElementById('config-form');
    if (formConfig) formConfig.addEventListener('submit', guardarConfiguracion);
});

function initThemeToggle() {
    const themeToggle = document.getElementById('theme-toggle');
    const htmlElement = document.documentElement;
    if (!themeToggle) return;
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        htmlElement.classList.add('dark');
    } else {
        htmlElement.classList.remove('dark');
    }
    themeToggle.addEventListener('click', () => {
        htmlElement.classList.toggle('dark');
        const isDark = htmlElement.classList.contains('dark');
        localStorage.setItem('theme', isDark ? 'dark' : 'light');
    });
}

function actualizarFechaHora() {
    const ahora = new Date();
    const opciones = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const fechaFormateada = ahora.toLocaleDateString('es-ES', opciones);
    const horaFormateada = ahora.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    const fechaEl = document.getElementById('fecha-actual');
    const horaEl = document.getElementById('hora-actual');
    if (fechaEl) fechaEl.textContent = fechaFormateada.charAt(0).toUpperCase() + fechaFormateada.slice(1);
    if (horaEl) horaEl.textContent = horaFormateada;
}

function setupMobileMenu() {
    const mobileMenuButton = document.getElementById('mobile-menu-button');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (mobileMenuButton && sidebar && overlay) {
        const toggle = () => toggleMobileMenu(sidebar, overlay);
        mobileMenuButton.addEventListener('click', toggle);
        overlay.addEventListener('click', toggle);
    }
}

function toggleMobileMenu(sidebar, overlay) {
    sidebar.classList.toggle('-translate-x-full');
    overlay.classList.toggle('opacity-0');
    overlay.classList.toggle('pointer-events-none');
}

function initDayButtons() {
    const dayButtons = document.querySelectorAll('.day-btn');
    dayButtons.forEach(button => {
        button.addEventListener('click', () => {
            const willSelect = !button.classList.contains('bg-blue-500');
            button.classList.toggle('bg-blue-500', willSelect);
            button.classList.toggle('text-white', willSelect);
            button.classList.toggle('bg-blue-100', !willSelect);
            button.classList.toggle('dark:bg-blue-900', !willSelect);
            button.classList.toggle('text-blue-800', !willSelect);
            button.classList.toggle('dark:text-blue-200', !willSelect);
        });
    });
}

async function obtenerGanancias() {
    if (!negocioId) return [];
    try {
        const { data, error } = await supabase
            .from('turnos')
            .select('fecha, monto_cobrado')
            .eq('negocio_id', negocioId);
        if (error) throw error;
        const resumen = {};
        (data || []).forEach(({ fecha, monto_cobrado }) => {
            const monto = Number(monto_cobrado);
            if (!resumen[fecha]) resumen[fecha] = 0;
            resumen[fecha] += isNaN(monto) ? 0 : monto;
        });
        return Object.entries(resumen).map(([fecha, ganancia]) => ({
            Fecha: fecha,
            Ganancia: Number(ganancia).toFixed(2),
        }));
    } catch (error) {
        mostrarNotificacion('Error', `No se pudieron obtener los datos de ganancias: ${error.message}`, 'error');
        return [];
    }
}

async function exportarAExcel() {
    try {
        let ingresos = await obtenerGanancias();
        if (ingresos.length === 0) {
            mostrarNotificacion('Sin datos', 'No hay datos para exportar', 'info');
            return;
        }
        ingresos = ingresos.sort((a, b) => new Date(a.Fecha) - new Date(b.Fecha));
        const total = ingresos.reduce((sum, fila) => sum + Number(fila.Ganancia), 0);
        ingresos.push({ Fecha: 'TOTAL', Ganancia: total.toFixed(2) });
        const ws = XLSX.utils.json_to_sheet(ingresos);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Ingresos');
        XLSX.writeFile(wb, 'historial_ingresos.xlsx');
        mostrarNotificacion('Éxito', 'El archivo Excel ha sido generado correctamente', 'success');
    } catch (error) {
        mostrarNotificacion('Error', `No se pudo exportar a Excel: ${error.message}`, 'error');
    }
}

async function mostrarTotales() {
    try {
        const ingresos = await obtenerGanancias();
        const hoy = new Date();
        const diaActual = hoy.toISOString().slice(0, 10);
        const primerDiaSemana = new Date(hoy);
        primerDiaSemana.setDate(hoy.getDate() - hoy.getDay() + (hoy.getDay() === 0 ? -6 : 1));
        const inicioSemana = primerDiaSemana.toISOString().slice(0, 10);
        const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().slice(0, 10);
        let totalDia = 0, totalSemana = 0, totalMes = 0;
        ingresos.forEach(({ Fecha, Ganancia }) => {
            if (Fecha === 'TOTAL') return;
            const g = Number(Ganancia);
            if (Fecha === diaActual) totalDia += g;
            if (Fecha >= inicioSemana) totalSemana += g;
            if (Fecha >= inicioMes) totalMes += g;
        });
        document.getElementById('ganancia-dia').textContent = totalDia.toFixed(2);
        document.getElementById('ganancia-semana').textContent = totalSemana.toFixed(2);
        document.getElementById('ganancia-mes').textContent = totalMes.toFixed(2);
        const maxGanancia = Math.max(totalDia, totalSemana, totalMes, 1);
        document.getElementById('barra-dia').style.width = `${(totalDia / maxGanancia) * 100}%`;
        document.getElementById('barra-semana').style.width = `${(totalSemana / maxGanancia) * 100}%`;
        document.getElementById('barra-mes').style.width = `${(totalMes / maxGanancia) * 100}%`;
        actualizarGraficoIngresos(ingresos);
    } catch (error) {
        console.error('Error al mostrar totales:', error);
    }
}

let ingresosChart;
function inicializarGrafico() {
    const canvas = document.getElementById('ingresos-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ingresosChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Ingresos diarios',
                data: [],
                borderColor: getComputedStyle(document.documentElement).getPropertyValue('--color-primary-500') || '#0ea5e9',
                backgroundColor: 'rgba(14, 165, 233, 0.1)',
                borderWidth: 2,
                tension: 0.3,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: true, position: 'top', labels: { color: document.documentElement.classList.contains('dark') ? '#e2e8f0' : '#1e293b' } },
                tooltip: { mode: 'index', intersect: false, callbacks: { label: (context) => `Ingresos: $${context.raw}` } }
            },
            scales: {
                x: { grid: { color: document.documentElement.classList.contains('dark') ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)' }, ticks: { color: document.documentElement.classList.contains('dark') ? '#e2e8f0' : '#1e293b' } },
                y: { beginAtZero: true, grid: { color: document.documentElement.classList.contains('dark') ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)' }, ticks: { color: document.documentElement.classList.contains('dark') ? '#e2e8f0' : '#1e293b', callback: (value) => '$' + value } }
            }
        }
    });
}

function actualizarGraficoIngresos(ingresos) {
    if (!ingresosChart) return;
    const hoy = new Date();
    const hace14Dias = new Date();
    hace14Dias.setDate(hoy.getDate() - 14);
    const datosRecientes = (ingresos || [])
        .filter(item => item.Fecha !== 'TOTAL' && new Date(item.Fecha) >= hace14Dias)
        .sort((a, b) => new Date(a.Fecha) - new Date(b.Fecha));
    const labels = datosRecientes.map(item => new Date(item.Fecha).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' }));
    const datos = datosRecientes.map(item => Number(item.Ganancia));
    ingresosChart.data.labels = labels;
    ingresosChart.data.datasets[0].data = datos;
    ingresosChart.update();
}

async function cargarConfiguracion() {
    if (!negocioId) return;
    try {
        const { data, error } = await supabase
            .from('configuracion_negocio')
            .select('*')
            .eq('negocio_id', negocioId)
            .maybeSingle();
        if (error) throw error;
        if (data) {
            document.getElementById('hora-apertura').value = data.hora_apertura || '';
            document.getElementById('hora-cierre').value = data.hora_cierre || '';
            document.getElementById('limite-turnos').value = data.limite_turnos || '';
            document.getElementById('mostrar-tiempo-toggle').checked = data.mostrar_tiempo_estimado !== undefined ? data.mostrar_tiempo_estimado : false;
            if (data.dias_operacion && Array.isArray(data.dias_operacion)) {
                const dayNumToName = { 'Domingo': 0, 'Lunes': 1, 'Martes': 2, 'Miércoles': 3, 'Jueves': 4, 'Viernes': 5, 'Sábado': 6 };
                const selectedDays = data.dias_operacion.map(name => dayNumToName[name]).filter(n => typeof n === 'number');
                document.querySelectorAll('.day-btn').forEach(button => {
                    const day = parseInt(button.getAttribute('data-day'));
                    const isSelected = selectedDays.includes(day);
                    button.classList.toggle('bg-blue-500', isSelected);
                    button.classList.toggle('text-white', isSelected);
                    button.classList.toggle('bg-blue-100', !isSelected);
                    button.classList.toggle('dark:bg-blue-900', !isSelected);
                });
            }
        }
    } catch (error) {
        console.error('Error al cargar configuración:', error);
    }
}

async function guardarConfiguracion(event) {
    event.preventDefault();
    if (!negocioId) return;
    try {
        const horaApertura = document.getElementById('hora-apertura').value || null;
        const horaCierre = document.getElementById('hora-cierre').value || null;
        const limiteTurnosRaw = parseInt(document.getElementById('limite-turnos').value);
        const limiteTurnos = isNaN(limiteTurnosRaw) ? null : limiteTurnosRaw;
        const mostrarTiempo = document.getElementById('mostrar-tiempo-toggle').checked;
        const dayNumToName = { 0: 'Domingo', 1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes', 6: 'Sábado' };
        const diasOperacion = [];
        document.querySelectorAll('.day-btn.bg-blue-500').forEach(button => {
            const dayNum = parseInt(button.getAttribute('data-day'));
            if (dayNumToName[dayNum]) diasOperacion.push(dayNumToName[dayNum]);
        });
        if (!diasOperacion.length) {
            mostrarNotificacion('Error de Configuración', 'Debe seleccionar al menos un día de operación.', 'warning');
            return;
        }
        const { error } = await supabase
            .from('configuracion_negocio')
            .upsert({
                negocio_id: negocioId,
                hora_apertura: horaApertura,
                hora_cierre: horaCierre,
                limite_turnos: limiteTurnos,
                dias_operacion: diasOperacion,
                mostrar_tiempo_estimado: mostrarTiempo
            }, { onConflict: 'negocio_id' });
        if (error) throw error;
        mostrarNotificacion('Éxito', 'Configuración guardada correctamente', 'success');
    } catch (error) {
        mostrarNotificacion('Error', `No se pudo guardar la configuración: ${error.message}`, 'error');
    }
}

function mostrarNotificacion(titulo, mensaje, tipo) {
    Swal.fire({
        title: titulo,
        text: mensaje,
        icon: tipo,
        confirmButtonColor: '#0ea5e9',
        confirmButtonText: 'Aceptar',
        background: document.documentElement.classList.contains('dark') ? '#1e293b' : '#ffffff',
        color: document.documentElement.classList.contains('dark') ? '#e2e8f0' : '#1e293b'
    });
}

function initBreakControl() {
    document.getElementById('toggle-break')?.addEventListener('click', toggleBreak);
}

async function verificarEstadoBreak() {
    if (!negocioId) return;
    try {
        const { data, error } = await supabase
            .from('estado_negocio')
            .select('*')
            .eq('negocio_id', negocioId)
            .single();
        if (error && error.code !== 'PGRST116') throw error;
        if (data && data.en_break) {
            const endTime = new Date(data.break_end_time);
            if (endTime > new Date()) {
                breakActivo = true;
                breakEndTime = endTime;
                actualizarUIBreak(true);
                iniciarTemporizador();
            } else {
                await finalizarBreak();
            }
        } else {
            actualizarUIBreak(false);
        }
    } catch (error) {
        console.error('Error al verificar estado del break:', error);
    }
}

async function toggleBreak() {
    if (breakActivo) await finalizarBreak(); else await iniciarBreak();
}

async function iniciarBreak() {
    if (!negocioId) return;
    try {
        const duracion = parseInt(document.getElementById('break-duration').value) || 30;
        const mensaje = document.getElementById('break-message').value || 'Estamos en break, regresamos pronto...';
        const now = new Date();
        const endTime = new Date(now.getTime() + duracion * 60000);
        const { error } = await supabase
            .from('estado_negocio')
            .upsert({
                negocio_id: negocioId,
                en_break: true,
                break_start_time: now.toISOString(),
                break_end_time: endTime.toISOString(),
                break_message: mensaje,
                updated_at: now.toISOString()
            }, { onConflict: 'negocio_id' });
        if (error) throw error;
        breakActivo = true;
        breakEndTime = endTime;
        actualizarUIBreak(true);
        iniciarTemporizador();
        mostrarNotificacion('Break Iniciado', `Break activo por ${duracion} minutos`, 'success');
    } catch (error) {
        console.error('Error al iniciar break:', error);
        mostrarNotificacion('Error', 'No se pudo iniciar el break', 'error');
    }
}

async function finalizarBreak() {
    if (!negocioId) return;
    try {
        const { error } = await supabase
            .from('estado_negocio')
            .upsert({
                negocio_id: negocioId,
                en_break: false,
                break_start_time: null,
                break_end_time: null,
                break_message: null,
                updated_at: new Date().toISOString()
            }, { onConflict: 'negocio_id' });
        if (error) throw error;
        breakActivo = false;
        breakEndTime = null;
        if (breakInterval) clearInterval(breakInterval);
        breakInterval = null;
        actualizarUIBreak(false);
        mostrarNotificacion('Break Finalizado', 'El negocio está nuevamente abierto', 'success');
    } catch (error) {
        console.error('Error al finalizar break:', error);
        mostrarNotificacion('Error', 'No se pudo finalizar el break', 'error');
    }
}

function actualizarUIBreak(enBreak) {
    const indicator = document.getElementById('break-indicator');
    const text = document.getElementById('break-text');
    const button = document.getElementById('toggle-break');
    const buttonText = document.getElementById('break-button-text');
    const timeRemaining = document.getElementById('break-time-remaining');
    if (!indicator || !text || !button || !buttonText || !timeRemaining) return;
    if (enBreak) {
        indicator.className = 'w-3 h-3 rounded-full bg-orange-500';
        text.textContent = 'En Break';
        text.className = 'font-medium text-orange-600 dark:text-orange-400';
        button.className = 'w-full bg-red-600 hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-800 text-white px-6 py-3 rounded-lg transition-colors flex items-center justify-center font-semibold';
        buttonText.textContent = 'Finalizar Break';
        timeRemaining.classList.remove('hidden');
    } else {
        indicator.className = 'w-3 h-3 rounded-full bg-green-500';
        text.textContent = 'Negocio Abierto';
        text.className = 'font-medium text-green-600 dark:text-green-400';
        button.className = 'w-full bg-orange-600 hover:bg-orange-700 dark:bg-orange-700 dark:hover:bg-orange-800 text-white px-6 py-3 rounded-lg transition-colors flex items-center justify-center font-semibold';
        buttonText.textContent = 'Iniciar Break';
        timeRemaining.classList.add('hidden');
    }
}

function iniciarTemporizador() {
    if (breakInterval) clearInterval(breakInterval);
    breakInterval = setInterval(() => {
        const now = new Date();
        const timeLeft = breakEndTime - now;
        if (timeLeft <= 0) {
            finalizarBreak();
        } else {
            const minutes = Math.floor(timeLeft / 60000);
            const seconds = Math.floor((timeLeft % 60000) / 1000);
            document.getElementById('remaining-time').textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
    }, 1000);
}

window.exportarAExcel = exportarAExcel;
window.mostrarTotales = mostrarTotales;
window.guardarConfiguracion = guardarConfiguracion;
window.verificarBreakActivo = async () => {
    if (!negocioId) return { enBreak: false, mensaje: null };
    try {
        const { data, error } = await supabase
            .from('estado_negocio')
            .select('en_break, break_end_time, break_message')
            .eq('negocio_id', negocioId)
            .single();
        if (error && error.code !== 'PGRST116') return { enBreak: false, mensaje: null };
        if (data && data.en_break) {
            const endTime = new Date(data.break_end_time);
            if (endTime > new Date()) {
                return { enBreak: true, mensaje: data.break_message || 'En break.', tiempoRestante: Math.ceil((endTime - new Date()) / 60000) };
            }
        }
        return { enBreak: false, mensaje: null };
    } catch (error) {
        console.error('Error al verificar break:', error);
        return { enBreak: false, mensaje: null };
    }
};
