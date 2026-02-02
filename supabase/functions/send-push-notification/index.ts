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

    const { telefono, negocio_id, title, body } = await req.json();

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
      .eq("negocio_id", negocio_id)
      .single();

    if (error || !data) {
      return new Response(
        JSON.stringify({ error: "Suscripción no encontrada" }),
        { status: 404, headers: corsHeaders }
      );
    }

    const payload = JSON.stringify({
      title: title || "¡Es tu turno!",
      body: body || "Un barbero te está esperando",
      icon: "/android-chrome-192x192.png",
      url: "/usuario_barberia005.html",
    });

    await webpush.sendNotification(data.subscription, payload);

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
