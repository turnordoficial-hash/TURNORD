// build.js - Script de construcción segura
const fs = require('fs');
const path = require('path');
const { minify } = require('terser');
const JavaScriptObfuscator = require('javascript-obfuscator');

async function buildProduction() {
  const files = [
    'database.js',
    'config.js',
    'admin/negocio.js',
    'admin/turno.js',
    'usuario/usuario.js'
  ];
  
  for (const file of files) {
    const inputPath = path.join(__dirname, file);
    const outputPath = path.join(__dirname, 'dist', file);
    
    if (fs.existsSync(inputPath)) {
      const code = fs.readFileSync(inputPath, 'utf8');
      
      // Minificar
      const minified = await minify(code, {
        compress: true,
        mangle: true
      });
      
      // Ofuscar
      const obfuscated = JavaScriptObfuscator.obfuscate(minified.code, {
        compact: true,
        controlFlowFlattening: true,
        deadCodeInjection: true,
        stringArray: true,
        rotateStringArray: true
      });
      
      // Crear directorio si no existe
      const outputDir = path.dirname(outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      
      fs.writeFileSync(outputPath, obfuscated.getObfuscatedCode());
      console.log(`✅ Procesado: ${file}`);
    }
  }
}

buildProduction().catch(console.error);