import type {Transport} from './client';
import {normalizePage, normalizeQuote, record, rows, string} from './types';

function parseJson(value: string): unknown {
	try {
		return JSON.parse(value) as unknown;
	} catch {
		throw new Error('Quotewise returned an unreadable attribution response.');
	}
}

export function normalizeAttribution(value: unknown) {
	const data = record(value);
	const matches = rows(data.results).flatMap((item) => {
		const quote = normalizeQuote(item);
		return quote ? [{...quote, status: string(record(item).attribution_status)}] : [];
	});
	const alternatives = Array.isArray(data.alternatives) ? data.alternatives.flatMap((item: unknown) => {
		const row = record(item);
		const author = string(row.originator);
		const text = string(row.text);
		return author && text ? [{author, text}] : [];
	}) : [];
	const score = data.confidence;
	return {
		matches,
		alternatives,
		correction: normalizeQuote(data.correct_attribution),
		status: string(data.attribution_status),
		confidence: typeof score === 'number' && score >= 0 && score <= 100 ? score : undefined,
	};
}

// Quotewise's MCP transport currently responds without assigning a session.
export class QuotewiseMcpClient {
	private retryAt = 0;

	constructor(private readonly send: Transport, private readonly getKey: () => string | null) {}

	async check(quote: string) {
		return normalizeAttribution(await this.call('who_said', {quote}));
	}

	async byAuthor(originator: string) {
		return normalizePage(await this.call('quotes_by', {originator, limit: 15}), true);
	}

	private async call(name: string, args: object): Promise<unknown> {
		if (Date.now() < this.retryAt) throw new Error('Quotewise is rate limited. Wait before trying again.');
		const key = this.getKey()?.trim();
		let response;
		try {
			response = await this.send({
				url: 'https://mcp.quotewise.io/mcp',
				method: 'POST',
				contentType: 'application/json',
				headers: {
					Accept: 'application/json, text/event-stream',
					'MCP-Protocol-Version': '2025-03-26',
					...(key ? {Authorization: 'Bearer ' + key} : {}),
				},
				body: JSON.stringify({
					jsonrpc: '2.0', id: 1, method: 'tools/call',
					params: {name, arguments: args},
				}),
				throw: false,
			});
		} catch {
			throw new Error('Could not reach Quotewise. Check your connection and try again.');
		}
		if (response.status === 429) {
			const header = Object.entries(response.headers).find(([name]) => name.toLowerCase() === 'retry-after')?.[1];
			const seconds = header && /^\d+$/.test(header) ? Number(header) * 1000 : NaN;
			const delay = Number.isFinite(seconds) ? seconds : Date.parse(header ?? '') - Date.now();
			this.retryAt = Date.now() + (Number.isFinite(delay) ? Math.max(1000, delay) : 30000);
			throw new Error('Quotewise rate limit or credit quota reached. Check your usage before retrying.');
		}
		if (response.status === 401 || response.status === 403) throw new Error('Quotewise denied access. Check your API key or plan.');
		if (response.status !== 200) throw new Error('The Quotewise lookup is unavailable (HTTP ' + response.status + ').');

		const payload = response.text.trim();
		const messages = payload.startsWith('{') ? [payload] : payload.split(/\r?\n\r?\n/).flatMap((event) => {
			const data = event.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart());
			return data.length ? [data.join('\n')] : [];
		});
		const reply = messages.map((message) => record(parseJson(message))).find((message) => message.id === 1);
		const result = record(reply?.result);
		if (!reply || reply.error || result.isError === true) {
			throw new Error('Quotewise could not complete this lookup. Check your key and available credits, then try again.');
		}
		return result.structuredContent;
	}
}
