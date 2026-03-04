# Informe de Diagnóstico: Error 401 en Sistema de Notificaciones

Este informe detalla las causas por las cuales las funciones de notificación están fallando con el error 401 (No autorizado) y por qué otras funciones relacionadas no se están ejecutando.

## 1. Causa del Error 401 en `sistema-notificaciones`

El error 401 ocurre cuando la función de Edge de Supabase recibe una solicitud con una clave de autorización inválida o ausente.

En tu sistema, las llamadas a `sistema-notificaciones` se originan desde la base de datos a través de dos mecanismos:
1. **Cron Job (`pg_cron`):** Ejecuta `public.run_sistema_notificaciones()` cada minuto.
2. **Triggers:** Ejecutan `public.trg_notificar_evento()` cuando hay cambios en las tablas de `citas` o `turnos`.

**El problema técnico:**
Ambas funciones SQL intentan obtener la clave de servicio (`SERVICE_ROLE_KEY`) desde el **Supabase Vault** con la siguiente instrucción:
```sql
SELECT decrypted_secret INTO v_service_role FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1;
```
Si el secreto llamado `'SUPABASE_SERVICE_ROLE_KEY'` no existe en el Vault de tu proyecto de Supabase, la variable `v_service_role` queda vacía, y la llamada HTTP se envía con un encabezado `Authorization: Bearer` incompleto, lo que provoca el error **401 Unauthorized**.

## 2. Por qué no se ejecutan las demás funciones

### `send-push-notification`
Esta función es invocada internamente por `sistema-notificaciones`. Debido a que la función madre (`sistema-notificaciones`) falla inmediatamente por el error 401 al ser llamada desde la base de datos, el código interno que debería disparar `send-push-notification` nunca llega a ejecutarse.

### `send-onesignal-notification`
Tras revisar todo el código del proyecto, no se han encontrado referencias activas a esta función. Todo el sistema actual utiliza `send-push-notification`. Por lo tanto, `send-onesignal-notification` es una función obsoleta (deprecated) y es normal que no registre actividad.

---

## 3. Cómo solucionar el problema

Para arreglar esto, debes asegurarte de que los secretos necesarios estén configurados correctamente en el **Vault** de Supabase. Puedes hacerlo ejecutando los siguientes comandos en el **SQL Editor** de tu panel de Supabase:

### Paso 1: Configurar la SERVICE_ROLE_KEY
Reemplaza `'TU_SERVICE_ROLE_KEY_AQUÍ'` con la clave real que encuentras en: *Project Settings -> API -> service_role (secret)*.

```sql
-- Primero, eliminamos si existe para evitar duplicados
DELETE FROM vault.secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY';

-- Insertamos la clave correcta
INSERT INTO vault.secrets (name, secret, description)
VALUES (
  'SUPABASE_SERVICE_ROLE_KEY',
  'TU_SERVICE_ROLE_KEY_AQUÍ',
  'Clave de servicio para llamadas internas de Edge Functions'
);
```

### Paso 2: Configurar las demás claves (Opcional pero Recomendado)
Otras funciones en `schema.sql` también dependen del Vault. Asegúrate de configurarlas igual:

```sql
-- Para OneSignal
DELETE FROM vault.secrets WHERE name = 'ONE_SIGNAL_REST_API_KEY';
INSERT INTO vault.secrets (name, secret, description)
VALUES ('ONE_SIGNAL_REST_API_KEY', 'TU_ONESIGNAL_REST_API_KEY', 'Clave API de OneSignal');

-- Para Resend (Correos)
DELETE FROM vault.secrets WHERE name = 'RESEND_API_KEY';
INSERT INTO vault.secrets (name, secret, description)
VALUES ('RESEND_API_KEY', 'TU_RESEND_API_KEY', 'Clave API de Resend para correos');
```

## 4. Verificación
Una vez ejecutados los comandos SQL:
1. Espera 1 minuto para que el Cron Job se ejecute nuevamente.
2. Revisa los logs de `sistema-notificaciones`. Deberías ver respuestas `200 OK`.
3. Inmediatamente después, deberías ver actividad en los logs de `send-push-notification`.

---
*Informe generado automáticamente por el equipo de ingeniería para resolver incidencias de autenticación en Edge Functions.*
