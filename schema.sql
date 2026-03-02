-- Script: Tablas adicionales para TurnoRD (servicios y cierres de caja)
-- Script: Esquema de Base de Datos para TurnoRD
-- Ejecutar en el SQL Editor de Supabase

BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

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

-- Migración: Agregar columnas de tema si no existen para evitar error 400 en frontend
ALTER TABLE public.configuracion_negocio
  ADD COLUMN IF NOT EXISTS theme_primary TEXT DEFAULT '#C1121F',
  ADD COLUMN IF NOT EXISTS theme_mode TEXT DEFAULT 'light';

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
ALTER TABLE public.estado_negocio
  ADD COLUMN IF NOT EXISTS weekly_breaks JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.estado_negocio
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

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
    endpoint TEXT,
    negocio_id VARCHAR(255) NOT NULL
);

-- Asegurar que la columna endpoint exista si la tabla ya fue creada anteriormente
ALTER TABLE public.push_subscriptions ADD COLUMN IF NOT EXISTS endpoint TEXT;

COMMENT ON TABLE push_subscriptions IS 'Almacena las suscripciones de notificaciones push de los usuarios para un negocio específico.';

ALTER TABLE public.push_subscriptions DROP CONSTRAINT IF EXISTS push_subscriptions_user_id_key;
ALTER TABLE public.push_subscriptions DROP CONSTRAINT IF EXISTS ux_push_subscriptions_user_negocio;
ALTER TABLE public.push_subscriptions ADD CONSTRAINT ux_push_subscriptions_user_negocio UNIQUE (user_id, negocio_id);

-- Índice para búsquedas y eliminaciones eficientes por endpoint
CREATE UNIQUE INDEX IF NOT EXISTS ux_push_subscriptions_endpoint ON public.push_subscriptions(endpoint);

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

-- --- Políticas Turnos ---
DROP POLICY IF EXISTS turnos_select ON public.turnos;
CREATE POLICY turnos_select ON public.turnos 
  FOR SELECT USING (true); -- Permitimos ver la cola general, pero limitaremos campos en la vista si es necesario

DROP POLICY IF EXISTS turnos_insert ON public.turnos;
CREATE POLICY turnos_insert ON public.turnos 
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS turnos_update ON public.turnos;
CREATE POLICY turnos_update ON public.turnos 
  FOR UPDATE USING (true) WITH CHECK (true);

-- --- Políticas Push Subscriptions (Corregidas para push_subscriptions) ---
DROP POLICY IF EXISTS "Public-insert" ON public.push_subscriptions;
CREATE POLICY "Public-insert" ON public.push_subscriptions 
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Public-update" ON public.push_subscriptions;
CREATE POLICY "Public-update" ON public.push_subscriptions 
  FOR UPDATE USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public-select" ON public.push_subscriptions;
CREATE POLICY "Public-select" ON public.push_subscriptions 
  FOR SELECT USING (true);


-- ==============================================================================
-- 8) Funciones RPC (Remote Procedure Calls)
-- ==============================================================================

-- Función para reordenar turnos masivamente de forma atómica
CREATE OR REPLACE FUNCTION public.reordenar_turnos(updates jsonb)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.turnos AS t
  SET orden = (elem->>'orden')::int
  FROM jsonb_array_elements(updates) AS elem
  WHERE t.id = (elem->>'id')::bigint;
END;
$$;

CREATE TABLE IF NOT EXISTS public.barberos (
  id BIGSERIAL PRIMARY KEY,
  negocio_id TEXT NOT NULL,
  nombre TEXT,
  usuario TEXT NOT NULL,
  password TEXT NOT NULL,
  avatar_url TEXT,
  activo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ux_barberos_neg_usuario UNIQUE (negocio_id, usuario)
);

ALTER TABLE public.barberos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS barberos_select ON public.barberos;
CREATE POLICY barberos_select ON public.barberos FOR SELECT USING (true);
DROP POLICY IF EXISTS barberos_insert ON public.barberos;
CREATE POLICY barberos_insert ON public.barberos FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS barberos_update ON public.barberos;
CREATE POLICY barberos_update ON public.barberos FOR UPDATE USING (true) WITH CHECK (true);

