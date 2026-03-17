import { redirect } from '@sveltejs/kit';
import { owo } from '$lib/server/owo';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { user } = await parent();
	if (!user) {
		throw redirect(302, '/login');
	}

	try {
		// Fetch initial billing data for the user
		const [invoicesRes, plansRes, checkRes, premiumCheck] = await Promise.all([
			owo.billing.invoices({ customer: user.id }).catch(() => ({ invoices: [] })),
			owo.plans().catch(() => ({ plans: [] })),
            owo.check({ customer: user.id, feature: 'ai-credits', value: 0 }).catch(() => null),
            owo.check({ customer: user.id, feature: 'premium-models', value: 0 }).catch(() => null)
		]);

		return {
			invoices: invoicesRes?.invoices || [],
			plans: plansRes?.plans || [],
            checkResult: checkRes,
            isPremium: premiumCheck?.allowed || false,
            user
		};
	} catch (e) {
		console.error('Error fetching dashboard data:', e);
		return {
			invoices: [],
			plans: [],
            checkResult: null,
            isPremium: false,
            user
		};
	}
};
