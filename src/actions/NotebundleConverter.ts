import { App, TFile, TFolder } from "obsidian";

import {
    getNotebundlePrimaryNotePath,
    inspectNotebundle,
    NotebundleIssueError,
} from "../notebundle";
import { t } from "../i18n";

export interface NotebundleConversionResult {
    readonly bundle: TFolder;
    readonly converted: boolean;
}

export class NotebundleConverter {
    public constructor(private readonly app: App) {}

    public async convert(
        file: TFile,
        bundlePath: string,
        primaryNoteNaming: "bundle-name" | "note" = "bundle-name",
    ): Promise<NotebundleConversionResult> {
        const parent = file.parent ?? this.app.vault.getRoot();
        const inspection = inspectNotebundle(parent);

        if (inspection.kind === "invalid") throw new NotebundleIssueError(inspection);

        if (inspection.kind === "valid" && inspection.notebundle.primaryNote === file) {
            return {
                bundle: inspection.notebundle.folder,
                converted: false,
            };
        }

        const notePath = getNotebundlePrimaryNotePath(file, bundlePath, primaryNoteNaming);

        const sourcePath = file.path;
        const sourceParent = file.parent;
        const createdFolder = await this.app.vault.createFolder(bundlePath);

        try {
            if (
                file.path !== sourcePath ||
                file.parent !== sourceParent ||
                this.app.vault.getAbstractFileByPath(sourcePath) !== file ||
                this.app.vault.getAbstractFileByPath(bundlePath) !== createdFolder
            ) {
                throw new Error(t("operation.review_changed"));
            }
            await this.app.fileManager.renameFile(file, notePath);
        } catch (error) {
            try {
                await this.removeEmptyFolder(bundlePath, createdFolder);
            } catch (cleanupError) {
                console.error(
                    "obsidian-notebundle: Failed to clean up after conversion failed",
                    bundlePath,
                    cleanupError,
                );
            }
            throw error;
        }

        const bundle = this.app.vault.getAbstractFileByPath(bundlePath);
        const note = this.app.vault.getAbstractFileByPath(notePath);

        if (!(bundle instanceof TFolder)) {
            throw new Error(`${t("operation.failed")}\n${bundlePath}`);
        }

        if (!(note instanceof TFile)) {
            throw new Error(`${t("operation.failed")}\n${notePath}`);
        }

        return {
            bundle,
            converted: true,
        };
    }

    private async removeEmptyFolder(path: string, createdFolder: TFolder): Promise<void> {
        const folder = this.app.vault.getAbstractFileByPath(path);

        if (!(folder instanceof TFolder) || folder !== createdFolder) {
            return;
        }

        if (folder.children.length !== 0) {
            return;
        }

        await this.app.fileManager.trashFile(folder);
    }
}
