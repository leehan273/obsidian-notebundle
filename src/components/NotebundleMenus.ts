import { App, Component, Notice, Plugin, TFile, TFolder } from "obsidian";
import type { Menu, TAbstractFile } from "obsidian";

import type { NotebundleInspection } from "../notebundle";
import type { NotebundleActions } from "../actions/NotebundleActions";
import type { NotebundlePluginSettings } from "../settings";
import {
    getBundleName,
    getNotebundleIfPrimaryNote,
    hasNotebundleSuffix,
    inspectNotebundle,
} from "../notebundle";
import { RenameBundleModal } from "../ui/RenameBundleModal";
import { NotebundleConversionModal } from "../ui/NotebundleConversionModal";
import {
    hasNotebundleFailures,
    reportNotebundleResult,
    showNotebundleError,
} from "../ui/NotebundleNotice";
import { showNotebundleIssues } from "../ui/NotebundleIssueNotice";
import { t } from "../i18n";

export class NotebundleMenus extends Component {
    private readonly renameModals = new Set<RenameBundleModal>();
    private readonly app: App;
    private conversionModal: NotebundleConversionModal | null = null;

    public constructor(
        private readonly plugin: Plugin,
        private readonly actions: NotebundleActions,
        private readonly getSettings: () => NotebundlePluginSettings,
    ) {
        super();
        this.app = plugin.app;
    }

    public onload(): void {
        this.plugin.addCommand({
            id: "convert-to-notebundle",
            name: t("command.convert_current_note_to_notebundle"),
            // Always display command item even the file already notebundle is more intuitive i think
            callback: () => {
                const file = this.app.workspace.getActiveFile();
                if (file) void this.requestConversion(file);
            },
        });
        this.plugin.addCommand({
            id: "collect-notebundle-attachments",
            name: t("command.collect_attachments"),
            checkCallback: (checking) => {
                const file = this.app.workspace.getActiveFile();
                if (!file || !getNotebundleIfPrimaryNote(file)) return false;
                if (!checking) void this.requestCollection(file);
                return true;
            },
        });
        this.plugin.addCommand({
            id: "unwrap-notebundle",
            name: t("command.unwrap_current_notebundle"),
            checkCallback: (checking) => {
                const file = this.app.workspace.getActiveFile();
                const bundle = file && getNotebundleIfPrimaryNote(file);
                if (!bundle) return false;
                if (!checking) void this.requestUnwrap(bundle.folder, bundle.folder.path);
                return true;
            },
        });
        this.registerEvent(
            this.app.workspace.on("file-menu", (menu, file, source) =>
                this.addFileMenuItems(menu, file, source),
            ),
        );
    }

    private addFileMenuItems(menu: Menu, file: TAbstractFile, source: string): void {
        if (file instanceof TFile) {
            if (
                source !== "file-explorer-context-menu" &&
                source !== "tab-header" &&
                source !== "sidebar-context-menu" &&
                source !== "more-options" &&
                source !== "bases-context-menu"
            )
                return;
            const isAlreadyNotebundlePrimaryNote: boolean =
                getNotebundleIfPrimaryNote(file) !== null;
            if (isAlreadyNotebundlePrimaryNote) return;
            menu.addItem((item) => {
                item.setTitle(t("menu.convert_to_notebundle"))
                    .setIcon("package")
                    .onClick(() => {
                        void this.requestConversion(file);
                    });
            });
            return;
        }
        if (!this.isExplorerActionsEnabled()) return;
        if (source !== "file-explorer-context-menu") return;
        if (!(file instanceof TFolder) || !hasNotebundleSuffix(file)) return;
        this.addBundleMenuItems(menu, file);
    }

    private addBundleMenuItems(menu: Menu, folder: TFolder): void {
        const path = folder.path;
        menu.addSeparator();
        const inspection = inspectNotebundle(folder);
        if (inspection.kind === "invalid") {
            menu.addItem((item) =>
                item
                    .setTitle(t("menu.show_notebundle_issues"))
                    .setIcon("alert-triangle")
                    .onClick(() => {
                        if (!this.isExplorerActionsEnabled()) return;
                        const currentInspection = inspectNotebundle(folder);
                        if (currentInspection.kind === "invalid")
                            showNotebundleIssues(currentInspection);
                    }),
            );
        }
        if (this.getSettings().lab_rename_modal_enabled) {
            menu.addItem((item) =>
                item
                    .setTitle("Rename notebundle...")
                    .setIcon("pencil")
                    .onClick(() => {
                        if (
                            !this.isExplorerActionsEnabled() ||
                            !this.getSettings().lab_rename_modal_enabled
                        )
                            return;
                        this.openRenameModal(folder, path, inspection);
                    }),
            );
        }
        menu.addItem((item) =>
            item
                .setTitle(t("menu.unwrap_notebundle"))
                .setIcon("package-x")
                .onClick(() => {
                    if (!this.isExplorerActionsEnabled()) return;
                    void this.requestUnwrap(folder, path);
                }),
        );
    }

