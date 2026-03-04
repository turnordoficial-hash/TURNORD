-- Verifica que el secreto existe en el Vault
SELECT name, length(decrypted_secret) > 0 as "existe_y_no_vacio"
FROM vault.decrypted_secrets
WHERE name = 'SUPABASE_SERVICE_ROLE_KEY';

-- Prueba una llamada HTTP desde SQL (debe devolver status 200)
-- Esta prueba puede causar timeouts si la función Edge tarda en responder.
-- Se recomienda ejecutarla en un script aparte o comentarla en el schema principal.
/*
SELECT (h.response).status_code as status, (h.response).body::json->>'success' as "exitoso"
FROM net.http_collect_response(
    net.http_post(
        url := 'https://wjvwjirhxenotvdewbmm.supabase.co/functions/v1/sistema-notificaciones',
        headers := jsonb_build_object(
            'Content-Type','application/json',
            'Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='SUPABASE_SERVICE_ROLE_KEY' LIMIT 1)
        ),
        body := '{}'::jsonb
    ),
    async := false
) as h; */