-- Script: Tablas adicionales para TurnoRD (servicios y cierres de caja)
-- Script: Esquema de Base de Datos para TurnoRD
-- Ejecutar en el SQL Editor de Supabase

BEGIN;

-- ==============================================================================
-- 0) Funciones de Utilidad (Shared Functions)
-- ==============================================================================

-- Función para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION public.set_timestamp_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ==============================================================================
-- 0.5) Tabla: turnos
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.turnos (
  id BIGSERIAL PRIMARY KEY,
  negocio_id TEXT NOT NULL,
  turno TEXT NOT NULL,
  nombre TEXT NOT NULL,
  telefono TEXT,
  servicio TEXT,
  estado TEXT NOT NULL DEFAULT 'En espera',
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  hora TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'HH24:MI'),
  monto_cobrado NUMERIC DEFAULT 0,
  metodo_pago TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_set_timestamp_updated_at_turnos ON public.turnos;
CREATE TRIGGER trg_set_timestamp_updated_at_turnos
BEFORE UPDATE ON public.turnos
FOR EACH ROW EXECUTE FUNCTION public.set_timestamp_updated_at();

-- ==============================================================================
-- 1) Tabla: servicios
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.servicios (
  id BIGSERIAL PRIMARY KEY,
  negocio_id TEXT NOT NULL,
  nombre TEXT NOT NULL,
  duracion_min INTEGER NOT NULL DEFAULT 25,
  precio NUMERIC NOT NULL DEFAULT 0,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ux_servicios_neg_nombre UNIQUE (negocio_id, nombre)
);

CREATE INDEX IF NOT EXISTS idx_servicios_neg_activo ON public.servicios(negocio_id, activo);

DROP TRIGGER IF EXISTS trg_set_timestamp_updated_at_servicios ON public.servicios;
CREATE TRIGGER trg_set_timestamp_updated_at_servicios
BEFORE UPDATE ON public.servicios
FOR EACH ROW EXECUTE FUNCTION public.set_timestamp_updated_at();

-- Semillas opcionales
INSERT INTO public.servicios (negocio_id, nombre, duracion_min, precio, activo)
VALUES
  ('barberia0001', 'Barbería', 30, 0, TRUE),
  ('barberia0001', 'Corte de cabello', 20, 0, TRUE),
  ('barberia0001', 'Afeitado', 15, 0, TRUE),
  ('barberia0001', 'Tratamiento facial', 40, 0, TRUE)
ON CONFLICT (negocio_id, nombre) DO NOTHING;

-- ==============================================================================
-- 2) Tabla: cierres_caja
-- ==============================================================================
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

-- ==============================================================================
-- 3) Tabla: negocio_config
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.configuracion_negocio (
    id SERIAL PRIMARY KEY,
    negocio_id VARCHAR(50) NOT NULL,
    nombre TEXT,
    direccion TEXT,
    telefono TEXT,
    email TEXT,
    hora_apertura TEXT DEFAULT '09:00',
    hora_cierre TEXT DEFAULT '18:00',
    limite_turnos INTEGER DEFAULT 50,
    dias_operacion JSONB DEFAULT '["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"]'::jsonb,
    mostrar_tiempo_estimado BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (negocio_id)
);

CREATE INDEX IF NOT EXISTS idx_configuracion_negocio_negocio_id ON public.configuracion_negocio(negocio_id);

DROP TRIGGER IF EXISTS set_timestamp_updated_at_configuracion_negocio ON public.configuracion_negocio;
CREATE TRIGGER set_timestamp_updated_at_configuracion_negocio
BEFORE UPDATE ON public.configuracion_negocio
FOR EACH ROW EXECUTE FUNCTION public.set_timestamp_updated_at();

INSERT INTO public.configuracion_negocio (negocio_id, nombre)
VALUES ('barberia0001', 'Barbería 0001')
ON CONFLICT (negocio_id) DO NOTHING;

