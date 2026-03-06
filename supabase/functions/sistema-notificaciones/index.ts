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
async function enviarPush(supabase: SupabaseClient, negocioId: string, telefono: string, title: string, body: string, url = "/panel_cliente.html") {
  // OPTIMIZACIÓN: Llamada directa a OneSignal para reducir latencia y cold-starts
  let status = 'failed';
  let responseData = {};

  try {
    if (!ONE_SIGNAL_KEY) throw new Error("Missing ONE_SIGNAL_REST_API_KEY");

    const res = await fetch("https://api.onesignal.com/notifications", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${ONE_SIGNAL_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        app_id: ONE_SIGNAL_APP_ID,
        headings: { en: title, es: title },
        contents: { en: body, es: body },
        include_aliases: { external_id: [telefono] },
        target_channel: "push",
        url: url,
      }),
    });
    
    status = res.ok ? 'sent' : 'failed';
    responseData = await res.json().catch(() => ({}));

    // Log a historial (Fire and forget para no bloquear, pero idealmente await si es crítico)
    await supabase.from('notification_history').insert({
      negocio_id: negocioId,
      recipient: telefono,
      title,
      body,
      status,
      response: responseData,
      channel: 'push'
    });

    return { ok: res.ok };
  } catch (e) {
    console.error("Error sending push directly:", e);
    
    // Log error
    await supabase.from('notification_history').insert({
      negocio_id: negocioId,
      recipient: telefono,
      title,
      body,
      status: 'failed',
      response: { error: e instanceof Error ? e.message : String(e) },
      channel: 'push'
    });

    return { ok: false };
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
  
  // OPTIMIZACIÓN: Procesamiento en paralelo con Promise.all
  // En lugar de esperar uno por uno, disparamos todas las notificaciones simultáneamente
  await Promise.all(enEspera.map(async (turno: any, index: number) => {
    const posicion = index + 1;

    if (posicion <= 2 && !turno.notificado_cerca && turno.telefono) {
      const nombre = turno.nombre || "Cliente";
      const { ok } = await enviarPush(supabase, negocioId, turno.telefono, "Tu turno está cerca ✂️", `Hola ${nombre}, quedan pocas personas antes de ti.`);
      if (ok) {
        // Update sin await para no bloquear el hilo principal innecesariamente si no dependemos del resultado inmediato
        supabase.from("turnos").update({ notificado_cerca: true }).eq("id", turno.id).then();
      }
    }
    if (posicion === 1 && !turno.notificado_siguiente && turno.telefono) {
      const nombre = turno.nombre || "Cliente";
      const { ok } = await enviarPush(supabase, negocioId, turno.telefono, "Prepárate, eres el siguiente 🔔", `Hola ${nombre}, serás atendido en breve.`);
      if (ok) {
        supabase.from("turnos").update({ notificado_siguiente: true }).eq("id", turno.id).then();
      }
    }
  }));

  const enAtencion = turnos.find((t: any) => t.estado === "En atención");
  if (enAtencion && !enAtencion.notificado_llamado && enAtencion.telefono) {
    const nombre = enAtencion.nombre || "Cliente";
    const { ok } = await enviarPush(supabase, negocioId, enAtencion.telefono, "Es tu turno ahora", `¡Pasa ${nombre}! Te estamos llamando.`);
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
    
    await Promise.all(citas.map(async (cita: any) => {
      const startTs = new Date(cita.start_at).getTime();
      const diffMin = Math.floor((startTs - ahoraTs) / 60000);
      const nombreCliente = cita.clientes?.nombre || "Cliente";

      if (diffMin <= 60 && diffMin > 15 && !cita.recordatorio_1h && cita.cliente_telefono) {
        const { ok } = await enviarPush(supabase, negocioId, cita.cliente_telefono, "Tu cita es en 1 hora 📅", `Hola ${nombreCliente}, te esperamos en JBarber.`);
        if (ok) {
          supabase.from("citas").update({ recordatorio_1h: true }).eq("id", cita.id).then();
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
        const { ok } = await enviarPush(supabase, negocioId, cita.cliente_telefono, "Tu cita es en 15 minutos 🔔", `Ya casi es tu momento, ${nombreCliente}.`);
        if (ok) supabase.from("citas").update({ recordatorio_15m: true }).eq("id", cita.id).then();
      }
      
      if (diffMin <= 10 && diffMin > 0 && !cita.recordatorio_barbero_10m && cita.barber_id) {
        const hora = new Date(cita.start_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        const { ok } = await enviarPush(supabase, negocioId, String(`barber_${cita.barber_id}`), "Cita en 10 minutos 🔔", `Tienes una cita con ${nombreCliente} a las ${hora}.`);
        if (ok) supabase.from("citas").update({ recordatorio_barbero_10m: true }).eq("id", cita.id).then();
      }
    }));
  }

  // Se elimina el envío de nuevas citas por cron para operar solo por eventos INSERT
}

// Cache simple en memoria para configuraciones (Edge Cache)
let cachedNegocios: { ids: string[], timestamp: number } | null = null;

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

      console.info(`Evento recibido: ${event || 'POLLING'}`, { id: record?.id });

      if (event) {
        // Marcar evento como procesado si viene de la tabla notification_events
        // (Esto es opcional si el trigger llama directamente, pero útil para cron de reintentos)
      }
      if (event === "INSERT" && record && record.start_at) {
        // Nueva Cita
        const { data: b } = await supabase.from('barberos').select('nombre').eq('id', record.barber_id).maybeSingle();
        const { data: c } = await supabase.from('clientes').select('nombre, email').eq('telefono', record.cliente_telefono).maybeSingle();

        const nombreCliente = c?.nombre || "Un cliente";
        const hora = new Date(record.start_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const notificaciones = [];

        if (record.barber_id) {
          notificaciones.push(enviarPush(supabase, record.negocio_id, String(`barber_${record.barber_id}`), "Nueva cita asignada 💈", `Cita con ${nombreCliente} a las ${hora}.`));
        }
        if (record.cliente_telefono) {
          notificaciones.push(enviarPush(supabase, record.negocio_id, record.cliente_telefono, "Cita Confirmada ✅", `Tu cita ha sido agendada para las ${hora}.`));
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
                await enviarPush(supabase, record.negocio_id, record.telefono, "Es tu turno ahora 💈", `¡Pasa ${nombre}! Te estamos llamando.`);
            } else if (record.estado === "Cancelado") {
                await enviarPush(supabase, record.negocio_id, record.telefono, "Turno Cancelado", `Tu turno ${record.turno} ha sido cancelado.`);
            }
            // return new Response(JSON.stringify({ success: true, message: "Estado de turno procesado" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        // Cambio de Estado (Cancelación de Cita)
        if (record.start_at && record.estado === "Cancelada" && old_record.estado !== "Cancelada") {
          const { data: c } = await supabase.from('clientes').select('nombre').eq('telefono', record.cliente_telefono).maybeSingle();
          const nombreCliente = c?.nombre || "Un cliente";
          const hora = new Date(record.start_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

          // Notificar al Barbero
          await enviarPush(supabase, record.negocio_id, String(`barber_${record.barber_id}`), "Cita Cancelada ❌", `${nombreCliente} ha cancelado su cita de las ${hora}.`);
          // Notificar al Cliente
          await enviarPush(supabase, record.negocio_id, record.cliente_telefono, "Cita Cancelada", `Has cancelado tu cita de las ${hora}.`);
          // return new Response(JSON.stringify({ success: true, message: "Cancelación de cita procesada" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }
    }

    // --- POLLING DE CRON (LLAMADO SIN BODY O SIN EVENTO) ---
    // Obtener todos los negocios configurados
    let uniqIds: string[] = [];
    
    // Edge Cache: Usar caché en memoria si es reciente (< 60s)
    if (cachedNegocios && (Date.now() - cachedNegocios.timestamp < 60000)) {
        uniqIds = cachedNegocios.ids;
    } else {
        const { data: negocios, error: negociosError } = await supabase
          .from("configuracion_negocio")
          .select("negocio_id")
          .order("updated_at", { ascending: false });

        if (negociosError) {
          console.error("Error fetching negocios:", negociosError);
          throw negociosError;
        }
        
        if (negocios) {
            const ids = negocios.map((n: any) => n.negocio_id).filter(Boolean);
            uniqIds = Array.from(new Set(ids));
            // Actualizar caché
            cachedNegocios = { ids: uniqIds, timestamp: Date.now() };
        }
    }

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
