const STRIPE_API_BASE = 'https://api.stripe.com/v1';
const ACCESS_CODE_KEYS = ['hookaccesscode'];
const ACCESS_CODE_LABELS = ['Hook Access Code'];

async function stripeRequest(path, stripeSecretKey) {
	const response = await fetch(`${STRIPE_API_BASE}${path}`, {
		headers: {
			Authorization: `Bearer ${stripeSecretKey}`,
		},
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Stripe request failed (${response.status}): ${body}`);
	}

	return response.json();
}

function normalize(value) {
	return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function extractAccessCode(session) {
	for (const field of session?.custom_fields || []) {
		if (!field || field.type !== 'text' || !field.text) {
			continue;
		}

		const key = normalize(field.key);
		const label = normalize(field.label?.custom);
		const value = typeof field.text.value === 'string' ? field.text.value.trim() : '';

		if ((ACCESS_CODE_KEYS.includes(key) || ACCESS_CODE_LABELS.includes(label)) && value) {
			return value;
		}

		if ((key === 'threadlineaccesscode' || label === 'threadline access code') && value) {
			return value;
		}
	}

	return '';
}

function subscriptionIsEligible(subscription) {
	return subscription?.status === 'active' || subscription?.status === 'trialing';
}

function subscriptionHasTargetItem(subscription) {
	return (subscription?.items?.data || []).some((item) => {
		const price = item.price;
		const productId = typeof price?.product === 'string' ? price.product : price?.product?.id;
		return price?.id === 'price_1TcwKdIp3RW2iH2OlyDvbEUz' && productId === 'prod_UcAfvJIroYVHIz';
	});
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

async function findMatchingCheckoutSession(accessCode, stripeSecretKey) {
	let startingAfter = null;

	while (true) {
		const params = new URLSearchParams();
		params.set('limit', '100');
		if (startingAfter) {
			params.set('starting_after', startingAfter);
		}

		const sessions = await stripeRequest(`/checkout/sessions?${params.toString()}`, stripeSecretKey);
		const data = sessions?.data || [];

		for (const session of data) {
			const sessionDetails = await stripeRequest(
				`/checkout/sessions/${encodeURIComponent(session.id)}?expand[]=custom_fields`,
				stripeSecretKey,
			);

			if (normalize(extractAccessCode(sessionDetails)) !== normalize(accessCode)) {
				continue;
			}

			const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
			if (!subscriptionId) {
				continue;
			}

			const subscription = await stripeRequest(
				`/subscriptions/${encodeURIComponent(subscriptionId)}?expand[]=items.data.price.product`,
				stripeSecretKey,
			);

			if (subscriptionIsEligible(subscription) && subscriptionHasTargetItem(subscription)) {
				return true;
			}
		}

		if (!sessions?.has_more || data.length === 0) {
			return false;
		}

		startingAfter = data[data.length - 1].id;
	}
}

export default async function handler(req, res) {
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

	if (req.method === 'OPTIONS') {
		return res.status(200).end();
	}

	const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
	if (typeof stripeSecretKey !== 'string' || !stripeSecretKey.trim()) {
		return res.status(500).send('false');
	}

	const accessCode = getQueryCode(req);
	if (!accessCode) {
		return res.status(400).send('false');
	}

	try {
		const allowed = await findMatchingCheckoutSession(accessCode, stripeSecretKey);
		return res.status(200).send(allowed ? 'true' : 'false');
	} catch (error) {
		return res.status(500).send('false');
	}
}
