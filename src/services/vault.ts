import type {Vault} from 'obsidian';

type NoteVault = Pick<Vault, 'getAbstractFileByPath' | 'createFolder' | 'create'>;

export async function createQuoteNote(vault: NoteVault, folder: string, name: string, markdown: string) {
	const parts = folder.trim().replace(/\\/g, '/').split('/').filter(Boolean);
	let parent = '';
	for (const part of parts) {
		if (part === '.' || part === '..' || /[<>:"|?*]|\p{Cc}/u.test(part)) {
			throw new Error('Choose a valid vault-relative folder in Quotewise settings.');
		}
		parent = parent ? parent + '/' + part : part;
		const existing = vault.getAbstractFileByPath(parent);
		if (existing) {
			if (!('children' in existing)) throw new Error('The commonplace-book folder is blocked by a file.');
			continue;
		}
		try {
			await vault.createFolder(parent);
		} catch (error) {
			const current = vault.getAbstractFileByPath(parent);
			if (!current || !('children' in current)) throw error;
		}
	}

	for (let index = 1; index <= 1000; index++) {
		const suffix = index > 1 ? ' (' + index + ')' : '';
		const path = (parent ? parent + '/' : '') + name + suffix + '.md';
		if (vault.getAbstractFileByPath(path)) continue;
		try {
			return await vault.create(path, markdown);
		} catch (error) {
			if (!vault.getAbstractFileByPath(path)) throw error;
		}
	}
	throw new Error('Too many notes share this name. Change the filename template and try again.');
}
