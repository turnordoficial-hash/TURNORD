window.tailwind = window.tailwind || {};
window.tailwind.config = {
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Outfit', 'sans-serif'],
        display: ['Playfair Display', 'serif']
      },
      colors: {
        barberRed: '#C1121F',
        barberBlue: '#003049',
        gold: '#D4AF37',
        dark: { 900: '#0b0b0c', 800: '#141416', 700: '#1e1f22' }
      },
      boxShadow: {
        soft: '0 8px 30px rgba(0,0,0,0.08)'
      }
    }
  }
};

