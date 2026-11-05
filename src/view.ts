import { ItemView, Notice, TFile, TFolder, WorkspaceLeaf } from "obsidian";
import {
	addFileToIndex,
	createEmptyIndex,
	finalizeIndex,
	VaultIndex,
} from "./index";
import {
	DateFormatVariant,
	DriftReason,
	FullReport,
	LookalikeKeyGroup,
	lookupPropertyByValue,
	MixedDateFormatGroup,
	MixedTypeGroup,
	NearDuplicateValueGroup,
	RareKeyGroup,
	runAllDetectors,
	VariantItem,
} from "./detectors";
import type VaultHealthPlugin from "./main";

export const VIEW_TYPE_VAULT_HEALTH = "vault-health-report-view";

type SectionId =
	| "all"
	| "lookalike-keys"
	| "near-duplicate-values"
	| "mixed-types"
	| "mixed-dates"
	| "rare-keys"
	| "lookup";

const NOTES_PAGE_SIZE = 20;
const SCAN_BATCH_SIZE = 500;

export class ReportView extends ItemView {
	plugin: VaultHealthPlugin;

	private currentIndex: VaultIndex | null = null;
	private currentReport: FullReport | null = null;
	private selectedFolder = "";
	private activeSectionFilter: SectionId = "all";
	private showDismissed = false;
	private lookupQuery = "";
	private lookupContains = false;
	private isScanning = false;
	private scanRunId = 0;

