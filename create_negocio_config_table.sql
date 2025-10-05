-- Script SQL para crear la tabla negocio_config en Supabase (separada de estado_negocio)
-- Ejecutar este script en el SQL Editor de Supabase

-- Tabla 1: Configuración del negocio (datos relativamente estáticos)
CREATE TABLE IF NOT EXISTS negocio_config (
    id SERIAL PRIMARY KEY,
    negocio_id VARCHAR(50) NOT NULL,
    nombre TEXT,
    direccion TEXT,
    telefono TEXT,
    email TEXT,
    ajustes JSONB NOT NULL DEFAULT '{}'::jsonb, -- configuración flexible (por ejemplo, preferencias de UI, opciones)
    horario JSONB NOT NULL DEFAULT '[]'::jsonb, -- por ejemplo, bloques de horario [{dia:"lun", abre:"09:00", cierra:"18:00"}, ...]
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (negocio_id)
);

-- Índice por negocio_id para 1:1 y búsquedas
CREATE INDEX IF NOT EXISTS idx_negocio_config_negocio_id ON negocio_config(negocio_id);

-- Semilla opcional para barberia0001
INSERT INTO negocio_config (negocio_id, nombre)
VALUES ('barberia0001', 'Barbería 0001')
ON CONFLICT (negocio_id) DO NOTHING;

-- RLS
ALTER TABLE negocio_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Enable all operations for negocio_config" ON negocio_config
    FOR ALL USING (true) WITH CHECK (true);

-- Trigger para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION set_timestamp_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_timestamp_updated_at_negocio_config ON negocio_config;
CREATE TRIGGER set_timestamp_updated_at_negocio_config
BEFORE UPDATE ON negocio_config
FOR EACH ROW EXECUTE FUNCTION set_timestamp_updated_at();

-- Comentarios
COMMENT ON TABLE negocio_config IS 'Tabla de configuración 1:1 por negocio (datos estáticos y opciones)';
COMMENT ON COLUMN negocio_config.negocio_id IS 'Identificador único del negocio. Agregar FK si existe tabla de negocios';
COMMENT ON COLUMN negocio_config.ajustes IS 'Ajustes flexibles del negocio en formato JSONB';
COMMENT ON COLUMN negocio_config.horario IS 'Definición de horarios en formato JSONB';