import type {Quote} from '../api/types';

export function renderQuote(root: HTMLElement, quote: Quote): HTMLElement {
	const card = root.createEl('article', {cls: 'quotewise-card'});
	card.createEl('blockquote', {text: quote.text});
	if (quote.author) card.createEl('p', {cls: 'quotewise-meta', text: quote.author});
	if (quote.status) card.createEl('p', {cls: 'quotewise-meta', text: 'Quotewise attribution: ' + quote.status});
	if (quote.alternative) card.createEl('p', {cls: 'quotewise-meta', text: 'Alternative attribution: ' + quote.alternative});
	for (const item of quote.sightings ?? []) {
		const label = [item.title, item.platform].filter(Boolean).join(' · ') || 'Sighting';
		const line = card.createEl('p', {cls: 'quotewise-meta'});
		if (item.url) line.createEl('a', {text: label, href: item.url, cls: 'external-link'});
		else line.setText(label);
	}
	if (quote.url) card.createEl('a', {text: 'View on Quotewise', href: quote.url, cls: 'external-link'});
	return card;
}
