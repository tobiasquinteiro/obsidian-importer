import { App, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { FormatImporter } from './format-importer';
import { UrlImporter } from './formats/url';
import { truncateText } from './util';

declare global {
	interface Window {
		electron: any;
		require: NodeRequire;
	}
}

interface ImporterDefinition {
	name: string;
	optionText: string;
	helpPermalink?: string;
	formatDescription?: string;
	importer: new (app: App, modal: ImporterModal) => FormatImporter;
}


/**
 * URI to use as the callback for OAuth applications.
 */
export const AUTH_REDIRECT_URI: string = 'obsidian://importer-auth/';

/**
 * List of accepted attachment extensions
 */
export const ATTACHMENT_EXTS = ['png', 'webp', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'mpg', 'm4a', 'webm', 'wav', 'ogv', '3gp', 'mov', 'mp4', 'mkv', 'pdf'];

/**
 * AuthCallback is a function which will be called when the importer-auth
 * protocal is opened by an OAuth callback.
 */
export type AuthCallback = (data: any) => void;

// Temporary compatibility for in progress PRs
export type ProgressReporter = ImportContext;

export class ImportContext {
	notes = 0;
	attachments = 0;
	skipped: string[] = [];
	failed: string[] = [];
	maxFileNameLength: number = 100;
	statusMessage: string = '';

	cancelled: boolean = false;

	el: HTMLElement;
	progressBarEl: HTMLElement;
	progressBarInnerEl: HTMLElement;
	importedCountEl: HTMLElement;
	attachmentCountEl: HTMLElement;
	remainingCountEl: HTMLElement;
	skippedCountEl: HTMLElement;
	failedCountEl: HTMLElement;
	statusEl: HTMLElement;
	importLogEl: HTMLElement;

	constructor(el: HTMLElement) {
		this.el = el;
		this.createProgressUI(el);
	}

	/**
	 * Creates the import progress UI.
	 * @param container The container element to create the UI in
	 */
	createProgressUI(container: HTMLElement) {
		container.empty();

		this.el = container;
		this.statusEl = container.createDiv('importer-status');

		this.progressBarEl = container.createDiv('importer-progress-bar', el => {
			this.progressBarInnerEl = el.createDiv('importer-progress-bar-inner');
		});

		container.createDiv('importer-stats-container', el => {
			el.createDiv('importer-stat mod-imported', el => {
				this.importedCountEl = el.createDiv({ cls: 'importer-stat-count', text: this.notes.toString() });
				el.createDiv({ cls: 'importer-stat-name', text: 'imported' });
			});
			el.createDiv('importer-stat mod-attachments', el => {
				this.attachmentCountEl = el.createDiv({ cls: 'importer-stat-count', text: this.attachments.toString() });
				el.createDiv({ cls: 'importer-stat-name', text: 'attachments' });
			});
			el.createDiv('importer-stat mod-remaining', el => {
				this.remainingCountEl = el.createDiv({ cls: 'importer-stat-count', text: '0' });
				el.createDiv({ cls: 'importer-stat-name', text: 'remaining' });
			});
			el.createDiv('importer-stat mod-skipped', el => {
				this.skippedCountEl = el.createDiv({ cls: 'importer-stat-count', text: this.skipped.length.toString() });
				el.createDiv({ cls: 'importer-stat-name', text: 'skipped' });
			});
			el.createDiv('importer-stat mod-failed', el => {
				this.failedCountEl = el.createDiv({ cls: 'importer-stat-count', text: this.failed.length.toString() });
				el.createDiv({ cls: 'importer-stat-name', text: 'failed' });
			});
		});

		this.importLogEl = container.createDiv('importer-log');
		this.importLogEl.hide();
	}

	/**
	 * Sets the current user visible in-progress task. The purpose is to tell the user that something is happening,
	 * and makes it easy to tell if something got stuck.
	 *
	 * Try to keep the message short, since longer ones will get truncated based on font and space availability.
	 * @param message
	 */
	status(message: string) {
		this.statusMessage = message;
		this.statusEl.setText(message.trim() + '...');
	}

	/**
	 * Report that a note has been successfully imported.
	 * @param name
	 */
	reportNoteSuccess(name: string) {
		this.notes++;
		this.importedCountEl.setText(this.notes.toString());
	}

	/**
	 * Report that an attachment has been successfully imported.
	 * @param name
	 */
	reportAttachmentSuccess(name: string) {
		this.attachments++;
		this.attachmentCountEl.setText(this.attachments.toString());
	}

	/**
	 * Report that something has been skipped and ignored.
	 * If the skipping action is on purpose and expected for the import, then prefer not to report it
	 * (for example, some tools export to a Note.json and a Note.html, and we only use one of them).
	 * @param name
	 * @param reason
	 */
	reportSkipped(name: string, reason?: any) {
		let { importLogEl } = this;
		this.skipped.push(name);
		this.skippedCountEl.setText(this.skipped.length.toString());

		console.log('Import skipped', name, reason);

		this.importLogEl.createDiv('list-item', el => {
			el.createSpan({ cls: 'importer-error', text: 'Skipped: ' });
			el.createSpan({ text: `"${truncateText(name, this.maxFileNameLength)}"` + (reason ? ` because ${truncateText(String(reason), this.maxFileNameLength)}` : '') });
		});
		importLogEl.scrollTop = importLogEl.scrollHeight;
		importLogEl.show();
	}

	/**
	 * Report that something has failed to import.
	 * @param name
	 * @param reason
	 */
	reportFailed(name: string, reason?: any) {
		let { importLogEl } = this;

		this.failed.push(name);
		this.failedCountEl.setText(this.failed.length.toString());

		console.log('Import failed', name, reason);

		this.importLogEl.createDiv('list-item', el => {
			el.createSpan({ cls: 'importer-error', text: 'Failed: ' });
			el.createSpan({ text: `"${truncateText(name, this.maxFileNameLength)}"` + (reason ? ` because ${truncateText(String(reason), this.maxFileNameLength)}` : '') });
		});
		importLogEl.scrollTop = importLogEl.scrollHeight;
		importLogEl.show();
	}

	/**
	 * Report the current progress. This will update the progress bar as well as changing
	 * the "imported" and "remaining" numbers on the UI.
	 * @param current
	 * @param total
	 */
	reportProgress(current: number, total: number) {
		if (total <= 0) return;
		console.log('Current progress:', (100 * current / total).toFixed(1) + '%');
		this.remainingCountEl.setText((total - current).toString());
		this.importedCountEl.setText(current.toString());
		this.progressBarInnerEl.style.width = (100 * current / total).toFixed(1) + '%';
	}

	cancel() {
		this.cancelled = true;
		this.progressBarEl.hide();
		this.statusEl.hide();
	}

	hideStatus() {
		this.progressBarEl.hide();
		this.statusEl.hide();
	}

	/**
	 * Check if the user has cancelled this run.
	 */
	isCancelled() {
		return this.cancelled;
	}
}

export interface ImporterData {
	importers: {
		onenote?: {
			previouslyImportedIDs: string[];
		};
	};
	quickUrl: {
		outputFolder: string;
		createImportSubfolder: boolean;
		useObsidianAttachmentLocation: boolean;
		downloadImagesToHiddenAssets: boolean;
		followInternalLinks: boolean;
		restrictToSamePath: boolean;
		includeUrlRegex: string;
		excludeUrlRegex: string;
		maxPages: number;
		maxDepth: number;
		preserveGraphConnections: boolean;
		useLocalNoteLinks: boolean;
	};
}

const DEFAULT_DATA: ImporterData = {
	importers: {
		onenote: {
			previouslyImportedIDs: [],
		},
	},
	quickUrl: {
		outputFolder: 'URL import',
		createImportSubfolder: true,
		useObsidianAttachmentLocation: true,
		downloadImagesToHiddenAssets: true,
		followInternalLinks: true,
		restrictToSamePath: true,
		includeUrlRegex: '',
		excludeUrlRegex: '',
		maxPages: 10,
		maxDepth: 1,
		preserveGraphConnections: true,
		useLocalNoteLinks: false,
	},
};

export default class ImporterPlugin extends Plugin {
	importers: Record<string, ImporterDefinition>;
	data: ImporterData;

	authCallback: AuthCallback | undefined;

	async onload() {
		this.data = await this.loadData();

		this.importers = {
			'url': {
				name: 'Web page URL',
				optionText: 'URL (Web page)',
				importer: UrlImporter,
				formatDescription: 'Fetch a web page from a URL and save the content as Markdown.',
			},
		};

		this.addRibbonIcon('lucide-import', 'Open Importer', () => {
			new ImporterModal(this.app, this).open();
		});

		this.addCommand({
			id: 'open-modal',
			name: 'Open importer',
			callback: () => {
				new ImporterModal(this.app, this).open();
			},
		});

		this.addCommand({
			id: 'quick-import-url-from-clipboard',
			name: 'Quick import URL from clipboard',
			callback: async () => {
				try {
					const text = (await navigator.clipboard.readText()).trim();
					if (!text) {
						new Notice('Clipboard is empty.');
						return;
					}
					await this.importUrlWithDefaults(text, false);
				}
				catch {
					new Notice('Could not read clipboard.');
				}
			},
		});

		this.addSettingTab(new ImporterSettingsTab(this.app, this));

		this.registerEvent((this.app.workspace as any).on('url-menu', (menu: any, url: string) => {
			if (!url) {
				return;
			}

			try {
				const parsed = new URL(url);
				if (!['http:', 'https:'].includes(parsed.protocol)) {
					return;
				}
			}
			catch {
				return;
			}

			menu.addItem((item: any) => {
				item
					.setTitle('Import URL (quick)')
					.setIcon('import')
					.onClick(() => {
						void this.importUrlWithDefaults(url, false);
					});
			});

			menu.addItem((item: any) => {
				item
					.setTitle('Import URL as local notes (quick)')
					.setIcon('files')
					.onClick(() => {
						void this.importUrlWithDefaults(url, true);
					});
			});
		}));

		this.registerObsidianProtocolHandler('importer-auth',
			(data) => {
				if (this.authCallback) {
					this.authCallback(data);
					this.authCallback = undefined;
					return;
				}

				new Notice('Unexpected auth event. Please restart the auth process.');
			});

		// For development, un-comment this and tweak it to your importer:

		/*
		// Create and open the importer on boot
		let modal = new ImporterModal(this.app, this);
		modal.open();
		// Select my importer
		modal.updateContent('url');
		if (modal.importer instanceof UrlImporter) {
			// Automatically set URL
			modal.importer.sourceUrl = 'https://example.com';
		}
		*/
	}

	onunload() {

	}

	async loadData(): Promise<ImporterData> {
		const loaded = await super.loadData();
		const data = Object.assign({}, DEFAULT_DATA, loaded) as ImporterData;
		data.importers = Object.assign({}, DEFAULT_DATA.importers, data.importers);
		data.importers.onenote = Object.assign({}, DEFAULT_DATA.importers.onenote, data.importers.onenote);
		data.quickUrl = Object.assign({}, DEFAULT_DATA.quickUrl, data.quickUrl);
		return data;
	}

	async saveData(data: ImporterData): Promise<void> {
		await super.saveData(data);
	}

	/**
	 * Register a function to be called when the `obsidian://importer-auth/` open
	 * event is received by Obsidian.
	 *
	 * Note: The callback will be cleared after being called. It must be
	 * reregistered if a subsequent auth event is expected.
	 */
	public registerAuthCallback(callback: AuthCallback): void {
		this.authCallback = callback;
	}

	private async importUrlWithDefaults(sourceUrl: string, localNotesMode: boolean): Promise<void> {
		let parsed: URL;
		try {
			parsed = new URL(sourceUrl);
		}
		catch {
			new Notice('Invalid URL for quick import.');
			return;
		}

		if (!['http:', 'https:'].includes(parsed.protocol)) {
			new Notice('Quick import only supports HTTP/HTTPS URLs.');
			return;
		}

		const quick = this.data.quickUrl;
		const fakeModal = {
			contentEl: document.createElement('div'),
			plugin: this,
		} as unknown as ImporterModal;

		const importer = new UrlQuickImporter(this.app, fakeModal);
		importer.sourceUrl = parsed.href;
		importer.outputLocation = quick.outputFolder;
		importer.createImportSubfolder = quick.createImportSubfolder;
		importer.useObsidianAttachmentLocation = quick.useObsidianAttachmentLocation;
		importer.downloadImagesToHiddenAssets = quick.downloadImagesToHiddenAssets;
		importer.crawlInternalLinks = quick.followInternalLinks;
		importer.limitToBasePath = quick.restrictToSamePath;
		importer.includeUrlRegex = quick.includeUrlRegex;
		importer.excludeUrlRegex = quick.excludeUrlRegex;
		importer.maxPages = quick.maxPages;
		importer.maxDepth = quick.maxDepth;
		importer.preserveGraphConnections = quick.preserveGraphConnections;
		importer.useLocalNoteLinks = localNotesMode;

		const ctx = new ImportContext(document.createElement('div'));
		new Notice(`Importing URL${localNotesMode ? ' as local notes' : ''}: ${parsed.href}`);
		await importer.import(ctx);

		if (ctx.notes > 0) {
			new Notice(`Imported ${ctx.notes} note(s) from URL.`);
		}
		else {
			new Notice('Quick URL import did not create notes.');
		}
	}
}

class UrlQuickImporter extends UrlImporter {
	init(): void {
		// Quick import bypasses modal configuration fields and uses saved defaults.
	}
}

class ImporterSettingsTab extends PluginSettingTab {
	plugin: ImporterPlugin;

	constructor(app: App, plugin: ImporterPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		const quick = this.plugin.data.quickUrl;

		new Setting(containerEl)
			.setName('Output folder')
			.setDesc('Default vault folder for quick URL imports.')
			.addText(text => text
				.setValue(quick.outputFolder)
				.onChange(async (value) => {
					quick.outputFolder = value.trim() || DEFAULT_DATA.quickUrl.outputFolder;
					await this.plugin.saveData(this.plugin.data);
				}));

		new Setting(containerEl)
			.setName('Create folder per import')
			.setDesc('Create one subfolder and place all notes from each quick import run inside it.')
			.addToggle(toggle => toggle
				.setValue(quick.createImportSubfolder)
				.onChange(async (value) => {
					quick.createImportSubfolder = value;
					await this.plugin.saveData(this.plugin.data);
				}));

		new Setting(containerEl)
			.setName('Download images to hidden assets folder')
			.setDesc('Fallback mode when native attachment handling is disabled.')
			.addToggle(toggle => toggle
				.setValue(quick.downloadImagesToHiddenAssets)
				.onChange(async (value) => {
					quick.downloadImagesToHiddenAssets = value;
					await this.plugin.saveData(this.plugin.data);
				}));

		new Setting(containerEl)
			.setName('Use Obsidian attachment location')
			.setDesc('Delegate image file placement to Obsidian and compatible plugins such as Custom Attachment Location.')
			.addToggle(toggle => toggle
				.setValue(quick.useObsidianAttachmentLocation)
				.onChange(async (value) => {
					quick.useObsidianAttachmentLocation = value;
					await this.plugin.saveData(this.plugin.data);
				}));

		new Setting(containerEl)
			.setName('Follow internal links')
			.setDesc('Quick import will follow internal links recursively.')
			.addToggle(toggle => toggle
				.setValue(quick.followInternalLinks)
				.onChange(async (value) => {
					quick.followInternalLinks = value;
					await this.plugin.saveData(this.plugin.data);
				}));

		new Setting(containerEl)
			.setName('Restrict to same path')
			.setDesc('Only follow links under the same path prefix as the clicked URL.')
			.addToggle(toggle => toggle
				.setValue(quick.restrictToSamePath)
				.onChange(async (value) => {
					quick.restrictToSamePath = value;
					await this.plugin.saveData(this.plugin.data);
				}));

		new Setting(containerEl)
			.setName('Include URL regex')
			.setDesc('Optional regex to include links in recursive crawl.')
			.addText(text => text
				.setPlaceholder('/docs|guide/')
				.setValue(quick.includeUrlRegex)
				.onChange(async (value) => {
					quick.includeUrlRegex = value.trim();
					await this.plugin.saveData(this.plugin.data);
				}));

		new Setting(containerEl)
			.setName('Exclude URL regex')
			.setDesc('Optional regex to exclude links in recursive crawl.')
			.addText(text => text
				.setPlaceholder('/tag|login|category/')
				.setValue(quick.excludeUrlRegex)
				.onChange(async (value) => {
					quick.excludeUrlRegex = value.trim();
					await this.plugin.saveData(this.plugin.data);
				}));

		new Setting(containerEl)
			.setName('Max pages')
			.setDesc('Maximum number of pages in quick import.')
			.addText(text => text
				.setValue(quick.maxPages.toString())
				.then(({ inputEl }) => {
					inputEl.type = 'number';
					inputEl.min = '1';
					inputEl.step = '1';
				})
				.onChange(async (value) => {
					const parsed = Number(value);
					if (!Number.isFinite(parsed) || parsed < 1) {
						text.setValue(quick.maxPages.toString());
						return;
					}
					quick.maxPages = Math.floor(parsed);
					await this.plugin.saveData(this.plugin.data);
				}));

		new Setting(containerEl)
			.setName('Max link depth')
			.setDesc('Maximum recursive depth when following internal links.')
			.addText(text => text
				.setValue(quick.maxDepth.toString())
				.then(({ inputEl }) => {
					inputEl.type = 'number';
					inputEl.min = '0';
					inputEl.step = '1';
				})
				.onChange(async (value) => {
					const parsed = Number(value);
					if (!Number.isFinite(parsed) || parsed < 0) {
						text.setValue(quick.maxDepth.toString());
						return;
					}
					quick.maxDepth = Math.floor(parsed);
					await this.plugin.saveData(this.plugin.data);
				}));

		new Setting(containerEl)
			.setName('Preserve graph connections')
			.setDesc('Keep internal link relationships from the original page for Obsidian graph connections.')
			.addToggle(toggle => toggle
				.setValue(quick.preserveGraphConnections)
				.onChange(async (value) => {
					quick.preserveGraphConnections = value;
					await this.plugin.saveData(this.plugin.data);
				}));

		new Setting(containerEl)
			.setName('Convert imported links to local notes')
			.setDesc('Links between imported pages are converted to local .md links.')
			.addToggle(toggle => toggle
				.setValue(quick.useLocalNoteLinks)
				.onChange(async (value) => {
					quick.useLocalNoteLinks = value;
					await this.plugin.saveData(this.plugin.data);
				}));
	}
}

export class ImporterModal extends Modal {
	plugin: ImporterPlugin;
	importer: FormatImporter;
	selectedId: string;
	abortController: AbortController;

	current: ImportContext | null = null;

	constructor(app: App, plugin: ImporterPlugin) {
		super(app);
		this.plugin = plugin;
		this.titleEl.setText('Import data into Obsidian');
		this.modalEl.addClass('mod-importer');
		this.abortController = new AbortController();

		let keys = Object.keys(plugin.importers);
		if (keys.length > 0) {
			this.selectedId = keys[0];
			this.updateContent();
		}
	}

	updateContent() {
		const { contentEl, selectedId } = this;
		let importers = this.plugin.importers;
		let selectedImporter = importers[selectedId];
		contentEl.empty();

		let descriptionFragment = new DocumentFragment();
		descriptionFragment.createSpan({ text: 'The format to be imported.' });
		if (selectedImporter.formatDescription) {
			descriptionFragment.createEl('br');
			descriptionFragment.createSpan({ text: selectedImporter.formatDescription });
		}
		if (selectedImporter.helpPermalink) {
			descriptionFragment.createEl('br');
			descriptionFragment.createEl('a', {
				text: `Learn more about importing from ${selectedImporter.name}.`,
				href: `https://help.obsidian.md/${selectedImporter.helpPermalink}`,
			});
		}

		new Setting(contentEl)
			.setName('File format')
			.setDesc(descriptionFragment)
			.addDropdown(dropdown => {
				for (let id in importers) {
					if (importers.hasOwnProperty(id)) {
						dropdown.addOption(id, importers[id].optionText);
					}
				}
				dropdown.onChange((value) => {
					if (importers.hasOwnProperty(value)) {
						this.selectedId = value;
						this.updateContent();
					}
				});
				dropdown.setValue(this.selectedId);
			});

		if (selectedId && importers.hasOwnProperty(selectedId)) {
			let importer = this.importer = new selectedImporter.importer(this.app, this);

			//Hide the import buttons if it's not available.
			//The actual message to display is handled by the importer, since it depends on what is being imported.
			if (importer.notAvailable) return;

			contentEl.createDiv('modal-button-container', el => {
				el.createEl('button', { cls: 'mod-cta', text: 'Import' }, el => {
					el.addEventListener('click', async () => {
						if (this.current) {
							this.current.cancel();
						}

						// Clear content
						contentEl.empty();
						let configEl = contentEl.createDiv();
						let ctx = this.current = new ImportContext(configEl);

						// Check if importer needs template configuration
						const templateResult = await importer.showTemplateConfiguration(ctx, configEl);

						if (templateResult === false) {
							// User cancelled or preparation failed
							this.current = null;
							this.updateContent();
							return;
						}

						// Show progress UI
						contentEl.empty();
						let progressEl = contentEl.createDiv();
						ctx.createProgressUI(progressEl);

						let buttonsEl = contentEl.createDiv('modal-button-container');
						let cancelButtonEl = buttonsEl.createEl('button', { cls: 'mod-danger', text: 'Stop' }, el => {
							el.addEventListener('click', () => {
								ctx.cancel();
								cancelButtonEl.detach();
							});
						});
						try {
							await importer.import(ctx);
						}
						finally {
							if (this.current === ctx) {
								this.current = null;
							}
							buttonsEl.empty();
							buttonsEl.createEl('button', { text: 'Import more' }, el => {
								el.addEventListener('click', () => this.updateContent());
							});
							buttonsEl.createEl('button', { cls: 'mod-cta', text: 'Done' }, el => {
								el.addEventListener('click', () => this.close());
							});
							ctx.hideStatus();
						}
					});
				});
			});
		}
	}

	onClose() {
		const { contentEl, current } = this;
		contentEl.empty();
		this.abortController.abort('import was canceled by user');

		if (current) {
			current.cancel();
		}
	}
}
