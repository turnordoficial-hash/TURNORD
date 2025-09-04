-- Script: Tablas adicionales para TurnoRD (servicios y cierres de caja)
-- Ejecutar en el SQL Editor de Supabase

BEGIN;

-- =============================
-- 1) Catálogo de servicios
-- =============================
CREATE TABLE IF NOT EXISTS public.servicios (
  id BIGSERIAL PRIMARY KEY,
  negocio_id TEXT NOT NULL,
  nombre TEXT NOT NULL,
  duracion_min INTEGER NOT NULL DEFAULT 25,   -- duración estimada en minutos
  precio NUMERIC NOT NULL DEFAULT 0,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ux_servicios_neg_nombre UNIQUE (negocio_id, nombre)
);

CREATE INDEX IF NOT EXISTS idx_servicios_neg_activo ON public.servicios(negocio_id, activo);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.set_timestamp_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_timestamp_updated_at_servicios ON public.servicios;
CREATE TRIGGER trg_set_timestamp_updated_at_servicios
BEFORE UPDATE ON public.servicios
FOR EACH ROW EXECUTE FUNCTION public.set_timestamp_updated_at();

-- RLS básica (ajusta por roles reales)
ALTER TABLE public.servicios ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='servicios' AND policyname='servicios_select') THEN
    EXECUTE 'DROP POLICY servicios_select ON public.servicios';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='servicios' AND policyname='servicios_insert') THEN
    EXECUTE 'DROP POLICY servicios_insert ON public.servicios';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='servicios' AND policyname='servicios_update') THEN
    EXECUTE 'DROP POLICY servicios_update ON public.servicios';
  END IF;
END $$;

CREATE POLICY servicios_select ON public.servicios
  FOR SELECT USING (true);

CREATE POLICY servicios_insert ON public.servicios
  FOR INSERT WITH CHECK (true);

CREATE POLICY servicios_update ON public.servicios
  FOR UPDATE USING (true) WITH CHECK (true);

-- Semillas opcionales
INSERT INTO public.servicios (negocio_id, nombre, duracion_min, precio, activo)
VALUES
  ('barberia0001', 'Barbería', 30, 0, TRUE),
  ('barberia0001', 'Corte de cabello', 20, 0, TRUE),
  ('barberia0001', 'Afeitado', 15, 0, TRUE),
  ('barberia0001', 'Tratamiento facial', 40, 0, TRUE)
ON CONFLICT (negocio_id, nombre) DO NOTHING;

-- =============================
-- 2) Cierres de caja diarios
-- =============================
CREATE TABLE IF NOT EXISTS public.cierres_caja (
  id BIGSERIAL PRIMARY KEY,
  negocio_id TEXT NOT NULL,
  fecha DATE NOT NULL,
  cerrado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  total_turnos INTEGER NOT NULL DEFAULT 0,
  total_en_espera INTEGER NOT NULL DEFAULT 0,
  total_en_atencion INTEGER NOT NULL DEFAULT 0,
  total_atendidos INTEGER NOT NULL DEFAULT 0,
  total_cancelados INTEGER NOT NULL DEFAULT 0,
  total_no_presentado INTEGER NOT NULL DEFAULT 0,
  ingresos_total NUMERIC NOT NULL DEFAULT 0,
  observaciones TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ux_cierres_neg_fecha UNIQUE (negocio_id, fecha)
);

CREATE INDEX IF NOT EXISTS idx_cierres_neg_fecha ON public.cierres_caja(negocio_id, fecha);

DROP TRIGGER IF EXISTS trg_set_timestamp_updated_at_cierres ON public.cierres_caja;
CREATE TRIGGER trg_set_timestamp_updated_at_cierres
BEFORE UPDATE ON public.cierres_caja
FOR EACH ROW EXECUTE FUNCTION public.set_timestamp_updated_at();

ALTER TABLE public.cierres_caja ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='cierres_caja' AND policyname='cierres_select') THEN
    EXECUTE 'DROP POLICY cierres_select ON public.cierres_caja';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='cierres_caja' AND policyname='cierres_insert') THEN
    EXECUTE 'DROP POLICY cierres_insert ON public.cierres_caja';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='cierres_caja' AND policyname='cierres_update') THEN
    EXECUTE 'DROP POLICY cierres_update ON public.cierres_caja';
  END IF;
END $$;

CREATE POLICY cierres_select ON public.cierres_caja
  FOR SELECT USING (true);

CREATE POLICY cierres_insert ON public.cierres_caja
  FOR INSERT WITH CHECK (true);

CREATE POLICY cierres_update ON public.cierres_caja
  FOR UPDATE USING (true) WITH CHECK (true);

COMMIT;

-- =============================
-- Notas de uso
-- =============================
-- servicios: permite administrar tiempos y precios de servicios para mejorar ETA y reportes.
-- cierres_caja: registra el cierre diario por negocio (bloquea cifras del día, útil para cierre.html).
-- Para calcular los totales de cierres, puedes:
--   1) Consultar sobre la tabla turnos por negocio_id y fecha (sum y count),
--   2) Insertar el resultado en cierres_caja al finalizar el día.
-- Ajusta las políticas RLS según tus roles reales para producción.
