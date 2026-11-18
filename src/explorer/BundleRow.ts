import { App, Keymap, setIcon, setTooltip, TFile } from "obsidian";
import { around } from "monkey-around";

import {
    getBundleName,
    getValidNotebundle,
    hasNotebundleSuffix,
    inspectNotebundle,
    NOTEBUNDLE_SUFFIX,
} from "../notebundle";
import type { NotebundleInspection } from "../notebundle";
import { describeNotebundleIssues, showNotebundleIssues } from "../ui/NotebundleIssueNotice";
import type { ExplorerFolderItem, ExplorerInput, ExplorerView } from "./ExplorerInternals";
import { t } from "../i18n";

export const NOTEBUNDLE_PATCH_UI_ATTRIBUTE = "data-notebundle-ui";

const ROW_CLASSES = [
    "notebundle-explorer-row",
    "notebundle-explorer-custom-label",
    "notebundle-explorer-active",
    "notebundle-explorer-invalid",
];

export class BundleRow {
    private readonly removeInteractionPatches: () => void;
    private readonly iconEl: HTMLButtonElement;
    private readonly labelEl: HTMLSpanElement;
    private readonly bundleNameEl: HTMLSpanElement;
    private readonly extensionBadgeEl: HTMLSpanElement;
    private iconTooltip = "";

    public constructor(
        private readonly app: App,
        private readonly view: ExplorerView,
        public readonly item: ExplorerFolderItem,
        private readonly openPrimaryNoteOnRowClick: () => boolean,
        private readonly requestRefresh: () => void = () => {},
    ) {
        const doc = item.selfEl.ownerDocument;
        this.iconEl = this.createIcon();

        this.labelEl = doc.createElement("span");
        this.labelEl.className = "notebundle-explorer-label";
        this.labelEl.setAttribute(NOTEBUNDLE_PATCH_UI_ATTRIBUTE, "");
        this.bundleNameEl = this.labelEl.appendChild(doc.createElement("span"));
        this.bundleNameEl.className = "notebundle-explorer-name";
        const suffixEl = this.labelEl.appendChild(doc.createElement("span"));
        suffixEl.className = "notebundle-explorer-suffix";
        suffixEl.textContent = NOTEBUNDLE_SUFFIX;

        this.extensionBadgeEl = doc.createElement("span");
        this.extensionBadgeEl.className = "nav-file-tag notebundle-explorer-extension";
        this.extensionBadgeEl.setAttribute(NOTEBUNDLE_PATCH_UI_ATTRIBUTE, "");
        this.removeInteractionPatches = this.installInteractionPatches();
    }

    private createIcon(): HTMLButtonElement {
        const doc = this.item.selfEl.ownerDocument;
        const icon = doc.createElement("button");
        icon.type = "button";
        icon.tabIndex = -1;
        icon.className = "tree-item-icon clickable-icon notebundle-explorer-icon";
        icon.setAttribute(NOTEBUNDLE_PATCH_UI_ATTRIBUTE, "");
        const collapsedIconEl = icon.appendChild(doc.createElement("span"));
        collapsedIconEl.className = "notebundle-explorer-icon-collapsed";
        setIcon(collapsedIconEl, "package");
        const expandedIconEl = icon.appendChild(doc.createElement("span"));
        expandedIconEl.className = "notebundle-explorer-icon-expanded";
        setIcon(expandedIconEl, "package-open");
        icon.addEventListener("click", this.onIconClick);
        icon.addEventListener("auxclick", this.onIconClick);
        return icon;
    }

    private installInteractionPatches(): () => void {
        const interceptor = (
            item: ExplorerFolderItem,
            event: ExplorerInput,
            passthrough: () => unknown,
        ): unknown => {
            return this.interceptSelfClick(item, event, passthrough);
        };
        const selectBundleName = (item: ExplorerFolderItem): void => {
            if (item === this.item) this.selectBundleName();
        };

        return around(this.item, {
            onSelfClick: (nextSelfClick) =>
                function (this: ExplorerFolderItem, event: ExplorerInput): unknown {
                    return interceptor(this, event, () => nextSelfClick.call(this, event));
                },
            startRename: (nextRename) =>
                function (this: ExplorerFolderItem): unknown {
                    const result = nextRename.call(this);
                    selectBundleName(this);
                    return result;
                },
        });
    }

