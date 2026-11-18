import { AbstractInputSuggest, SearchComponent } from "obsidian";
import type { App, Setting, SettingDefinition, SettingDefinitionList, TFolder } from "obsidian";

import { t } from "../i18n";

interface WhitelistFolderEditorOptions {
    getPaths: () => readonly string[];
    savePaths: (paths: string[]) => Promise<void>;
    onRowsChanged: () => void;
    visible: () => boolean;
}

interface FolderRow {
    path: string | null;
    query: string;
    error: string;
    inputEl: HTMLInputElement | null;
    errorEl: HTMLElement | null;
}

export class WhitelistFolderEditor {
    private folderRows: FolderRow[] = [];
    private draftRow: FolderRow | null = null;
    private focusNewDraft = false;
    private saving = false;

    public constructor(
        private readonly app: App,
        private readonly options: WhitelistFolderEditorOptions,
    ) {}

    public getSettingDefinition(): SettingDefinitionList {
        const rows = this.syncFolderRows();
        return {
            type: "list",
            heading: t("settings.folders_allowed_for_automatic_conversion"),
            visible: () => this.options.visible(),
            emptyState: t("settings.no_folders_registered"),
            items: rows.map((row): SettingDefinition => ({
                name: "",
                searchable: false,
                render: (setting) => this.renderFolderRow(setting, row),
            })),
            addItem: {
                name: t("settings.add_folder"),
                action: () => this.addFolderRow(),
            },
            onDelete: (index) => {
                const row = rows[index];
                if (row) void this.removeFolderRow(row);
            },
        };
    }

    private syncFolderRows(): FolderRow[] {
        if (!this.saving) {
            this.folderRows = this.options
                .getPaths()
                .map(
                    (path) =>
                        this.folderRows.find((row) => row.path === path) ?? this.createRow(path),
                );
        }
        return this.draftRow ? [...this.folderRows, this.draftRow] : this.folderRows;
    }

    private createRow(path: string | null): FolderRow {
        return { path, query: path ?? "", error: "", inputEl: null, errorEl: null };
    }

    private renderFolderRow(setting: Setting, row: FolderRow): () => void {
        setting.nameEl.hide();
        setting.descEl.hide();
        const host = setting.infoEl.createDiv({
            cls: "notebundle-whitelist-folder",
        });
        const search = new SearchComponent(host)
            .setValue(row.query)
            .setPlaceholder(t("settings.search_and_select_folder"));
        const input = search.inputEl;
        input.disabled = this.saving;
        row.inputEl = input;
        const errorEl = host.createDiv({
            cls: "notebundle-whitelist-error",
            text: row.error,
        });
        errorEl.hidden = !row.error;
        row.errorEl = errorEl;
        search.onChange((query) => {
            row.query = query;
            this.showRowError(row, "");
        });

        let disposed = false;
        const suggest = new FolderPathSuggest(this.app, input, (folder) => {
            if (!disposed) void this.selectFolder(row, folder.path);
        });
        if (row === this.draftRow && this.focusNewDraft) {
            this.focusNewDraft = false;
            queueMicrotask(() => {
                if (!disposed && input.isConnected && !this.saving) input.focus();
            });
        }

        return () => {
            if (disposed) return;
            disposed = true;
            suggest.close();
            host.remove();
            setting.nameEl.show();
            setting.descEl.show();
            if (row.inputEl === input) {
                row.inputEl = null;
                row.errorEl = null;
            }
        };
    }

    private addFolderRow(): void {
        if (this.saving) return;
        if (this.draftRow) {
            this.draftRow.inputEl?.focus();
            return;
        }
        this.draftRow = this.createRow(null);
        this.focusNewDraft = true;
        this.options.onRowsChanged();
    }

    private async selectFolder(row: FolderRow, path: string): Promise<void> {
        if (this.saving) return;
        const currentPaths = this.options.getPaths();
        const isDraft = row === this.draftRow;
        const index = isDraft ? currentPaths.length : currentPaths.indexOf(row.path!);
        if (index < 0) return;

        const folder = this.app.vault.getFolderByPath(path);
        if (!folder) {
            console.error("obsidian-notebundle: Selected whitelist folder no longer exists", path);
            return;
        }
        if (currentPaths.some((value, at) => at !== index && value === folder.path)) {
            this.showRowError(row, t("settings.folder_is_already_registered"));
            return;
        }
        if (currentPaths[index] === folder.path) {
            row.query = folder.path;
            if (row.inputEl) row.inputEl.value = row.query;
            this.showRowError(row, "");
            return;
        }

        const nextPaths = [...currentPaths];
        nextPaths[index] = folder.path;
        if (!(await this.savePaths(nextPaths, row))) return;
        row.path = folder.path;
        row.query = folder.path;
        if (row.inputEl) row.inputEl.value = row.query;
        if (isDraft) {
            this.folderRows.push(row);
            this.draftRow = null;
            this.options.onRowsChanged();
        }
    }

    private async removeFolderRow(row: FolderRow): Promise<void> {
        if (this.saving) {
            this.options.onRowsChanged();
            return;
        }
        if (row === this.draftRow) {
            this.draftRow = null;
            this.focusNewDraft = false;
            this.options.onRowsChanged();
            return;
        }
        const currentPaths = this.options.getPaths();
        if (!currentPaths.includes(row.path!)) return;
        await this.savePaths(
            currentPaths.filter((path) => path !== row.path),
            row,
        );
        this.options.onRowsChanged();
    }

    private showRowError(row: FolderRow, message: string): void {
        row.error = message;
        if (row.errorEl) {
            row.errorEl.setText(message);
            row.errorEl.hidden = !message;
        }
    }

    private async savePaths(paths: string[], row: FolderRow): Promise<boolean> {
        this.showRowError(row, "");
        const rows = this.syncFolderRows();
        this.saving = true;
        for (const current of rows) if (current.inputEl) current.inputEl.disabled = true;
        try {
            await this.options.savePaths(paths);
            return true;
        } catch (error) {
            console.error("obsidian-notebundle: Failed to save auto-conversion whitelist", error);
            return false;
        } finally {
            this.saving = false;
            for (const current of rows) if (current.inputEl) current.inputEl.disabled = false;
        }
    }
}

class FolderPathSuggest extends AbstractInputSuggest<TFolder> {
    public constructor(
        app: App,
        input: HTMLInputElement,
        private readonly onSelectFolder: (folder: TFolder) => void,
    ) {
        super(app, input);
        this.limit = 20;
    }

    protected override getSuggestions(query: string): TFolder[] {
        const search = query.toLocaleLowerCase();
        return this.app.vault
            .getAllFolders(false)
            .filter((folder) => folder.path.toLocaleLowerCase().includes(search));
    }

    public override renderSuggestion(folder: TFolder, element: HTMLElement): void {
        element.setText(folder.path);
    }

    public override selectSuggestion(folder: TFolder): void {
        this.close();
        this.onSelectFolder(folder);
    }
}
