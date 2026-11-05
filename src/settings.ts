import { App, debounce, Notice, PluginSettingTab, Setting } from "obsidian";
import {
	DEFAULT_KEY_SYNONYM_SETS,
	DEFAULT_VALUE_SYNONYM_SETS,
} from "./detectors";
import type VaultHealthPlugin from "./main";

// Replace with the real Gumroad link before release.
export const PLAYBOOK_URL = "https://atlascreative0.gumroad.com/l/YOUR-PLAYBOOK";

export interface VaultHealthSettings {
	rareKeyThreshold: number;
	enableSpellingDistance: boolean;
	keySynonymSets: string[][];
	valueSynonymSets: string[][];
	ignoredKeys: string[];
	excludedFolders: string[];
	dismissedGroups: string[];
}

export const DEFAULT_SETTINGS: VaultHealthSettings = {
	rareKeyThreshold: 3,
	enableSpellingDistance: true,
	keySynonymSets: DEFAULT_KEY_SYNONYM_SETS.map((row) => [...row]),
	valueSynonymSets: DEFAULT_VALUE_SYNONYM_SETS.map((row) => [...row]),
	ignoredKeys: ["position"],
	excludedFolders: [],
	dismissedGroups: [],
};

export function formatSynonymSets(sets: string[][]): string {
	return sets.map((set) => set.join(", ")).join("\n");
}

export function parseSynonymSets(text: string): string[][] {
	return text
		.split("\n")
		.map((line) =>
			line
				.split(",")
				.map((item) => item.trim())
				.filter((item) => item.length > 0)
		)
		.filter((row) => row.length >= 2);
}

export function formatStringList(list: string[]): string {
	return list.join(", ");
}

export function parseStringList(text: string): string[] {
	return text
		.split(/[\n,]/)
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

export class VaultHealthSettingTab extends PluginSettingTab {
	plugin: VaultHealthPlugin;
	private debouncedRescan = debounce(
		() => {
			this.plugin.rescanOpenViews();
		},
		600,
		true
	);

	constructor(app: App, plugin: VaultHealthPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Rare key threshold")
			.setDesc(
				"Report keys used in at most this many notes (only active when the vault has at least 20 notes)."
			)
			.addText((text) =>
				text
					.setPlaceholder("3")
					.setValue(String(this.plugin.settings.rareKeyThreshold))
					.onChange(async (value) => {
						const parsed = parseInt(value, 10);
						if (!Number.isNaN(parsed) && parsed >= 1) {
							this.plugin.settings.rareKeyThreshold = parsed;
							await this.plugin.saveSettings();
							this.plugin.refreshOpenViews();
						}
					})
			);

		new Setting(containerEl)
			.setName("Spelling distance")
			.setDesc(
				"Detect lookalike keys and near-duplicate values that differ by a single typo (Damerau-Levenshtein distance 1, minimum 6 characters, rare variant)."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableSpellingDistance)
					.onChange(async (value) => {
						this.plugin.settings.enableSpellingDistance = value;
						await this.plugin.saveSettings();
						this.plugin.refreshOpenViews();
					})
			);

		new Setting(containerEl)
			.setName("Key synonym list")
			.setDesc(
				"One synonym set per line, with keys separated by commas. Do not include 'date' as it is too often its own field."
			)
			.addTextArea((area) => {
				area.inputEl.rows = 6;
				area.inputEl.cols = 40;
				area.setValue(
					formatSynonymSets(this.plugin.settings.keySynonymSets)
				).onChange(async (value) => {
					this.plugin.settings.keySynonymSets =
						parseSynonymSets(value);
					await this.plugin.saveSettings();
					this.plugin.refreshOpenViews();
				});
			});

		new Setting(containerEl)
			.setName("Value synonym list")
			.setDesc(
				"One synonym set per line, with values separated by commas."
			)
			.addTextArea((area) => {
				area.inputEl.rows = 4;
				area.inputEl.cols = 40;
				area.setValue(
					formatSynonymSets(this.plugin.settings.valueSynonymSets)
				).onChange(async (value) => {
					this.plugin.settings.valueSynonymSets =
						parseSynonymSets(value);
					await this.plugin.saveSettings();
					this.plugin.refreshOpenViews();
				});
			});

		new Setting(containerEl)
			.setName("Ignored keys")
			.setDesc(
				"Comma-separated list of frontmatter keys to skip during scanning (default: position)."
			)
			.addTextArea((area) => {
				area.inputEl.rows = 2;
				area.inputEl.cols = 40;
				area.setValue(
					formatStringList(this.plugin.settings.ignoredKeys)
				).onChange(async (value) => {
					const parsed = parseStringList(value);
					this.plugin.settings.ignoredKeys =
						parsed.length > 0 ? parsed : ["position"];
					await this.plugin.saveSettings();
					this.debouncedRescan();
				});
			});

		new Setting(containerEl)
			.setName("Excluded folders")
			.setDesc(
				"Comma- or newline-separated folder paths to exclude from scanning."
			)
			.addTextArea((area) => {
				area.inputEl.rows = 3;
				area.inputEl.cols = 40;
				area.setPlaceholder("Templates, Archive/Old")
					.setValue(
						formatStringList(this.plugin.settings.excludedFolders)
					)
					.onChange(async (value) => {
						this.plugin.settings.excludedFolders =
							parseStringList(value);
						await this.plugin.saveSettings();
						this.debouncedRescan();
					});
			});

		const dismissedCount = this.plugin.settings.dismissedGroups.length;
		new Setting(containerEl)
			.setName("Clear dismissed groups")
			.setDesc(
				`Currently ${dismissedCount} dismissed group${
					dismissedCount === 1 ? "" : "s"
				}. Clearing restores all dismissed groups to the report.`
			)
			.addButton((btn) =>
				btn
					.setButtonText("Clear dismissed groups")
					.setDisabled(dismissedCount === 0)
					.onClick(async () => {
						this.plugin.settings.dismissedGroups = [];
						await this.plugin.saveSettings();
						new Notice("Cleared all dismissed drift groups.");
						this.display();
						this.plugin.refreshOpenViews();
					})
			);

		const promo = containerEl.createDiv({ cls: "vhr-settings-promo" });
		promo.createSpan({ text: "Want help cleaning up your vault? See the " });
		promo.createEl("a", {
			text: "Vault Cleanup Playbook",
			href: PLAYBOOK_URL,
		});
		promo.createSpan({ text: " from Atlas Creative." });
	}
}
