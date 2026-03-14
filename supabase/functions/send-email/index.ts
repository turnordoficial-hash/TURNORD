import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface EmailRequest {
  to: string;
  subject: string;
  template?: string;
  data?: any;
  negocio_id?: string;
  body?: string;
}

serve(async (req) => {
  console.info("--- SEND EMAIL: INICIO ---");
  
  // Manejo de CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { to, subject, template, data, body }: EmailRequest = await req.json();
    console.info(`Destinatario: ${to}`);
    console.info(`Asunto: ${subject}`);
    console.info(`Template: ${template || "Personalizado"}`);

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") || "JBarber <onboarding@resend.dev>";

    if (!RESEND_API_KEY) {
      console.error("Falta RESEND_API_KEY");
      throw new Error("Falta la variable de entorno RESEND_API_KEY");
    }

    let htmlContent = body || "";

    // --- SISTEMA DE PLANTILLAS ---
    // Renderiza el HTML basado en el template solicitado por admin/turno.js
    if (template === 'cita_recordatorio') {
        htmlContent = `
            <div style="font-family: sans-serif; color: #111; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px; overflow: hidden;">
                <div style="background-color: #C1121F; padding: 20px; text-align: center;">
                    <h1 style="color: white; margin: 0; font-size: 24px;">⏰ Recordatorio de Cita</h1>
                </div>
                <div style="padding: 20px;">
                    <p style="font-size: 16px;">Hola <strong>${data.nombre_cliente}</strong>,</p>
                    <p style="font-size: 16px;">Te recordamos que tu cita está próxima.</p>
                    
                    <div style="background-color: #f9f9f9; padding: 15px; border-radius: 8px; margin: 20px 0;">
                        <p style="margin: 5px 0;"><strong>Barbero:</strong> ${data.barbero}</p>
                        <p style="margin: 5px 0;"><strong>Hora:</strong> ${data.hora_cita}</p>
                        <p style="margin: 5px 0; color: #C1121F;"><strong>Faltan:</strong> ${data.tiempo_restante}</p>
                    </div>

                    <p style="font-size: 14px; color: #666;">Por favor, llega 5 minutos antes para mantener tu turno.</p>
                </div>
                <div style="background-color: #f1f1f1; padding: 10px; text-align: center; font-size: 12px; color: #888;">
                    <p>JBarber - Estilo & Precisión</p>
                </div>
            </div>
        `;
    } else if (template === 'cita_confirmacion') {
        htmlContent = `
            <div style="font-family: sans-serif; color: #111; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px; overflow: hidden;">
                <div style="background-color: #C1121F; padding: 20px; text-align: center;">
                    <h1 style="color: white; margin: 0; font-size: 24px;">✅ Cita Confirmada</h1>
                </div>
                <div style="padding: 20px;">
                    <p style="font-size: 16px;">Hola <strong>${data.nombre_cliente}</strong>,</p>
                    <p style="font-size: 16px;">Tu cita ha sido confirmada con éxito.</p>
                    
                    <div style="background-color: #f9f9f9; padding: 15px; border-radius: 8px; margin: 20px 0;">
                        <p style="margin: 5px 0;"><strong>Barbero:</strong> ${data.barbero}</p>
                        <p style="margin: 5px 0;"><strong>Hora:</strong> ${data.hora_cita}</p>
                        <p style="margin: 5px 0;"><strong>Servicio:</strong> ${data.servicio}</p>
                    </div>

                    <p style="font-size: 14px; color: #555;">Gracias por elegir JBarber.</p>
                </div>
                <div style="background-color: #f1f1f1; padding: 10px; text-align: center; font-size: 12px; color: #888;">
                    <p>JBarber - Estilo & Precisión</p>
                </div>
            </div>
        `;
    } else if (template === 'marketing_inactividad') {
        htmlContent = `
            <div style="font-family: sans-serif; color: #111; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px; overflow: hidden;">
                <div style="background-color: #000; padding: 20px; text-align: center;">
                    <h1 style="color: white; margin: 0; font-size: 24px;">💈 ¡Te extrañamos!</h1>
                </div>
                <div style="padding: 20px;">
                    <p style="font-size: 16px;">Hola <strong>${data.nombre_cliente}</strong>,</p>
                    <p style="font-size: 16px;">Hace <strong>${data.dias_ausente} días</strong> que no te vemos por la barbería.</p>
                    <p>Tu estilo es importante para nosotros y queremos verte fresh de nuevo.</p>
                    
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="https://tu-dominio-app.com/panel_cliente.html" style="background-color: #C1121F; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px;">Reservar Ahora</a>
                    </div>
                </div>
                <div style="background-color: #f1f1f1; padding: 10px; text-align: center; font-size: 12px; color: #888;">
                    <p>JBarber - Estilo & Precisión</p>
                </div>
            </div>
        `;
    }

    // Envío a través de la API de Resend
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [to],
        subject: subject,
        html: htmlContent,
      }),
    });

    const dataRes = await res.json();

    if (!res.ok) {
      return new Response(JSON.stringify(dataRes), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(dataRes), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
