import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
  "Access-Control-Max-Age": "86400"
};

type FlowType =
  | "post_servicio"
  | "recordatorio_habito"
  | "reactivacion"
  | "referidos"
  | "cumple"
  | "educativo";

type SegmentType =
  | "Nuevo"
  | "Frecuente"
  | "Regular"
  | "Inactivo"
  | "VIP";

interface Cliente {
  id: string;
  negocio_id: string;
  nombre: string;
  email: string;
  telefono: string | null;
  puntos: number | null;
  ultima_visita: string | null;
  created_at: string;
}

interface Payload {
  negocio_id: string;
  cliente_id?: string;
  email?: string;
  flow: FlowType;
}

function inferSegment(cliente: Cliente): SegmentType {
  const puntos = cliente.puntos ?? 0;
  const visitasEstimadas = Math.floor(puntos / 10);
  const ultima = cliente.ultima_visita ? new Date(cliente.ultima_visita) : null;
  const diasDesdeUltima = ultima
    ? Math.floor((Date.now() - ultima.getTime()) / (1000 * 60 * 60 * 24))
    : 999;

  if (visitasEstimadas <= 1) return "Nuevo";
  if (visitasEstimadas > 20) return "VIP";
  if (diasDesdeUltima > 45) return "Inactivo";
  if (diasDesdeUltima > 25) return "Regular";
  return "Frecuente";
}

