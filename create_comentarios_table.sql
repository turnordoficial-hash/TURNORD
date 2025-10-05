-- Script: Tabla de comentarios y sentimiento para TurnoRD
-- Ejecutar en el SQL Editor de Supabase

BEGIN;

-- =============================
-- 1) Tabla de Comentarios
-- =============================
CREATE TABLE IF NOT EXISTS public.comentarios (
  id BIGSERIAL PRIMARY KEY,
  negocio_id TEXT NOT NULL,
  turno_id BIGINT REFERENCES public.turnos(id) ON DELETE SET NULL,
  nombre_cliente TEXT,
  telefono_cliente TEXT,
  comentario TEXT,
  calificacion INT CHECK (calificacion >= 1 AND calificacion <= 5),
  sentimiento_score NUMERIC(4, 2) DEFAULT 0.00, -- Rango de -1 (negativo) a 1 (positivo)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comentarios_negocio_id ON public.comentarios(negocio_id);
CREATE INDEX IF NOT EXISTS idx_comentarios_turno_id ON public.comentarios(turno_id);

-- RLS
ALTER TABLE public.comentarios ENABLE ROW LEVEL SECURITY;

-- Políticas de seguridad
DROP POLICY IF EXISTS "Permitir acceso de lectura a todos" ON public.comentarios;
CREATE POLICY "Permitir acceso de lectura a todos"
ON public.comentarios
FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Permitir inserción a todos" ON public.comentarios;
CREATE POLICY "Permitir inserción a todos"
ON public.comentarios
FOR INSERT
WITH CHECK (true);

COMMIT;