    private selectBundleName(): void {
        const { file, innerEl } = this.item;
        if (!hasNotebundleSuffix(file) || this.view.fileBeingRenamed !== file) return;

        const doc = innerEl.ownerDocument;
        const text = innerEl.firstChild;
        const selection = doc.defaultView?.getSelection();
        if (
            doc.activeElement !== innerEl ||
            innerEl.getAttribute("contenteditable") !== "true" ||
            innerEl.childNodes.length !== 1 ||
            text?.nodeType !== Node.TEXT_NODE ||
            text.nodeValue !== file.name ||
            !selection ||
            selection.rangeCount !== 1 ||
            !selection.containsNode(innerEl, true) ||
            selection.toString() !== file.name
        )
            return;

        // Only include bundle name without .notebundle suffix from the initial selection.
        const range = doc.createRange();
        range.setStart(text, 0);
        range.setEnd(text, file.name.length - NOTEBUNDLE_SUFFIX.length);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    public render(inspection: NotebundleInspection, activeFile: TFile | null): void {
        if (inspection.kind === "none" || this.isRenaming()) {
            this.clearVisuals();
            return;
        }

        const primary = inspection.kind === "valid" ? inspection.notebundle.primaryNote : null;
        const titleEl = this.item.selfEl;
        const useCustomLabel = this.view.searchQuery === null;
        titleEl.classList.add("notebundle-explorer-row");
        titleEl.classList.toggle("notebundle-explorer-custom-label", useCustomLabel);
        titleEl.classList.toggle("notebundle-explorer-invalid", inspection.kind === "invalid");
        this.setActive(primary !== null && primary === activeFile);
        if (this.iconEl.parentElement !== titleEl)
            titleEl.insertBefore(this.iconEl, this.item.innerEl);

        this.renderName(useCustomLabel);
        this.renderExtensionBadge(primary?.extension ?? "", useCustomLabel);
        this.updateIconTooltip(inspection);
    }

    private renderName(useCustomLabel: boolean): void {
        const displayName = getBundleName(this.item.file) ?? this.item.file.name;
        if (this.bundleNameEl.textContent !== displayName)
            this.bundleNameEl.textContent = displayName;
        if (useCustomLabel) {
            if (this.labelEl.previousSibling !== this.item.innerEl)
                this.item.innerEl.after(this.labelEl);
        } else {
            this.labelEl.remove(); // Search keeps the native name and any native highlights.
        }
    }

    private renderExtensionBadge(extension: string, useCustomLabel: boolean): void {
        if (extension && extension.toLowerCase() !== "md") {
            const text = extension.toUpperCase();
            if (this.extensionBadgeEl.textContent !== text)
                this.extensionBadgeEl.textContent = text;
            const anchor = useCustomLabel ? this.labelEl : this.item.innerEl;
            if (this.extensionBadgeEl.previousSibling !== anchor)
                anchor.after(this.extensionBadgeEl);
        } else {
            this.extensionBadgeEl.remove();
        }
    }

    private updateIconTooltip(inspection: Exclude<NotebundleInspection, { kind: "none" }>): void {
        const iconTogglesFolder = inspection.kind !== "valid" || this.openPrimaryNoteOnRowClick();
        const action = iconTogglesFolder
            ? this.item.collapsed
                ? t("explorer.click_to_expand_folder")
                : t("explorer.click_to_collapse_folder")
            : t("explorer.click_to_open_primary_note");
        const tooltip = inspection.kind === "valid" ? action : describeNotebundleIssues(inspection);
        if (tooltip !== this.iconTooltip) {
            this.iconTooltip = tooltip;
            setTooltip(this.iconEl, tooltip);
        }
    }

    public updateActiveState(activeFile: TFile | null): void {
        const isPrimaryNoteActive =
            activeFile !== null &&
            activeFile.parent === this.item.file &&
            getValidNotebundle(this.item.file)?.primaryNote === activeFile;

        this.setActive(isPrimaryNoteActive);
    }

    public dispose(): void {
        try {
            this.removeInteractionPatches();
        } finally {
            this.clearVisuals();
            this.iconEl.removeEventListener("click", this.onIconClick);
            this.iconEl.removeEventListener("auxclick", this.onIconClick);
        }
    }

    private setActive(active: boolean): void {
        this.item.selfEl.classList.toggle(
            "notebundle-explorer-active",
            this.item.selfEl.classList.contains("notebundle-explorer-row") && active,
        );
    }

    private isRenaming(): boolean {
        return (
            this.view.fileBeingRenamed === this.item.file ||
            this.item.selfEl.classList.contains("is-being-renamed") ||
            this.item.innerEl.isContentEditable ||
            this.item.selfEl.querySelector('input, textarea, [contenteditable="true"]') !== null
        );
    }

    private interceptSelfClick(
        item: ExplorerFolderItem,
        event: ExplorerInput,
        passthrough: () => unknown,
    ): unknown {
        if (item !== this.item || !this.canHandle(event)) {
            return passthrough();
        }

        const isKeyboardEvent = "key" in event;
        const inspection = inspectNotebundle(item.file);
        if (inspection.kind === "invalid") {
            if (!isKeyboardEvent && event.button !== 0) return passthrough();
            if (this.view.tree?.handleItemSelection(event, item)) return;
            showNotebundleIssues(inspection);
            return this.toggleFolder();
        }
        const shouldHandlePrimaryNote =
            isKeyboardEvent || event.button === 1 || this.openPrimaryNoteOnRowClick();

        if (shouldHandlePrimaryNote && this.tryHandlePrimaryNoteInteraction(event, inspection)) {
            return;
        }

        return passthrough();
    }

    private canHandle(event: ExplorerInput): boolean {
        if (event.defaultPrevented || this.isRenaming()) return false;
        if (!hasNotebundleSuffix(this.item.file)) return false;
        if ("key" in event) return event.key === "Enter" && !event.isComposing;
        return event.button === 0 || event.button === 1;
    }

    private tryHandlePrimaryNoteInteraction(
        event: ExplorerInput,
        inspection: NotebundleInspection,
        invalidNotice: "show" | "suppress" = "show",
    ): boolean {
        const tree = this.view.tree;
        if (typeof tree?.handleItemSelection !== "function") return false;
        if (inspection.kind !== "valid") {
            const selectionGesture = !Keymap.isModEvent(event) && (event.shiftKey || event.altKey);
            if (inspection.kind === "invalid" && invalidNotice === "show" && !selectionGesture) {
                if (tree.handleItemSelection(event, this.item)) return true;
                showNotebundleIssues(inspection);
                return true;
            }
            return false;
        }

        const selectionHandled = tree.handleItemSelection(event, this.item);
        if (selectionHandled) return true;

        void this.openPrimaryNote(inspection.notebundle.primaryNote, event);
        return true;
    }

    private async openPrimaryNote(file: TFile, event: ExplorerInput): Promise<void> {
        try {
            await this.app.workspace.getLeaf(Keymap.isModEvent(event)).openFile(file);
        } catch (error) {
            console.error("obsidian-notebundle: could not open primary note", file.path, error);
        }
    }

    private readonly onIconClick = (event: MouseEvent): void => {
        if (event.button !== 0 && event.button !== 1) return;
        if (!this.canHandle(event)) return;
        event.preventDefault();
        event.stopPropagation();
        const inspection = inspectNotebundle(this.item.file);

        if (event.button === 1) {
            this.tryHandlePrimaryNoteInteraction(event, inspection);
            return;
        }

        if (
            !this.openPrimaryNoteOnRowClick() &&
            this.tryHandlePrimaryNoteInteraction(event, inspection, "suppress")
        )
            return;
        void this.toggleFolder().catch((error: unknown) => {
            console.error(
                "obsidian-notebundle: could not complete folder action",
                this.item.file.path,
                error,
            );
        });
    };

    private async toggleFolder(): Promise<void> {
        try {
            await this.item.toggleCollapsed(true);
        } catch (error) {
            console.error(
                "obsidian-notebundle: could not toggle folder",
                this.item.file.path,
                error,
            );
        }

        this.requestRefresh();
    }

    private clearVisuals(): void {
        this.item.selfEl.classList.remove(...ROW_CLASSES);
        this.iconEl.remove();
        this.labelEl.remove();
        this.extensionBadgeEl.remove();
    }
}
