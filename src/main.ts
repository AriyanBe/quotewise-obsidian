import {MarkdownView, Notice, Plugin, requestUrl} from 'obsidian';
import type {WorkspaceLeaf} from 'obsidian';
import {QuotewiseMcpClient} from './api/attribution';
import {QuotewiseClient} from './api/client';
import type {Quote} from './api/types';
import {filenameFor, formatQuote} from './services/format';
import {createQuoteNote} from './services/vault';
import {KEY_ID, loadSettings, QuotewiseSettings} from './settings';
import type {Settings} from './settings';
import {AttributionModal} from './views/AttributionModal';
import {EXPLORER_VIEW, QuoteExplorerView} from './views/QuoteExplorerView';

export default class QuotewisePlugin extends Plugin {
	settings!: Settings;
	client!: QuotewiseClient;
	mcp!: QuotewiseMcpClient;
	private modal?: AttributionModal;
	private opening?: Promise<void>;
	private saveQueue: Promise<void> = Promise.resolve();
	private running = false;

	async onload(): Promise<void> {
		this.settings = loadSettings(await this.loadData());
		const key = () => this.app.secretStorage.getSecret(KEY_ID);
		this.client = new QuotewiseClient(requestUrl, key);
		this.mcp = new QuotewiseMcpClient(requestUrl, key);
		this.running = true;

		this.registerView(EXPLORER_VIEW, (leaf) => new QuoteExplorerView(leaf, this));
		this.addRibbonIcon('quote', 'Open quote explorer', () => this.openExplorer());
		this.addCommand({id: 'open-quote-explorer', name: 'Open quote explorer', callback: () => this.openExplorer()});
		this.addCommand({
			id: 'check-quotation-attribution',
			name: 'Check quotation attribution',
			editorCallback: (editor) => {
				const text = editor.getSelection().trim();
				if (!text || text.length > 4000) {
					new Notice('Select a quotation of up to 4,000 characters.');
					return;
				}
				this.modal?.close();
				this.modal = new AttributionModal(this, text, () => {
					this.modal = undefined;
				});
				this.modal.open();
			},
		});
		this.addSettingTab(new QuotewiseSettings(this.app, this));
	}

	onunload(): void {
		this.running = false;
		this.modal?.close();
	}

	async saveSettings(): Promise<void> {
		const snapshot = {...this.settings};
		this.saveQueue = this.saveQueue.catch(() => undefined).then(() => this.saveData(snapshot));
		try {
			await this.saveQueue;
		} catch {
			new Notice('Could not save Quotewise settings.');
		}
	}

	private openExplorer(): void {
		this.opening ??= this.revealExplorer().catch(() => {
			new Notice('Could not open the Quotewise explorer.');
		}).finally(() => {
			this.opening = undefined;
		});
	}

	private async revealExplorer(): Promise<void> {
		const workspace = this.app.workspace;
		let leaf = workspace.getLeavesOfType(EXPLORER_VIEW)[0];
		if (!leaf) {
			leaf = workspace.getRightLeaf(false) ?? undefined;
			if (!leaf) throw new Error('Sidebar unavailable.');
			await leaf.setViewState({type: EXPLORER_VIEW, active: true});
		}
		if (!this.running) return;
		await workspace.revealLeaf(leaf);
		if (leaf.view instanceof QuoteExplorerView) leaf.view.focusSearch();
	}

	insertQuote(quote: Quote, sidebar: WorkspaceLeaf): string {
		const workspace = this.app.workspace;
		const active = workspace.getActiveViewOfType(MarkdownView);
		const fallback = workspace.getActiveViewOfType(QuoteExplorerView)?.leaf === sidebar;
		const view = active ?? (fallback ? workspace.getMostRecentLeaf(workspace.rootSplit)?.view : null);
		if (!(view instanceof MarkdownView) || view.getMode() !== 'source' || !view.file) {
			return 'Open a Markdown note in editing mode before inserting a quotation.';
		}

		const {format, wikilinks, template} = this.settings;
		const editor = view.editor;
		const cursor = editor.getCursor('head');
		const offset = editor.posToOffset(cursor);
		const current = editor.getValue();
		const frontmatter = /^---[ \t]*\r?\n[\s\S]*?^---[ \t]*(?:\r?\n|$)/m;
		const currentHeader = frontmatter.exec(current);
		if (currentHeader?.index === 0 && offset < currentHeader[0].trimEnd().length) {
			return 'Move the cursor below the note properties before inserting a quotation.';
		}
		let markdown = formatQuote(quote, format, wikilinks, template);
		if (format === 'structured' && (offset > 0 || current.trim()) && markdown.startsWith('---')) {
			markdown = markdown.replace(frontmatter, '').trimStart();
		}
		editor.replaceRange((offset ? '\n\n' : '') + markdown + (offset < current.length ? '\n\n' : '\n'), cursor);
		return 'Quotation inserted into ' + view.file.basename + '.';
	}

	async createNote(quote: Quote): Promise<string> {
		const {folder, filename, wikilinks, template, openNote} = this.settings;
		const note = await createQuoteNote(this.app.vault, folder, filenameFor(quote, filename),
			formatQuote(quote, 'structured', wikilinks, template) + '\n');
		if (openNote && this.running) {
			try {
				await this.app.workspace.getLeaf(false).openFile(note);
			} catch {
				return 'Created ' + note.path + '. Open it from the file explorer.';
			}
		}
		return 'Created ' + note.path + '.';
	}
}