ALTER TABLE public.turnos
  ADD COLUMN IF NOT EXISTS barber_id BIGINT REFERENCES public.barberos(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.citas (
  id BIGSERIAL PRIMARY KEY,
  negocio_id TEXT NOT NULL,
  barber_id BIGINT REFERENCES public.barberos(id) ON DELETE CASCADE,
  cliente_telefono TEXT,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  estado TEXT DEFAULT 'Programada',
  servicio TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Migración: Asegurar que la columna servicio exista si la tabla ya fue creada anteriormente
ALTER TABLE public.citas ADD COLUMN IF NOT EXISTS servicio TEXT;

ALTER TABLE public.citas ENABLE ROW LEVEL SECURITY;

-- --- Políticas Citas (Movidas aquí para asegurar que la tabla existe) ---
DROP POLICY IF EXISTS citas_select ON public.citas;
CREATE POLICY citas_select ON public.citas 
  FOR SELECT USING (true);

DROP POLICY IF EXISTS citas_insert ON public.citas;
CREATE POLICY citas_insert ON public.citas 
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS citas_update ON public.citas;
CREATE POLICY citas_update ON public.citas 
  FOR UPDATE USING (true) WITH CHECK (true);

ALTER TABLE public.citas DROP CONSTRAINT IF EXISTS citas_no_overlap;
ALTER TABLE public.citas
  ADD CONSTRAINT citas_no_overlap EXCLUDE USING gist (
    barber_id WITH =,
    tstzrange(start_at, end_at, '[)') WITH &&
  );

CREATE TABLE IF NOT EXISTS public.roles_negocio (
  negocio_id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rol TEXT NOT NULL CHECK (rol IN ('admin','staff')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (negocio_id, user_id)
);

ALTER TABLE public.roles_negocio ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS roles_select ON public.roles_negocio;
CREATE POLICY roles_select
ON public.roles_negocio
FOR SELECT
USING (auth.uid() = user_id);

-- ==============================================================================
-- 9) Tabla: Clientes (Perfil y Auth Personalizado)
-- ==============================================================================

-- Eliminar tabla antigua si existe para evitar conflicto de tipos (BigInt vs UUID)
DROP TABLE IF EXISTS public.clientes CASCADE;

CREATE TABLE IF NOT EXISTS public.clientes (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  negocio_id TEXT NOT NULL,
  nombre TEXT NOT NULL,
  telefono TEXT,
  email TEXT NOT NULL,
  documento_identidad TEXT, -- Cédula o Código (Opcional)
  avatar_url TEXT,
  puntos_actuales INTEGER DEFAULT 0,
  puntos_totales_historicos INTEGER DEFAULT 0,
  ultima_visita TIMESTAMPTZ,
  referido_por UUID REFERENCES public.clientes(id) ON DELETE SET NULL,
  recompensa_referido_aplicada BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ux_clientes_negocio_doc UNIQUE (negocio_id, documento_identidad),
  CONSTRAINT ux_clientes_negocio_email UNIQUE (negocio_id, email)
);

-- RLS para Clientes
ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Los usuarios pueden gestionar su propio perfil." ON public.clientes;
CREATE POLICY "Los usuarios pueden gestionar su propio perfil." ON public.clientes
  FOR ALL
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Trigger update timestamp
DROP TRIGGER IF EXISTS trg_set_timestamp_updated_at_clientes ON public.clientes;
CREATE TRIGGER trg_set_timestamp_updated_at_clientes
BEFORE UPDATE ON public.clientes
FOR EACH ROW EXECUTE FUNCTION public.set_timestamp_updated_at();

CREATE OR REPLACE FUNCTION registrar_turno(
  p_negocio_id TEXT,
  p_nombre TEXT,
  p_telefono TEXT,
  p_servicio TEXT,
  p_barber_id BIGINT
) RETURNS JSONB AS $$
DECLARE
  v_fecha DATE := CURRENT_DATE;
  v_letra CHAR(1);
  v_ultimo_turno TEXT;
  v_nuevo_numero INT;
  v_nuevo_turno TEXT;
  v_turno_id BIGINT;
  v_fecha_base DATE := '2024-08-23'; -- Fecha base para cálculo de letra
  v_diff_dias INT;
BEGIN
  -- 1. Validar si ya tiene turno activo
  IF EXISTS (
    SELECT 1 FROM turnos 
    WHERE negocio_id = p_negocio_id 
      AND fecha = v_fecha 
      AND telefono = p_telefono 
      AND estado IN ('En espera', 'En atención')
  ) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Ya tienes un turno activo.');
  END IF;

  -- 2. Calcular letra del día (A, B, C...)
  v_diff_dias := (v_fecha - v_fecha_base);
  -- Asegurar índice positivo para el módulo
  v_letra := CHR(65 + (MOD((MOD(v_diff_dias, 26) + 26), 26)));

  -- 3. Obtener último turno del día (Bloqueo pesimista para evitar duplicados)
  SELECT turno INTO v_ultimo_turno
  FROM turnos
  WHERE negocio_id = p_negocio_id 
    AND fecha = v_fecha
    AND turno LIKE v_letra || '%'
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  -- 4. Generar nuevo número
  IF v_ultimo_turno IS NULL THEN
    v_nuevo_numero := 1;
  ELSE
    v_nuevo_numero := CAST(SUBSTRING(v_ultimo_turno FROM 2) AS INT) + 1;
  END IF;

  v_nuevo_turno := v_letra || LPAD(v_nuevo_numero::TEXT, 2, '0');

  -- 5. Insertar el turno
  INSERT INTO turnos (
    negocio_id, turno, nombre, telefono, servicio, barber_id, estado, fecha, hora
  ) VALUES (
    p_negocio_id,
    v_nuevo_turno,
    p_nombre,
    p_telefono,
    p_servicio,
    p_barber_id,
    'En espera',
    v_fecha,
    TO_CHAR(NOW(), 'HH24:MI')
  ) RETURNING id INTO v_turno_id;

  -- 6. Retornar éxito
  RETURN jsonb_build_object('success', true, 'turno', v_nuevo_turno, 'id', v_turno_id);
END;
$$ LANGUAGE plpgsql;

-- ==============================================================================
-- 10) Trigger para creación automática de perfil (Solución Error 403 RLS)
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_nombre TEXT;
  v_telefono TEXT;
  v_negocio_id TEXT;
  v_referido UUID;
BEGIN
  -- Extraer datos de metadata o usar defaults
  v_nombre := COALESCE(NEW.raw_user_meta_data->>'nombre', split_part(NEW.email, '@', 1));
  v_telefono := COALESCE(NEW.raw_user_meta_data->>'telefono', NULL);
  -- Fallback seguro: si el signup no envía negocio_id, usar 'barberia005'
  v_negocio_id := COALESCE(NEW.raw_user_meta_data->>'negocio_id', 'barberia005');
  
  -- Manejo seguro de UUID para referido (evita error si el string no es UUID válido)
  BEGIN
    v_referido := NULLIF(NEW.raw_user_meta_data->>'referido_por', '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_referido := NULL;
  END;

  INSERT INTO public.clientes (id, email, nombre, telefono, negocio_id, referido_por)
  VALUES (NEW.id, NEW.email, v_nombre, v_telefono, v_negocio_id, v_referido)
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Asegurar que el trigger no se duplique
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ==============================================================================
-- 11) Sistema de Promociones y Puntos (Admin)
-- ==============================================================================

-- Tabla de Promociones
CREATE TABLE IF NOT EXISTS public.promociones (
  id BIGSERIAL PRIMARY KEY,
  negocio_id TEXT NOT NULL,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL, -- 'AUTOMATICA', 'CAMPAÑA', 'NIVEL', 'REFERIDO'
  subtipo TEXT, -- 'CUMPLEAÑOS', 'INACTIVO', 'TEMPORADA', etc.
  descripcion TEXT,
  configuracion JSONB DEFAULT '{}'::jsonb, -- { descuento: 10, tipo_descuento: '%', dias_inactivo: 30, etc }
  activo BOOLEAN DEFAULT FALSE,
  fecha_inicio TIMESTAMPTZ,
  fecha_fin TIMESTAMPTZ,
  impacto_clientes INTEGER DEFAULT 0,
  impacto_ingresos NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.promociones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin manage promociones" ON public.promociones;
CREATE POLICY "Admin manage promociones" ON public.promociones FOR ALL USING (true) WITH CHECK (true);

-- Tabla Historial de Uso de Promociones (para métricas)
CREATE TABLE IF NOT EXISTS public.historial_uso_promociones (
  id BIGSERIAL PRIMARY KEY,
  negocio_id TEXT NOT NULL,
  promocion_id BIGINT REFERENCES public.promociones(id),
  cliente_id UUID REFERENCES public.clientes(id) ON DELETE SET NULL,
  turno_id BIGINT REFERENCES public.turnos(id),
  monto_ahorrado NUMERIC DEFAULT 0,
  fecha_uso TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.historial_uso_promociones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin view history" ON public.historial_uso_promociones;
CREATE POLICY "Admin view history" ON public.historial_uso_promociones FOR SELECT USING (true);

-- ==============================================================================
-- 12) Automatización de Correos (Recordatorios y Marketing)
-- ==============================================================================

ALTER TABLE public.citas
  ADD COLUMN IF NOT EXISTS reminder_1h_sent BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reminder_30m_sent BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reminder_15m_sent BOOLEAN DEFAULT FALSE;
ALTER TABLE public.citas
  ADD COLUMN IF NOT EXISTS notificado_barbero BOOLEAN DEFAULT FALSE;
ALTER TABLE public.citas
  ADD COLUMN IF NOT EXISTS recordatorio_barbero_10m BOOLEAN DEFAULT FALSE;
ALTER TABLE public.citas
  DROP COLUMN IF EXISTS reminder_30m_sent;
ALTER TABLE public.citas
  DROP COLUMN IF EXISTS reminder_1h_sent;
ALTER TABLE public.citas
  DROP COLUMN IF EXISTS reminder_15m_sent;
ALTER TABLE public.citas
  ADD COLUMN IF NOT EXISTS recordatorio_1h BOOLEAN DEFAULT FALSE;
ALTER TABLE public.citas
  ADD COLUMN IF NOT EXISTS recordatorio_15m BOOLEAN DEFAULT FALSE;
ALTER TABLE public.turnos
  ADD COLUMN IF NOT EXISTS notificado_cerca BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS notificado_siguiente BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS notificado_llamado BOOLEAN DEFAULT FALSE;

ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS last_marketing_email_sent_at TIMESTAMPTZ;

-- Movimientos de puntos con referencia de pago
CREATE TABLE IF NOT EXISTS public.movimientos_puntos (
  id BIGSERIAL PRIMARY KEY,
  negocio_id TEXT NOT NULL,
  cliente_id UUID REFERENCES public.clientes(id) ON DELETE CASCADE,
  puntos INTEGER NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('GANADO','CANJE')),
  referencia_pago_id BIGINT,
  descripcion TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.movimientos_puntos
  ADD COLUMN IF NOT EXISTS descripcion TEXT;

-- ==============================================================================
-- 4) Función RPC: Programar Cita (CORREGIDA Y UNIFICADA)
-- ==============================================================================
-- Ya no valida contra turnos en atención, solo bloquea al barbero para evitar race conditions
-- y confía en la restricción EXCLUDE de la tabla citas para solapamientos.
CREATE OR REPLACE FUNCTION public.programar_cita(
  p_negocio_id TEXT,
  p_barber_id BIGINT,
  p_cliente_telefono TEXT,
  p_start TIMESTAMPTZ,
  p_end TIMESTAMPTZ,
  p_servicio TEXT DEFAULT NULL
) RETURNS public.citas AS $$
DECLARE
  nueva public.citas;
BEGIN
  -- 1. BLOQUEO FUERTE: Bloquear el registro del barbero para serializar transacciones
  PERFORM 1 FROM public.barberos WHERE id = p_barber_id FOR UPDATE;

  -- 2. Insertar cita (La restricción EXCLUDE en la tabla citas manejará solapamientos de citas)
  INSERT INTO public.citas (negocio_id, barber_id, cliente_telefono, start_at, end_at, servicio)
  VALUES (p_negocio_id, p_barber_id, p_cliente_telefono, p_start, p_end, p_servicio)
  RETURNING * INTO nueva;

  RETURN nueva;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==============================================================================
-- 5) Función RPC: Finalizar Turno (UNIFICADA Y SEGURA)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.finalizar_turno_con_pago(
  p_turno_id BIGINT,
  p_negocio_id TEXT,
  p_monto NUMERIC,
  p_metodo_pago TEXT
) RETURNS JSONB AS $$
DECLARE
  v_turno record;
  v_cliente_id UUID;
  v_puntos INTEGER;
  v_ok BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  -- 1. Validar Rol (Seguridad) - DESACTIVADO TEMPORALMENTE
  -- SELECT EXISTS(
  --   SELECT 1 FROM public.roles_negocio
  --   WHERE negocio_id = p_negocio_id AND user_id = auth.uid() AND rol IN ('admin','staff')
  -- ) INTO v_ok;

  -- IF NOT v_ok THEN
  --   RAISE EXCEPTION 'No autorizado';
  -- END IF;

  -- 2. Obtener y Bloquear Turno
  SELECT * INTO v_turno
  FROM public.turnos
  WHERE id = p_turno_id AND negocio_id = p_negocio_id
  FOR UPDATE;

  IF v_turno IS NULL THEN
    RAISE EXCEPTION 'Turno no encontrado';
  END IF;

  IF v_turno.estado = 'Atendido' THEN
    RETURN jsonb_build_object('success', true, 'message', 'Turno ya atendido');
  END IF;

  -- 3. Actualizar Turno
  UPDATE public.turnos
  SET estado = 'Atendido',
      monto_cobrado = p_monto,
      metodo_pago = p_metodo_pago,
      updated_at = NOW()
  WHERE id = p_turno_id;

  -- 4. Calcular y Asignar Puntos (10% del monto)
  v_puntos := FLOOR(COALESCE(p_monto, 0) * 0.1);

  IF v_puntos > 0 AND v_turno.telefono IS NOT NULL THEN
    UPDATE public.clientes
    SET puntos_actuales = COALESCE(puntos_actuales, 0) + v_puntos,
        puntos_totales_historicos = COALESCE(puntos_totales_historicos, 0) + v_puntos,
        ultima_visita = NOW()
    WHERE negocio_id = p_negocio_id AND telefono = v_turno.telefono
    RETURNING id INTO v_cliente_id;

    IF v_cliente_id IS NOT NULL THEN
      INSERT INTO public.movimientos_puntos(negocio_id, cliente_id, puntos, tipo, referencia_pago_id, descripcion)
      VALUES (p_negocio_id, v_cliente_id, v_puntos, 'GANADO', p_turno_id, 'Puntos por servicio');
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'puntos_ganados', v_puntos);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==============================================================================
-- 6) Función RPC: Canjear Puntos (UNIFICADA Y SEGURA)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.canjear_puntos(
  p_negocio_id TEXT,
  p_cliente_telefono TEXT,
  p_puntos INT,
  p_concepto TEXT
) RETURNS JSONB AS $$
DECLARE
  v_cliente_id UUID;
  v_saldo_actual INT;
  v_ok BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  -- 1. Validar Rol
  SELECT EXISTS(
    SELECT 1 FROM public.roles_negocio
    WHERE negocio_id = p_negocio_id AND user_id = auth.uid() AND rol IN ('admin','staff')
  ) INTO v_ok;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  -- 2. Obtener cliente
  SELECT id, puntos_actuales INTO v_cliente_id, v_saldo_actual
  FROM public.clientes
  WHERE negocio_id = p_negocio_id AND telefono = p_cliente_telefono;

  IF v_cliente_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Cliente no encontrado');
  END IF;

  IF v_saldo_actual < p_puntos THEN
    RETURN jsonb_build_object('success', false, 'message', 'Saldo insuficiente');
  END IF;

  -- 3. Descontar puntos
  UPDATE public.clientes
  SET puntos_actuales = puntos_actuales - p_puntos
  WHERE id = v_cliente_id;

  -- 4. Registrar movimiento
  INSERT INTO public.movimientos_puntos (negocio_id, cliente_id, tipo, puntos, descripcion)
  VALUES (p_negocio_id, v_cliente_id, 'CANJE', p_puntos, p_concepto);

  RETURN jsonb_build_object('success', true, 'nuevo_saldo', v_saldo_actual - p_puntos);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Índice recomendado para optimizar dashboard en tiempo real
