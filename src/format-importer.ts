import { App, normalizePath, Setting, TFile, TFolder, Vault } from 'obsidian';
import { ImporterModal, ImportContext, AuthCallback } from './main';
import { sanitizeFileName } from './util';

function splitext(name: string): [string, string] {
	let i = name.lastIndexOf('.');
	if (i <= 0 || i === name.length - 1) {
		return [name, ''];
	}

	const basename = name.substring(0, i);
	const extension = name.substring(i + 1).toLowerCase();
	return [basename, extension];
}

function parseFilePath(filepath: string): { parent: string, name: string, basename: string, extension: string } {
	let lastIndex = Math.max(filepath.lastIndexOf('/'), filepath.lastIndexOf('\\'));
	let name = filepath;
	let parent = '';
	if (lastIndex >= 0) {
		name = filepath.substring(lastIndex + 1);
		parent = filepath.substring(0, lastIndex);
	}

	let [basename, extension] = splitext(name);
	return { parent, name, basename, extension };
}

export abstract class FormatImporter {
	app: App;
	vault: Vault;
	modal: ImporterModal;

	outputLocation: string = '';
	notAvailable: boolean = false;

	/** Cached value for getOutputFolder. Do not use directly. */
	private outputFolder: TFolder | null = null;

	constructor(app: App, modal: ImporterModal) {
		this.app = app;
		this.vault = app.vault;
		this.modal = modal;
		this.init();
	}

	abstract init(): void;

	/**
	 * Optional: Show template configuration UI and prepare data for import.
	 * This will be called as a configuration step before the import progress.
	 *
	 * Overriding functions are responsible for displaying errors before returning false.
	 *
	 * @param ctx The import context
	 * @param container The container element to show the configuration UI in
	 * @returns true if configuration was successful, false if cancelled or failed, null if no configuration needed
	 */
	async showTemplateConfiguration(ctx: ImportContext, container: HTMLElement): Promise<boolean | null> {
		return null;
	}

	/**
	 * Register a function to be called when the `obsidian://importer-auth/` open
	 * event is received by Obsidian.
	 *
	 * Note: The callback will be cleared after being called. It must be
	 * reregistered if a subsequent auth event is expected.
	 */
	registerAuthCallback(callback: AuthCallback): void {
		this.modal.plugin.registerAuthCallback(callback);
	}

	addOutputLocationSetting(defaultExportFolderName: string) {
		this.outputLocation = defaultExportFolderName;
		new Setting(this.modal.contentEl)
			.setName('Output folder')
			.setDesc('Choose a folder in the vault to put the imported files. Leave empty to output to vault root.')
			.addText(text => text
				.setValue(defaultExportFolderName)
				.onChange(value => {
					this.outputLocation = value;
					this.outputFolder = null;
				}));
	}

	async getOutputFolder(): Promise<TFolder | null> {
		if (this.outputFolder) {
			return this.outputFolder;
		}

		let { vault } = this.app;

		let folderPath = this.outputLocation;
		if (folderPath === '') {
			folderPath = '/';
		}
		folderPath = normalizePath(folderPath);

		let folder = vault.getAbstractFileByPath(folderPath);

		if (folder === null || !(folder instanceof TFolder)) {
			await vault.createFolder(folderPath);
			folder = vault.getAbstractFileByPath(folderPath);
		}

		if (folder instanceof TFolder) {
			this.outputFolder = folder;
			return folder;
		}

		return null;
	}

