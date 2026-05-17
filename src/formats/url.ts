import { htmlToMarkdown, normalizePath, Notice, requestUrl, Setting, TFile, TFolder } from 'obsidian';
import { FormatImporter } from '../format-importer';
import { ImportContext } from '../main';
import { extensionForMime } from '../mime';
import { parseHTML, sanitizeFileName } from '../util';

const CONTENT_SELECTORS = [
	'article',
	'main',
	'[itemprop="articleBody"]',
	'[role="main"]',
	'.article-content',
	'.entry-content',
	'.post-content',
	'body',
];

const NOISE_SELECTORS = [
	'script',
	'style',
	'noscript',
	'template',
	'svg',
	'canvas',
	'iframe',
	'nav',
	'footer',
	'aside',
	'form',
	'button',
	'[aria-hidden="true"]',
	'[hidden]',
	'.advertisement',
	'.ads',
	'.ad',
	'.cookie',
	'.newsletter',
	'.sidebar',
	'.social',
	'.share',
	'.comments',
];

interface CrawlItem {
	url: URL;
	depth: number;
}

interface CrawlPage {
	url: URL;
	urlKey: string;
	title: string;
	markdown: string;
	discoveredInternalUrls: string[];
	graphInternalUrls: string[];
}

export class UrlImporter extends FormatImporter {
	sourceUrl: string = '';
	noteTitle: string = '';
	crawlInternalLinks: boolean = true;
	limitToBasePath: boolean = true;
	includeUrlRegex: string = '';
	excludeUrlRegex: string = '';
	preserveGraphConnections: boolean = true;
	createImportSubfolder: boolean = false;
	useLocalNoteLinks: boolean = false;
	useObsidianAttachmentLocation: boolean = true;
	downloadImagesToHiddenAssets: boolean = true;
	maxPages: number = 10;
	maxDepth: number = 1;

	init() {
		const quick = this.modal.plugin.data.quickUrl;
		this.crawlInternalLinks = quick.followInternalLinks;
		this.limitToBasePath = quick.restrictToSamePath;
		this.includeUrlRegex = quick.includeUrlRegex;
		this.excludeUrlRegex = quick.excludeUrlRegex;
		this.preserveGraphConnections = quick.preserveGraphConnections;
		this.createImportSubfolder = quick.createImportSubfolder;
		this.useLocalNoteLinks = quick.useLocalNoteLinks;
		this.useObsidianAttachmentLocation = quick.useObsidianAttachmentLocation;
		this.downloadImagesToHiddenAssets = quick.downloadImagesToHiddenAssets;
		this.maxPages = quick.maxPages;
		this.maxDepth = quick.maxDepth;

		new Setting(this.modal.contentEl)
			.setName('Page URL')
			.setDesc('Paste the URL of the page you want to import.')
			.addText(text => text
				.setPlaceholder('https://example.com/article')
				.onChange(value => {
					this.sourceUrl = value.trim();
				}));

		new Setting(this.modal.contentEl)
			.setName('File name (optional)')
			.setDesc('Leave empty to use the page title.')
			.addText(text => text
				.setPlaceholder('Optional custom note name')
				.onChange(value => {
					this.noteTitle = value.trim();
				}));

		this.addOutputLocationSetting('URL import');
	}

	async import(ctx: ImportContext): Promise<void> {
		if (!this.sourceUrl) {
			new Notice('Please provide a valid URL to import.');
			return;
		}

		let parsedUrl: URL;
		try {
			parsedUrl = new URL(this.sourceUrl);
		}
		catch {
			new Notice('Invalid URL. Please check the address and try again.');
			return;
		}

		if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
			new Notice('Only HTTP/HTTPS URLs are supported.');
			return;
		}

		const folder = await this.getOutputFolder();
		if (!(folder instanceof TFolder)) {
			new Notice('Please select a location to export to.');
			return;
		}

