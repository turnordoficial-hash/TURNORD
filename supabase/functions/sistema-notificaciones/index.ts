import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
  "Access-Control-Max-Age": "86400",
};

const ONE_SIGNAL_APP_ID = Deno.env.get("ONE_SIGNAL_APP_ID") || "85f98db3-968a-4580-bb02-8821411a6bee";
const ONE_SIGNAL_KEY = Deno.env.get("ONE_SIGNAL_REST_API_KEY") || "";

async function enviarPush(telefono: string, title: string, body: string, url = "/panel_cliente.html") {
  if (!ONE_SIGNAL_KEY) return { ok: false, reason: "missing_onesignal_key" };
  const reqBody: Record<string, unknown> = {
    app_id: ONE_SIGNAL_APP_ID,
    headings: { en: title },
    contents: { en: body },
    url,
    include_aliases: { external_id: [String(telefono)] },
    target_channel: "push",
  };
  (reqBody as any).include_external_user_ids = [String(telefono)];
  const res = await fetch("https://api.onesignal.com/notifications", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${ONE_SIGNAL_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(reqBody),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

function ymdLocal(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function verificarTurnos(supabase: any, negocioId: string) {
  const hoy = ymdLocal(new Date());
  const { data: turnos } = await supabase
    .from("turnos")
    .select("*")
    .eq("negocio_id", negocioId)
    .eq("fecha", hoy)
    .order("created_at", { ascending: true });
  if (!turnos || turnos.length === 0) return;

  const enEspera = turnos.filter((t: any) => t.estado === "En espera");
  enEspera.forEach(async (turno: any, index: number) => {
    const posicion = index + 1;
    if (posicion <= 2 && !turno.notificado_cerca && turno.telefono) {
      await enviarPush(turno.telefono, "Tu turno está cerca ✂️", "Quedan pocas personas antes de ti.");
      await supabase.from("turnos").update({ notificado_cerca: true }).eq("id", turno.id);
    }
    if (posicion === 1 && !turno.notificado_siguiente && turno.telefono) {
      await enviarPush(turno.telefono, "Prepárate, eres el siguiente 🔔", "Serás atendido en breve.");
      await supabase.from("turnos").update({ notificado_siguiente: true }).eq("id", turno.id);
    }
  });

  const enAtencion = turnos.find((t: any) => t.estado === "En atención");
  if (enAtencion && !enAtencion.notificado_llamado && enAtencion.telefono) {
    await enviarPush(enAtencion.telefono, "Es tu turno ahora", "Te estamos llamando. ¡Pasa!");
    await supabase.from("turnos").update({ notificado_llamado: true }).eq("id", enAtencion.id);
  }
}

async function verificarRecordatoriosCitas(supabase: any, negocioId: string) {
  const { data: citas } = await supabase
    .from("citas")
    .select("*")
    .eq("negocio_id", negocioId)
    .in("estado", ["Programada", "Confirmada"]);
  if (!citas || citas.length === 0) return;

  const ahora = Date.now();
  for (const cita of citas) {
    const startTs = new Date(cita.start_at).getTime();
    const diffMin = Math.floor((startTs - ahora) / 60000);
    if (diffMin <= 60 && diffMin > 15 && !cita.recordatorio_1h && cita.cliente_telefono) {
      await enviarPush(cita.cliente_telefono, "Tu cita es en 1 hora 📅", "Te esperamos en JBarber.");
      await supabase.from("citas").update({ recordatorio_1h: true }).eq("id", cita.id);
    } else if (diffMin <= 15 && diffMin > 0 && !cita.recordatorio_15m && cita.cliente_telefono) {
      await enviarPush(cita.cliente_telefono, "Tu cita es en 15 minutos 🔔", "Ya casi es tu momento.");
      await supabase.from("citas").update({ recordatorio_15m: true }).eq("id", cita.id);
    }
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ error: "Faltan variables de entorno SUPABASE_URL/SERVICE_ROLE" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Obtener todos los negocios configurados
    const { data: negocios } = await supabase
      .from("configuracion_negocio")
      .select("negocio_id")
      .order("updated_at", { ascending: false });
    const ids = (negocios || []).map((n: any) => n.negocio_id).filter((v: any) => !!v);
    const uniqIds = Array.from(new Set(ids));

    for (const negocioId of uniqIds) {
      await verificarTurnos(supabase, negocioId);
      await verificarRecordatoriosCitas(supabase, negocioId);
    }

    return new Response(JSON.stringify({ success: true, processed: uniqIds.length }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});