COMMENT ON TABLE public.configuracion_negocio IS 'Tabla de configuración 1:1 por negocio (datos estáticos y opciones)';

-- ==============================================================================
-- 3.1) Tabla: estado_negocio
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.estado_negocio (
    id BIGSERIAL PRIMARY KEY,
    negocio_id TEXT NOT NULL UNIQUE,
    en_break BOOLEAN DEFAULT FALSE,
    break_start_time TIMESTAMPTZ,
    break_end_time TIMESTAMPTZ,
    break_message TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_estado_negocio_negocio_id ON public.estado_negocio(negocio_id);

DROP TRIGGER IF EXISTS trg_set_timestamp_updated_at_estado_negocio ON public.estado_negocio;
CREATE TRIGGER trg_set_timestamp_updated_at_estado_negocio
BEFORE UPDATE ON public.estado_negocio
FOR EACH ROW EXECUTE FUNCTION public.set_timestamp_updated_at();

-- ==============================================================================
-- 4) Tabla: comentarios
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.comentarios (
  id BIGSERIAL PRIMARY KEY,
  negocio_id TEXT NOT NULL,
  turno_id BIGINT REFERENCES public.turnos(id) ON DELETE SET NULL,
  nombre_cliente TEXT,
  telefono_cliente TEXT,
  comentario TEXT,
  calificacion INT CHECK (calificacion >= 1 AND calificacion <= 5),
  sentimiento_score NUMERIC(4, 2) DEFAULT 0.00,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comentarios_negocio_id ON public.comentarios(negocio_id);
CREATE INDEX IF NOT EXISTS idx_comentarios_turno_id ON public.comentarios(turno_id);

-- ==============================================================================
-- 5) Tabla: push_subscriptions
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    user_id TEXT NOT NULL,
    subscription JSONB NOT NULL,
    negocio_id VARCHAR(255) NOT NULL
);

COMMENT ON TABLE push_subscriptions IS 'Almacena las suscripciones de notificaciones push de los usuarios para un negocio específico.';

ALTER TABLE public.push_subscriptions DROP CONSTRAINT IF EXISTS push_subscriptions_user_id_key;
ALTER TABLE public.push_subscriptions ADD CONSTRAINT ux_push_subscriptions_user_negocio UNIQUE (user_id, negocio_id);

-- ==============================================================================
-- 6) Modificaciones a Tabla: turnos
-- ==============================================================================
ALTER TABLE public.turnos
  ADD COLUMN IF NOT EXISTS orden INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;

-- Inicializar 'orden' para registros existentes
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY negocio_id, fecha ORDER BY created_at ASC NULLS LAST) AS rn
  FROM public.turnos
)
UPDATE public.turnos t
SET orden = r.rn
FROM ranked r
WHERE r.id = t.id
  AND (t.orden IS NULL OR t.orden = 0);

-- Índices para turnos
CREATE INDEX IF NOT EXISTS idx_turnos_negocio_estado_orden ON public.turnos(negocio_id, estado, orden);
CREATE INDEX IF NOT EXISTS idx_turnos_negocio_fecha ON public.turnos(negocio_id, fecha);
CREATE UNIQUE INDEX IF NOT EXISTS ux_turnos_neg_fecha_turno ON public.turnos(negocio_id, fecha, turno);
CREATE UNIQUE INDEX IF NOT EXISTS ux_turnos_tel_dia_activos ON public.turnos(negocio_id, fecha, telefono)
  WHERE estado IN ('En espera','En atención');

-- Trigger para orden en turnos
CREATE OR REPLACE FUNCTION public.set_turno_orden() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.orden IS NULL OR NEW.orden = 0 THEN
    SELECT COALESCE(MAX(orden), 0) + 1 INTO NEW.orden
    FROM public.turnos
    WHERE negocio_id = NEW.negocio_id
      AND fecha = NEW.fecha;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_turno_orden ON public.turnos;
CREATE TRIGGER trg_set_turno_orden
BEFORE INSERT ON public.turnos
FOR EACH ROW EXECUTE FUNCTION public.set_turno_orden();

