/**
 * PWA Manager - JBarber
 * Gestiona la detección de plataforma, instalación y UI para PWA.
 */

const PWAManager = {
    deferredPrompt: null,
    platform: {
        isAndroid: /Android/i.test(navigator.userAgent),
        isIOS: /iPhone|iPad|iPod/i.test(navigator.userAgent),
        isSafari: /^((?!chrome|android).)*safari/i.test(navigator.userAgent),
        isStandalone: window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone
    },

    init() {
        console.log('PWA Manager: Inicializando...', this.platform);
        
        // 1. Escuchar evento de instalación en Android
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            this.deferredPrompt = e;
            console.log('PWA: beforeinstallprompt detectado');
            this.showInstallUI();
        });

        // 2. Escuchar cuando la app se instala con éxito
        window.addEventListener('appinstalled', () => {
            console.log('PWA: Instalada con éxito');
            localStorage.setItem('pwa_installed_jbarber', 'true');
            this.hideInstallUI();
        });

        // 3. Verificar si mostrar el banner (iOS o Android no instalada)
        this.checkInitialUI();
    },

    checkInitialUI() {
        if (this.platform.isStandalone) return;
        if (localStorage.getItem('pwa_closed_banner') === 'true') return;

        // Si es iOS Safari, mostrar guía de instalación manual
        if (this.platform.isIOS && this.platform.isSafari) {
            setTimeout(() => this.showIOSGuide(), 3000);
        }
    },

    showInstallUI() {
        if (this.platform.isStandalone) return;
        
        const banner = document.createElement('div');
        banner.id = 'pwa-install-banner';
        banner.className = 'fixed bottom-6 left-6 right-6 bg-zinc-900 border border-white/10 p-4 rounded-2xl shadow-2xl z-[9999] flex items-center justify-between animate-bounce-in';
        banner.innerHTML = `
            <div class="flex items-center gap-3">
                <div class="w-12 h-12 bg-red-600 rounded-xl flex items-center justify-center shadow-lg shadow-red-600/20">
                    <span class="text-white text-xl font-bold">J</span>
                </div>
                <div>
                    <h3 class="text-white font-bold text-sm">Instalar JBarber</h3>
                    <p class="text-gray-400 text-xs">Acceso rápido y notificaciones</p>
                </div>
            </div>
            <div class="flex gap-2">
                <button id="pwa-btn-close" class="p-2 text-gray-500 hover:text-white transition-colors">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
                </button>
                <button id="pwa-btn-install" class="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-xl text-xs font-bold transition-all active:scale-95 shadow-lg shadow-red-600/20">
                    INSTALAR
                </button>
            </div>
        `;
        document.body.appendChild(banner);

        document.getElementById('pwa-btn-install').addEventListener('click', () => this.installAndroid());
        document.getElementById('pwa-btn-close').addEventListener('click', () => this.closeBanner());
    },

    showIOSGuide() {
        const modal = document.createElement('div');
        modal.id = 'pwa-ios-modal';
        modal.className = 'fixed inset-0 z-[9999] flex items-end justify-center p-6 bg-black/60 backdrop-blur-sm animate-fade-in';
        modal.innerHTML = `
            <div class="bg-white dark:bg-zinc-900 w-full max-w-sm rounded-[2.5rem] p-8 shadow-2xl animate-slide-up">
                <div class="text-center mb-6">
                    <div class="w-20 h-20 bg-red-600 rounded-3xl flex items-center justify-center shadow-2xl shadow-red-600/30 mx-auto mb-4">
                        <span class="text-white text-4xl font-bold">J</span>
                    </div>
                    <h2 class="text-2xl font-bold text-gray-900 dark:text-white">Instalar JBarber</h2>
                    <p class="text-gray-500 dark:text-gray-400 text-sm mt-2">Sigue estos pasos para instalar la app en tu iPhone</p>
                </div>
                
                <div class="space-y-6 mb-8">
                    <div class="flex items-center gap-4">
                        <div class="w-10 h-10 bg-gray-100 dark:bg-white/5 rounded-full flex items-center justify-center text-red-600 font-bold">1</div>
                        <p class="text-sm text-gray-700 dark:text-gray-300">Toca el botón <strong>Compartir</strong> <svg class="w-5 h-5 inline text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/></svg></p>
                    </div>
                    <div class="flex items-center gap-4">
                        <div class="w-10 h-10 bg-gray-100 dark:bg-white/5 rounded-full flex items-center justify-center text-red-600 font-bold">2</div>
                        <p class="text-sm text-gray-700 dark:text-gray-300">Desliza hacia abajo y toca en <strong>"Agregar a pantalla de inicio"</strong></p>
                    </div>
                    <div class="flex items-center gap-4">
                        <div class="w-10 h-10 bg-gray-100 dark:bg-white/5 rounded-full flex items-center justify-center text-red-600 font-bold">3</div>
                        <p class="text-sm text-gray-700 dark:text-gray-300">Toca <strong>"Agregar"</strong> en la esquina superior derecha</p>
                    </div>
                </div>

                <button id="pwa-ios-close" class="w-full py-4 bg-gray-100 dark:bg-white/5 text-gray-900 dark:text-white font-bold rounded-2xl hover:bg-gray-200 dark:hover:bg-white/10 transition-colors">
                    ENTENDIDO
                </button>
            </div>
        `;
        document.body.appendChild(modal);
        document.getElementById('pwa-ios-close').addEventListener('click', () => {
            modal.remove();
            localStorage.setItem('pwa_closed_banner', 'true');
        });
    },

    async installAndroid() {
        if (!this.deferredPrompt) return;
        this.deferredPrompt.prompt();
        const { outcome } = await this.deferredPrompt.userChoice;
        console.log(`PWA: Usuario eligió ${outcome}`);
        this.deferredPrompt = null;
        this.hideInstallUI();
    },

    closeBanner() {
        this.hideInstallUI();
        localStorage.setItem('pwa_closed_banner', 'true');
    },

    hideInstallUI() {
        const banner = document.getElementById('pwa-install-banner');
        if (banner) {
            banner.classList.add('animate-slide-down');
            setTimeout(() => banner.remove(), 500);
        }
    }
};

// Estilos extra para animaciones
const style = document.createElement('style');
style.textContent = `
    @keyframes bounce-in {
        0% { transform: translateY(100px); opacity: 0; }
        60% { transform: translateY(-10px); opacity: 1; }
        100% { transform: translateY(0); }
    }
    @keyframes fade-in {
        from { opacity: 0; }
        to { opacity: 1; }
    }
    @keyframes slide-up {
        from { transform: translateY(100%); }
        to { transform: translateY(0); }
    }
    @keyframes slide-down {
        from { transform: translateY(0); opacity: 1; }
        to { transform: translateY(100px); opacity: 0; }
    }
    .animate-bounce-in { animation: bounce-in 0.6s cubic-bezier(0.34, 1.56, 0.64, 1); }
    .animate-fade-in { animation: fade-in 0.3s ease-out; }
    .animate-slide-up { animation: slide-up 0.4s cubic-bezier(0.16, 1, 0.3, 1); }
    .animate-slide-down { animation: slide-down 0.3s ease-in forwards; }
`;
document.head.appendChild(style);

// Auto-inicializar
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => PWAManager.init());
} else {
    PWAManager.init();
}