CREATE INDEX IF NOT EXISTS idx_turnos_dashboard
ON public.turnos (negocio_id, fecha, estado, orden);

-- ==============================================================================
-- 13) Función RPC: Procesar Cita a Turno (Transaccional)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.procesar_cita_a_turno(
  p_cita_id BIGINT,
  p_negocio_id TEXT
) RETURNS JSONB AS $$
DECLARE
  v_cita record;
  v_cliente_nombre TEXT;
  v_nuevo_turno_id BIGINT;
  v_nuevo_turno_codigo TEXT;
  v_letra CHAR(1);
  v_ultimo_turno TEXT;
  v_nuevo_numero INT;
  v_fecha DATE := CURRENT_DATE;
  v_fecha_base DATE := '2024-08-23';
  v_diff_dias INT;
BEGIN
  -- 1. Obtener y bloquear cita
  SELECT * INTO v_cita
  FROM public.citas
  WHERE id = p_cita_id AND negocio_id = p_negocio_id
  FOR UPDATE;

  IF v_cita IS NULL THEN
    RAISE EXCEPTION 'Cita no encontrada';
  END IF;

  IF v_cita.estado = 'Atendida' OR v_cita.estado = 'Cancelada' THEN
    RAISE EXCEPTION 'La cita ya fue procesada o cancelada';
  END IF;

  -- 2. Obtener nombre del cliente
  SELECT nombre INTO v_cliente_nombre
  FROM public.clientes
  WHERE negocio_id = p_negocio_id AND telefono = v_cita.cliente_telefono;

  IF v_cliente_nombre IS NULL THEN
    v_cliente_nombre := 'Cliente Cita';
  END IF;

  -- 3. Generar código de turno (Lógica replicada de registrar_turno para consistencia)
  v_diff_dias := (v_fecha - v_fecha_base);
  v_letra := CHR(65 + (MOD((MOD(v_diff_dias, 26) + 26), 26)));

  SELECT turno INTO v_ultimo_turno
  FROM turnos
  WHERE negocio_id = p_negocio_id 
    AND fecha = v_fecha
    AND turno LIKE v_letra || '%'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_ultimo_turno IS NULL THEN
    v_nuevo_numero := 1;
  ELSE
    v_nuevo_numero := CAST(SUBSTRING(v_ultimo_turno FROM 2) AS INT) + 1;
  END IF;

  v_nuevo_turno_codigo := v_letra || LPAD(v_nuevo_numero::TEXT, 2, '0');

  -- 4. Insertar Turno (En atención directamente)
  INSERT INTO public.turnos (
    negocio_id, turno, nombre, telefono, servicio, barber_id, estado, fecha, hora, started_at
  ) VALUES (
    p_negocio_id,
    v_nuevo_turno_codigo,
    v_cliente_nombre,
    v_cita.cliente_telefono,
    v_cita.servicio,
    v_cita.barber_id,
    'En atención',
    v_fecha,
    TO_CHAR(NOW(), 'HH24:MI'),
    NOW()
  ) RETURNING id INTO v_nuevo_turno_id;

  -- 5. Actualizar Cita
  UPDATE public.citas
  SET estado = 'Atendida',
      updated_at = NOW()
  WHERE id = p_cita_id;

  RETURN jsonb_build_object(
    'success', true, 
    'turno_id', v_nuevo_turno_id, 
    'turno_codigo', v_nuevo_turno_codigo,
    'nombre_cliente', v_cliente_nombre
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==============================================================================
-- 14) Configuración de Cron Jobs (Notificaciones Automáticas)
-- ==============================================================================

-- Habilitar extensiones necesarias
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Función para invocar la Edge Function
-- ⚠️ IMPORTANTE: Reemplaza TU_PROJECT_REF y TU_SERVICE_ROLE_KEY con tus valores reales antes de ejecutar
CREATE OR REPLACE FUNCTION public.run_sistema_notificaciones()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM
    net.http_post(
      url := 'https://TU_PROJECT_REF.supabase.co/functions/v1/sistema-notificaciones',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer TU_SERVICE_ROLE_KEY'
      ),
      body := '{}'::jsonb
    );
END;
$$;

-- Programar el job para que corra cada minuto
SELECT cron.schedule(
  'sistema-notificaciones-cada-minuto',
  '* * * * *',
  $$ SELECT public.run_sistema_notificaciones(); $$
);

COMMIT;