-- ==============================================================================
-- 7) Seguridad (RLS Policies)
-- ==============================================================================

-- Habilitar RLS
ALTER TABLE public.servicios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cierres_caja ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.configuracion_negocio ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estado_negocio ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comentarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.turnos ENABLE ROW LEVEL SECURITY;

-- --- Políticas Servicios ---
DROP POLICY IF EXISTS servicios_select ON public.servicios;
CREATE POLICY servicios_select ON public.servicios FOR SELECT USING (true);

DROP POLICY IF EXISTS servicios_insert ON public.servicios;
CREATE POLICY servicios_insert ON public.servicios FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS servicios_update ON public.servicios;
CREATE POLICY servicios_update ON public.servicios FOR UPDATE USING (true) WITH CHECK (true);

-- --- Políticas Cierres Caja ---
DROP POLICY IF EXISTS cierres_select ON public.cierres_caja;
CREATE POLICY cierres_select ON public.cierres_caja FOR SELECT USING (true);

DROP POLICY IF EXISTS cierres_insert ON public.cierres_caja;
CREATE POLICY cierres_insert ON public.cierres_caja FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS cierres_update ON public.cierres_caja;
CREATE POLICY cierres_update ON public.cierres_caja FOR UPDATE USING (true) WITH CHECK (true);

-- --- Políticas Configuracion Negocio ---
DROP POLICY IF EXISTS "Enable all operations for configuracion_negocio" ON public.configuracion_negocio;
CREATE POLICY "Enable all operations for configuracion_negocio" ON public.configuracion_negocio
    FOR ALL USING (true) WITH CHECK (true);

-- --- Políticas Estado Negocio ---
DROP POLICY IF EXISTS "Enable all operations for estado_negocio" ON public.estado_negocio;
CREATE POLICY "Enable all operations for estado_negocio" ON public.estado_negocio
    FOR ALL USING (true) WITH CHECK (true);

-- --- Políticas Comentarios ---
DROP POLICY IF EXISTS "Permitir acceso de lectura a todos" ON public.comentarios;
CREATE POLICY "Permitir acceso de lectura a todos" ON public.comentarios FOR SELECT USING (true);

DROP POLICY IF EXISTS "Permitir inserción a todos" ON public.comentarios;
CREATE POLICY "Permitir inserción a todos" ON public.comentarios FOR INSERT WITH CHECK (true);

-- --- Políticas Push Subscriptions ---
DROP POLICY IF EXISTS "Public-insert" ON public.push_subscriptions;
CREATE POLICY "Public-insert" ON public.push_subscriptions FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "Public-update" ON public.push_subscriptions;
CREATE POLICY "Public-update" ON public.push_subscriptions FOR UPDATE USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Public-select" ON public.push_subscriptions;
CREATE POLICY "Public-select" ON public.push_subscriptions FOR SELECT USING (true);

-- --- Políticas Turnos ---
DROP POLICY IF EXISTS turnos_select ON public.turnos;
CREATE POLICY turnos_select ON public.turnos FOR SELECT USING (true);

DROP POLICY IF EXISTS turnos_insert ON public.turnos;
CREATE POLICY turnos_insert ON public.turnos FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS turnos_update ON public.turnos;
CREATE POLICY turnos_update ON public.turnos FOR UPDATE USING (true) WITH CHECK (true);

-- ==============================================================================
-- 8) Funciones RPC (Remote Procedure Calls)
-- ==============================================================================

-- Función para reordenar turnos masivamente de forma atómica
CREATE OR REPLACE FUNCTION public.reordenar_turnos(updates jsonb)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  item jsonb;
BEGIN
  FOR item IN SELECT * FROM jsonb_array_elements(updates)
  LOOP
    UPDATE public.turnos
    SET orden = (item->>'orden')::int
    WHERE id = (item->>'id')::bigint;
  END LOOP;
END;
$$;

COMMIT;
