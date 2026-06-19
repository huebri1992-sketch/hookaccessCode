function normalize(value) {
	return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function getQueryCode(request) {
	const url = new URL(request.url);

	const direct = url.searchParams.get('code') || url.searchParams.get('customer');
	if (direct) {
		return direct.trim();
	}

	for (const [key, value] of url.searchParams.entries()) {
		if (key && !value) {
			return key.trim();
		}
	}

	const firstKey = url.searchParams.keys().next().value;
	return firstKey ? firstKey.trim() : '';
}

export default async function handler(req, res) {
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

	if (req.method === 'OPTIONS') {
		return res.status(200).end();
	}

	const accessCode = getQueryCode(req);
	if (!accessCode) {
		return res.status(400).send('false');
	}

	try {
		const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
		if (typeof stripeSecretKey !== 'string' || !stripeSecretKey.trim()) {
			return res.status(500).send('false');
		}

		const { default: Stripe } = await import('stripe');
		const stripe = new Stripe(stripeSecretKey);

		const sessions = await stripe.checkout.sessions.list({
			limit: 100,
		});

		for (const session of sessions.data) {
			if (session.payment_status === 'unpaid') continue;
			if (!session.subscription) continue;

			const subscription = await stripe.subscriptions.retrieve(session.subscription, {
			expand: ['items.data.price.product'],
			});
			if (!['active', 'trialing'].includes(subscription.status)) continue;

			const sessionDetails = await stripe.checkout.sessions.retrieve(session.id, {
				expand: ['custom_fields'],
			});

			if (sessionDetails.custom_fields && Array.isArray(sessionDetails.custom_fields)) {
				const accessCodeField = sessionDetails.custom_fields.find(
					(field) => {
						const key = normalize(field?.key);
						const label = normalize(field?.label?.custom);
						return key === 'hookaccesscode' || label === 'hook access code' || key === 'threadlineaccesscode' || label === 'threadline access code';
					},
				);

				if (
					accessCodeField &&
					accessCodeField.text?.value &&
					normalize(accessCodeField.text.value) === normalize(accessCode)
				) {
					const hasTargetItem = (subscription.items?.data || []).some((item) => {
						const price = item.price;
						const productId = typeof price?.product === 'string' ? price.product : price?.product?.id;
						return price?.id === 'price_1TcwKdIp3RW2iH2OlyDvbEUz' && productId === 'prod_UcAfvJIroYVHIz';
					});

					if (hasTargetItem) {
						return res.status(200).send('true');
					}
				}
			}
		}

		return res.status(200).send('false');
	} catch (error) {
		return res.status(500).send('false');
	}
}
