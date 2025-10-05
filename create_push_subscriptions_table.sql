-- Creación de la tabla para almacenar las suscripciones de notificaciones push
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    user_id TEXT NOT NULL UNIQUE, -- Usaremos el número de teléfono como identificador único del usuario
    subscription JSONB NOT NULL,
    negocio_id VARCHAR(255) NOT NULL -- Para asegurar que la suscripción es para un negocio específico
);

-- Asegurar que la tabla tiene políticas de seguridad a nivel de fila (RLS)
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Crear una política para permitir a los usuarios insertar su propia suscripción
-- Los usuarios están autenticados anónimamente, por lo que no podemos usar auth.uid() directamente.
-- Por ahora, permitiremos la inserción pública, pero en un escenario real, esto debería estar más protegido.
CREATE POLICY "Public-insert" ON push_subscriptions FOR INSERT WITH CHECK (true);

-- Permitir a los administradores (o funciones del servidor) leer las suscripciones
-- Asumimos que las funciones de servidor usan el rol 'service_role' que bypassa RLS.
-- Si necesitáramos una política de lectura, sería algo como:
-- CREATE POLICY "Admin-read" ON push_subscriptions FOR SELECT USING (auth.role() = 'service_role');

-- Añadir un comentario a la tabla para describir su propósito
COMMENT ON TABLE push_subscriptions IS 'Almacena las suscripciones de notificaciones push de los usuarios para un negocio específico.';