function buildEmail(
  flow: FlowType,
  segment: SegmentType,
  cliente: Cliente,
  baseUrl: string
) {
  const nombre = cliente.nombre?.split(" ")[0] || "Cliente";
  const puntos = cliente.puntos ?? 0;
  const panelUrl = `${baseUrl.replace(/\/+$/, "")}/panel_cliente.html`;
  const reservarUrl = `${panelUrl}#cita`;

  if (flow === "post_servicio") {
    const subject = `¿Cómo te fue con tu corte, ${nombre}?`;
    const text =
      `Gracias por visitarnos en JBarber.\n\n` +
      `Tu corte es parte de tu flow. Queremos saber cómo te fue y ayudarte a reservar tu próxima cita antes de que se te olvide.\n\n` +
      `Puntos acumulados: ${puntos}.\n\n` +
      `Reserva tu próximo turno aquí: ${reservarUrl}\n\n` +
      `Si te gustó el servicio, invita a un amigo y ambos ganan.`;
    const html =
      `<p>Hola ${nombre},</p>` +
      `<p>Gracias por pasar por JBarber. Tu imagen es tu respeto, y queremos cuidar ese nivel.</p>` +
      `<p><strong>Puntos acumulados:</strong> ${puntos}</p>` +
      `<p>Reserva tu próxima cita antes de que se te olvide:</p>` +
      `<p><a href="${reservarUrl}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#C1121F;color:#ffffff;font-weight:700;text-decoration:none;">Reservar próxima cita</a></p>` +
      `<p>Comparte tu flow: invita a un amigo y ambos ganan beneficios.</p>`;
    return { subject, text, html };
  }

  if (flow === "recordatorio_habito") {
    const subject = `✂️ Ya casi es tu fecha habitual, ${nombre}`;
    const text =
      `Tu estilo suele renovarse cada pocas semanas.\n\n` +
      `Te recordamos que ya casi llega tu fecha ideal para retocar el corte.\n\n` +
      `Reserva aquí y mantén tu flow al día: ${reservarUrl}`;
    const html =
      `<p>Hola ${nombre},</p>` +
      `<p>Tu estilo habla por ti. Ya casi se cumple tu ciclo habitual de corte.</p>` +
      `<p>Sin descuentos, sin presión, solo hábito ganador.</p>` +
      `<p><a href="${reservarUrl}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#111111;color:#ffffff;font-weight:700;text-decoration:none;">Ver horarios y reservar</a></p>`;
    return { subject, text, html };
  }

  if (flow === "reactivacion") {
    const subject =
      segment === "VIP"
        ? `Te extrañamos en la barbería, ${nombre} 🔥`
        : `Hace tiempo que no te vemos en JBarber`;
    const baseText =
      `Hace rato no pasas por tu barbería.\n\n` +
      `Tu silla sigue siendo tuya y queremos verte de nuevo con el flow arriba.\n\n`;
    const text =
      baseText +
      `Reserva tu regreso aquí: ${reservarUrl}\n\n` +
      `Si reservas esta semana, desbloqueas un beneficio especial.`;
    const html =
      `<p>Hola ${nombre},</p>` +
      `<p>Hace tiempo que no te vemos por JBarber y tu silla te está esperando.</p>` +
      `<p>Vuelve esta semana y reactiva tu flow con un trato especial.</p>` +
      `<p><a href="${reservarUrl}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#C1121F;color:#ffffff;font-weight:700;text-decoration:none;">Volver a reservar</a></p>` +
      `<p>Tu nivel no se pierde, solo se pausa. Te esperamos.</p>`;
    return { subject, text, html };
  }

  if (flow === "referidos") {
    const subject = `👥 Invita a un amigo y ambos ganan`;
    const text =
      `Tu flow ya habla por ti.\n\n` +
      `Invita a un amigo a JBarber y ambos acumulan puntos adicionales para recompensas.\n\n` +
      `Reserva y comparte tu enlace personal desde tu panel: ${panelUrl}`;
    const html =
      `<p>Hola ${nombre},</p>` +
      `<p>Si tu corte habla bien de ti, deja que también te dé recompensas.</p>` +
      `<p>Invita a un amigo a JBarber y ambos ganan puntos para cortes y beneficios.</p>` +
      `<p><a href="${panelUrl}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#111111;color:#ffffff;font-weight:700;text-decoration:none;">Entrar a mi panel</a></p>`;
    return { subject, text, html };
  }

  if (flow === "cumple") {
    const subject = `🎉 Feliz cumpleaños, ${nombre}`;
    const text =
      `Todo buen cumpleaños merece un buen corte.\n\n` +
      `Tienes un beneficio especial válido por 7 días para celebrarlo con estilo.\n\n` +
      `Reserva tu cita aquí: ${reservarUrl}`;
    const html =
      `<p>Hola ${nombre},</p>` +
      `<p>Feliz cumpleaños. Tu imagen también celebra.</p>` +
      `<p>Tienes un beneficio especial válido por 7 días para usar en JBarber.</p>` +
      `<p><a href="${reservarUrl}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#C1121F;color:#ffffff;font-weight:700;text-decoration:none;">Agendar mi cita de cumpleaños</a></p>`;
    return { subject, text, html };
  }

  if (flow === "educativo") {
    const subject = `💡 Tip para cuidar tu corte`;
    const text =
      `Un buen corte dura más cuando lo cuidas bien.\n\n` +
      `Te compartimos contenido corto sobre cómo mantener tu cabello y peinado según tu estilo.\n\n` +
      `Cuando quieras renovar el look, agenda aquí: ${reservarUrl}`;
    const html =
      `<p>Hola ${nombre},</p>` +
      `<p>Un buen corte no es solo el día de la barbería, es lo que haces después.</p>` +
      `<p>Tip rápido: evita exceso de calor, usa producto acorde a tu tipo de cabello y no abuses de la cera.</p>` +
      `<p>Cuando toque renovar tu estilo, agenda aquí:</p>` +
      `<p><a href="${reservarUrl}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#111111;color:#ffffff;font-weight:700;text-decoration:none;">Ver horarios</a></p>`;
    return { subject, text, html };
  }

  const subject = `Tu barbería JBarber`;
  const text =
    `Tu imagen es tu respeto.\n\n` +
    `Entra a tu panel para ver puntos, historial y reservar: ${panelUrl}`;
  const html =
    `<p>Hola ${nombre},</p>` +
    `<p>Tu flow comienza cuando tú decides. Entra a tu panel para ver tus puntos, tus visitas y reservar tu próxima cita.</p>` +
    `<p><a href="${panelUrl}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#C1121F;color:#ffffff;font-weight:700;text-decoration:none;">Entrar a mi panel</a></p>`;
  return { subject, text, html };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method === "GET") {
    return new Response(
      JSON.stringify({ ok: true }),
      { headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Método no permitido" }),
      { status: 405, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(
        JSON.stringify({ error: "Faltan variables de entorno de Supabase" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") || "JBarber <no-reply@example.com>";
    const APP_BASE_URL = Deno.env.get("APP_BASE_URL") || "https://example.com";

    if (!RESEND_API_KEY) {
      return new Response(
        JSON.stringify({ error: "Falta RESEND_API_KEY" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let payload: Payload;
    try {
      payload = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "JSON inválido" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const { negocio_id, cliente_id, email, flow } = payload;
    if (!negocio_id || !flow) {
      return new Response(
        JSON.stringify({ error: "negocio_id y flow son requeridos" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    let cliente: Cliente | null = null;

    if (cliente_id) {
      const { data, error } = await supabase
        .from("clientes")
        .select("*")
        .eq("negocio_id", negocio_id)
        .eq("id", cliente_id)
        .maybeSingle();
      if (error) {
        return new Response(
          JSON.stringify({ error: "Error obteniendo cliente: " + error.message }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
      cliente = data as Cliente | null;
    } else if (email) {
      const { data, error } = await supabase
        .from("clientes")
        .select("*")
        .eq("negocio_id", negocio_id)
        .eq("email", email)
        .maybeSingle();
      if (error) {
        return new Response(
          JSON.stringify({ error: "Error obteniendo cliente: " + error.message }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
      cliente = data as Cliente | null;
    } else {
      return new Response(
        JSON.stringify({ error: "cliente_id o email requerido" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    if (!cliente || !cliente.email) {
      return new Response(
        JSON.stringify({ error: "Cliente sin email registrado" }),
        { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const segment = inferSegment(cliente);
    const template = buildEmail(flow, segment, cliente, APP_BASE_URL);

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [cliente.email],
        subject: template.subject,
        html: template.html,
        text: template.text
      })
    });

    if (!resendResponse.ok) {
      const errorText = await resendResponse.text().catch(() => "");
      return new Response(
        JSON.stringify({ error: "Error Resend: " + errorText }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const result = await resendResponse.json().catch(() => ({}));

    return new Response(
      JSON.stringify({ success: true, segment, result }),
      { headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});

