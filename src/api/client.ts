import type {RequestUrlParam, RequestUrlResponse} from 'obsidian';
import {API_ORIGIN, normalizePage, normalizeQuote, normalizeSightings, quoteCode} from './types';

export type SearchMode = 'text' | 'semantic' | 'author';
export type Transport = (options: RequestUrlParam) => Promise<RequestUrlResponse>;

export class QuotewiseClient {
	private retryAt = 0;

	constructor(private readonly send: Transport, private readonly key: () => string | null) {}

	private async request(path: string, body?: object): Promise<unknown> {
		const key = this.key()?.trim();
		if (!key) throw new Error('Add a Quotewise API key in the plugin settings to use quote discovery.');
		if (Date.now() < this.retryAt) throw new Error('Quotewise is rate limited. Wait before trying again.');

		let response: RequestUrlResponse;
		try {
			response = await this.send({
				url: API_ORIGIN + path,
				method: body ? 'POST' : 'GET',
				contentType: body ? 'application/json' : undefined,
				body: body ? JSON.stringify(body) : undefined,
				headers: {Authorization: 'Bearer ' + key, Accept: 'application/json'},
				throw: false,
			});
		} catch {
			throw new Error('Could not reach Quotewise. Check your connection and try again.');
		}
		if (response.status === 429) {
			const header = Object.entries(response.headers).find(([name]) => name.toLowerCase() === 'retry-after')?.[1];
			const seconds = header && /^\d+$/.test(header) ? Number(header) * 1000 : NaN;
			const wait = Number.isFinite(seconds) ? seconds : Date.parse(header ?? '') - Date.now();
			this.retryAt = Date.now() + (Number.isFinite(wait) ? Math.max(1000, wait) : 30000);
			throw new Error('Quotewise rate limit or credit quota reached. Wait or check usage in your developer dashboard.');
		}
		if (response.status === 401 || response.status === 403) {
			throw new Error('Quotewise denied access. Check your API key and plan in the developer dashboard.');
		}
		if (response.status < 200 || response.status >= 300) {
			throw new Error('Quotewise could not complete this request (HTTP ' + response.status + ').');
		}
		try {
			return JSON.parse(response.text) as unknown;
		} catch {
			throw new Error('Quotewise returned an unreadable response. Try again later.');
		}
	}

	async testConnection(): Promise<void> {
		normalizePage(await this.request('/v1/quotes/?page_size=1'), true);
	}

	async search(mode: Exclude<SearchMode, 'author'>, query: string, page = 1) {
		if (mode === 'semantic') {
			return normalizePage(await this.request('/v1/quotes/similar_by_text/', {
				text: query,
				page_size: 15,
			}), false);
		}
		const params = new URLSearchParams({page: String(page), page_size: '15'});
		params.set('q', query);
		return normalizePage(await this.request('/v1/quotes/?' + params.toString()), true, page);
	}

	async detail(code: string) {
		const quote = normalizeQuote(await this.request(this.quotePath(code)));
		if (!quote || quote.code !== code) throw new Error('Quotewise returned an unexpected quote record.');
		return quote;
	}

	async sightings(code: string) {
		return normalizeSightings(await this.request(this.quotePath(code) + 'sightings/'));
	}

	async similar(code: string) {
		return normalizePage(await this.request(this.quotePath(code) + 'similar/'), false);
	}

	private quotePath(code: string): string {
		if (!quoteCode(code)) throw new Error('Invalid Quotewise quote reference.');
		return '/v1/quotes/' + code + '/';
	}
}
