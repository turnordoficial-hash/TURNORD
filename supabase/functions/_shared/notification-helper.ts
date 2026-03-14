
export interface NotificationPayload {
  telefono: string;
  title: string;
  body: string;
  url?: string;
  negocio_id?: string;
}

export async function sendPushInternal(payload: NotificationPayload): Promise<{ ok: boolean; data?: any; error?: string }> {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, error: "Missing environment variables" };
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-onesignal-notification`, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, data, error: data.error || "HTTP Error" };
    }
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export function ymdLocal(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'America/Santo_Domingo',
  }).format(d);
}