	/**
	 * Resolves a unique path for the attachment file being saved.
	 * Ensures that the parent directory exists and dedupes the
	 * filename if the destination filename already exists.
	 *
	 * NOTE: This is a duplicate of `fileManager.getAvailablePathForAttachment`
	 * which adds two key adjustments to aid Importer:
	 *   - Use the provided `sourcePath` even if the file doesn't exist yet.
	 *   - Avoid duplicating a list of provided filesnames that do not yet exist, but will in the future.
	 *
	 * @param filename Name of the attachment being saved
	 * @param claimedPaths List of filepaths that may not exist yet but will in the future.
	 * @param sourcePath Optional path of the current file being imported (for "Same folder as current file" setting)
	 * @returns Full path for where the attachment should be saved, according to the user's settings
	 */
	async getAvailablePathForAttachment(filename: string, claimedPaths: string[], sourcePath?: string): Promise<string> {
		let sourceFile: TFile | null = null;
		
		// If sourcePath is provided, use its parent folder for attachment placement
		// This is important for respecting user's "Same folder as current file" setting
		if (sourcePath) {
			const { parent } = parseFilePath(sourcePath);
			if (parent) {
				const parentFolder = this.vault.getAbstractFileByPath(normalizePath(parent));
				if (parentFolder instanceof TFolder) {
					sourceFile = { parent: parentFolder } as TFile;
				}
			}
		}
		
		// Fallback to outputFolder if sourcePath not provided or parent folder not found
		if (!sourceFile) {
			const outputFolder = await this.getOutputFolder();
			// XXX: (Ab)use the fact that getAvailablePathForAttachments only looks sourceFile.parent.
			sourceFile = !!outputFolder
				? { parent: outputFolder } as TFile
				: null;
		}

		const { basename, extension } = parseFilePath(filename);

		// Use getAvailablePathForAttachments because it can give us the configured output path.
		//@ts-ignore
		const prelimOutPath = await this.vault.getAvailablePathForAttachments(basename, extension, sourceFile);
		const parsedPrelimOutPath = parseFilePath(prelimOutPath);

		const fullExt = parsedPrelimOutPath.extension ?
			'.' + parsedPrelimOutPath.extension
			: '.' + extension;

		// Increase number until the path is unique.
		let i = 1;
		let outputPath = prelimOutPath;
		while (claimedPaths.includes(outputPath) || !!this.vault.getAbstractFileByPath(outputPath)) {
			const parentPrefix = parsedPrelimOutPath.parent ? `${parsedPrelimOutPath.parent}/` : '';
			outputPath = `${parentPrefix}${parsedPrelimOutPath.name} ${i}${fullExt}`;
			i++;
		}

		// Normalize the final outputPath before returning
		return normalizePath(outputPath);
	}

	async pause(durationSeconds: number, reason: string, ctx: ImportContext | undefined): Promise<void> {
		const promise = new Promise(resolve => setTimeout(resolve, durationSeconds * 1_000));

		if (ctx) {
			const previousStatusMessage = ctx.statusMessage;
			ctx.status(`⏸️ Pausing import for ${durationSeconds} seconds (${reason})`);
			await promise;
			ctx.status(previousStatusMessage);
		}
		else {
			await promise;
		}
	}

	abstract import(ctx: ImportContext): Promise<any>;

	// Utility functions for vault

	/** Remove any characters that would be illegal on any platform. */
	sanitizeFilePath(path: string): string {
		return path.replace(/[:|?<>*\\]/g, '');
	}

	/**
	 * Recursively create folders, if they don't exist.
	 */
	async createFolders(path: string): Promise<TFolder> {
		// can't create folders starting with a dot
		const sanitizedPath = path.split('/').map(segment => segment.replace(/^\.+/, '')).join('/');
		let normalizedPath = normalizePath(sanitizedPath);
		let folder = this.vault.getAbstractFileByPathInsensitive(normalizedPath);
		if (folder && folder instanceof TFolder) {
			return folder;
		}

		await this.vault.createFolder(normalizedPath);
		folder = this.vault.getAbstractFileByPathInsensitive(normalizedPath);
		if (!(folder instanceof TFolder)) {
			throw new Error(`Failed to create folder at "${path}"`);
		}

		return folder;
	}

	async saveAsMarkdownFile(folder: TFolder, title: string, content: string): Promise<TFile> {
		let sanitizedName = sanitizeFileName(title);
		// @ts-ignore
		return await this.app.fileManager.createNewMarkdownFile(folder, sanitizedName, content);
	}
}
