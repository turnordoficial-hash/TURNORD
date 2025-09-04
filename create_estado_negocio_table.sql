-- Script SQL para crear la tabla estado_negocio en Supabase
-- Ejecutar este script en el SQL Editor de Supabase

CREATE TABLE IF NOT EXISTS estado_negocio (
    id SERIAL PRIMARY KEY,
    negocio_id VARCHAR(50) NOT NULL,
    en_break BOOLEAN DEFAULT FALSE,
    break_start_time TIMESTAMP WITH TIME ZONE,
    break_end_time TIMESTAMP WITH TIME ZONE,
    break_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(negocio_id)
);

-- Crear índice para mejorar el rendimiento de las consultas
CREATE INDEX IF NOT EXISTS idx_estado_negocio_negocio_id ON estado_negocio(negocio_id);

-- Insertar registro inicial para el negocio barberia0001
INSERT INTO estado_negocio (negocio_id, en_break) 
VALUES ('barberia0001', FALSE)
ON CONFLICT (negocio_id) DO NOTHING;

-- Habilitar Row Level Security (RLS)
ALTER TABLE estado_negocio ENABLE ROW LEVEL SECURITY;

-- Políticas RLS refinadas (ajusta según tus roles reales)
DROP POLICY IF EXISTS "Enable all operations for estado_negocio" ON estado_negocio;

DROP POLICY IF EXISTS estado_negocio_select ON estado_negocio;
CREATE POLICY estado_negocio_select ON estado_negocio
  FOR SELECT USING (true);

DROP POLICY IF EXISTS estado_negocio_insert ON estado_negocio;
CREATE POLICY estado_negocio_insert ON estado_negocio
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS estado_negocio_update ON estado_negocio;
CREATE POLICY estado_negocio_update ON estado_negocio
  FOR UPDATE USING (true) WITH CHECK (true);

-- Comentarios sobre la tabla
COMMENT ON TABLE estado_negocio IS 'Tabla para controlar el estado de break de los negocios';
COMMENT ON COLUMN estado_negocio.negocio_id IS 'Identificador único del negocio';
COMMENT ON COLUMN estado_negocio.en_break IS 'Indica si el negocio está actualmente en break';
COMMENT ON COLUMN estado_negocio.break_start_time IS 'Hora de inicio del break';
COMMENT ON COLUMN estado_negocio.break_end_time IS 'Hora de finalización del break';
COMMENT ON COLUMN estado_negocio.break_message IS 'Mensaje personalizado para mostrar durante el break';

-- Trigger para mantener updated_at automáticamente
CREATE OR REPLACE FUNCTION set_timestamp_updated_at() RETURNS TRIGGER AS $
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_timestamp_updated_at_estado_negocio ON estado_negocio;
CREATE TRIGGER set_timestamp_updated_at_estado_negocio
BEFORE UPDATE ON estado_negocio
FOR EACH ROW EXECUTE FUNCTION set_timestamp_updated_at();