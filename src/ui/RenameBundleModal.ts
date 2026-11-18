import { App, Modal } from "obsidian";
import type { TFile } from "obsidian";

import { cleanBundleName, NOTEBUNDLE_SUFFIX } from "../notebundle";
import { t } from "../i18n";

interface RenameBundleModalOptions {
    readonly initialBundleName: string;
    readonly initialFolderName: string;
    readonly primaryNote: TFile | null;
    readonly onRename: (name: string) => Promise<void>;
    readonly onClose: () => void;
}

// Lab: lab_rename_modal_enabled
export class RenameBundleModal extends Modal {
    private nameInputEl: HTMLInputElement | null = null;
    private nameSuffixEl: HTMLElement | null = null;
    private previewPathEl: HTMLElement | null = null;
    private errorMessageEl: HTMLElement | null = null;
    private actionButtons: HTMLButtonElement[] = [];
    private submitting = false;
    private opened = false;
    private focusFrame: number | null = null;
    private focusWindow: Window | null = null;

    public constructor(
        app: App,
        private readonly options: RenameBundleModalOptions,
    ) {
        super(app);
    }

    public onOpen(): void {
        this.opened = true;
        this.setTitle("Rename notebundle");
        this.contentEl.classList.add("notebundle-explorer-rename");
        this.contentEl.setCssStyles({
            display: "flex",
            flexDirection: "column",
            gap: "var(--size-4-3)",
        });
        const nameField = this.contentEl.createDiv({ cls: "notebundle-explorer-rename-input" });
        nameField.setCssStyles({
            display: "flex",
            alignItems: "baseline",
            minWidth: "0",
            padding: "var(--size-4-2)",
            border: "1px solid var(--background-modifier-border)",
            borderRadius: "var(--input-radius)",
            fontSize: "var(--font-ui-small)",
        });
        const nameInput = (this.nameInputEl = nameField.createEl("input", {
            type: "text",
        }));
        const inputStyles = {
            fieldSizing: "content",
            flex: "0 1 auto",
            width: "auto",
            minWidth: "2ch",
            maxWidth: "100%",
            height: "auto",
            padding: "0",
            paddingInlineEnd: "2px",
            border: "0",
            outline: "none",
            boxShadow: "none",
            background: "transparent",
            font: "inherit",
        };
        nameInput.setCssStyles(inputStyles);
        nameInput.addEventListener("focus", () => {
            nameField.setCssStyles({
                borderColor: "var(--background-modifier-border-focus)",
                boxShadow:
                    "0 0 0 var(--input-border-width-focus) var(--background-modifier-border-focus)",
            });
        });
        nameInput.addEventListener("blur", () => {
            nameField.setCssStyles({
                borderColor: "var(--background-modifier-border)",
                boxShadow: "none",
            });
        });
        nameInput.value = this.options.initialBundleName;
        this.nameSuffixEl = nameField.createSpan({
            cls: "notebundle-explorer-rename-suffix",
            text: NOTEBUNDLE_SUFFIX,
        });
        this.nameSuffixEl.setCssStyles({
            flexShrink: "0",
            color: "var(--text-faint)",
            fontSize: "var(--font-ui-smaller)",
        });
        nameInput.addEventListener("input", () => this.updatePreview());
        nameInput.addEventListener("keydown", (event) => {
            if (event.key !== "Enter" || event.isComposing) return;
            event.preventDefault();
            void this.submit();
        });

        const preview = this.contentEl.createDiv({
            cls: "notebundle-explorer-rename-preview",
        });
        preview.setCssStyles({
            display: "grid",
            gridTemplateColumns: "max-content minmax(0, 1fr)",
            alignItems: "baseline",
            gap: "var(--size-4-1) var(--size-4-3)",
            color: "var(--text-muted)",
            fontSize: "var(--font-ui-small)",
        });
        const { initialFolderName, primaryNote } = this.options;
        const originalPath = primaryNote
            ? `${initialFolderName}/${primaryNote.name}`
            : initialFolderName;
        preview.createSpan({ text: "Current" });
        const currentPathEl = preview.createEl("code", { text: originalPath });
        preview.createSpan({ text: "After rename" });
        this.previewPathEl = preview.createEl("code");
        for (const pathEl of [currentPathEl, this.previewPathEl])
            pathEl.setCssStyles({
                padding: "0",
                background: "none",
                overflowWrap: "anywhere",
                whiteSpace: "normal",
            });
        this.previewPathEl.setCssStyles({ color: "var(--text-normal)" });
        this.updatePreview();
        this.errorMessageEl = this.contentEl.createDiv({
            cls: "notebundle-explorer-rename-error",
        });
        this.errorMessageEl.setCssStyles({
            color: "var(--text-error)",
            fontSize: "var(--font-ui-small)",
        });
        this.errorMessageEl.hidden = true;

        const buttonRow = this.contentEl.createDiv({
            cls: "notebundle-explorer-rename-buttons",
        });
        buttonRow.setCssStyles({
            display: "flex",
            justifyContent: "flex-end",
            gap: "var(--size-4-2)",
        });
        const cancelButton = buttonRow.createEl("button", {
            text: "Cancel",
        });
        const renameButton = buttonRow.createEl("button", {
            text: "Rename",
            cls: "mod-cta",
        });
        this.actionButtons = [cancelButton, renameButton];
        cancelButton.addEventListener("click", () => this.close());
        renameButton.addEventListener("click", () => {
            void this.submit();
        });

        this.focusWindow = nameInput.ownerDocument.defaultView;
        this.focusFrame =
            this.focusWindow?.requestAnimationFrame(() => {
                this.focusFrame = null;
                if (!this.opened) return;
                nameInput.focus();
                nameInput.select();
            }) ?? null;
    }

