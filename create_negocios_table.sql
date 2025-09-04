-- Crear la tabla para almacenar los negocios
CREATE TABLE IF NOT EXISTS negocios (
    id VARCHAR(50) PRIMARY KEY,
    nombre VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insertar el negocio principal si no existe
INSERT INTO negocios (id, nombre)
VALUES ('barberia005', 'Barbería Principal')
ON CONFLICT (id) DO NOTHING;

-- Insertar o actualizar la configuración para el negocio principal
-- Esto mueve la configuración de config.js a la base de datos
INSERT INTO configuracion_negocio (negocio_id, hora_apertura, hora_cierre, limite_turnos, hora_limite_turnos)
VALUES ('barberia005', '08:00', '23:00', 50, '23:00')
ON CONFLICT (negocio_id) DO UPDATE SET
    hora_apertura = EXCLUDED.hora_apertura,
    hora_cierre = EXCLUDED.hora_cierre,
    limite_turnos = EXCLUDED.limite_turnos,
    hora_limite_turnos = EXCLUDED.hora_limite_turnos;
