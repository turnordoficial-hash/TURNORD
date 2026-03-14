import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
};

const ONESIGNAL_APP_ID = Deno.env.get("ONE_SIGNAL_APP_ID");
const ONE_SIGNAL_KEY = Deno.env.get("ONE_SIGNAL_REST_API_KEY");

serve(async (req) => {
  console.info("--- SEND ONESIGNAL NOTIFICATION: INICIO ---");
  
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method === "GET") {
    return new Response(JSON.stringify({
      ok: true,
      service: "send-push-notification",
      status: "ready"
    }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  if (req.method !== "POST") {
    console.warn(`Método no permitido: ${req.method}`);
    return new Response(JSON.stringify({ error: "Método no permitido" }), {
      status: 405,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  try {
    const payload = await req.json().catch(() => ({}));
    const { telefono, title, body, url } = payload;
    
    console.info(`Destinatario (Tel): ${telefono}`);
    console.info(`Título: ${title}`);

    if (!telefono) {
      console.error("Error: telefono es requerido");
      return new Response(JSON.stringify({ error: "telefono es requerido" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    if (!ONE_SIGNAL_KEY || !ONESIGNAL_APP_ID) {
      console.error("Error: Variables de entorno de OneSignal faltantes");
      return new Response(JSON.stringify({ error: "Variables de entorno faltantes" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const osPayload = {
      app_id: ONESIGNAL_APP_ID,
      headings: { en: title || "💈 JBarber", es: title || "💈 JBarber" },
      contents: { en: body || "Tienes una actualización.", es: body || "Tienes una actualización." },
      url: url || "/panel_cliente.html",
      include_aliases: {
        external_id: [String(telefono)]
      },
      target_channel: "push"
    };

    console.info("Enviando petición a OneSignal API...");
    const osResponse = await fetch("https://api.onesignal.com/notifications", {
      method: "POST",
      headers: {
        Authorization: `Basic ${ONE_SIGNAL_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(osPayload),
    });

    const osData = await osResponse.json().catch(() => ({}));
    console.info(`OneSignal API Status: ${osResponse.status}`);

    if (!osResponse.ok) {
      console.error("Error de OneSignal API:", osData);
      return new Response(JSON.stringify({
        error: osData?.errors || "Error en OneSignal",
        detail: osData
      }), {
        status: osResponse.status,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    console.info(`Notificación enviada con éxito. ID: ${osData?.id}`);
    return new Response(JSON.stringify({
      success: true,
      onesignal_id: osData?.id || null
    }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });

  } catch (err: any) {
    console.error("Excepción en send-onesignal-notification:", err);
    return new Response(JSON.stringify({
      error: err?.message || "Error interno"
    }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});