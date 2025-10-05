-- Migración para fortalecer el sistema de turnos (una sola silla)
-- Ejecutar en Supabase SQL Editor

-- 1) Nuevas columnas
ALTER TABLE turnos
  ADD COLUMN IF NOT EXISTS orden INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;

-- 2) Inicializar 'orden' para registros existentes por negocio/día según created_at
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY negocio_id, fecha ORDER BY created_at ASC NULLS LAST) AS rn
  FROM turnos
)
UPDATE turnos t
SET orden = r.rn
FROM ranked r
WHERE r.id = t.id
  AND (t.orden IS NULL OR t.orden = 0);

-- 3) Índices y unicidades útiles
CREATE INDEX IF NOT EXISTS idx_turnos_negocio_estado_orden ON turnos(negocio_id, estado, orden);
CREATE INDEX IF NOT EXISTS idx_turnos_negocio_fecha ON turnos(negocio_id, fecha);
-- Unicidad por día para el código de turno
CREATE UNIQUE INDEX IF NOT EXISTS ux_turnos_neg_fecha_turno ON turnos(negocio_id, fecha, turno);
-- Evitar duplicados activos por teléfono el mismo día (en espera o en atención)
CREATE UNIQUE INDEX IF NOT EXISTS ux_turnos_tel_dia_activos ON turnos(negocio_id, fecha, telefono)
  WHERE estado IN ('En espera','En atención');

-- 4) Trigger para asignar orden automáticamente antes de insertar
CREATE OR REPLACE FUNCTION set_turno_orden() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.orden IS NULL OR NEW.orden = 0 THEN
    SELECT COALESCE(MAX(orden), 0) + 1 INTO NEW.orden
    FROM turnos
    WHERE negocio_id = NEW.negocio_id
      AND fecha = NEW.fecha;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_turno_orden ON turnos;
CREATE TRIGGER trg_set_turno_orden
BEFORE INSERT ON turnos
FOR EACH ROW EXECUTE FUNCTION set_turno_orden();

-- 5) (Opcional) Normalizar estados anteriores
-- Si tienes filas antiguas con estado 'Devuelto', puedes mapearlas a 'En espera' según tu flujo actual
-- UPDATE turnos SET estado = 'En espera' WHERE estado = 'Devuelto';

-- Fin de migración