	private summaryEl: HTMLElement | null = null;
	private bodyEl: HTMLElement | null = null;
	private chipsContainerEl: HTMLElement | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: VaultHealthPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_VAULT_HEALTH;
	}

	getDisplayText(): string {
		return "Vault Health Report";
	}

	getIcon(): string {
		return "stethoscope";
	}

	async onOpen(): Promise<void> {
		this.buildSkeleton();
		await this.runScan();
	}

	async onClose(): Promise<void> {
		this.scanRunId += 1;
	}

	private buildSkeleton(): void {
		const root = this.contentEl;
		root.empty();
		root.addClass("vhr-container");

		const header = root.createDiv({ cls: "vhr-header" });

		this.summaryEl = header.createDiv({
			cls: "vhr-summary",
			text: "Scanning vault...",
		});

		const controlsRow = header.createDiv({ cls: "vhr-controls-row" });

		const rescanBtn = controlsRow.createEl("button", {
			cls: "vhr-btn vhr-btn-primary",
			text: "Rescan",
		});
		rescanBtn.addEventListener("click", () => {
			void this.runScan();
		});

		const copyBtn = controlsRow.createEl("button", {
			cls: "vhr-btn",
			text: "Copy report as markdown",
		});
		copyBtn.addEventListener("click", () => {
			void this.copyReportAsMarkdown();
		});

		const scopeWrap = controlsRow.createDiv({ cls: "vhr-scope-wrap" });
		scopeWrap.createEl("label", {
			cls: "vhr-label",
			text: "Scope:",
		});
		const scopeSelect = scopeWrap.createEl("select", {
			cls: "dropdown vhr-scope-select",
		});
		this.populateFolderOptions(scopeSelect);
		scopeSelect.value = this.selectedFolder;
		scopeSelect.addEventListener("change", () => {
			this.selectedFolder = scopeSelect.value;
			void this.runScan();
		});

		const dismissedWrap = controlsRow.createEl("label", {
			cls: "vhr-dismissed-toggle",
		});
		const dismissedCheckbox = dismissedWrap.createEl("input", {
			type: "checkbox",
		});
		dismissedCheckbox.checked = this.showDismissed;
		dismissedWrap.createSpan({ text: "Show dismissed" });
		dismissedCheckbox.addEventListener("change", () => {
			this.showDismissed = dismissedCheckbox.checked;
			this.recomputeReportFromIndex();
		});

		this.chipsContainerEl = header.createDiv({ cls: "vhr-chips-row" });

		this.bodyEl = root.createDiv({ cls: "vhr-body" });
	}

	private populateFolderOptions(selectEl: HTMLSelectElement): void {
		selectEl.empty();
		selectEl.createEl("option", {
			value: "",
			text: "Whole vault",
		});

		const folders: string[] = [];
		for (const abstractFile of this.app.vault.getAllLoadedFiles()) {
			if (abstractFile instanceof TFolder && !abstractFile.isRoot()) {
				folders.push(abstractFile.path);
			}
		}
		folders.sort((a, b) => a.localeCompare(b));

		for (const folderPath of folders) {
			selectEl.createEl("option", {
				value: folderPath,
				text: folderPath,
			});
		}
	}

	async runScan(): Promise<void> {
		if (this.isScanning) {
			this.scanRunId += 1;
		}
		const runId = ++this.scanRunId;
		this.isScanning = true;

		const allMarkdownFiles = this.app.vault.getMarkdownFiles();
		const scopedFiles = this.selectedFolder
			? allMarkdownFiles.filter(
					(f) =>
						f.path === this.selectedFolder ||
						f.path.startsWith(this.selectedFolder + "/")
			  )
			: allMarkdownFiles;

		const index = createEmptyIndex();
		const ignoredSet = new Set<string>(["position"]);
		for (const k of this.plugin.settings.ignoredKeys) {
			const trimmed = k.trim();
			if (trimmed) ignoredSet.add(trimmed);
		}
		const excludedFolders = this.plugin.settings.excludedFolders;

		const total = scopedFiles.length;

		for (let i = 0; i < total; i += SCAN_BATCH_SIZE) {
			if (runId !== this.scanRunId) return;

			const end = Math.min(i + SCAN_BATCH_SIZE, total);
			if (this.summaryEl && total > SCAN_BATCH_SIZE) {
				this.summaryEl.setText(
					`Scanning notes... ${i.toLocaleString()} / ${total.toLocaleString()}`
				);
			}

			for (let j = i; j < end; j++) {
				const file = scopedFiles[j];
				const cache = this.app.metadataCache.getFileCache(file);
				addFileToIndex(
					index,
					{
						path: file.path,
						frontmatter: cache?.frontmatter ?? null,
					},
					ignoredSet,
					excludedFolders
				);
			}

			if (end < total) {
				await new Promise<void>((resolve) =>
					window.setTimeout(resolve, 0)
				);
			}
		}

		if (runId !== this.scanRunId) return;

		finalizeIndex(index);
		this.currentIndex = index;
		this.isScanning = false;
		this.recomputeReportFromIndex();
	}

	recomputeReportFromIndex(): void {
		if (!this.currentIndex) return;

		this.currentReport = runAllDetectors(this.currentIndex, {
			rareKeyThreshold: this.plugin.settings.rareKeyThreshold,
			enableSpellingDistance:
				this.plugin.settings.enableSpellingDistance,
			keySynonymSets: this.plugin.settings.keySynonymSets,
			valueSynonymSets: this.plugin.settings.valueSynonymSets,
			dismissedGroups: this.plugin.settings.dismissedGroups,
			showDismissed: this.showDismissed,
		});

		this.renderReport();
	}

	private renderReport(): void {
		if (!this.currentIndex || !this.currentReport || !this.bodyEl) return;

		const notesCount = this.currentIndex.totalNotes;
		const propsCount = this.currentIndex.keys.size;
		const groupsCount = this.currentReport.totalDriftGroups;

		if (this.summaryEl) {
			const baseSummary = `Scanned ${notesCount.toLocaleString()} note${
				notesCount === 1 ? "" : "s"
			}, ${propsCount.toLocaleString()} propert${
				propsCount === 1 ? "y" : "ies"
			}. Found ${groupsCount.toLocaleString()} drift group${
				groupsCount === 1 ? "" : "s"
			}.`;

			if (!this.plugin.isMetadataReady()) {
				this.summaryEl.setText(
					`${baseSummary} Obsidian is still indexing your vault. Results may be incomplete.`
				);
			} else {
				this.summaryEl.setText(baseSummary);
			}
		}

		this.renderFilterChips(this.currentReport);

		this.bodyEl.empty();

		const showSection = (id: SectionId) =>
			this.activeSectionFilter === "all" ||
			this.activeSectionFilter === id;

		if (showSection("lookalike-keys")) {
			this.renderLookalikeKeysSection(
				this.bodyEl,
				this.currentReport.lookalikeKeys
			);
		}

		if (showSection("near-duplicate-values")) {
			this.renderNearDuplicateValuesSection(
				this.bodyEl,
				this.currentReport.nearDuplicateValues
			);
		}

		if (showSection("mixed-types")) {
			this.renderMixedTypesSection(
				this.bodyEl,
				this.currentReport.mixedTypes
			);
		}

		if (showSection("mixed-dates")) {
			this.renderMixedDatesSection(
				this.bodyEl,
				this.currentReport.mixedDateFormats
			);
		}

		if (showSection("rare-keys")) {
			this.renderRareKeysSection(
				this.bodyEl,
				this.currentReport.rareKeys
			);
		}

		if (showSection("lookup")) {
			this.renderLookupSection(this.bodyEl);
		}

		if (this.currentReport.nestedKeys.length > 0) {
			const footer = this.bodyEl.createDiv({ cls: "vhr-nested-footer" });
			const keyList = this.currentReport.nestedKeys
				.map((n) => `${n.key} (${n.count})`)
				.join(", ");
			footer.createSpan({
				cls: "vhr-nested-text",
				text: `Not scanned: nested values: ${keyList}`,
			});
		}
	}

	private renderFilterChips(report: FullReport): void {
		if (!this.chipsContainerEl) return;
		this.chipsContainerEl.empty();

		const chips: { id: SectionId; label: string; count?: number }[] = [
			{
				id: "all",
				label: "All",
				count: report.totalDriftGroups,
			},
			{
				id: "lookalike-keys",
				label: "Lookalike keys",
				count: report.lookalikeKeys.length,
			},
			{
				id: "near-duplicate-values",
				label: "Near-duplicate values",
				count: report.nearDuplicateValues.length,
			},
			{
				id: "mixed-types",
				label: "Mixed value types",
				count: report.mixedTypes.length,
			},
			{
				id: "mixed-dates",
				label: "Mixed date formats",
				count: report.mixedDateFormats.length,
			},
			{
				id: "rare-keys",
				label: "Rare keys",
				count: report.rareKeys.length,
			},
			{
				id: "lookup",
				label: "Lookup",
			},
		];

		for (const chip of chips) {
			const btn = this.chipsContainerEl.createEl("button", {
				cls:
					"vhr-chip" +
					(this.activeSectionFilter === chip.id
						? " is-active"
						: ""),
			});
			btn.createSpan({ text: chip.label });
			if (chip.count !== undefined) {
				btn.createSpan({
					cls: "vhr-chip-count",
					text: String(chip.count),
				});
			}
			btn.addEventListener("click", () => {
				this.activeSectionFilter = chip.id;
				this.renderReport();
			});
		}
	}

	private createSectionContainer(
		parent: HTMLElement,
		title: string,
		count: number,
		emptyMessage: string
	): HTMLElement | null {
		const sectionEl = parent.createDiv({ cls: "vhr-section" });
		const headerEl = sectionEl.createDiv({ cls: "vhr-section-header" });
		headerEl.createEl("h3", {
			cls: "vhr-section-title",
			text: title,
		});
		headerEl.createSpan({
			cls: "vhr-section-count",
			text: String(count),
		});

		if (count === 0) {
			sectionEl.addClass("is-empty");
			sectionEl.createDiv({
				cls: "vhr-empty-line",
				text: emptyMessage,
			});
			return null;
		}

		return sectionEl.createDiv({ cls: "vhr-section-list" });
	}

	private renderLookalikeKeysSection(
		parent: HTMLElement,
		groups: LookalikeKeyGroup[]
	): void {
		const listEl = this.createSectionContainer(
			parent,
			"Lookalike keys",
			groups.length,
			"No lookalike keys found"
		);
		if (!listEl) return;

		for (const group of groups) {
			const titleParts = group.variants.map((v) => ({
				code: v.label,
				suffix: ` (${v.count})`,
			}));
			this.renderGroupCard(listEl, {
				id: group.id,
				titleParts,
				reason: group.reason,
				onExpand: (detailsEl) => {
					this.renderVariantsDetails(detailsEl, group.variants);
				},
			});
		}
	}

	private renderNearDuplicateValuesSection(
		parent: HTMLElement,
		groups: NearDuplicateValueGroup[]
	): void {
		const listEl = this.createSectionContainer(
			parent,
			"Near-duplicate values",
			groups.length,
			"No near-duplicate values found"
		);
		if (!listEl) return;

		for (const group of groups) {
			const titleParts = group.variants.map((v) => ({
				code: v.label,
				suffix: ` (${v.count})`,
			}));
			this.renderGroupCard(listEl, {
				id: group.id,
				prefixKey: group.key,
				titleParts,
				reason: group.reason,
				onExpand: (detailsEl) => {
					this.renderVariantsDetails(detailsEl, group.variants);
				},
			});
		}
	}

	private renderMixedTypesSection(
		parent: HTMLElement,
		groups: MixedTypeGroup[]
	): void {
		const listEl = this.createSectionContainer(
			parent,
			"Mixed value types",
			groups.length,
			"No mixed value types found"
		);
		if (!listEl) return;

		for (const group of groups) {
			const titleParts = group.types.map((t) => ({
				code: t.type,
				suffix: ` (${t.count})`,
			}));
			if (group.emptyCount > 0) {
				titleParts.push({
					code: "empty",
					suffix: ` (${group.emptyCount})`,
				});
			}

			const variants: VariantItem[] = group.types.map((t) => ({
				label: t.type,
				count: t.count,
				notes: t.examples,
			}));
			if (group.emptyCount > 0 && group.emptyExamples.length > 0) {
				variants.push({
					label: "empty",
					count: group.emptyCount,
					notes: group.emptyExamples,
				});
			}

			this.renderGroupCard(listEl, {
				id: group.id,
				prefixKey: group.key,
				titleParts,
				reason: group.reason,
				onExpand: (detailsEl) => {
					this.renderVariantsDetails(detailsEl, variants, true);
				},
			});
		}
	}

	private renderMixedDatesSection(
		parent: HTMLElement,
		groups: MixedDateFormatGroup[]
	): void {
		const listEl = this.createSectionContainer(
			parent,
			"Mixed date formats",
			groups.length,
			"No mixed date formats found"
		);
		if (!listEl) return;

		for (const group of groups) {
			const titleParts = group.formats.map((f) => ({
				code: f.pattern,
				suffix: ` (${f.count}, e.g. ${f.exampleRaw})`,
			}));

			this.renderGroupCard(listEl, {
				id: group.id,
				prefixKey: group.key,
				titleParts,
				reason: group.reason,
				onExpand: (detailsEl) => {
					this.renderDateFormatDetails(detailsEl, group.formats);
				},
			});
		}
	}

	private renderRareKeysSection(
		parent: HTMLElement,
		groups: RareKeyGroup[]
	): void {
		const listEl = this.createSectionContainer(
			parent,
			"Rare keys",
			groups.length,
			this.currentIndex && this.currentIndex.totalNotes < 20
				? "No rare keys found (requires at least 20 notes in vault)"
				: "No rare keys found"
		);
		if (!listEl) return;

		for (const group of groups) {
			this.renderGroupCard(listEl, {
				id: group.id,
				titleParts: [
					{
						code: group.key,
						suffix: ` (${group.count})`,
					},
				],
				reason: group.reason,
				onExpand: (detailsEl) => {
					this.renderVariantsDetails(detailsEl, [
						{
							label: group.key,
							count: group.count,
							notes: group.notes,
						},
					]);
				},
			});
		}
	}

	private renderGroupCard(
		parent: HTMLElement,
		opts: {
			id: string;
			prefixKey?: string;
			titleParts: { code: string; suffix: string }[];
			reason: DriftReason;
			onExpand: (detailsEl: HTMLElement) => void;
		}
	): void {
		const isDismissed = this.plugin.settings.dismissedGroups.includes(
			opts.id
		);
		const cardEl = parent.createDiv({
			cls: "vhr-card" + (isDismissed ? " is-dismissed" : ""),
		});

		const topRow = cardEl.createDiv({ cls: "vhr-card-top" });

		const titleBtn = topRow.createDiv({ cls: "vhr-card-title" });
		const chevron = titleBtn.createSpan({
			cls: "vhr-chevron",
			text: "▸",
		});

		if (opts.prefixKey) {
			titleBtn.createSpan({
				cls: "vhr-card-key-prefix",
				text: `${opts.prefixKey}: `,
			});
		}

		opts.titleParts.forEach((part, idx) => {
			if (idx > 0) {
				titleBtn.createSpan({ cls: "vhr-dot", text: " · " });
			}
			titleBtn.createEl("code", {
				cls: "vhr-variant-code",
				text: part.code,
			});
			titleBtn.createSpan({
				cls: "vhr-variant-count",
				text: part.suffix,
			});
		});

		const actionsEl = topRow.createDiv({ cls: "vhr-card-actions" });
		actionsEl.createSpan({
			cls: `vhr-badge vhr-badge-${opts.reason.replace(/\s+/g, "-")}`,
			text: opts.reason,
		});

		const dismissBtn = actionsEl.createEl("button", {
			cls: "vhr-btn-small",
			text: isDismissed ? "Restore" : "Not drift",
		});
		dismissBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			void this.toggleDismissGroup(opts.id);
		});

		let expanded = false;
		let detailsEl: HTMLElement | null = null;

		titleBtn.addEventListener("click", () => {
			expanded = !expanded;
			cardEl.toggleClass("is-expanded", expanded);
			chevron.setText(expanded ? "▾" : "▸");

			if (expanded) {
				if (!detailsEl) {
					detailsEl = cardEl.createDiv({ cls: "vhr-card-details" });
					opts.onExpand(detailsEl);
				} else {
					detailsEl.removeClass("vhr-hidden");
				}
			} else if (detailsEl) {
				detailsEl.addClass("vhr-hidden");
			}
		});
	}

	private renderVariantsDetails(
		container: HTMLElement,
		variants: VariantItem[],
		isExamplesOnly = false
	): void {
		for (const variant of variants) {
			const block = container.createDiv({ cls: "vhr-variant-block" });
			const header = block.createDiv({ cls: "vhr-variant-header" });
			header.createEl("code", { text: variant.label });
			header.createSpan({
				cls: "vhr-variant-subcount",
				text: isExamplesOnly
					? ` (${variant.count} total, example notes)`
					: ` (${variant.count} note${
							variant.count === 1 ? "" : "s"
					  })`,
			});

			this.renderPaginatedNoteLinks(block, variant.notes);
		}
	}

	private renderDateFormatDetails(
		container: HTMLElement,
		formats: DateFormatVariant[]
	): void {
		for (const fmt of formats) {
			const block = container.createDiv({ cls: "vhr-variant-block" });
			const header = block.createDiv({ cls: "vhr-variant-header" });
			header.createEl("code", { text: fmt.pattern });
			header.createSpan({
				cls: "vhr-variant-subcount",
				text: ` (${fmt.count}, example: `,
			});
			header.createEl("code", { text: fmt.exampleRaw });
			header.createSpan({
				cls: "vhr-variant-subcount",
				text: ")",
			});

			this.renderPaginatedNoteLinks(block, fmt.notes);
		}
	}

	private renderPaginatedNoteLinks(
		parent: HTMLElement,
		notePaths: string[]
	): void {
		const listEl = parent.createDiv({ cls: "vhr-note-list" });
		let shownCount = 0;

		const renderNextBatch = (moreBtn?: HTMLButtonElement) => {
			const nextLimit = Math.min(
				shownCount + NOTES_PAGE_SIZE,
				notePaths.length
			);
			for (let i = shownCount; i < nextLimit; i++) {
				const path = notePaths[i];
				const link = listEl.createEl("a", {
					cls: "vhr-note-link",
					text: path,
					href: path,
				});
				link.addEventListener("click", (e) => {
					e.preventDefault();
					void this.openNoteByPath(path);
				});
			}
			shownCount = nextLimit;

			if (moreBtn) {
				if (shownCount >= notePaths.length) {
					moreBtn.remove();
				} else {
					const remaining = notePaths.length - shownCount;
					moreBtn.setText(`Show more (${remaining} left)`);
				}
			}
		};

		renderNextBatch();

		if (shownCount < notePaths.length) {
			const remaining = notePaths.length - shownCount;
			const moreBtn = parent.createEl("button", {
				cls: "vhr-btn-small vhr-show-more",
				text: `Show more (${remaining} left)`,
			});
			moreBtn.addEventListener("click", () => {
				renderNextBatch(moreBtn);
			});
		}
	}

	private renderLookupSection(parent: HTMLElement): void {
		const sectionEl = parent.createDiv({
			cls: "vhr-section vhr-lookup-section",
		});
		const headerEl = sectionEl.createDiv({ cls: "vhr-section-header" });
		headerEl.createEl("h3", {
			cls: "vhr-section-title",
			text: "Property-by-value lookup",
		});

		const controls = sectionEl.createDiv({ cls: "vhr-lookup-controls" });
		const input = controls.createEl("input", {
			type: "search",
			cls: "vhr-lookup-input",
			placeholder: "Search for a frontmatter value...",
		});
		input.value = this.lookupQuery;

		const containsLabel = controls.createEl("label", {
			cls: "vhr-lookup-toggle",
		});
		const containsCheck = containsLabel.createEl("input", {
			type: "checkbox",
		});
		containsCheck.checked = this.lookupContains;
		containsLabel.createSpan({ text: "Contains" });

		const resultsContainer = sectionEl.createDiv({
			cls: "vhr-lookup-results",
		});

		const updateResults = () => {
			resultsContainer.empty();
			if (!this.currentIndex) return;
			const q = this.lookupQuery.trim();
			if (!q) {
				resultsContainer.createDiv({
					cls: "vhr-empty-line",
					text: "Type a value above to see every property key that holds it.",
				});
				return;
			}

			const rows = lookupPropertyByValue(
				this.currentIndex,
				q,
				this.lookupContains
			);
			if (rows.length === 0) {
				resultsContainer.createDiv({
					cls: "vhr-empty-line",
					text: `No properties found holding "${q}".`,
				});
				return;
			}

			for (const row of rows) {
				const rowCard = resultsContainer.createDiv({
					cls: "vhr-card vhr-lookup-card",
				});
				const top = rowCard.createDiv({ cls: "vhr-card-top" });
				const titleBtn = top.createDiv({ cls: "vhr-card-title" });
				const chevron = titleBtn.createSpan({
					cls: "vhr-chevron",
					text: "▸",
				});
				titleBtn.createEl("code", {
					cls: "vhr-variant-code",
					text: row.key,
				});
				titleBtn.createSpan({
					cls: "vhr-variant-count",
					text: ` (${row.count})`,
				});

				let expanded = false;
				let detailsEl: HTMLElement | null = null;
				titleBtn.addEventListener("click", () => {
					expanded = !expanded;
					chevron.setText(expanded ? "▾" : "▸");
					if (expanded) {
						if (!detailsEl) {
							detailsEl = rowCard.createDiv({
								cls: "vhr-card-details",
							});
							this.renderPaginatedNoteLinks(detailsEl, row.notes);
						} else {
							detailsEl.removeClass("vhr-hidden");
						}
					} else if (detailsEl) {
						detailsEl.addClass("vhr-hidden");
					}
				});
			}
		};

		input.addEventListener("input", () => {
			this.lookupQuery = input.value;
			updateResults();
		});

		containsCheck.addEventListener("change", () => {
			this.lookupContains = containsCheck.checked;
			updateResults();
		});

		updateResults();
	}

	private async toggleDismissGroup(groupId: string): Promise<void> {
		const list = this.plugin.settings.dismissedGroups;
		const idx = list.indexOf(groupId);
		if (idx >= 0) {
			list.splice(idx, 1);
		} else {
			list.push(groupId);
		}
		await this.plugin.saveSettings();
		this.recomputeReportFromIndex();
	}

	private async openNoteByPath(path: string): Promise<void> {
		const abstractFile = this.app.vault.getAbstractFileByPath(path);
		if (abstractFile instanceof TFile) {
			const leaf = this.app.workspace.getLeaf(false);
			await leaf.openFile(abstractFile);
		} else {
			new Notice(`Note not found: ${path}`);
		}
	}

	private async copyReportAsMarkdown(): Promise<void> {
		if (!this.currentReport || !this.currentIndex) return;

		const r = this.currentReport;
		const lines: string[] = [];

		lines.push("# Vault Health Report");
		lines.push(
			`Scanned ${this.currentIndex.totalNotes} notes, ${this.currentIndex.keys.size} properties. Found ${r.totalDriftGroups} drift groups.`
		);
		lines.push("");

		lines.push("## Lookalike keys");
		if (r.lookalikeKeys.length === 0) {
			lines.push("- No lookalike keys found");
		} else {
			for (const g of r.lookalikeKeys) {
				const variants = g.variants
					.map((v) => `\`${v.label}\` (${v.count})`)
					.join(" · ");
				lines.push(`- ${variants} [${g.reason}]`);
			}
		}
		lines.push("");

		lines.push("## Near-duplicate values");
		if (r.nearDuplicateValues.length === 0) {
			lines.push("- No near-duplicate values found");
		} else {
			for (const g of r.nearDuplicateValues) {
				const variants = g.variants
					.map((v) => `\`${v.label}\` (${v.count})`)
					.join(" · ");
				lines.push(`- \`${g.key}\`: ${variants} [${g.reason}]`);
			}
		}
		lines.push("");

		lines.push("## Mixed value types");
		if (r.mixedTypes.length === 0) {
			lines.push("- No mixed value types found");
		} else {
			for (const g of r.mixedTypes) {
				const types = g.types
					.map((t) => `\`${t.type}\` (${t.count})`)
					.join(" · ");
				const emptySuffix =
					g.emptyCount > 0 ? ` · \`empty\` (${g.emptyCount})` : "";
				lines.push(`- \`${g.key}\`: ${types}${emptySuffix} [type]`);
			}
		}
		lines.push("");

		lines.push("## Mixed date formats");
		if (r.mixedDateFormats.length === 0) {
			lines.push("- No mixed date formats found");
		} else {
			for (const g of r.mixedDateFormats) {
				const formats = g.formats
					.map(
						(f) =>
							`\`${f.pattern}\` (${f.count}, e.g. \`${f.exampleRaw}\`)`
					)
					.join(" · ");
				lines.push(`- \`${g.key}\`: ${formats} [date format]`);
			}
		}
		lines.push("");

		lines.push("## Rare keys");
		if (r.rareKeys.length === 0) {
			lines.push("- No rare keys found");
		} else {
			for (const g of r.rareKeys) {
				lines.push(`- \`${g.key}\` (${g.count}) [rare]`);
			}
		}

		if (r.nestedKeys.length > 0) {
			lines.push("");
			const nestedStr = r.nestedKeys
				.map((n) => `\`${n.key}\` (${n.count})`)
				.join(", ");
			lines.push(`Not scanned: nested values: ${nestedStr}`);
		}

		try {
			await navigator.clipboard.writeText(lines.join("\n"));
			new Notice("Copied Vault Health Report to clipboard.");
		} catch {
			new Notice("Couldn't copy to the clipboard.");
		}
	}
}
