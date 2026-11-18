import { Modal, Setting, TFile, TFolder } from "obsidian";
import type { App, TAbstractFile } from "obsidian";

import type { NotebundleInspection } from "../notebundle";
import type {
    AttachmentInspection,
    NotebundleOperationResult,
} from "../actions/NotebundleOperation";
import { describeNotebundleIssues } from "./NotebundleIssueNotice";
import { reportNotebundleResult, showNotebundleError } from "./NotebundleNotice";

interface InspectModalOptions {
    readonly inspection: Exclude<NotebundleInspection, { kind: "none" }>;
    readonly loadReferences: () => Promise<AttachmentInspection | null>;
    readonly onCollect: () => Promise<NotebundleOperationResult>;
    readonly onClose: () => void;
}

const REFERENCE_STATE_LABELS = {
    inside: "Internal",
    move: "External (Collectable)",
    shared: "External (Shared)",
    note: "Another note",
};

// Lab: lab_show_current_bundle_inspect
export class NotebundleInspectModal extends Modal {
    private collecting = false;
    private opened = false;

    public constructor(
        app: App,
        private readonly options: InspectModalOptions,
    ) {
        super(app);
    }

    public override onOpen(): void {
        this.opened = true;
        this.modalEl.setCssStyles({ width: "min(820px, calc(100vw - 32px))" });
        this.setTitle("Inspect notebundle");
        this.contentEl.createEl("p", { text: "Loading references..." });
        void this.loadReferences();
    }

    private async loadReferences(): Promise<void> {
        try {
            const references = await this.options.loadReferences();
            if (!this.opened) return;
            this.contentEl.empty();
            this.render(references);
        } catch (error) {
            if (!this.opened) return;
            showNotebundleError(error);
            this.close();
        }
    }

    private render(references: AttachmentInspection | null): void {
        const { inspection } = this.options;
        const folder =
            inspection.kind === "valid" ? inspection.notebundle.folder : inspection.folder;
        const primaryNote = inspection.kind === "valid" ? inspection.notebundle.primaryNote : null;
        const structureDescription =
            inspection.kind === "valid"
                ? `Primary note: ${inspection.notebundle.primaryNote.name} - valid structure`
                : describeNotebundleIssues(inspection);
        this.contentEl
            .createEl("p", { text: folder.path })
            .setCssStyles({ overflowWrap: "anywhere" });
        this.contentEl
            .createEl("p", {
                text: structureDescription,
            })
            .setCssStyles({
                color: "var(--text-muted)",
                fontSize: "var(--font-ui-small)",
                overflowWrap: "anywhere",
            });
        this.renderContents(folder, primaryNote, references);
        if (references && !references.complete)
            showNotebundleError("Failed to detect attachments.");
        this.renderReferences(references);
        this.renderFooter(references);
    }

    private renderContents(
        folder: TFolder,
        primaryNote: TFile | null,
        references: AttachmentInspection | null,
    ): void {
        this.contentEl.createEl("h3", { text: "Bundle directory structure" });
        const contentsTableBody = this.createNotebundleTable(["File", "Kind"]);
        const referencedFiles = new Set(references?.entries.map((entry) => entry.file));
        const appendContentRow = (file: TAbstractFile): void => {
            const row = contentsTableBody.createEl("tr");
            const pathCell = row.createEl("td");
            const kindCell = row.createEl("td");
            for (const cell of Array.from(row.cells))
                cell.setCssStyles({
                    padding: "8px",
                    border: "1px solid var(--background-modifier-border)",
                    textAlign: "left",
                });
            const relativePath =
                file.path.slice(folder.path.length + 1) + (file instanceof TFolder ? "/" : "");
            this.appendNotebundlePath(pathCell, file.path, relativePath);
            let kindLabel = "File";
            if (file instanceof TFolder) kindLabel = "Folder";
            else if (file === primaryNote) kindLabel = "Primary note";
            else if (file instanceof TFile && references?.complete && !referencedFiles.has(file))
                kindLabel = "File: not referenced by the primary note";
            kindCell.setText(kindLabel);
        };
        const appendFolderContents = (parent: TFolder): void => {
            const sortedChildren = [...parent.children].sort(
                (a, b) =>
                    Number(b instanceof TFolder) - Number(a instanceof TFolder) ||
                    a.name.localeCompare(b.name),
            );
            for (const file of sortedChildren) {
                appendContentRow(file);
                if (file instanceof TFolder) appendFolderContents(file);
            }
        };
        appendFolderContents(folder);
    }

