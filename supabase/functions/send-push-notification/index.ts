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

const ONESIGNAL_APP_ID = Deno.env.get("ONE_SIGNAL_APP_ID") || "85f98db3-968a-4580-bb02-8821411a6bee";

serve(async (req) => {
  // 1. CORS Pre-flight: Manejar OPTIONS de inmediato sin leer nada más
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // 2. Health check / Pruebas
  if (req.method === "GET") {
    return new Response(JSON.stringify({ ok: true, status: "ready", version: "2.0" }), { 
      headers: { "Content-Type": "application/json", ...corsHeaders } 
    });
  }

  try {
    // 3. Lectura segura del cuerpo como texto
    // NUNCA usar req.json() directamente para evitar SyntaxError en cuerpos vacíos
    const bodyText = await req.text();
    
    if (!bodyText || bodyText.trim().length === 0) {
      console.warn("Recibido cuerpo vacío");
      return new Response(JSON.stringify({ error: "Cuerpo de solicitud requerido" }), { 
        status: 400, 
        headers: { "Content-Type": "application/json", ...corsHeaders } 
      });
    }

    // 4. Parseo manual de JSON
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
    const negocio_id = parsed?.negocio_id?.toString()?.trim();
    const title = parsed?.title || "💈 JBarber";
    const body = parsed?.body || "Tienes una actualización.";
    const clickUrl = parsed?.url || "/panel_cliente.html";

    if (!telefono) {
      return new Response(JSON.stringify({ error: "telefono es requerido" }), { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    const ONE_SIGNAL_KEY = Deno.env.get("ONE_SIGNAL_REST_API_KEY");
    if (!ONE_SIGNAL_KEY) {
      console.error("Falta ONE_SIGNAL_REST_API_KEY en variables de entorno");
      return new Response(JSON.stringify({ error: "Configuración de servidor incompleta" }), { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    // 5. Preparar llamada a OneSignal
    const reqBody: Record<string, unknown> = {
      app_id: ONESIGNAL_APP_ID,
      headings: { en: title },
      contents: { en: body },
      url: clickUrl,
      chrome_web_icon: "jbarber/jjj.png",
      chrome_web_badge: "imegenlogin/favicon-32x32.png",
      include_aliases: {
        external_id: [telefono]
      },
      target_channel: "push"
    };
    // Compatibilidad adicional
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
