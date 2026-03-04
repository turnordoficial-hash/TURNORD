import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// Define tipos para mejorar la legibilidad y seguridad
type Turno = {
  id: number;
  telefono?: string;
  nombre?: string;
  notificado_cerca?: boolean;
  notificado_siguiente?: boolean;
  notificado_llamado?: boolean;
  negocio_id: string; // Añadido para consistencia
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
  negocio_id: string; // Añadido para consistencia
  clientes?: { nombre: string };
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
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-push-notification`, {
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

// ✅ 1.5. Envío de correos via Edge Function
async function enviarEmail(to: string, subject: string, template: string, data: any) {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return { ok: false };
  
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to, subject, template, data }),
    });
    return { ok: res.ok };
  } catch (e) {
    console.error("Error enviando email:", e);
    return { ok: false };
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
      const nombre = turno.nombre || "Cliente";
      const { ok } = await enviarPush(turno.telefono, "Tu turno está cerca ✂️", `Hola ${nombre}, quedan pocas personas antes de ti.`);
      if (ok) {
        await supabase.from("turnos").update({ notificado_cerca: true }).eq("id", turno.id);
      }
    }
    if (posicion === 1 && !turno.notificado_siguiente && turno.telefono) {
      const nombre = turno.nombre || "Cliente";
      const { ok } = await enviarPush(turno.telefono, "Prepárate, eres el siguiente 🔔", `Hola ${nombre}, serás atendido en breve.`);
      if (ok) {
        await supabase.from("turnos").update({ notificado_siguiente: true }).eq("id", turno.id);
      }
    }
  }

  const enAtencion = turnos.find((t: any) => t.estado === "En atención");
  if (enAtencion && !enAtencion.notificado_llamado && enAtencion.telefono) {
    const nombre = enAtencion.nombre || "Cliente";
    const { ok } = await enviarPush(enAtencion.telefono, "Es tu turno ahora", `¡Pasa ${nombre}! Te estamos llamando.`);
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

  // ✅ 5. Filtro optimizado en consulta con JOIN a clientes
  const { data: citas, error: citasError } = await supabase
    .from("citas")
    .select<"*", Cita>("*, clientes(nombre)")
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
      const nombreCliente = cita.clientes?.nombre || "Cliente";

      if (diffMin <= 60 && diffMin > 15 && !cita.recordatorio_1h && cita.cliente_telefono) {
        const { ok } = await enviarPush(cita.cliente_telefono, "Tu cita es en 1 hora 📅", `Hola ${nombreCliente}, te esperamos en JBarber.`);
        if (ok) {
          await supabase.from("citas").update({ recordatorio_1h: true }).eq("id", cita.id);
          // También enviar email de recordatorio
          const { data: cliente } = await supabase.from('clientes').select('email').eq('telefono', cita.cliente_telefono).maybeSingle();
          if (cliente?.email) {
            await enviarEmail(cliente.email, "⏰ Recordatorio: Cita en 1 hora", "cita_recordatorio", {
              nombre_cliente: nombreCliente,
              barbero: "Tu Barbero", // Podríamos traer el nombre real con un join
              hora_cita: new Date(cita.start_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              tiempo_restante: "1 hora"
            });
          }
        }
      } else if (diffMin <= 15 && diffMin > 0 && !cita.recordatorio_15m && cita.cliente_telefono) {
        const { ok } = await enviarPush(cita.cliente_telefono, "Tu cita es en 15 minutos 🔔", `Ya casi es tu momento, ${nombreCliente}.`);
        if (ok) await supabase.from("citas").update({ recordatorio_15m: true }).eq("id", cita.id);
      }
      
      if (diffMin <= 10 && diffMin > 0 && !cita.recordatorio_barbero_10m && cita.barber_id) {
        const hora = new Date(cita.start_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        const { ok } = await enviarPush(String(`barber_${cita.barber_id}`), "Cita en 10 minutos 🔔", `Tienes una cita con ${nombreCliente} a las ${hora}.`);
        if (ok) await supabase.from("citas").update({ recordatorio_barbero_10m: true }).eq("id", cita.id);
      }
    }
  }

  // Se elimina el envío de nuevas citas por cron para operar solo por eventos INSERT
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

    // --- MANEJO DE EVENTOS (LLAMADO DESDE TRIGGERS) ---
    if (req.method === "POST") {
      const payload = await req.json().catch(() => ({}));
      const { event, record, old_record } = payload;

    // Manejo de eventos INSERT/UPDATE/DELETE provenientes de triggers SQL
      if (event === "INSERT" && record && record.start_at) {
        // Nueva Cita
        const { data: b } = await supabase.from('barberos').select('nombre').eq('id', record.barber_id).maybeSingle();
        const { data: c } = await supabase.from('clientes').select('nombre, email').eq('telefono', record.cliente_telefono).maybeSingle();

        const nombreCliente = c?.nombre || "Un cliente";
        const hora = new Date(record.start_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const notificaciones = [];

        if (record.barber_id) {
          notificaciones.push(enviarPush(String(`barber_${record.barber_id}`), "Nueva cita asignada 💈", `Cita con ${nombreCliente} a las ${hora}.`));
        }
        if (record.cliente_telefono) {
          notificaciones.push(enviarPush(record.cliente_telefono, "Cita Confirmada ✅", `Tu cita ha sido agendada para las ${hora}.`));
        }

        const resultados = await Promise.all(notificaciones);

        if (c?.email) {
          await enviarEmail(c.email, "✅ Cita Confirmada", "cita_confirmacion", {
            nombre_cliente: nombreCliente,
            barbero: b?.nombre || "Tu Barbero",
            hora_cita: hora,
            servicio: record.servicio
          });
        }

        if (resultados.length > 0 && resultados.every(r => r.ok)) {
          await supabase.from("citas").update({ notificado_barbero: true }).eq("id", record.id);
        }

        // return new Response(JSON.stringify({ success: true, message: "Evento procesado (cita creada)" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (event === "UPDATE" && record && old_record) {
        // Si el orden cambió, simplemente ejecutamos la verificación global de ese negocio
        if (record.orden !== old_record.orden) {
            await verificarTurnos(supabase, record.negocio_id);
            // return new Response(JSON.stringify({ success: true, message: "Posición actualizada" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        
        // Cambio de Estado o Posición en Turnos
        if (record.turno && record.estado !== old_record.estado) {
            const nombre = record.nombre || "Cliente";
            if (record.estado === "En atención") {
                await enviarPush(record.telefono, "Es tu turno ahora 💈", `¡Pasa ${nombre}! Te estamos llamando.`);
            } else if (record.estado === "Cancelado") {
                await enviarPush(record.telefono, "Turno Cancelado", `Tu turno ${record.turno} ha sido cancelado.`);
            }
            // return new Response(JSON.stringify({ success: true, message: "Estado de turno procesado" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        // Cambio de Estado (Cancelación de Cita)
        if (record.start_at && record.estado === "Cancelada" && old_record.estado !== "Cancelada") {
          const { data: c } = await supabase.from('clientes').select('nombre').eq('telefono', record.cliente_telefono).maybeSingle();
          const nombreCliente = c?.nombre || "Un cliente";
          const hora = new Date(record.start_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

          // Notificar al Barbero
          await enviarPush(String(`barber_${record.barber_id}`), "Cita Cancelada ❌", `${nombreCliente} ha cancelado su cita de las ${hora}.`);
          // Notificar al Cliente
          await enviarPush(record.cliente_telefono, "Cita Cancelada", `Has cancelado tu cita de las ${hora}.`);
          // return new Response(JSON.stringify({ success: true, message: "Cancelación de cita procesada" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }
    }

    // --- POLLING DE CRON (LLAMADO SIN BODY O SIN EVENTO) ---
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
