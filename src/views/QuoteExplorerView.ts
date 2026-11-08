import {ButtonComponent, ItemView, TextComponent, DropdownComponent} from 'obsidian';
import type {WorkspaceLeaf} from 'obsidian';
import type QuotewisePlugin from '../main';
import type {SearchMode} from '../api/client';
import type {Quote, QuotePage} from '../api/types';
import {MODES} from '../settings';
import {renderQuote} from './quote-card';

export const EXPLORER_VIEW = 'quotewise-explorer';

export class QuoteExplorerView extends ItemView {
	private input?: TextComponent;
	private generation = 0;

	constructor(leaf: WorkspaceLeaf, private readonly plugin: QuotewisePlugin) {
		super(leaf);
	}

	getViewType() { return EXPLORER_VIEW; }
	getDisplayText() { return 'Quotewise'; }
	getIcon() { return 'quote'; }

	focusSearch() { this.input?.inputEl.focus(); }

	protected async onOpen(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass('quotewise-explorer');
		root.createEl('h2', {text: 'Quote explorer'});
		const form = root.createEl('form', {cls: 'quotewise-form'});
		const mode = new DropdownComponent(form).addOptions(MODES).setValue(this.plugin.settings.mode);
		mode.selectEl.setAttribute('aria-label', 'Search mode');
		const input = this.input = new TextComponent(form);
		input.inputEl.setAttribute('aria-label', 'Search quotations');
		const updateHint = () => input.setPlaceholder(mode.getValue() === 'author'
			? 'Author name, e.g. Jane Austen'
			: 'Search quotations');
		mode.onChange(updateHint);
		updateHint();

		const submit = form.createEl('button', {text: 'Search', cls: 'mod-cta', attr: {type: 'submit'}});
		const status = root.createDiv({cls: 'quotewise-status', attr: {role: 'status'}});
		status.setText('Search by text, topic, or author name.');
		const list = root.createDiv({cls: 'quotewise-results'});
		const pager = root.createDiv();
		const more = new ButtonComponent(pager).setButtonText('Load more');
		pager.hidden = true;
		let next: number | undefined;
		let current: {mode: SearchMode; query: string} | undefined;
		let busy = false;
		const codes = new Set<string>();

		const show = async (fetchPage: () => Promise<QuotePage>, append = false) => {
			if (busy) return;
			busy = true;
			const run = ++this.generation;
			submit.disabled = true;
			more.setDisabled(true);
			if (!append) {
				list.empty();
				codes.clear();
				next = undefined;
			}
			pager.hidden = true;
			list.setAttribute('aria-busy', 'true');
			status.setText('Searching Quotewise…');
			try {
				const page = await fetchPage();
				if (run !== this.generation) return;
				for (const quote of page.quotes) {
					if (codes.has(quote.code)) continue;
					codes.add(quote.code);
					this.addCard(list, quote, (code) => {
						if (busy) return;
						current = undefined;
						void show(() => this.plugin.client.similar(code));
					});
				}
				next = page.next;
				status.setText(codes.size ? codes.size + ' quotations shown.' : 'No quotations found. Try another search.');
			} catch (error) {
				if (run === this.generation) status.setText(error instanceof Error ? error.message : 'Search failed.');
			} finally {
				if (run === this.generation) {
					busy = false;
					submit.disabled = false;
					list.setAttribute('aria-busy', 'false');
					pager.hidden = next === undefined || !current;
					more.setDisabled(false);
				}
			}
		};

		this.registerDomEvent(form, 'submit', (event) => {
			event.preventDefault();
			if (busy) return;
			const query = input.getValue().trim();
			if (!query) {
				status.setText('Enter a search first.');
				input.inputEl.focus();
				return;
			}
			const search = {mode: mode.getValue() as SearchMode, query};
			current = search;
			void show(() => search.mode === 'author'
				? this.plugin.mcp.byAuthor(search.query)
				: this.plugin.client.search(search.mode, search.query));
		});
		more.onClick(() => {
			const search = current;
			const page = next;
			if (search && search.mode !== 'author' && page) {
				const {mode, query} = search;
				void show(() => this.plugin.client.search(mode, query, page), true);
			}
		});
	}

	private addCard(list: HTMLElement, original: Quote, similar: (code: string) => void) {
		const item = list.createDiv();
		let quote = original;
		const details = item.createDiv();
		renderQuote(details, quote);
		const actions = item.createDiv({cls: 'quotewise-actions'});
		const status = item.createDiv({cls: 'quotewise-status', attr: {role: 'status'}});
		const live = () => this.contentEl.contains(item);
		new ButtonComponent(actions).setButtonText('Insert into note').onClick(() => {
			status.setText(this.plugin.insertQuote(quote, this.leaf));
		});
		new ButtonComponent(actions).setButtonText('Create quote note').onClick(async (event) => {
			const button = event.currentTarget as HTMLButtonElement;
			button.disabled = true;
			try {
				status.setText(await this.plugin.createNote(quote));
			} catch {
				status.setText('Could not create the note. Check the destination folder and vault access.');
			} finally {
				button.disabled = false;
			}
		});
		const detailButton = new ButtonComponent(actions).setButtonText('Load source details');
		detailButton.onClick(async () => {
			detailButton.setDisabled(true);
			status.setText('Loading source details…');
			try {
				const detail = await this.plugin.client.detail(quote.code);
				if (!live()) return;
				quote = {...quote, ...detail, author: detail.author ?? quote.author, url: detail.url ?? quote.url};
				details.empty();
				renderQuote(details, quote);
				const sightings = await this.plugin.client.sightings(quote.code);
				if (!live()) return;
				quote = {...quote, sightings};
				details.empty();
				renderQuote(details, quote);
				status.setText(sightings.length ? 'Source details loaded.' : 'Quotewise supplied no visible sightings.');
			} catch (error) {
				if (live()) {
					status.setText(error instanceof Error ? error.message : 'Could not load source details.');
					detailButton.setDisabled(false);
				}
			}
		});
		new ButtonComponent(actions).setButtonText('Similar quotes').onClick(() => similar(quote.code));
	}

	protected async onClose(): Promise<void> {
		this.generation++;
		this.contentEl.empty();
		this.input = undefined;
	}
}
