function registrarIngreso() {
  const hoy = new Date();
  const fecha = hoy.toISOString().split('T')[0]; // formato YYYY-MM-DD

  let historial = JSON.parse(localStorage.getItem('historialIngresos')) || {};
  
  if (!historial[fecha]) {
    historial[fecha] = 0;
  }

  historial[fecha] += 1;

  localStorage.setItem('historialIngresos', JSON.stringify(historial));
}
