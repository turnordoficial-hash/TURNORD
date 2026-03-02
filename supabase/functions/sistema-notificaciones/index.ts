import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// Define tipos para mejorar la legibilidad y seguridad
type Turno = {
  id: number;
  telefono?: string;
  notificado_cerca?: boolean;
  notificado_siguiente?: boolean;
  notificado_llamado?: boolean;
  estado: string;
};

type Cita = {
  id: number;
  cliente_telefono?: string;
  barber_id?: number;
  start_at: string;
  recordatorio_1h?: boolean;
  recordatorio_15m?: boolean;
  recordatorio_barbero_10m?: boolean;
  notificado_barbero?: boolean;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
  "Access-Control-Max-Age": "86400",
};

const ONE_SIGNAL_APP_ID = Deno.env.get("ONE_SIGNAL_APP_ID") || "85f98db3-968a-4580-bb02-8821411a6bee";
const ONE_SIGNAL_KEY = Deno.env.get("ONE_SIGNAL_REST_API_KEY") || "";

console.info("Hello from Functions!");

// ✅ 1. Uso correcto de OneSignal API
async function enviarPush(telefono: string, title: string, body: string, url = "/panel_cliente.html") {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing SUPABASE_URL or SERVICE_ROLE for sender invocation.");
    return { ok: false, reason: "missing_service_role" };
  }
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-onesignal-notification`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ telefono, title, body, url }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error("Sender function error:", data);
    }
    return { ok: res.ok, data };
  } catch (e) {
    console.error("Network error invoking sender function:", e);
    return { ok: false, data: { error: e.message } };
  }
}

// ✅ 6. Manejo más seguro de fechas
function ymdLocal(d: Date): string {
  // Intl.DateTimeFormat es más robusto y evita problemas de zona horaria
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'America/Santo_Domingo', // Ajusta a tu zona horaria local
  }).format(d);
}

// ✅ Función de turnos completamente refactorizada
async function verificarTurnos(supabase: SupabaseClient, negocioId: string) {
  const hoy = ymdLocal(new Date());
  
  // ✅ 5. Filtro optimizado en consulta
  const { data: turnos, error } = await supabase
    .from("turnos")
    .select<"*", Turno>("*")
    .eq("negocio_id", negocioId)
    .eq("fecha", hoy)
    .in("estado", ["En espera", "En atención"]) // Filtra desde SQL
    .order("orden", { ascending: true }) // Usar 'orden' es más fiable que 'created_at' para la posición
    .order("created_at", { ascending: true });

  // ✅ 3. Validación de errores Supabase
  if (error) {
    console.error(`[${negocioId}] Error fetching turns:`, error);
    return;
  }
  if (!turnos || turnos.length === 0) return;

  const enEspera = turnos.filter((t: any) => t.estado === "En espera");
  
  // ✅ 2. Reemplazo de forEach por for...of para manejar asincronía correctamente
  for (const [index, turno] of enEspera.entries()) {
    const posicion = index + 1;

    if (posicion <= 2 && !turno.notificado_cerca && turno.telefono) {
      const { ok } = await enviarPush(turno.telefono, "Tu turno está cerca ✂️", "Quedan pocas personas antes de ti.");
      if (ok) {
        await supabase.from("turnos").update({ notificado_cerca: true }).eq("id", turno.id);
      }
    }
    if (posicion === 1 && !turno.notificado_siguiente && turno.telefono) {
      const { ok } = await enviarPush(turno.telefono, "Prepárate, eres el siguiente 🔔", "Serás atendido en breve.");
      if (ok) {
        await supabase.from("turnos").update({ notificado_siguiente: true }).eq("id", turno.id);
      }
    }
  }

  const enAtencion = turnos.find((t: any) => t.estado === "En atención");
  if (enAtencion && !enAtencion.notificado_llamado && enAtencion.telefono) {
    const { ok } = await enviarPush(enAtencion.telefono, "Es tu turno ahora", "Te estamos llamando. ¡Pasa!");
    if (ok) {
      await supabase.from("turnos").update({ notificado_llamado: true }).eq("id", enAtencion.id);
    }
  }
}

// ✅ Función de citas completamente refactorizada
async function verificarRecordatoriosCitas(supabase: SupabaseClient, negocioId: string) {
  const ahora = new Date();
  // Rango de tiempo más preciso: desde ahora hasta 61 minutos en el futuro
  const unaHoraDespues = new Date(ahora.getTime() + 61 * 60 * 1000);

  // ✅ 5. Filtro optimizado en consulta
  const { data: citas, error: citasError } = await supabase
    .from("citas")
    .select<"*", Cita>("*")
    .eq("negocio_id", negocioId)
    .in("estado", ["Programada", "Confirmada"])
    .gte("start_at", ahora.toISOString())
    .lte("start_at", unaHoraDespues.toISOString());

  // ✅ 3. Validación de errores Supabase
  if (citasError) {
    console.error(`[${negocioId}] Error fetching appointment reminders:`, citasError);
    // No retornamos aquí para permitir que se verifiquen las citas nuevas
  }

  if (citas && citas.length > 0) {
    const ahoraTs = ahora.getTime();
    for (const cita of citas) {
      const startTs = new Date(cita.start_at).getTime();
      const diffMin = Math.floor((startTs - ahoraTs) / 60000);

      if (diffMin <= 60 && diffMin > 15 && !cita.recordatorio_1h && cita.cliente_telefono) {
        const { ok } = await enviarPush(cita.cliente_telefono, "Tu cita es en 1 hora 📅", "Te esperamos en JBarber.");
        if (ok) await supabase.from("citas").update({ recordatorio_1h: true }).eq("id", cita.id);
      } else if (diffMin <= 15 && diffMin > 0 && !cita.recordatorio_15m && cita.cliente_telefono) {
        const { ok } = await enviarPush(cita.cliente_telefono, "Tu cita es en 15 minutos 🔔", "Ya casi es tu momento.");
        if (ok) await supabase.from("citas").update({ recordatorio_15m: true }).eq("id", cita.id);
      }
      
      if (diffMin <= 10 && diffMin > 0 && !cita.recordatorio_barbero_10m && cita.barber_id) {
        const hora = new Date(cita.start_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        const { ok } = await enviarPush(String(`barber_${cita.barber_id}`), "Cita en 10 minutos 🔔", `Tienes una cita a las ${hora}.`);
        if (ok) await supabase.from("citas").update({ recordatorio_barbero_10m: true }).eq("id", cita.id);
      }
    }
  }

  // Notificar al barbero/administración por nuevas citas (creadas recientemente)
  const cincoMinAgo = new Date(Date.now() - 5 * 60000).toISOString();
  const { data: nuevas, error: nuevasError } = await supabase
    .from("citas")
    .select<"*, barber_id, cliente_telefono, start_at, created_at", Cita>("id, barber_id, cliente_telefono, start_at, created_at")
    .eq("negocio_id", negocioId)
    .eq("notificado_barbero", false)
    .gte("created_at", cincoMinAgo);

  if (nuevasError) {
    console.error(`[${negocioId}] Error fetching new appointments:`, nuevasError);
    return;
  }

  if (nuevas && nuevas.length > 0) {
    for (const c of nuevas) {
      const hora = c.start_at ? new Date(c.start_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
      
      // ✅ 4. Control de rate limit: Usar Promise.all para enviar en paralelo pero esperar a que terminen
      const notificaciones = [];
      
      // Notificación a admin
      notificaciones.push(enviarPush(String(`admin_${negocioId}`), "Nueva cita programada 📅", `Se creó una cita a las ${hora}.`));
      
      // Notificación a barbero
      if (c.barber_id) {
        notificaciones.push(enviarPush(String(`barber_${c.barber_id}`), "Nueva cita asignada 📅", `Tienes una cita a las ${hora}.`));
      }

      const resultados = await Promise.all(notificaciones);
      
      // Si todas las notificaciones fueron exitosas, actualiza la base de datos
      if (resultados.every(r => r.ok)) {
        await supabase.from("citas").update({ notificado_barbero: true }).eq("id", c.id);
      }
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
    const { data: negocios, error: negociosError } = await supabase
      .from("configuracion_negocio")
      .select("negocio_id")
      .order("updated_at", { ascending: false });

    if (negociosError) {
      console.error("Error fetching negocios:", negociosError);
      throw negociosError;
    }

    const ids = (negocios || []).map((n: any) => n.negocio_id).filter(Boolean);
    const uniqIds = Array.from(new Set(ids));

    // Procesar todos los negocios en paralelo para mayor eficiencia
    await Promise.all(uniqIds.map(negocioId => Promise.all([
      verificarTurnos(supabase, negocioId),
      verificarRecordatoriosCitas(supabase, negocioId)
    ])));

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
