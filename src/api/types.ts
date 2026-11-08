export const API_ORIGIN = 'https://api.quotewise.io';

export interface Quote {
	code: string;
	text: string;
	author?: string;
	title?: string;
	url?: string;
	status?: string;
	alternative?: string;
	sightings?: Sighting[];
}

export interface Sighting {
	title?: string;
	platform?: string;
	url?: string;
}

export interface QuotePage {
	quotes: Quote[];
	next?: number;
}

export function record(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown>
		: {};
}

export function string(value: unknown): string | undefined {
	return typeof value === 'string' ? value.trim() || undefined : undefined;
}

export function webUrl(value: unknown, origin?: string): string | undefined {
	try {
		const url = new URL(string(value) ?? '');
		if (url.protocol === 'https:' && !url.username && !url.password && (!origin || url.origin === origin)) {
			return url.href;
		}
	} catch {
		return undefined;
	}
	return undefined;
}

export function quoteCode(value: unknown): string | undefined {
	const code = string(value);
	return code && /^[a-z0-9]{6}$/i.test(code) ? code : undefined;
}

export function normalizeQuote(value: unknown): Quote | undefined {
	const row = record(value);
	const text = string(row.text);
	const code = quoteCode(row.short_code);
	if (!text || !code) return undefined;

	return {
		code,
		text,
		author: string(record(row.originator).full_name) ?? string(row.originator_name),
		title: string(row.framing),
		url: webUrl(row.web_url, 'https://quotewise.io'),
		status: row.is_misattributed === true ? 'Misattributed' : string(row.attribution_status) ??
			(['misattributed', 'disputed'].includes(string(row.quote_role) ?? '') ? string(row.quote_role) : undefined),
		alternative: string(record(row.correct_attribution).full_name),
	};
}

export function rows(value: unknown): unknown[] {
	if (!Array.isArray(value)) throw new Error('Quotewise returned an unexpected response. Try again later.');
	return value;
}

export function normalizePage(value: unknown, paginated: boolean, currentPage = 1): QuotePage {
	const envelope = record(value);
	const results = rows(paginated ? envelope.results : envelope.data);
	const quotes = results.flatMap((row) => normalizeQuote(row) ?? []);
	if (results.length && !quotes.length) throw new Error('Quotewise returned no readable quote records.');

	const nextUrl = string(envelope.next);
	let next: number | undefined;
	if (paginated && nextUrl) {
		try {
			const url = new URL(nextUrl, API_ORIGIN);
			const candidate = Number(url.searchParams.get('page'));
			if (url.origin === API_ORIGIN && url.pathname === '/v1/quotes/' &&
				Number.isSafeInteger(candidate) && candidate === currentPage + 1) next = candidate;
		} catch {
			// Ignore malformed pagination links.
		}
	}
	return {quotes, next};
}

export function normalizeSightings(value: unknown): Sighting[] {
	return rows(record(value).data).flatMap((item) => {
		const row = record(item);
		if (row.display_suppressed === true) return [];
		const title = string(row.source_title);
		const platform = string(row.platform);
		const url = webUrl(row.url);
		return title || platform || url ? [{title, platform, url}] : [];
	});
}
