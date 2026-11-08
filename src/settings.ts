import {Notice, PluginSettingTab, Setting} from 'obsidian';
import type {App} from 'obsidian';
import type QuotewisePlugin from './main';
import type {SearchMode} from './api/client';
import {DEFAULT_FILENAME, DEFAULT_TEMPLATE} from './services/format';
import type {InsertFormat} from './services/format';
import {record} from './api/types';

export const KEY_ID = 'quotewise-obsidian-api-key';
export const MODES: Record<SearchMode, string> = {
	text: 'Words or exact phrase',
	semantic: 'Meaning or topic',
	author: 'Author',
};
const FORMATS: Record<InsertFormat, string> = {
	simple: 'Simple blockquote',
	attributed: 'Blockquote with attribution and source',
	callout: 'Quote callout',
	structured: 'Commonplace entry',
};
const DEFAULTS = {
	mode: 'text' as SearchMode,
	format: 'attributed' as InsertFormat,
	folder: 'Quotations',
	filename: DEFAULT_FILENAME,
	template: DEFAULT_TEMPLATE,
	wikilinks: true,
	openNote: true,
};

export type Settings = typeof DEFAULTS;

export function loadSettings(value: unknown): Settings {
	const data = record(value);
	const settings = {...DEFAULTS};
	for (const key of ['folder', 'filename', 'template'] as const) {
		if (typeof data[key] === 'string') settings[key] = data[key];
	}
	for (const key of ['wikilinks', 'openNote'] as const) {
		if (typeof data[key] === 'boolean') settings[key] = data[key];
	}
	for (const mode of Object.keys(MODES) as SearchMode[]) if (data.mode === mode) settings.mode = mode;
	for (const format of Object.keys(FORMATS) as InsertFormat[]) if (data.format === format) settings.format = format;
	return settings;
}

export class QuotewiseSettings extends PluginSettingTab {
	constructor(app: App, private readonly plugin: QuotewisePlugin) {
		super(app, plugin);
	}

	display(): void {
		const root = this.containerEl;
		const settings = this.plugin.settings;
		root.empty();

		new Setting(root).setName('Quotewise API key')
			.setDesc('Required for text and topic searches, similar quotes, and source details. Create a key in the Quotewise developer dashboard. Obsidian stores it in Secret Storage.')
			.addText((field) => {
				field.inputEl.type = 'password';
				field.inputEl.autocomplete = 'off';
				field.setPlaceholder(this.app.secretStorage.getSecret(KEY_ID) ? 'Key saved' : 'Enter a key');
				new Setting(root).addButton((button) => button.setButtonText('Save key').onClick(() => {
					const key = field.getValue().trim();
					if (!/^qw_[a-z0-9_-]+$/i.test(key)) {
						new Notice('Enter a Quotewise key beginning with qw_.');
						return;
					}
					this.app.secretStorage.setSecret(KEY_ID, key);
					field.setValue('').setPlaceholder('Key saved');
				})).addButton((button) => button.setButtonText('Clear key').onClick(() => {
					this.app.secretStorage.setSecret(KEY_ID, '');
					field.setValue('').setPlaceholder('Enter a key');
				}));
			});
		const status = root.createDiv({cls: 'quotewise-status', attr: {role: 'status'}});
		new Setting(root).setName('Connection test')
			.setDesc('Requests one quote and may use an API credit.')
			.addButton((button) => button.setButtonText('Test connection').onClick(async () => {
				button.setDisabled(true);
				status.setText('Connecting to Quotewise…');
				try {
					await this.plugin.client.testConnection();
					status.setText('Connected to Quotewise.');
				} catch (error) {
					status.setText(error instanceof Error ? error.message : 'Connection failed.');
				} finally {
					button.setDisabled(false);
				}
			}));
		new Setting(root).setName('Default search mode').addDropdown((field) =>
			field.addOptions(MODES).setValue(settings.mode).onChange(async (mode) => {
				settings.mode = mode as SearchMode;
				await this.plugin.saveSettings();
			}));
		new Setting(root).setName('Insertion format').addDropdown((field) =>
			field.addOptions(FORMATS).setValue(settings.format).onChange(async (format) => {
				settings.format = format as InsertFormat;
				await this.plugin.saveSettings();
			}));
		new Setting(root).setName('Commonplace-book folder').setDesc('Use a vault-relative path or leave blank for the vault root.')
			.addText((field) => field.setValue(settings.folder).onChange(async (value) => {
				settings.folder = value;
				await this.plugin.saveSettings();
			}));
		new Setting(root).setName('Filename template').setDesc('Available placeholders are {{author}}, {{title}}, and {{code}}.')
			.addText((field) => field.setValue(settings.filename).onChange(async (value) => {
				settings.filename = value;
				await this.plugin.saveSettings();
			}));
		new Setting(root).setName('Author wikilinks')
			.addToggle((field) => field.setValue(settings.wikilinks).onChange(async (value) => {
				settings.wikilinks = value;
				await this.plugin.saveSettings();
			}));
		new Setting(root).setName('Open newly created notes')
			.addToggle((field) => field.setValue(settings.openNote).onChange(async (value) => {
				settings.openNote = value;
				await this.plugin.saveSettings();
			}));
		new Setting(root).setName('Commonplace note template').setDesc('Leave blank for the built-in template. See the README for placeholders.')
			.addTextArea((field) => {
				field.inputEl.rows = 8;
				field.setValue(settings.template).onChange(async (value) => {
					settings.template = value;
					await this.plugin.saveSettings();
				});
			});
		root.createEl('p', {text: 'Quotewise receives searches and text you explicitly submit for attribution. If a request is rate limited, wait before retrying or check your credits in the developer dashboard.'});
		root.createEl('a', {text: 'Quotewise developer dashboard', href: 'https://quotewise.io/developers/dashboard/'});
	}
}
