import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
  "Access-Control-Max-Age": "86400",
};

// Clave pública VAPID desde variables de entorno
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY");

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method === "GET") {
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json", ...corsHeaders } });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ error: "Faltan variables de entorno SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY" }), { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let parsed;
    try {
      parsed = await req.json();
    } catch (e) {
      const txt = await req.text().catch(() => "");
      if (!txt) {
        return new Response(JSON.stringify({ error: "Body vacío" }), { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } });
      }
      try {
        parsed = JSON.parse(txt);
      } catch (e2) {
        return new Response(JSON.stringify({ error: "JSON inválido: " + String(e2?.message || e2) + " - Body recibido: " + txt }), { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } });
      }
    }

    const telefono = parsed?.telefono?.toString()?.trim();
    const negocio_id = parsed?.negocio_id?.toString()?.trim();
    const title = parsed?.title;
    const body = parsed?.body;
    const clickUrl = parsed?.url; // opcional: url de destino personalizada

    if (!telefono || !negocio_id) {
      return new Response(JSON.stringify({ error: "telefono y negocio_id requeridos" }), { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY");
    const VAPID_MAILTO = Deno.env.get("VAPID_MAILTO");
    if (!VAPID_PRIVATE_KEY || !VAPID_MAILTO) {
      return new Response(JSON.stringify({ error: "Faltan variables de entorno VAPID_PRIVATE_KEY o VAPID_MAILTO" }), { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }
    if (!VAPID_PUBLIC_KEY) {
      return new Response(JSON.stringify({ error: "Falta VAPID_PUBLIC_KEY" }), { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }
    try {
      webpush.setVapidDetails(`mailto:${VAPID_MAILTO}`, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    } catch (e) {
      return new Response(JSON.stringify({ error: "Error configurando VAPID: " + (e?.message || String(e)) }), { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    // Búsqueda mejorada por teléfono, como sugeriste
    const { data, error } = await supabase
      .from("push_subscriptions")
      .select("subscription, endpoint")
      .eq("user_id", telefono)
      .eq("negocio_id", negocio_id);

    if (error) {
       return new Response(JSON.stringify({ error: "Error al buscar suscripción: " + error.message }), { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }
    if (!data || data.length === 0) {
      return new Response(JSON.stringify({ error: "Suscripción no encontrada" }), { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    const payload = JSON.stringify({
      title: title || "¡Es tu turno!",
      body: body || "Un barbero te está esperando",
      icon: "/android-chrome-192x192.png",
      badge: "/jbarber/jjj.png",
      vibrate: [200, 100, 200],
      data: {
        url: (typeof clickUrl === 'string' && clickUrl.length > 0) ? clickUrl : "/panel_cliente.html",
      }
    });

    // Iterar sobre todas las suscripciones encontradas para ese teléfono y limpiar inválidas
    let sent = 0;
    const invalidEndpoints: string[] = [];
    for (const sub of data) {
      try {
        // Normalizar/parsear la suscripción si viene en string
        let subscriptionObj: any = sub?.subscription;
        if (!subscriptionObj) {
          if (sub?.endpoint) invalidEndpoints.push(sub.endpoint);
          continue;
        }
        if (typeof subscriptionObj === 'string') {
          try {
            subscriptionObj = JSON.parse(subscriptionObj);
          } catch {
            if (sub?.endpoint) invalidEndpoints.push(sub.endpoint);
            continue;
          }
        }
        if (!subscriptionObj?.endpoint) {
          if (sub?.endpoint) invalidEndpoints.push(sub.endpoint);
          continue;
        }
        await webpush.sendNotification(subscriptionObj, payload);
        sent++;
      } catch (sendError: any) {
        console.error("Error al enviar notificación a una suscripción:", sendError);
        if (sendError?.statusCode === 410 || sendError?.statusCode === 404) {
          if (sub.endpoint) invalidEndpoints.push(sub.endpoint);
        }
      }
    }

    if (invalidEndpoints.length > 0) {
      await supabase
        .from('push_subscriptions')
        .delete()
        .in('endpoint', invalidEndpoints);
    }

    return new Response(JSON.stringify({ success: true, sent, removed: invalidEndpoints.length }), { headers: { "Content-Type": "application/json", ...corsHeaders } });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: err?.message || String(err) }), { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } });
  }
});
