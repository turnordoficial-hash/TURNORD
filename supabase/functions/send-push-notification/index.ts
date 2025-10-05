import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import * as webpush from 'https://deno.land/x/web_push@0.3.0/mod.ts';

// Define CORS headers to be used in all responses.
// For production, it's more secure to specify the exact origin instead of '*'.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// VAPID keys should be stored as environment variables in your Supabase project.
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.error('VAPID keys are not set in environment variables.');
}

const VAPID_MAILTO = Deno.env.get('VAPID_MAILTO');
if (!VAPID_MAILTO) {
  console.error('VAPID_MAILTO is not set in environment variables.');
}

webpush.setVapidDetails(
  `mailto:${VAPID_MAILTO}`,
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

serve(async (req) => {
  // Handle CORS preflight requests.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', // Use service_role key for admin access
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    const { telefono, negocio_id, message } = await req.json();

    if (!telefono || !negocio_id) {
      return new Response(
        JSON.stringify({ error: 'Missing telefono or negocio_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: subscriptionData, error: fetchError } = await supabaseClient
      .from('push_subscriptions')
      .select('subscription')
      .eq('user_id', telefono)
      .eq('negocio_id', negocio_id)
      .single();

    if (fetchError || !subscriptionData) {
      return new Response(
        JSON.stringify({ error: 'Subscription not found', details: fetchError?.message }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const payload = JSON.stringify({
      title: message.title || '¡Es tu turno!',
      body: message.body || 'Un barbero te está esperando. ¡Dirígete al local!',
      icon: 'imegenlogin/android-chrome-192x192.png',
      url: `/usuario_barberia005.html`
    });

    await webpush.sendNotification(subscriptionData.subscription, payload);

    return new Response(
      JSON.stringify({ success: true, message: 'Push notification sent successfully.' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    // Handle potential errors, such as an expired subscription (410 Gone).
    if (error.statusCode === 410) {
      const { telefono, negocio_id } = await req.json();
      const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      );
      await supabaseClient
        .from('push_subscriptions')
        .delete()
        .eq('user_id', telefono)
        .eq('negocio_id', negocio_id);
      console.log(`Deleted expired subscription for ${telefono}`);
    }

    return new Response(
      JSON.stringify({ error: 'Failed to send push notification', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});