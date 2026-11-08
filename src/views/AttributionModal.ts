import {ButtonComponent, Modal} from 'obsidian';
import type QuotewisePlugin from '../main';
import {renderQuote} from './quote-card';

export class AttributionModal extends Modal {
	private closed = false;

	constructor(
		private readonly plugin: QuotewisePlugin,
		private readonly selection: string,
		private readonly onDismiss: () => void,
	) {
		super(plugin.app);
	}

	onOpen(): void {
		this.setTitle('Check quotation attribution');
		const root = this.contentEl;
		root.addClass('quotewise-attribution');
		root.createEl('blockquote', {text: this.selection});
		root.createEl('p', {text: 'Check sends this selected text to Quotewise.'});
		const status = root.createDiv({cls: 'quotewise-status', attr: {role: 'status'}});
		const findings = root.createDiv();
		const check = new ButtonComponent(root).setButtonText('Check with Quotewise').setCta();
		check.onClick(async () => {
			check.setDisabled(true);
			status.setText('Checking attribution…');
			try {
				const result = await this.plugin.mcp.check(this.selection);
				if (this.closed) return;
				check.buttonEl.hidden = true;
				if (!result.matches.length) {
					status.setText('Quotewise could not establish an attribution for this selection.');
					return;
				}
				status.setText('Quotewise found possible matches. The match score describes text similarity.');
				if (result.status) findings.createEl('p', {text: 'Quotewise attribution: ' + result.status});
				if (result.confidence !== undefined) findings.createEl('p', {text: 'Text match: ' + result.confidence + '%'});
				if (result.correction) {
					findings.createEl('h3', {text: 'Quotewise correction'});
					renderQuote(findings, result.correction);
				}
				findings.createEl('h3', {text: 'Matched quotations'});
				for (const quote of result.matches) renderQuote(findings, quote);
				if (result.alternatives.length) {
					findings.createEl('h3', {text: 'Other possible matches'});
					const list = findings.createEl('ul');
					for (const alternative of result.alternatives) {
						list.createEl('li', {text: alternative.author + ' — ' + alternative.text});
					}
				}
				const evidenceQuote = result.correction ?? result.matches[0];
				if (evidenceQuote) {
					const evidence = new ButtonComponent(findings).setButtonText('Load source evidence');
					evidence.onClick(async () => {
						evidence.setDisabled(true);
						status.setText('Loading source evidence…');
						try {
							const sightings = await this.plugin.client.sightings(evidenceQuote.code);
							if (this.closed) return;
							if (sightings.length) renderQuote(findings, {...evidenceQuote, sightings});
							status.setText(sightings.length ? 'Source evidence loaded.' : 'Quotewise supplied no visible sightings.');
						} catch (error) {
							if (!this.closed) {
								status.setText(error instanceof Error ? error.message : 'Could not load source evidence.');
								evidence.setDisabled(false);
							}
						}
					});
				}
			} catch (error) {
				if (!this.closed) {
					status.setText(error instanceof Error ? error.message : 'Attribution check failed.');
					check.setDisabled(false);
				}
			}
		});
	}

	onClose(): void {
		this.closed = true;
		this.contentEl.empty();
		this.onDismiss();
	}
}
