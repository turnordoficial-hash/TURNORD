import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push";

function buildCorsHeaders(origin?: string) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Credentials": "true",
  };
}

// Clave pública VAPID (la que compartes en el cliente)
const VAPID_PUBLIC_KEY =
  "BCMJiXkuO_Q_y_JAMO56tAaJw1JVmSOejavwLsLC9OWCBihIxlGuHpgga6qEyuPQ2cF_KLuotZS7YzdUEzAiHlQ";

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req.headers.get("origin") || "*");
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "Content-Type": "text/plain", ...corsHeaders } });
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

    const telefono = parsed?.telefono;
    const negocio_id = parsed?.negocio_id;
    const title = parsed?.title;
    const body = parsed?.body;

    if (!telefono || !negocio_id) {
      return new Response(JSON.stringify({ error: "telefono y negocio_id requeridos" }), { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY");
    const VAPID_MAILTO = Deno.env.get("VAPID_MAILTO");
    if (!VAPID_PRIVATE_KEY || !VAPID_MAILTO) {
      return new Response(JSON.stringify({ error: "Faltan variables de entorno VAPID_PRIVATE_KEY o VAPID_MAILTO" }), { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }
    try {
      webpush.setVapidDetails(VAPID_MAILTO, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    } catch (e) {
      return new Response(JSON.stringify({ error: "Error configurando VAPID: " + (e?.message || String(e)) }), { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    let { data, error } = await supabase
      .from("push_subscriptions")
      .select("subscription")
      .eq("user_id", telefono)
      .eq("negocio_id", negocio_id);

    if ((!data || data.length === 0) && !error) {
      const fallback = await supabase
        .from("push_subscriptions")
        .select("subscription")
        .eq("telefono", telefono)
        .eq("negocio_id", negocio_id);
      data = fallback.data;
      error = fallback.error;
    }

    if (error || !data || data.length === 0) {
      return new Response(JSON.stringify({ error: "Suscripción no encontrada" }), { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    const payload = JSON.stringify({
      title: title || "¡Es tu turno!",
      body: body || "Un barbero te está esperando",
      icon: "/android-chrome-192x192.png",
      url: "/panel_cliente.html",
    });

    // Iterar sobre todas las suscripciones encontradas para ese teléfono
    for (const suscripcion of data) {
      try {
        await webpush.sendNotification(suscripcion.subscription, payload);
      } catch (sendError) {
        console.error("Error al enviar notificación a una suscripción:", sendError);
        // Si la suscripción es inválida (e.g., 410 Gone), la eliminamos
        if (sendError.statusCode === 410 || sendError.statusCode === 404) {
          console.log("Eliminando suscripción inválida:", suscripcion.subscription.endpoint);
          await supabase
            .from('push_subscriptions')
            .delete()
            .eq('subscription', suscripcion.subscription);
        }
      }
    }

    return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json", ...corsHeaders } });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: err?.message || String(err) }), { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } });
  }
});
