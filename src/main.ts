import { Plugin, WorkspaceLeaf } from "obsidian";
import {
	DEFAULT_SETTINGS,
	VaultHealthSettings,
	VaultHealthSettingTab,
} from "./settings";
import { ReportView, VIEW_TYPE_VAULT_HEALTH } from "./view";

export default class VaultHealthPlugin extends Plugin {
	settings: VaultHealthSettings = structuredClone(DEFAULT_SETTINGS);
	private metadataReady = false;

	async onload(): Promise<void> {
		await this.loadSettings();

		if (
			(
				this.app.metadataCache as unknown as {
					initialized?: boolean;
				}
			).initialized === true
		) {
			this.metadataReady = true;
		} else {
			this.registerEvent(
				this.app.metadataCache.on("resolved", () => {
					if (!this.metadataReady) {
						this.metadataReady = true;
						this.rescanOpenViews();
					}
				})
			);
		}

		this.registerView(
			VIEW_TYPE_VAULT_HEALTH,
			(leaf: WorkspaceLeaf) => new ReportView(leaf, this)
		);

		this.addRibbonIcon("stethoscope", "Vault Health: Open report", () => {
			void this.activateView();
		});

		this.addCommand({
			id: "open-report",
			name: "Open report",
			callback: () => {
				void this.activateView();
			},
		});

		this.addSettingTab(new VaultHealthSettingTab(this.app, this));
	}

	isMetadataReady(): boolean {
		if (
			(
				this.app.metadataCache as unknown as {
					initialized?: boolean;
				}
			).initialized === true
		) {
			this.metadataReady = true;
		}
		return this.metadataReady;
	}

	async activateView(): Promise<void> {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_VAULT_HEALTH);

		if (leaves.length > 0) {
			leaf = leaves[0];
		} else {
			leaf = workspace.getRightLeaf(false);
			if (leaf) {
				await leaf.setViewState({
					type: VIEW_TYPE_VAULT_HEALTH,
					active: true,
				});
			}
		}

		if (leaf) {
			void workspace.revealLeaf(leaf);
		}
	}

	refreshOpenViews(): void {
		const leaves = this.app.workspace.getLeavesOfType(
			VIEW_TYPE_VAULT_HEALTH
		);
		for (const leaf of leaves) {
			if (leaf.view instanceof ReportView) {
				leaf.view.recomputeReportFromIndex();
			}
		}
	}

	rescanOpenViews(): void {
		const leaves = this.app.workspace.getLeavesOfType(
			VIEW_TYPE_VAULT_HEALTH
		);
		for (const leaf of leaves) {
			if (leaf.view instanceof ReportView) {
				void leaf.view.runScan();
			}
		}
	}

	async loadSettings(): Promise<void> {
		const loaded = (await this.loadData()) as Partial<VaultHealthSettings> | null;
		const defaults = structuredClone(DEFAULT_SETTINGS);
		if (!loaded) {
			this.settings = defaults;
			return;
		}
		this.settings = {
			rareKeyThreshold:
				typeof loaded.rareKeyThreshold === "number"
					? loaded.rareKeyThreshold
					: defaults.rareKeyThreshold,
			enableSpellingDistance:
				typeof loaded.enableSpellingDistance === "boolean"
					? loaded.enableSpellingDistance
					: defaults.enableSpellingDistance,
			keySynonymSets: Array.isArray(loaded.keySynonymSets)
				? loaded.keySynonymSets.map((row) => [...row])
				: defaults.keySynonymSets,
			valueSynonymSets: Array.isArray(loaded.valueSynonymSets)
				? loaded.valueSynonymSets.map((row) => [...row])
				: defaults.valueSynonymSets,
			ignoredKeys: Array.isArray(loaded.ignoredKeys)
				? [...loaded.ignoredKeys]
				: defaults.ignoredKeys,
			excludedFolders: Array.isArray(loaded.excludedFolders)
				? [...loaded.excludedFolders]
				: defaults.excludedFolders,
			dismissedGroups: Array.isArray(loaded.dismissedGroups)
				? [...loaded.dismissedGroups]
				: defaults.dismissedGroups,
		};
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