    private renderReferences(references: AttachmentInspection | null): void {
        this.contentEl.createEl("h3", { text: "Primary note reference list" });
        if (!references) {
            this.contentEl
                .createEl("p", {
                    text: "INVALID NOTEBUNDLE",
                })
                .setCssStyles({
                    color: "var(--text-muted)",
                    fontSize: "var(--font-ui-small)",
                    overflowWrap: "anywhere",
                });
            return;
        }
        const referencesTableBody = this.createNotebundleTable([
            "File",
            "Current location",
            "Info",
        ]);
        for (const entry of references.entries) {
            const row = referencesTableBody.createEl("tr");
            row.createEl("td", { text: entry.file.name });
            this.appendNotebundlePath(row.createEl("td"), entry.path);
            row.createEl("td", { text: REFERENCE_STATE_LABELS[entry.state] }).setCssStyles({
                color: "var(--text-muted)",
                fontSize: "var(--font-ui-small)",
            });
            for (const cell of Array.from(row.cells))
                cell.setCssStyles({
                    padding: "8px",
                    border: "1px solid var(--background-modifier-border)",
                    textAlign: "left",
                });
        }
    }

    private renderFooter(references: AttachmentInspection | null): void {
        const collectibleCount =
            references?.entries.filter((entry) => entry.state === "move").length ?? 0;
        const footer = new Setting(this.contentEl);
        footer.settingEl.setCssStyles({
            position: "sticky",
            bottom: "0",
            flexWrap: "wrap",
            gap: "8px",
            background: "var(--background-primary)",
        });
        footer.controlEl.setCssStyles({ flexWrap: "wrap", gap: "8px" });
        if (references) footer.nameEl.setText(`${collectibleCount} external attachments detected`);
        footer.addButton((button) => button.setButtonText("Close").onClick(() => this.close()));
        if (collectibleCount)
            footer.addButton((button) =>
                button
                    .setButtonText("Collect attachments")
                    .setCta()
                    .onClick(() => {
                        void this.collect();
                    }),
            );
        if (this.modalEl.win.matchMedia("(pointer: coarse)").matches)
            footer.controlEl.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
                button.setCssStyles({ minHeight: "44px" });
            });
    }

    private createNotebundleTable(headers: readonly string[]): HTMLTableSectionElement {
        const scroll = this.contentEl.createDiv({ attr: { tabindex: "0" } });
        scroll.setCssStyles({ overflowX: "auto" });
        const table = scroll.createEl("table");
        table.setCssStyles({
            width: "100%",
            minWidth: "620px",
            tableLayout: "fixed",
            borderCollapse: "collapse",
            fontSize: "var(--font-ui-small)",
        });
        const headerRow = table.createEl("thead").createEl("tr");
        for (const text of headers)
            headerRow.createEl("th", { text, attr: { scope: "col" } }).setCssStyles({
                padding: "8px",
                border: "1px solid var(--background-modifier-border)",
                textAlign: "left",
                background: "var(--background-secondary)",
            });
        return table.createEl("tbody");
    }

    private appendNotebundlePath(
        host: HTMLElement,
        fullPath: string,
        displayPath = fullPath,
    ): void {
        const fileNameStart = displayPath.lastIndexOf("/") + 1;
        const pathEl = host.createSpan({ attr: { title: fullPath } });
        pathEl.setCssStyles({
            display: "flex",
            minWidth: "0",
            overflow: "hidden",
            whiteSpace: "nowrap",
            font: "var(--font-ui-smaller) var(--font-monospace)",
        });
        const parentPathEl = pathEl.createSpan();
        parentPathEl.setCssStyles({
            minWidth: "0",
            overflow: "hidden",
            textOverflow: "ellipsis",
            direction: "rtl",
            textAlign: "left",
            color: "var(--text-muted)",
        });
        parentPathEl.createEl("bdi", {
            text: displayPath.slice(0, fileNameStart),
            attr: { dir: "ltr" },
        });
        const fileNameEl = pathEl.createSpan();
        fileNameEl.setCssStyles({
            flexShrink: "0",
            maxWidth: "100%",
            overflow: "hidden",
            textOverflow: "ellipsis",
        });
        fileNameEl.createEl("bdi", {
            text: displayPath.slice(fileNameStart),
            attr: { dir: "ltr" },
        });
    }

    private async collect(): Promise<void> {
        if (this.collecting) return;
        this.collecting = true;
        this.contentEl.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
            button.disabled = true;
        });
        try {
            reportNotebundleResult(await this.options.onCollect());
        } catch (error) {
            showNotebundleError(error);
        } finally {
            this.collecting = false;
            if (this.opened) this.close();
        }
    }

    public override onClose(): void {
        this.opened = false;
        this.contentEl.empty();
        this.options.onClose();
    }
}
