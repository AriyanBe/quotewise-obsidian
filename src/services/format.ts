import type {Quote} from '../api/types';

export type InsertFormat = 'simple' | 'attributed' | 'callout' | 'structured';

export const DEFAULT_TEMPLATE = [
	'---',
	'type: quotation',
	'author: {{authorYaml}}',
	'source: {{sourceYaml}}',
	'tags:',
	'  - quotations',
	'---',
	'',
	'# {{title}}',
	'',
	'{{blockquote}}',
	'',
	'{{metadata}}',
	'',
	'## My Reflections',
	'',
	'## Related Notes',
].join('\n');

export const DEFAULT_FILENAME = '{{author}} - {{title}}';

function inline(value: string): string {
	return value.replace(/\r?\n|\r/g, ' ').replace(/[\\`*_{}[\]<>#!|~=]/g, '\\$&');
}

export function blockquote(value: string): string {
	return value.split(/\r\n?|\n/).map((line) => line ? '> ' + inline(line) : '>').join('\n');
}

export function safeFilename(value: string): string {
	let name = Array.from(value.normalize('NFC')
		.replace(/[<>:"/\\|?*#[\]^]/g, ' ')
		.replace(/\p{Cc}/gu, ' ')
		.replace(/\s+/g, ' ')
		.replace(/^[ .]+|[ .]+$/g, '')).slice(0, 60).join('').replace(/[ .]+$/g, '');
	if (/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name)) name = '_' + name;
	return name || 'Quotation';
}

function titleFor(quote: Quote): string {
	return quote.title || quote.text.split(/\s+/).slice(0, 8).join(' ');
}

function fill(template: string, fields: Record<string, string>): string {
	return template.replace(/\{\{(\w+)\}\}/g, (token, key: string) => Object.prototype.hasOwnProperty.call(fields, key) ? fields[key] ?? '' : token);
}

export function filenameFor(quote: Quote, template: string): string {
	return safeFilename(fill(template || DEFAULT_FILENAME, {
		title: titleFor(quote),
		author: quote.author ?? 'Unknown author',
		code: quote.code,
	}).replace(/\.md$/i, ''));
}

function link(label: string, url: string): string {
	return '[' + inline(label) + '](<' + url.replace(/[<>]/g, encodeURIComponent) + '>)';
}

export function formatQuote(quote: Quote, format: InsertFormat, wikilinks: boolean, template: string): string {
	const block = blockquote(quote.text);
	if (format === 'simple') return block;
	const author = quote.author
		? wikilinks ? '[[' + safeFilename(quote.author) + ']]' : inline(quote.author)
		: '';
	const source = quote.sightings?.find((item) => item.title)?.title;
	const evidence = [...new Set(quote.sightings?.map((item) => {
		const label = [item.title, item.platform].filter(Boolean).join(' · ') || 'Sighting';
		return item.url ? link(label, item.url) : inline(label);
	}))];
	const original = quote.url ? link('View original', quote.url) : '';
	const status = quote.status ? inline(quote.status) : '';
	const alternative = quote.alternative ? inline(quote.alternative) : '';
	const metadata = [
		author && '**Author:** ' + author,
		source && '**Source:** *' + inline(source) + '*',
		status && '**Quotewise attribution:** ' + status,
		alternative && '**Alternative attribution:** ' + alternative,
		evidence.length && '**Sightings:** ' + evidence.join(' · '),
		original && '**Quotewise:** ' + original,
	].filter(Boolean).join('\n\n');

	if (format === 'structured') {
		return fill(template || DEFAULT_TEMPLATE, {
			title: inline(titleFor(quote)),
			blockquote: block,
			metadata,
			author,
			source: source ? inline(source) : '',
			authorYaml: JSON.stringify(wikilinks ? author : quote.author ?? ''),
			sourceYaml: JSON.stringify(source ?? ''),
			url: quote.url ?? '',
		});
	}
	const byline = [author, source && '*' + inline(source) + '*'].filter(Boolean).join(', ');
	const credit = [
		byline && '— ' + byline,
		status && 'Attribution: ' + status,
		alternative && 'Alternative attribution: ' + alternative,
		evidence.length && evidence.join(' · '),
		original,
	].filter(Boolean);
	const content = [block, ...credit.map((line) => '> ' + line)].join('\n>\n');
	return format === 'callout' ? '> [!quote]\n>\n' + content : content;
}
