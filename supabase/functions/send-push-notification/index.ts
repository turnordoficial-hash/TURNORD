import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
  "Access-Control-Max-Age": "86400",
};

const ONESIGNAL_APP_ID = Deno.env.get("ONE_SIGNAL_APP_ID") || "85f98db3-968a-4580-bb02-8821411a6bee";

serve(async (req) => {
  // CORS robusto: Manejar OPTIONS inmediatamente
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Manejar GET para pruebas rápidas
  if (req.method === "GET") {
    return new Response(JSON.stringify({ ok: true, status: "active" }), { 
      headers: { "Content-Type": "application/json", ...corsHeaders } 
    });
  }

  try {
    // 1. Leer el body como texto primero para evitar errores de stream consumido o JSON vacío
    const bodyText = await req.text().catch(() => "");
    if (!bodyText || bodyText.trim() === "") {
      return new Response(JSON.stringify({ error: "Cuerpo de solicitud vacío" }), { 
        status: 400, 
        headers: { "Content-Type": "application/json", ...corsHeaders } 
      });
    }

    // 2. Intentar parsear el JSON de forma segura
    let parsed;
    try {
      parsed = JSON.parse(bodyText);
    } catch (e) {
      return new Response(JSON.stringify({ error: "JSON inválido", details: String(e.message) }), { 
        status: 400, 
        headers: { "Content-Type": "application/json", ...corsHeaders } 
      });
    }

    const telefono = parsed?.telefono?.toString()?.trim();
    const negocio_id = parsed?.negocio_id?.toString()?.trim();
    const title = parsed?.title;
    const body = parsed?.body;
    const clickUrl = parsed?.url; // opcional: url de destino personalizada

    if (!telefono || !negocio_id) {
      return new Response(JSON.stringify({ error: "telefono y negocio_id requeridos" }), { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    const ONE_SIGNAL_KEY = Deno.env.get("ONE_SIGNAL_REST_API_KEY");
    if (!ONE_SIGNAL_KEY) {
      return new Response(JSON.stringify({ error: "Falta ONE_SIGNAL_REST_API_KEY" }), { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    const reqBody: Record<string, unknown> = {
      app_id: ONESIGNAL_APP_ID,
      headings: { en: title || "💈 JBarber" },
      contents: { en: body || "Tienes una actualización en tu turno o cita." },
      url: (typeof clickUrl === 'string' && clickUrl.length > 0) ? clickUrl : "/panel_cliente.html",
      chrome_web_icon: "jbarber/jjj.png",
      chrome_web_badge: "imegenlogin/favicon-32x32.png",
      // CORRECCIÓN: Usar 'external_id' estándar.
      // El cliente debe haber ejecutado OneSignal.login(telefono) para que esto funcione.
      include_aliases: {
        external_id: [telefono]
      },
      target_channel: "push",
      priority: 10,
      ttl: 3600
    };

    const res = await fetch("https://api.onesignal.com/notifications", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${ONE_SIGNAL_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(reqBody),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return new Response(JSON.stringify({ error: json?.errors || json || "Error en OneSignal" }), { status: res.status, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    return new Response(JSON.stringify({ success: true, result: json }), { headers: { "Content-Type": "application/json", ...corsHeaders } });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: err?.message || String(err) }), { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } });
  }
});