		try {
			const includeMatcher = this.compileRegex(this.includeUrlRegex, 'Include URL regex');
			const excludeMatcher = this.compileRegex(this.excludeUrlRegex, 'Exclude URL regex');
			const basePathPrefix = this.getPathPrefix(parsedUrl);
			const crawlResult = await this.crawlPages(parsedUrl, ctx, basePathPrefix, includeMatcher, excludeMatcher);
			if (crawlResult.length === 0) {
				ctx.reportFailed(parsedUrl.href, 'No importable content found on this URL.');
				return;
			}

			const filenameMap = this.buildFileNameMap(crawlResult, parsedUrl);
			const rootFolderName = filenameMap.get(this.urlToKey(parsedUrl)) || this.resolveNoteTitle(parsedUrl, '');
			const saveFolder = this.createImportSubfolder
				? await this.createImportBatchFolder(folder, rootFolderName)
				: folder;
			const pageByKey = new Map<string, CrawlPage>(crawlResult.map(page => [page.urlKey, page]));
			for (let i = 0; i < crawlResult.length; i++) {
				const page = crawlResult[i];
				let linkedMarkdown = this.absolutizeMarkdownLinks(page.markdown, page.url);
				if (this.useLocalNoteLinks) {
					linkedMarkdown = this.rewriteImportedLinksToLocal(linkedMarkdown, page.urlKey, filenameMap);
				}
				const filename = filenameMap.get(page.urlKey) || this.resolveNoteTitle(page.url, page.title);
				const graphLinks = this.buildGraphConnectionLinks(page, pageByKey, filenameMap);

				let finalMarkdown = `> Source: ${page.url.href}\n\n${linkedMarkdown.trim()}\n`;
				if (graphLinks.length > 0) {
					finalMarkdown += `\n## Related pages\n\n${graphLinks.join('\n')}\n`;
				}

				const createdNote = await this.saveAsMarkdownFile(saveFolder, filename, finalMarkdown);
				if (this.downloadImagesToHiddenAssets) {
					const updated = await this.downloadImagesToAssets(finalMarkdown, page.url, createdNote);
					if (updated !== finalMarkdown) {
						await this.vault.modify(createdNote, updated);
					}
				}
				ctx.reportNoteSuccess(page.url.href);
				ctx.reportProgress(i + 1, crawlResult.length);
			}

			ctx.status('Import complete');
		}
		catch (error) {
			ctx.reportFailed(parsedUrl.href, error);
		}
	}

	private async crawlPages(startUrl: URL, ctx: ImportContext, basePathPrefix: string, includeMatcher: RegExp | null, excludeMatcher: RegExp | null): Promise<CrawlPage[]> {
		const queue: CrawlItem[] = [{ url: startUrl, depth: 0 }];
		const visited = new Set<string>();
		const discovered = new Set<string>([this.urlToKey(startUrl)]);
		const pages: CrawlPage[] = [];
		const crawlEnabled = this.crawlInternalLinks && this.maxPages > 1;

		while (queue.length > 0 && pages.length < this.maxPages) {
			if (ctx.isCancelled()) break;

			const current = queue.shift();
			if (!current) break;

			const currentKey = this.urlToKey(current.url);
			if (visited.has(currentKey)) continue;
			visited.add(currentKey);

			ctx.status(`Fetching page ${pages.length + 1}/${this.maxPages}`);
			const page = await this.fetchAndConvertPage(current.url, basePathPrefix, includeMatcher, excludeMatcher);
			if (!page || !page.markdown.trim()) {
				ctx.reportSkipped(current.url.href, 'No importable content found.');
				continue;
			}

			pages.push(page);

			if (!crawlEnabled || current.depth >= this.maxDepth) {
				continue;
			}

			for (const childKey of page.discoveredInternalUrls) {
				if (discovered.has(childKey) || visited.has(childKey)) continue;

				discovered.add(childKey);
				queue.push({ url: new URL(childKey), depth: current.depth + 1 });
				if (discovered.size >= this.maxPages * 4) {
					break;
				}
			}
		}

		return pages;
	}

	private async fetchAndConvertPage(sourceUrl: URL, basePathPrefix: string, includeMatcher: RegExp | null, excludeMatcher: RegExp | null): Promise<CrawlPage | null> {
		const response = await requestUrl(sourceUrl.href);
		const contentType = ((response.headers['content-type'] || response.headers['Content-Type']) || '').toLowerCase();
		const text = response.text;

		if (contentType.includes('text/markdown')) {
			const title = this.resolveNoteTitle(sourceUrl, '');
			return {
				url: sourceUrl,
				urlKey: this.urlToKey(sourceUrl),
				title,
				markdown: text,
				discoveredInternalUrls: [],
				graphInternalUrls: [],
			};
		}

		if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml') && contentType !== '') {
			const title = this.resolveNoteTitle(sourceUrl, '');
			return {
				url: sourceUrl,
				urlKey: this.urlToKey(sourceUrl),
				title,
				markdown: text,
				discoveredInternalUrls: [],
				graphInternalUrls: [],
			};
		}

		const dom = parseHTML(text);
		const title = this.resolveNoteTitle(sourceUrl, text);
		const graphInternalUrls = this.preserveGraphConnections
			? this.extractInternalUrls(dom, sourceUrl, basePathPrefix, includeMatcher, excludeMatcher)
			: [];
		const preparedContent = this.extractMainContent(dom, sourceUrl);
		const discoveredInternalUrls = this.extractInternalUrls(preparedContent, sourceUrl, basePathPrefix, includeMatcher, excludeMatcher);
		const markdown = htmlToMarkdown(preparedContent);
		const mergedDiscovered = Array.from(new Set([...discoveredInternalUrls, ...graphInternalUrls]));

		return {
			url: sourceUrl,
			urlKey: this.urlToKey(sourceUrl),
			title,
			markdown,
			discoveredInternalUrls: mergedDiscovered,
			graphInternalUrls,
		};
	}

	private extractMainContent(root: HTMLElement, sourceUrl: URL): HTMLElement {
		const doc = document.implementation.createHTMLDocument('');
		const wrapper = doc.createElement('article');
		wrapper.setAttribute('data-import-source', sourceUrl.href);

		root.findAll(NOISE_SELECTORS.join(', ')).forEach(element => element.remove());

		const bestRoot = this.findBestContentRoot(root);
		const clonedRoot = doc.importNode(bestRoot, true) as HTMLElement;
		this.normalizeAnchors(clonedRoot, sourceUrl);
		this.removeEmptyNodes(clonedRoot);
		wrapper.appendChild(clonedRoot);
		doc.body.appendChild(wrapper);
		return doc.documentElement;
	}

	private findBestContentRoot(root: HTMLElement): HTMLElement {
		let bestElement: HTMLElement | null = null;
		let bestScore = -1;

		for (const selector of CONTENT_SELECTORS) {
			const candidates = Array.from(root.querySelectorAll(selector)) as HTMLElement[];
			for (const candidate of candidates) {
				const textLength = candidate.textContent?.replace(/\s+/g, ' ').trim().length || 0;
				if (textLength < 120) continue;

				const linkTextLength = Array.from(candidate.querySelectorAll('a'))
					.reduce((sum, anchor) => sum + (anchor.textContent?.trim().length || 0), 0);
				const headingBoost = candidate.querySelector('h1, h2, h3') ? 80 : 0;
				const penalty = Math.floor((linkTextLength / Math.max(textLength, 1)) * 100);
				const score = textLength + headingBoost - penalty;

				if (score > bestScore) {
					bestElement = candidate;
					bestScore = score;
				}
			}
		}

		return bestElement || root;
	}

	private normalizeAnchors(root: HTMLElement, pageUrl: URL): void {
		const anchors = Array.from(root.querySelectorAll('a[href]')) as HTMLAnchorElement[];
		for (const anchor of anchors) {
			const rawHref = anchor.getAttribute('href');
			if (!rawHref) continue;

			try {
				const resolved = this.normalizeUrl(new URL(rawHref, pageUrl));
				if (resolved.protocol === 'http:' || resolved.protocol === 'https:') {
					anchor.setAttribute('href', resolved.href);
				}
			}
			catch {
				anchor.removeAttribute('href');
			}
		}

		const images = Array.from(root.querySelectorAll('img[src]')) as HTMLImageElement[];
		for (const image of images) {
			const rawSrc = image.getAttribute('src');
			if (!rawSrc) continue;

			try {
				const resolved = this.normalizeUrl(new URL(rawSrc, pageUrl));
				if (resolved.protocol === 'http:' || resolved.protocol === 'https:') {
					image.setAttribute('src', resolved.href);
				}
			}
			catch {
				image.removeAttribute('src');
			}
		}
	}

	private extractInternalUrls(root: HTMLElement, pageUrl: URL, basePathPrefix: string, includeMatcher: RegExp | null, excludeMatcher: RegExp | null): string[] {
		const urls = new Set<string>();
		const anchors = Array.from(root.querySelectorAll('a[href]')) as HTMLAnchorElement[];
		for (const anchor of anchors) {
			const rawHref = anchor.getAttribute('href');
			if (!rawHref) continue;

			try {
				const resolved = this.normalizeUrl(new URL(rawHref, pageUrl));
				if ((resolved.protocol === 'http:' || resolved.protocol === 'https:')
					&& this.isSameSite(pageUrl, resolved)
					&& this.isAllowedPath(resolved, basePathPrefix)
					&& this.matchesUrlFilters(resolved, includeMatcher, excludeMatcher)) {
					urls.add(this.urlToKey(resolved));
				}
			}
			catch {
				continue;
			}
		}

		return Array.from(urls);
	}

	private buildFileNameMap(pages: CrawlPage[], firstUrl: URL): Map<string, string> {
		const map = new Map<string, string>();
		const usedNames = new Set<string>();

		for (let index = 0; index < pages.length; index++) {
			const page = pages[index];
			const preferred = index === 0 && this.noteTitle
				? sanitizeFileName(this.noteTitle)
				: sanitizeFileName(page.title || this.resolveNoteTitle(page.url, ''));
			const unique = this.dedupeName(preferred, usedNames);
			map.set(page.urlKey, unique);
		}

		if (!map.has(this.urlToKey(firstUrl))) {
			map.set(this.urlToKey(firstUrl), this.dedupeName(this.resolveNoteTitle(firstUrl, ''), usedNames));
		}

		return map;
	}

	private buildGraphConnectionLinks(page: CrawlPage, pageByKey: Map<string, CrawlPage>, filenameMap: Map<string, string>): string[] {
		const links: string[] = [];
		const candidates = page.graphInternalUrls.length > 0 ? page.graphInternalUrls : page.discoveredInternalUrls;
		for (const discovered of candidates) {
			if (discovered === page.urlKey) continue;
			const linkedPage = pageByKey.get(discovered);
			if (!linkedPage) continue;
			const linkedFileName = filenameMap.get(discovered);
			const linkTitle = linkedPage.title || linkedFileName || linkedPage.url.hostname;
			if (this.useLocalNoteLinks && linkedFileName) {
				links.push(`- [${linkTitle}](${encodeURI(linkedFileName)}.md)`);
			}
			else {
				links.push(`- [${linkTitle}](${linkedPage.url.href})`);
			}
		}
		return Array.from(new Set(links));
	}

	private rewriteImportedLinksToLocal(markdown: string, currentUrlKey: string, filenameMap: Map<string, string>): string {
		return markdown.replace(/!?\[[^\]]*\]\(([^)]+)\)/g, (fullMatch, rawTarget: string) => {
			if (fullMatch.startsWith('![')) {
				return fullMatch;
			}

			const target = rawTarget.trim();
			if (!target) {
				return fullMatch;
			}

			try {
				const parsed = new URL(target);
				if (!['http:', 'https:'].includes(parsed.protocol)) {
					return fullMatch;
				}

				const key = this.urlToKey(parsed);
				if (key === currentUrlKey) {
					return fullMatch;
				}

				const localName = filenameMap.get(key);
				if (!localName) {
					return fullMatch;
				}

				return `](${encodeURI(localName)}.md)`;
			}
			catch {
				return fullMatch;
			}
		});
	}

	private async downloadImagesToAssets(markdown: string, baseUrl: URL, noteFile: TFile): Promise<string> {
		if (this.useObsidianAttachmentLocation) {
			return await this.downloadImagesViaObsidian(markdown, baseUrl, noteFile);
		}

		const noteParent = noteFile.parent;
		if (!noteParent) {
			return markdown;
		}

		const hiddenFolderName = `.${sanitizeFileName(noteFile.basename)}.assets`;
		const hiddenFolderPath = normalizePath(noteParent.path === '/'
			? hiddenFolderName
			: `${noteParent.path}/${hiddenFolderName}`);
		const hiddenFolder = await this.ensureExactFolder(hiddenFolderPath);

		const downloaded = new Map<string, TFile>();
		const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
		const matches = Array.from(markdown.matchAll(imageRegex));
		let rewritten = markdown;

		for (const match of matches) {
			const full = match[0];
			const alt = match[1];
			const rawTarget = match[2].trim();
			if (!rawTarget || rawTarget.startsWith('data:')) {
				continue;
			}

			let absolute: URL;
			try {
				absolute = new URL(rawTarget, baseUrl);
			}
			catch {
				continue;
			}

			if (!['http:', 'https:'].includes(absolute.protocol)) {
				continue;
			}

			let saved: TFile | null | undefined = downloaded.get(absolute.href);
			if (!saved) {
				saved = await this.downloadImageToFolder(absolute, hiddenFolder);
				if (saved) {
					downloaded.set(absolute.href, saved);
				}
			}

			if (!saved) {
				continue;
			}

			const localTarget = `./${encodeURI(hiddenFolder.name)}/${encodeURI(saved.name)}`;
			const replacement = `![${alt}](${localTarget})`;
			rewritten = rewritten.split(full).join(replacement);
		}

		return rewritten;
	}

	private async downloadImagesViaObsidian(markdown: string, baseUrl: URL, noteFile: TFile): Promise<string> {
		const downloaded = new Map<string, TFile>();
		const claimedPaths: string[] = [];
		const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
		const matches = Array.from(markdown.matchAll(imageRegex));
		let rewritten = markdown;

		for (const match of matches) {
			const full = match[0];
			const alt = match[1];
			const rawTarget = match[2].trim();
			if (!rawTarget || rawTarget.startsWith('data:')) {
				continue;
			}

			let absolute: URL;
			try {
				absolute = new URL(rawTarget, baseUrl);
			}
			catch {
				continue;
			}

			if (!['http:', 'https:'].includes(absolute.protocol)) {
				continue;
			}

			let saved: TFile | null | undefined = downloaded.get(absolute.href);
			if (!saved) {
				saved = await this.downloadImageToManagedAttachment(absolute, noteFile, claimedPaths);
				if (saved) {
					downloaded.set(absolute.href, saved);
					claimedPaths.push(saved.path);
				}
			}

			if (!saved) {
				continue;
			}

			const generatedLink = this.app.fileManager.generateMarkdownLink(saved, noteFile.path, undefined, alt || undefined);
			const replacement = generatedLink.startsWith('!') ? generatedLink : `!${generatedLink}`;
			rewritten = rewritten.split(full).join(replacement);
		}

		return rewritten;
	}

	private async downloadImageToFolder(source: URL, folder: TFolder): Promise<TFile | null> {
		try {
			const response = await requestUrl(source.href);
			const bytes = response.arrayBuffer;
			if (!bytes || bytes.byteLength === 0) {
				return null;
			}

			const contentType = (response.headers['content-type'] || response.headers['Content-Type'] || '').toLowerCase();
			const mimeExt = extensionForMime(contentType.replace(/;.*$/, ''));
			const { basename, extension } = this.parseNameFromUrl(source);
			const finalExtension = mimeExt || extension || 'bin';
			const rawFileName = sanitizeFileName(`${basename || 'image'}.${finalExtension}`);

			const path = await this.getUniqueFilePath(folder, rawFileName);
			return await this.vault.createBinary(path, bytes);
		}
		catch {
			return null;
		}
	}

	private async downloadImageToManagedAttachment(source: URL, noteFile: TFile, claimedPaths: string[]): Promise<TFile | null> {
		try {
			const response = await requestUrl(source.href);
			const bytes = response.arrayBuffer;
			if (!bytes || bytes.byteLength === 0) {
				return null;
			}

			const contentType = (response.headers['content-type'] || response.headers['Content-Type'] || '').toLowerCase();
			const mimeExt = extensionForMime(contentType.replace(/;.*$/, ''));
			const { basename, extension } = this.parseNameFromUrl(source);
			const finalExtension = mimeExt || extension || 'bin';
			const fileName = sanitizeFileName(`${basename || 'image'}.${finalExtension}`);
			const outputPath = await this.getAvailablePathForAttachment(fileName, claimedPaths, noteFile.path);
			return await this.vault.createBinary(outputPath, bytes);
		}
		catch {
			return null;
		}
	}

	private parseNameFromUrl(url: URL): { basename: string; extension: string } {
		const lastSegment = url.pathname.split('/').filter(Boolean).pop() || 'image';
		let decoded = lastSegment;
		try {
			decoded = decodeURIComponent(lastSegment);
		}
		catch {
			decoded = lastSegment;
		}
		const sanitized = sanitizeFileName(decoded);
		const dot = sanitized.lastIndexOf('.');
		if (dot <= 0 || dot === sanitized.length - 1) {
			return { basename: sanitized, extension: '' };
		}

		return {
			basename: sanitized.substring(0, dot),
			extension: sanitized.substring(dot + 1).toLowerCase(),
		};
	}

	private async getUniqueFilePath(folder: TFolder, fileName: string): Promise<string> {
		const dot = fileName.lastIndexOf('.');
		const base = dot > 0 ? fileName.substring(0, dot) : fileName;
		const ext = dot > 0 ? fileName.substring(dot + 1) : '';

		let candidate = normalizePath(`${folder.path}/${fileName}`);
		let index = 2;
		while (this.vault.getAbstractFileByPath(candidate)) {
			const withSuffix = ext ? `${base} ${index}.${ext}` : `${base} ${index}`;
			candidate = normalizePath(`${folder.path}/${withSuffix}`);
			index++;
		}

		return candidate;
	}

	private async ensureExactFolder(path: string): Promise<TFolder> {
		let existing = this.vault.getAbstractFileByPath(path);
		if (existing instanceof TFolder) {
			return existing;
		}

		await this.vault.createFolder(path);
		existing = this.vault.getAbstractFileByPath(path);
		if (!(existing instanceof TFolder)) {
			throw new Error(`Failed to create folder at ${path}`);
		}

		return existing;
	}

	private async createImportBatchFolder(baseFolder: TFolder, rootName: string): Promise<TFolder> {
		const safeRoot = sanitizeFileName(rootName || 'URL import');
		const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', ' ').slice(0, 19);
		const folderName = sanitizeFileName(`${safeRoot} ${stamp}`);

		const folderPath = baseFolder.path === '/'
			? folderName
			: normalizePath(`${baseFolder.path}/${folderName}`);

		return await this.createFolders(folderPath);
	}

	private absolutizeMarkdownLinks(markdown: string, baseUrl: URL): string {
		return markdown.replace(/\]\(([^)]+)\)/g, (fullMatch, rawTarget: string) => {
			const target = rawTarget.trim();
			if (!target || target.startsWith('#')) {
				return fullMatch;
			}

			if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) {
				return fullMatch;
			}

			try {
				const absolute = new URL(target, baseUrl).href;
				return `](${absolute})`;
			}
			catch {
				return fullMatch;
			}
		});
	}

	private removeEmptyNodes(root: HTMLElement): void {
		const candidates = Array.from(root.querySelectorAll('p, div, section, span'));
		for (const node of candidates) {
			if (node.children.length === 0 && !(node.textContent || '').trim()) {
				node.remove();
			}
		}
	}

	private normalizeUrl(url: URL): URL {
		const normalized = new URL(url.href);
		normalized.hash = '';

		for (const key of Array.from(normalized.searchParams.keys())) {
			const lower = key.toLowerCase();
			if (lower.startsWith('utm_') || lower === 'fbclid' || lower === 'gclid') {
				normalized.searchParams.delete(key);
			}
		}

		if (normalized.pathname.endsWith('/') && normalized.pathname !== '/') {
			normalized.pathname = normalized.pathname.slice(0, -1);
		}

		return normalized;
	}

	private urlToKey(url: URL): string {
		return this.normalizeUrl(url).href;
	}

	private isSameSite(base: URL, other: URL): boolean {
		return base.hostname.toLowerCase() === other.hostname.toLowerCase();
	}

	private getPathPrefix(url: URL): string {
		const normalized = this.normalizeUrl(url);
		if (!this.limitToBasePath) {
			return '/';
		}

		const path = normalized.pathname || '/';
		if (path === '/') {
			return '/';
		}

		const segments = path.split('/').filter(Boolean);
		if (segments.length === 0) {
			return '/';
		}

		if (!path.endsWith('/')) {
			segments.pop();
		}

		return segments.length > 0 ? `/${segments.join('/')}/` : '/';
	}

	private isAllowedPath(url: URL, basePathPrefix: string): boolean {
		if (!this.limitToBasePath || basePathPrefix === '/') {
			return true;
		}

		const pathname = this.normalizeUrl(url).pathname || '/';
		return pathname === basePathPrefix.slice(0, -1) || pathname.startsWith(basePathPrefix);
	}

	private dedupeName(base: string, usedNames: Set<string>): string {
		const normalized = sanitizeFileName(base) || 'Untitled';
		if (!usedNames.has(normalized)) {
			usedNames.add(normalized);
			return normalized;
		}

		let index = 2;
		let candidate = `${normalized} ${index}`;
		while (usedNames.has(candidate)) {
			index++;
			candidate = `${normalized} ${index}`;
		}

		usedNames.add(candidate);
		return candidate;
	}

	private compileRegex(pattern: string, label: string): RegExp | null {
		if (!pattern) {
			return null;
		}

		try {
			return new RegExp(pattern, 'i');
		}
		catch {
			throw new Error(`${label} is invalid.`);
		}
	}

	private matchesUrlFilters(url: URL, includeMatcher: RegExp | null, excludeMatcher: RegExp | null): boolean {
		const value = this.urlToKey(url);
		if (includeMatcher && !includeMatcher.test(value)) {
			return false;
		}
		if (excludeMatcher && excludeMatcher.test(value)) {
			return false;
		}
		return true;
	}

	private resolveNoteTitle(sourceUrl: URL, rawResponseText: string): string {
		let pageTitle = '';
		try {
			if (rawResponseText) {
				const dom = parseHTML(rawResponseText);
				pageTitle = dom.querySelector('title')?.textContent?.trim() || '';
			}
		}
		catch {
			// Keep fallback title.
		}

		if (!pageTitle) {
			const pathName = sourceUrl.pathname.split('/').filter(Boolean).pop();
			pageTitle = pathName || sourceUrl.hostname;
		}

		return sanitizeFileName(pageTitle);
	}
}
