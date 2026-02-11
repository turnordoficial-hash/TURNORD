import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY");
const VAPID_MAILTO = Deno.env.get("VAPID_MAILTO");

// TU CLAVE PUBLICA (la que generaste)
const VAPID_PUBLIC_KEY =
  "BCMJiXkuO_Q_y_JAMO56tAaJw1JVmSOejavwLsLC9OWCBihIxlGuHpgga6qEyuPQ2cF_KLuotZS7YzdUEzAiHlQ";

webpush.setVapidDetails(
  VAPID_MAILTO!,
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY!
);

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    let bodyText;
    try {
      bodyText = await req.text();
      if (!bodyText) {
        return new Response(
          JSON.stringify({ error: "Body vacío" }),
          { status: 400, headers: corsHeaders }
        );
      }
    } catch (e) {
      return new Response(
        JSON.stringify({ error: "Error leyendo body: " + e.message }),
        { status: 400, headers: corsHeaders }
      );
    }

    let telefono, negocio_id, title, body;
    try {
      const data = JSON.parse(bodyText);
      telefono = data.telefono;
      negocio_id = data.negocio_id;
      title = data.title;
      body = data.body;
    } catch (e) {
      return new Response(
        JSON.stringify({ error: "JSON inválido: " + e.message + " - Body recibido: " + bodyText }),
        { status: 400, headers: corsHeaders }
      );
    }

    if (!telefono || !negocio_id) {
      return new Response(
        JSON.stringify({ error: "telefono y negocio_id requeridos" }),
        { status: 400, headers: corsHeaders }
      );
    }

    const { data, error } = await supabase
      .from("push_subscriptions")
      .select("subscription")
      .eq("user_id", telefono)
      .eq("negocio_id", negocio_id);

    if (error || !data || data.length === 0) {
      return new Response(
        JSON.stringify({ error: "Suscripción no encontrada" }),
        { status: 404, headers: corsHeaders }
      );
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

    return new Response(
      JSON.stringify({ success: true }),
      { headers: corsHeaders }
    );
  } catch (err) {
    console.error(err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: corsHeaders }
    );
  }
});
