import { Modal, Setting } from "obsidian";
import type { App, TFile } from "obsidian";

import type {
    AttachmentEntry,
    AttachmentReview,
    ConversionReview,
    NotebundleOperationResult,
} from "../actions/NotebundleOperation";
import { reportNotebundleResult, showNotebundleError } from "./NotebundleNotice";
import { t } from "../i18n";

interface ConversionModalOptions {
    readonly loadReview: () => Promise<ConversionReview>;
    readonly onConfirm: (
        review: AttachmentReview,
        selected: readonly TFile[],
    ) => Promise<NotebundleOperationResult>;
    readonly onClose: () => void;
}

interface AttachmentRowCells {
    readonly selectionCell: HTMLTableCellElement;
    readonly fileNameCell: HTMLTableCellElement;
    readonly currentLocationCell: HTMLTableCellElement;
    readonly destinationCell: HTMLTableCellElement;
}

const KEEP_FILE_REASON = {
    inside: "Unchanged (Already inside)",
    shared: "Unchanged (Shared attachment)",
    note: "Unchanged (Another note)",
};

// Lab: lab_manual_conversion_mode
export class NotebundleConversionModal extends Modal {
    private submitting = false;
    private opened = false;
    private readonly selectedFiles = new Set<TFile>();
    private selectionSummaryEl: HTMLElement | null = null;

    public constructor(
        app: App,
        private readonly options: ConversionModalOptions,
    ) {
        super(app);
    }

    public override onOpen(): void {
        this.opened = true;
        this.modalEl.setCssStyles({ width: "min(820px, calc(100vw - 32px))" });
        this.setTitle("Convert to notebundle");
        this.contentEl.createEl("p", { text: "Loading references..." });
        void this.loadReview();
    }

    private async loadReview(): Promise<void> {
        try {
            const review = await this.options.loadReview();
            if (!this.opened) return;
            this.contentEl.empty();
            this.selectedFiles.clear();
            for (const entry of review.entries)
                if (entry.state === "move") this.selectedFiles.add(entry.file);
            if (!review.complete)
                showNotebundleError(
                    review.note.extension !== "md" && review.note.extension !== "canvas"
                        ? t("notice.attachment_collection_unsupported")
                        : "Failed to detect attachments.",
                );
            this.renderSummary(review);
            this.renderAttachments(review);
            this.renderFooter(review);
        } catch (error) {
            if (!this.opened) return;
            showNotebundleError(error);
            this.close();
        }
    }

    private renderSummary(review: ConversionReview): void {
        for (const [label, path] of [
            ["Current note", review.notePath],
            ["After conversion", review.primaryNotePath],
        ]) {
            const line = this.contentEl.createEl("p");
            line.setCssStyles({ overflowWrap: "anywhere" });
            line.createSpan({ text: `${label}: ` }).setCssStyles({
                color: "var(--text-muted)",
                fontSize: "var(--font-ui-small)",
            });
            line.createEl("code", { text: path });
        }
        this.contentEl.createEl("h3", {
            text: "Detected reference list",
        });
        this.contentEl
            .createEl("p", {
                text: "Selected attachments move into the bundle's attachments/ folder.",
            })
            .setCssStyles({
                color: "var(--text-muted)",
                fontSize: "var(--font-ui-small)",
                overflowWrap: "anywhere",
            });
    }

    private renderAttachments(review: AttachmentReview): void {
        const coarsePointer = this.modalEl.win.matchMedia("(pointer: coarse)").matches;
        const attachmentsTableBody = this.createNotebundleTable([
            "Select",
            "File",
            "Current location",
            "After conversion",
        ]);
        const orderedEntries = [
            ...review.entries.filter((entry) => entry.state === "shared"),
            ...review.entries.filter((entry) => entry.state !== "shared" && entry.state !== "move"),
            ...review.entries.filter((entry) => entry.state === "move"),
        ];
        for (const [index, entry] of orderedEntries.entries()) {
            const cells = this.createAttachmentRow(attachmentsTableBody);
            this.appendNotebundlePath(cells.currentLocationCell, entry.path);
            if (entry.state !== "move") {
                cells.fileNameCell.setText(entry.file.name);
                cells.destinationCell
                    .createSpan({ text: KEEP_FILE_REASON[entry.state] })
                    .setCssStyles({
                        color: "var(--text-muted)",
                        fontSize: "var(--font-ui-small)",
                    });
                continue;
            }
            this.renderSelectableAttachment(cells, entry, index, coarsePointer, review.bundlePath);
        }
    }

