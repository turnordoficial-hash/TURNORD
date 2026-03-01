import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
};

const ONESIGNAL_APP_ID = Deno.env.get("ONE_SIGNAL_APP_ID") || "85f98db3-968a-4580-bb02-8821411a6bee";
const ONE_SIGNAL_KEY = Deno.env.get("ONE_SIGNAL_REST_API_KEY") || "";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method === "GET") {
    return new Response(JSON.stringify({ ok: true, status: "ready", version: "2.1" }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  try {
    const bodyText = await req.text();
    if (!bodyText || bodyText.trim().length === 0) {
      return new Response(JSON.stringify({ error: "Cuerpo de solicitud requerido" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
    let parsed: any;
    try {
      parsed = JSON.parse(bodyText);
    } catch (e) {
      return new Response(JSON.stringify({ error: "JSON inválido" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const telefono = parsed?.telefono?.toString()?.trim();
    const title = parsed?.title || "💈 JBarber";
    const body = parsed?.body || "Tienes una actualización.";
    const clickUrl = parsed?.url || "/panel_cliente.html";

    if (!telefono) {
      return new Response(JSON.stringify({ error: "telefono es requerido" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
    if (!ONE_SIGNAL_KEY) {
      return new Response(JSON.stringify({ error: "ONE_SIGNAL_REST_API_KEY faltante" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const reqBody: Record<string, unknown> = {
      app_id: ONESIGNAL_APP_ID,
      headings: { en: title },
      contents: { en: body },
      url: clickUrl,
      include_aliases: { external_id: [telefono] },
      target_channel: "push",
    };
    (reqBody as any).include_external_user_ids = [telefono];

    const osResponse = await fetch("https://api.onesignal.com/notifications", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${ONE_SIGNAL_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(reqBody),
    });

    const osData = await osResponse.json().catch(() => ({}));
    if (!osResponse.ok) {
      return new Response(JSON.stringify({ error: osData?.errors || "Error en OneSignal" }), {
        status: osResponse.status,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    return new Response(JSON.stringify({ success: true, result: osData }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});

