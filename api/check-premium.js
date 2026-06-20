import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  // --- CORS headers ---
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  // --- end CORS headers ---

  const { code } = req.query;

  if (!code) {
    return res.status(400).json({ premium: false, error: 'Missing code' });
  }

  try {
    // List all checkout sessions (no payment_status filter)
    const sessions = await stripe.checkout.sessions.list({
      limit: 100,
    });

    for (const session of sessions.data) {
      // Only check paid sessions
      if (session.payment_status !== 'paid') continue;

        // Only check sessions with a subscription
        if (!session.subscription) continue;

        // Retrieve the subscription and check if it's active or in trial
        const subscription = await stripe.subscriptions.retrieve(session.subscription);
        if (subscription.status !== 'active' && subscription.status !== 'trialing') continue;

        // Fetch session details to get custom fields
        const sessionDetails = await stripe.checkout.sessions.retrieve(session.id, {
          expand: ['custom_fields'],
        });

        if (sessionDetails.custom_fields && Array.isArray(sessionDetails.custom_fields)) {
          const accessCodeField = sessionDetails.custom_fields.find(
            field =>
              field.key === 'hookaccesscode' ||
              field.label?.custom === 'Hook Access Code'
          );
          if (
            accessCodeField &&
            accessCodeField.text?.value &&
            accessCodeField.text.value.trim().toLowerCase() === code.trim().toLowerCase()
          ) {
            return res.status(200).json({ premium: true });
          }
        }
    }

    // Not found
    return res.status(200).json({ premium: false });
  } catch (err) {
    return res.status(500).json({ premium: false, error: err.message });
  }
}
