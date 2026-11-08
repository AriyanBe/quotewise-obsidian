import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {RequestUrlParam, RequestUrlResponse, TFile, TFolder, Vault} from 'obsidian';
import {QuotewiseClient} from '../src/api/client';
import {normalizeAttribution, QuotewiseMcpClient} from '../src/api/attribution';
import {normalizePage, normalizeQuote, normalizeSightings} from '../src/api/types';
import {blockquote, DEFAULT_TEMPLATE, filenameFor, formatQuote, safeFilename} from '../src/services/format';
import {createQuoteNote} from '../src/services/vault';

const row = {short_code: 'abc123', text: 'A sample quotation.', originator: {full_name: 'Example Author'}};
const quote = {code: 'abc123', text: row.text, author: 'Example Author'};

void test('normalizes quote responses, pagination and optional metadata', () => {
	const page = normalizePage({results: [row, null], next: 'https://api.quotewise.io/v1/quotes/?page=2'}, true);
	assert.equal(page.next, 2);
	assert.equal(page.quotes[0]?.author, 'Example Author');
	assert.equal(normalizeQuote({short_code: 'abc123', text: 'Text', web_url: 'javascript:alert(1)'})?.url, undefined);
	assert.equal(normalizeQuote({...row, web_url: 'https://example.com/q/abc123/'})?.url, undefined);
	assert.equal(normalizeQuote({...row, quote_role: 'canonical'})?.status, undefined);
	assert.equal(normalizeQuote({...row, is_misattributed: true})?.status, 'Misattributed');
	assert.equal(normalizePage({results: [], next: 'https://example.com/v1/quotes/?page=2'}, true).next, undefined);
	assert.throws(() => normalizePage({unexpected: []}, true), /unexpected response/);
});

void test('normalizes visible source sightings', () => {
	assert.deepEqual(normalizeSightings({data: [
		{source_title: 'Example work', platform: 'Book', url: 'https://example.com/'},
		{source_title: 'Hidden', display_suppressed: true},
	]}), [{title: 'Example work', platform: 'Book', url: 'https://example.com/'}]);
});

void test('formats multiline quotations, callouts, and optional metadata', () => {
	assert.equal(blockquote('One\r\n\r\nTwo'), '> One\n>\n> Two');
	assert.equal(formatQuote({code: 'abc123', text: 'Text'}, 'attributed', true, ''), '> Text');
	const withSource = {...quote, url: 'https://quotewise.io/q/abc123/', sightings: [{title: 'Example work'}]};
	const callout = formatQuote(withSource, 'callout', true, '');
	assert.match(callout, /^> \[!quote\]/);
	assert.match(callout, /\[\[Example Author\]\], \*Example work\*/);
	assert.match(callout, /https:\/\/quotewise.io\/q\/abc123\//);
	const structured = formatQuote(withSource, 'structured', true, DEFAULT_TEMPLATE);
	assert.match(structured, /author: "\[\[Example Author\]\]"/);
	assert.match(structured, /source: "Example work"/);
	assert.doesNotMatch(blockquote('![[Secret]] <iframe>'), /(?<!\\)\[\[/);
});

void test('sanitizes cross-platform filenames and renders filename tokens', () => {
	assert.equal(safeFilename(' CON '), '_CON');
	assert.equal(safeFilename('../..'), 'Quotation');
	assert.equal(safeFilename('a/b:c'), 'a b c');
	assert.equal(filenameFor(quote, '{{author}} - {{code}}.md'), 'Example Author - abc123');
	assert.equal(Array.from(safeFilename('😀'.repeat(100))).length, 60);
});

void test('creates folders and retries note conflicts without replacing files', async () => {
	const files = new Map<string, TFile | TFolder>([
		['Quotes/Collected/Example.md', {path: 'Quotes/Collected/Example.md'} as TFile],
	]);
	const writes: string[] = [];
	const vault: Pick<Vault, 'getAbstractFileByPath' | 'createFolder' | 'create'> = {
		getAbstractFileByPath: (path) => files.get(path) ?? null,
		createFolder: (path) => {
			const folder = {path, children: []} as unknown as TFolder;
			files.set(path, folder);
			return Promise.resolve(folder);
		},
		create: (path, data) => {
			const file = {path} as TFile;
			files.set(path, file);
			if (path.endsWith('(2).md')) return Promise.reject(new Error('Already exists'));
			writes.push(data);
			return Promise.resolve(file);
		},
	};
	assert.equal((await createQuoteNote(vault, 'Quotes/Collected', 'Example', 'Quote body')).path,
		'Quotes/Collected/Example (3).md');
	assert.deepEqual(writes, ['Quote body']);
	await assert.rejects(createQuoteNote(vault, '../Other', 'Example', 'Body'), /vault-relative/);
});

function response(status: number, body: unknown, headers: Record<string, string> = {}): RequestUrlResponse {
	return {status, text: JSON.stringify(body), json: body, headers, arrayBuffer: new ArrayBuffer(0)};
}

void test('sends authenticated requests and handles missing keys, network failures, and HTTP failures', async () => {
	const calls: RequestUrlParam[] = [];
	const client = new QuotewiseClient((params) => {
		calls.push(params);
		return Promise.resolve(response(200, {results: [row]}));
	}, () => 'qw_test');
	await client.search('text', 'a & b', 2);
	assert.equal(new URL(calls[0]?.url ?? '').searchParams.get('q'), 'a & b');
	assert.equal(calls[0]?.headers?.Authorization, 'Bearer qw_test');
	const missing = new QuotewiseClient(() => Promise.reject(new Error('must not call')), () => null);
	await assert.rejects(missing.testConnection(), /Add a Quotewise API key/);
	const failing = new QuotewiseClient(() => Promise.reject(new Error('qw_test')), () => 'qw_test');
	await assert.rejects(failing.testConnection(), /Could not reach Quotewise/);
	const unauthorized = new QuotewiseClient(() => Promise.resolve(response(401, 'qw_test')), () => 'qw_test');
	await assert.rejects(unauthorized.testConnection(), /denied access/);
});

void test('honors Retry-After without issuing additional requests', async () => {
	let count = 0;
	const client = new QuotewiseClient(() => {
		count++;
		return Promise.resolve(response(429, {}, {'Retry-After': '60'}));
	}, () => 'qw_test');
	await assert.rejects(client.testConnection(), /credit quota/);
	await assert.rejects(client.testConnection(), /Wait/);
	assert.equal(count, 1);
});

void test('handles MCP SSE attribution and distinguishes corrections from alternatives', async () => {
	const structuredContent = {
		results: [{...row, attribution_status: 'misattributed'}],
		correct_attribution: {...row, short_code: 'xyz987', originator_name: 'Correction', originator: null},
		alternatives: [{originator: 'Another author', text: 'Variant'}],
		confidence: 82,
	};
	const client = new QuotewiseMcpClient((params) => {
		assert.equal(params.headers?.Authorization, undefined);
		assert.match(params.body as string, /"quote":"Selected text"/);
		const payload = JSON.stringify({jsonrpc: '2.0', id: 1, result: {structuredContent}});
		return Promise.resolve({...response(200, {}), text: 'event: message\ndata: ' + payload + '\n\n'});
	}, () => null);
	const result = await client.check('Selected text');
	assert.equal(result.matches[0]?.status, 'misattributed');
	assert.equal(result.correction?.author, 'Correction');
	assert.equal(result.alternatives[0]?.author, 'Another author');
	assert.equal(result.confidence, 82);
	assert.deepEqual(normalizeAttribution({results: []}).matches, []);
});
