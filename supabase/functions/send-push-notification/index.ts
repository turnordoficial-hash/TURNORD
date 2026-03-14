
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, handleError } from "../_shared/supabase-client.ts";

const ONESIGNAL_APP_ID = Deno.env.get("ONE_SIGNAL_APP_ID");
const ONE_SIGNAL_KEY = Deno.env.get("ONE_SIGNAL_REST_API_KEY");

/**
 * DELIVERY SERVICE 2.0
 * Encargado único de la entrega de notificaciones PUSH vía OneSignal.
 * Implementa retry inteligente y validación estricta.
 */

serve(async (req) => {
  console.info("--- SEND PUSH NOTIFICATION (v2): INICIO ---");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  try {
    const payload = await req.json().catch(() => ({}));
    const { telefono, title, body, url, negocio_id } = payload;
    
    console.info(`Destinatario (Tel): ${telefono}`);
    console.info(`Título: ${title}`);

    if (!telefono || !title || !body) {
      console.error("Error: Faltan campos obligatorios");
      return new Response(JSON.stringify({ error: "Faltan campos obligatorios: telefono, title, body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (!ONE_SIGNAL_KEY || !ONESIGNAL_APP_ID) {
      console.error("Error: Variables de entorno faltantes");
      throw new Error("Configuración de OneSignal faltante (ONE_SIGNAL_APP_ID/KEY)");
    }

    const osPayload = {
      app_id: ONESIGNAL_APP_ID,
      headings: { en: title, es: title },
      contents: { en: body, es: body },
      url: url || "/panel_cliente.html",
      include_aliases: {
        external_id: [String(telefono)]
      },
      target_channel: "push",
      data: { negocio_id }
    };

    // Retry con Exponential Backoff
    async function fetchWithRetry(url: string, options: any, maxRetries = 3): Promise<Response> {
      for (let i = 0; i < maxRetries; i++) {
        try {
          console.info(`Intento ${i + 1} de envío a OneSignal...`);
          const response = await fetch(url, options);
          
          // Si es éxito o error del cliente (4xx), no reintentar (excepto 429)
          if (response.ok || (response.status >= 400 && response.status < 500 && response.status !== 429)) {
            return response;
          }
          
          console.warn(`Retry attempt ${i + 1} due to status ${response.status}`);
        } catch (err) {
          if (i === maxRetries - 1) throw err;
          console.warn(`Retry attempt ${i + 1} due to network error: ${err.message}`);
        }
        
        const delay = Math.pow(2, i) * 500; // 500ms, 1000ms, 2000ms
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      throw new Error("Max retries reached");
    }

    const response = await fetchWithRetry("https://api.onesignal.com/notifications", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${ONE_SIGNAL_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(osPayload),
    });

    const result = await response.json().catch(() => ({}));
    console.info(`OneSignal API Status: ${response.status}`);

    if (!response.ok) {
      console.error("OneSignal Error:", result);
      return new Response(JSON.stringify({ error: result.errors || "Error en OneSignal API", detail: result }), {
        status: response.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    console.info(`Push enviado con éxito. ID: ${result.id}`);
    return new Response(JSON.stringify({ success: true, id: result.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (err) {
    console.error("Excepción en send-push-notification:", err);
    return handleError(err);
  }
});