    private createAttachmentRow(body: HTMLTableSectionElement): AttachmentRowCells {
        const row = body.createEl("tr");
        const cells = {
            selectionCell: row.createEl("td"),
            fileNameCell: row.createEl("td"),
            currentLocationCell: row.createEl("td"),
            destinationCell: row.createEl("td"),
        };
        for (const cell of Array.from(row.cells))
            cell.setCssStyles({
                padding: "8px",
                border: "1px solid var(--background-modifier-border)",
                textAlign: "left",
            });
        cells.selectionCell.setCssStyles({ width: "44px", textAlign: "center" });
        return cells;
    }

    private renderSelectableAttachment(
        cells: AttachmentRowCells,
        entry: AttachmentEntry,
        index: number,
        coarsePointer: boolean,
        bundlePath: string,
    ): void {
        const { selectionCell, fileNameCell, destinationCell } = cells;
        const checkbox = selectionCell.createEl("input", { type: "checkbox" });
        checkbox.id = `notebundle-attachment-${index}`;
        checkbox.checked = true;
        checkbox.setCssStyles({ margin: "0" });
        if (coarsePointer) checkbox.setCssStyles({ minWidth: "22px", minHeight: "22px" });
        const label = fileNameCell.createEl("label", {
            text: entry.file.name,
            attr: { for: checkbox.id },
        });
        label.setCssStyles({
            display: "block",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
        });
        if (coarsePointer) label.setCssStyles({ minHeight: "44px" });
        const targetPathEl = destinationCell.createDiv();
        this.appendNotebundlePath(
            targetPathEl,
            entry.to,
            entry.to.slice(bundlePath.length + 1),
            entry.to.slice(entry.to.lastIndexOf("/") + 1) !== entry.file.name,
        );
        const keepLocationLabel = destinationCell.createSpan({
            text: "Unchanged",
        });
        keepLocationLabel.setCssStyles({
            color: "var(--text-muted)",
            fontSize: "var(--font-ui-small)",
        });
        keepLocationLabel.hidden = true;
        checkbox.addEventListener("change", () => {
            if (checkbox.checked) this.selectedFiles.add(entry.file);
            else this.selectedFiles.delete(entry.file);
            targetPathEl.hidden = !checkbox.checked;
            keepLocationLabel.hidden = checkbox.checked;
            this.updateSelectionSummary();
        });
    }

    private renderFooter(review: AttachmentReview): void {
        const footer = new Setting(this.contentEl);
        footer.settingEl.setCssStyles({
            position: "sticky",
            bottom: "0",
            flexWrap: "wrap",
            gap: "8px",
            background: "var(--background-primary)",
        });
        footer.controlEl.setCssStyles({ flexWrap: "wrap", gap: "8px" });
        this.selectionSummaryEl = footer.nameEl;
        this.updateSelectionSummary();
        footer.addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()));
        footer.addButton((button) =>
            button
                .setButtonText("Convert")
                .setCta()
                .onClick(() => {
                    void this.submit(review);
                }),
        );
        if (this.modalEl.win.matchMedia("(pointer: coarse)").matches)
            footer.controlEl.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
                button.setCssStyles({ minHeight: "44px" });
            });
    }

    private updateSelectionSummary(): void {
        this.selectionSummaryEl?.setText(`Move ${this.selectedFiles.size} attachment(s)`);
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
        for (const [index, text] of headers.entries()) {
            const header = headerRow.createEl("th", { text, attr: { scope: "col" } });
            header.setCssStyles({
                padding: "8px",
                border: "1px solid var(--background-modifier-border)",
                textAlign: "left",
                background: "var(--background-secondary)",
            });
            if (index === 0) header.setCssStyles({ width: "44px", textAlign: "center" });
            if (index === 1) header.setCssStyles({ width: "130px" });
        }
        return table.createEl("tbody");
    }

    private appendNotebundlePath(
        host: HTMLElement,
        fullPath: string,
        displayPath = fullPath,
        renamed = false,
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
        if (renamed) fileNameEl.setCssStyles({ color: "var(--text-accent)" });
        fileNameEl.createEl("bdi", {
            text: displayPath.slice(fileNameStart),
            attr: { dir: "ltr" },
        });
    }

    private async submit(review: AttachmentReview): Promise<void> {
        if (this.submitting) return;
        this.submitting = true;
        const selectedFiles = [...this.selectedFiles];
        this.contentEl
            .createEl("p", {
                text: "Processing...",
            })
            .setCssStyles({ overflowWrap: "anywhere" });
        this.contentEl
            .querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button")
            .forEach((element) => {
                element.disabled = true;
            });
        try {
            reportNotebundleResult(await this.options.onConfirm(review, selectedFiles));
        } catch (error) {
            showNotebundleError(error);
        } finally {
            this.submitting = false;
            if (this.opened) this.close();
        }
    }

    public override onClose(): void {
        this.opened = false;
        this.selectionSummaryEl = null;
        this.contentEl.empty();
        this.options.onClose();
    }
}