    private async requestUnwrap(folder: TFolder, path: string): Promise<void> {
        try {
            await this.actions.unwrapNotebundle(folder, path);
        } catch (error) {
            console.error("obsidian-notebundle: could not unwrap bundle", error);
            showNotebundleError(error);
        }
    }

    private openRenameModal(
        folder: TFolder,
        expectedPath: string,
        inspection: NotebundleInspection,
    ): void {
        const modal: RenameBundleModal = new RenameBundleModal(this.app, {
            initialBundleName: getBundleName(folder) ?? "",
            initialFolderName: folder.name,
            primaryNote: inspection.kind === "valid" ? inspection.notebundle.primaryNote : null,
            onRename: async (name) => {
                await this.actions.renameNotebundleFromModal(folder, name, expectedPath);
            },
            onClose: () => this.renameModals.delete(modal),
        });
        this.renameModals.add(modal);
        modal.open();
    }

    public applySettings(): void {
        const settings = this.getSettings();
        if (!settings.file_explorer_patch_enabled || !settings.lab_rename_modal_enabled)
            this.closeRenameModals();
        if (settings.lab_manual_conversion_mode !== "review") this.conversionModal?.close();
    }

    private async requestConversion(note: TFile): Promise<void> {
        try {
            const bundle = getNotebundleIfPrimaryNote(note);
            if (bundle) {
                new Notice(
                    t("notice.note_is_already_notebundle", {
                        file_name: note.name,
                        folder_name: bundle.folder.name,
                    }),
                );
                return;
            }
            const settings = this.getSettings();
            const naming = settings.convert_primary_note_file_naming_rule;
            if (
                settings.lab_manual_conversion_mode === "note-only" ||
                settings.lab_manual_conversion_mode === "collect"
            ) {
                const attachments =
                    settings.lab_manual_conversion_mode === "note-only" ? "none" : "all";
                const result = await this.actions.convert(note, {
                    naming,
                    attachments,
                });
                reportNotebundleResult(result);
                if (
                    attachments === "all" &&
                    !hasNotebundleFailures(result) &&
                    note.extension !== "md" &&
                    note.extension !== "canvas"
                )
                    new Notice(t("notice.attachment_collection_unsupported"));
                return;
            }
            this.openConversionReview(note, naming);
        } catch (error) {
            showNotebundleError(error);
        }
    }

    private openConversionReview(note: TFile, naming: "bundle-name" | "note"): void {
        if (this.conversionModal) return;
        const modal = new NotebundleConversionModal(this.app, {
            loadReview: () => this.actions.reviewConversion(note, naming),
            onConfirm: (review, selected) =>
                this.actions.convert(note, { naming, attachments: { review, files: selected } }),
            onClose: () => {
                this.conversionModal = null;
            },
        });
        this.conversionModal = modal;
        modal.open();
    }

    private async requestCollection(note: TFile): Promise<void> {
        try {
            const result = await this.actions.collectAttachments(note);
            if (hasNotebundleFailures(result)) {
                reportNotebundleResult(result);
                return;
            }
            const count = result.items.filter((item) => item.status === "moved").length;
            const message =
                note.extension !== "md" && note.extension !== "canvas"
                    ? "notice.attachment_collection_unsupported"
                    : result.referencesComplete === false
                      ? "notice.collection_incomplete"
                      : "notice.attachments_collected";
            new Notice(t(message, { count }));
        } catch (error) {
            showNotebundleError(error);
        }
    }

    private isExplorerActionsEnabled(): boolean {
        return this.getSettings().file_explorer_patch_enabled === true;
    }

    private closeRenameModals(): void {
        for (const modal of [...this.renameModals]) modal.close();
        this.renameModals.clear();
    }

    public onunload(): void {
        this.conversionModal?.close();
        this.closeRenameModals();
    }
}