    private updatePreview(): void {
        if (!this.nameInputEl || !this.previewPathEl) return;
        const rawName = this.nameInputEl.value;
        const { initialBundleName, primaryNote } = this.options;
        if (this.nameSuffixEl)
            this.nameSuffixEl.hidden =
                rawName !== initialBundleName && rawName.trim().endsWith(NOTEBUNDLE_SUFFIX);
        const bundleName =
            rawName === initialBundleName ? initialBundleName : cleanBundleName(rawName);
        let targetPath = `${bundleName}${NOTEBUNDLE_SUFFIX}`;
        if (primaryNote) {
            const primaryName =
                primaryNote.basename === "note"
                    ? primaryNote.name
                    : `${bundleName}${primaryNote.extension ? `.${primaryNote.extension}` : ""}`;
            targetPath += `/${primaryName}`;
        }
        this.previewPathEl.setText(targetPath);
    }

    private async submit(): Promise<void> {
        if (this.submitting || !this.nameInputEl) return;
        this.submitting = true;
        const submittedName = this.nameInputEl.value;
        if (this.errorMessageEl) this.errorMessageEl.hidden = true;
        this.nameInputEl.disabled = true;
        for (const button of this.actionButtons) button.disabled = true;
        try {
            await this.options.onRename(submittedName);
            if (this.opened) this.close();
        } catch (error) {
            console.error("obsidian-notebundle: could not rename folder", error);
            if (this.opened && this.errorMessageEl) {
                this.errorMessageEl.textContent =
                    error instanceof Error ? error.message : t("operation.failed");
                this.errorMessageEl.hidden = false;
            }
        } finally {
            this.submitting = false;
            if (this.opened && this.nameInputEl) {
                this.nameInputEl.disabled = false;
                for (const button of this.actionButtons) button.disabled = false;
                this.nameInputEl.focus();
            }
        }
    }

    public onClose(): void {
        this.opened = false;
        if (this.focusFrame !== null) this.focusWindow?.cancelAnimationFrame(this.focusFrame);
        this.focusFrame = null;
        this.focusWindow = null;
        this.contentEl.empty();
        this.nameInputEl = null;
        this.nameSuffixEl = null;
        this.previewPathEl = null;
        this.errorMessageEl = null;
        this.actionButtons = [];
        this.options.onClose();
    }
}
