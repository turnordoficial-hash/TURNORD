import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

/**
 * send-push-notification Edge Function
 * VERSIÓN ROBUSTA 2.0 - MANEJO DE CUERPO Y CORS
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
};

const ONESIGNAL_APP_ID = Deno.env.get("ONE_SIGNAL_APP_ID");
const ONE_SIGNAL_KEY = Deno.env.get("ONE_SIGNAL_REST_API_KEY");

serve(async (req) => {
  // 1. CORS Pre-flight: Manejar OPTIONS de inmediato sin leer nada más
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // 2. Health check / Pruebas
  if (req.method === "GET") {
    return new Response(JSON.stringify({ ok: true, status: "ready", version: "2.1" }), { 
      headers: { "Content-Type": "application/json", ...corsHeaders } 
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Método no permitido" }), {
      status: 405,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  try {
    const ct = req.headers.get("content-type") || "";
    if (!ct.toLowerCase().includes("application/json")) {
      return new Response(JSON.stringify({ error: "Content-Type debe ser application/json" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const bodyText = await req.text();
    
    if (!bodyText || bodyText.trim().length === 0) {
      console.warn("Recibido cuerpo vacío");
      return new Response(JSON.stringify({ error: "Cuerpo de solicitud requerido" }), { 
        status: 400, 
        headers: { "Content-Type": "application/json", ...corsHeaders } 
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(bodyText);
    } catch (e) {
      console.error("Error parseando JSON:", e.message, "Cuerpo:", bodyText);
      return new Response(JSON.stringify({ error: "JSON inválido", details: e.message }), { 
        status: 400, 
        headers: { "Content-Type": "application/json", ...corsHeaders } 
      });
    }

    const telefono = parsed?.telefono?.toString()?.trim();
    const nombre = parsed?.nombre?.toString()?.trim() || "";
    const clickUrl = parsed?.url || "/panel_cliente.html";
    const negocioId = parsed?.negocio_id?.toString()?.trim() || "";
    const rol = (parsed?.rol || "cliente").toString().toLowerCase();
    const baseTitle = parsed?.title 
      || (rol === "barbero" ? "Nueva cita asignada 💈" : "Tu cita está confirmada ✂️");
    const title = nombre ? `${nombre}, ${baseTitle}` : baseTitle;
    const body = parsed?.body || "Tienes una actualización importante.";

    if (!telefono) {
      return new Response(JSON.stringify({ error: "telefono es requerido" }), { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    if (!ONE_SIGNAL_KEY || !ONESIGNAL_APP_ID) {
      return new Response(JSON.stringify({ error: "Variables de entorno faltantes" }), { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    const reqBody: Record<string, unknown> = {
      app_id: ONESIGNAL_APP_ID,
      headings: { en: title, es: title },
      contents: { en: body, es: body },
      url: clickUrl,
      web_push_topic: `${telefono}-default`,
      data: negocioId ? { negocio_id: negocioId } : undefined,
      include_aliases: {
        external_id: [telefono]
      },
      target_channel: "push"
    };

    async function postWithRetry(attempt = 1): Promise<Response> {
      const res = await fetch("https://api.onesignal.com/notifications", {
        method: "POST",
        headers: {
          "Authorization": `Basic ${ONE_SIGNAL_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(reqBody),
      });
      if (!res.ok && attempt < 3 && (res.status >= 500 || res.status === 429)) {
        const backoff = 300 * attempt;
        await new Promise(r => setTimeout(r, backoff));
        return postWithRetry(attempt + 1);
      }
      return res;
    }

    const osResponse = await postWithRetry();

    const osData = await osResponse.json().catch(() => ({}));
    
    if (!osResponse.ok) {
      console.error("Error OneSignal:", osData);
      return new Response(JSON.stringify({ error: osData?.errors || "Error en OneSignal" }), { 
        status: osResponse.status, 
        headers: { "Content-Type": "application/json", ...corsHeaders } 
      });
    }

    return new Response(JSON.stringify({ success: true, result: osData }), { 
      headers: { "Content-Type": "application/json", ...corsHeaders } 
    });

  } catch (err) {
    console.error("Error crítico en Edge Function:", err);
    return new Response(JSON.stringify({ error: err.message }), { 
      status: 500, 
      headers: { "Content-Type": "application/json", ...corsHeaders } 
    });
  }
});
