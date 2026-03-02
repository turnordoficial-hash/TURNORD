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
    return new Response(JSON.stringify({ error: "Método no permitido" }), {
      status: 405,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  try {
    if (!req.headers.get("content-type")?.includes("application/json")) {
      return new Response(JSON.stringify({ error: "Content-Type debe ser application/json" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const { telefono, title, body, url } = await req.json();

    if (!telefono) {
      return new Response(JSON.stringify({ error: "telefono es requerido" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    if (!ONE_SIGNAL_KEY || !ONESIGNAL_APP_ID) {
      return new Response(JSON.stringify({ error: "Variables de entorno faltantes" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const payload = {
      app_id: ONESIGNAL_APP_ID,
      headings: { en: title || "💈 JBarber" },
      contents: { en: body || "Tienes una actualización." },
      url: url || "/panel_cliente.html",
      include_aliases: {
        external_id: [String(telefono)]
      },
      target_channel: "push"
    };

    const osResponse = await fetch("https://api.onesignal.com/notifications", {
      method: "POST",
      headers: {
        Authorization: `Basic ${ONE_SIGNAL_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const osData = await osResponse.json().catch(() => ({}));

    if (!osResponse.ok) {
      return new Response(JSON.stringify({
        error: osData?.errors || "Error en OneSignal",
        detail: osData
      }), {
        status: osResponse.status,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      onesignal_id: osData?.id || null
    }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });

  } catch (err: any) {
    return new Response(JSON.stringify({
      error: err?.message || "Error interno"
    }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});