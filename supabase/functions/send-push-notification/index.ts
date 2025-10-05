import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import * as webpush from 'https://deno.land/x/web_push@0.3.0/mod.ts';

// VAPID keys should be stored as environment variables in your Supabase project.
// IMPORTANT: The public key MUST match the one used in the frontend (usuario/usuario.js).
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.error('VAPID keys are not set in environment variables.');
}

webpush.setVapidDetails(
  'mailto:your-email@example.com', // Replace with your email
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

serve(async (req) => {
  // 1. Initialize Supabase client
  const supabaseClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
  );

  // 2. Extract phone number and business ID from the request body
  const { telefono, negocio_id, message } = await req.json();

  if (!telefono || !negocio_id) {
    return new Response(
      JSON.stringify({ error: 'Missing telefono or negocio_id' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // 3. Fetch the push subscription from the database
  const { data: subscriptionData, error: fetchError } = await supabaseClient
    .from('push_subscriptions')
    .select('subscription')
    .eq('user_id', telefono)
    .eq('negocio_id', negocio_id)
    .single();

  if (fetchError || !subscriptionData) {
    return new Response(
      JSON.stringify({ error: 'Subscription not found', details: fetchError?.message }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // 4. Prepare the notification payload
  const payload = JSON.stringify({
    title: message.title || '¡Es tu turno!',
    body: message.body || 'Un barbero te está esperando. ¡Dirígete al local!',
    icon: 'imegenlogin/android-chrome-192x192.png',
    url: `/usuario_barberia005.html` // URL to open on click
  });

  // 5. Send the push notification
  try {
    await webpush.sendNotification(subscriptionData.subscription, payload);
    console.log(`Push notification sent to ${telefono}`);
    return new Response(
      JSON.stringify({ success: true, message: 'Push notification sent successfully.' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error sending push notification:', error);
    // If the subscription is expired or invalid, it might be a good idea to delete it
    if (error.statusCode === 410) {
      await supabaseClient
        .from('push_subscriptions')
        .delete()
        .eq('user_id', telefono)
        .eq('negocio_id', negocio_id);
      console.log(`Deleted expired subscription for ${telefono}`);
    }
    return new Response(
      JSON.stringify({ error: 'Failed to send push notification', details: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});