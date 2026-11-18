import { App, TAbstractFile, TFile, TFolder } from "obsidian";

import { hasNotebundleSuffix, inspectNotebundle, NOTEBUNDLE_SUFFIX } from "../notebundle";
import { BundleRow, NOTEBUNDLE_PATCH_UI_ATTRIBUTE } from "./BundleRow";
import { getFolderItem } from "./ExplorerInternals";
import type { ExplorerFolderItem, ExplorerRowApiMember, ExplorerView } from "./ExplorerInternals";
import { ExplorerSortPatch } from "./ExplorerSort";

export class ExplorerViewController {
    private readonly app: App;
    private readonly view: ExplorerView;
    private readonly root: HTMLElement;
    private readonly win: Window;

    private readonly observer: MutationObserver;
    private readonly sort: ExplorerSortPatch;
    private readonly rows = new Map<HTMLElement, BundleRow>();
    private readonly warnedRowMembers = new Set<ExplorerRowApiMember>();

    private open_primary_note_on_click: boolean;

    private refreshFrame: number | null = null;
    private activeFile: TFile | null = null;
    private activeUpdateQueued = false;

    public constructor(
        app: App,
        view: ExplorerView,
        options: {
            open_primary_note_on_click: boolean;
            sort_notebundle_as_file: boolean;
        },
        private readonly onUnavailable: (feature: "explorer" | "sort") => void,
    ) {
        this.app = app;
        this.view = view;
        this.open_primary_note_on_click = options.open_primary_note_on_click;

        this.root = view.containerEl;
        const win = this.root.ownerDocument.defaultView;
        if (!win || win.closed) throw new Error("File Explorer document has no live window.");
        this.win = win;

        this.sort = new ExplorerSortPatch(view, () => onUnavailable("sort"));
        // Obtain the constructor from this view's realm, not the main application's window.
        this.observer = new win.MutationObserver(this.onDomChange);

        try {
            this.observer.observe(this.root, {
                childList: true,
                subtree: true,
                characterData: true,
                attributes: true,
                attributeFilter: ["data-path", "contenteditable"],
            });

            this.applyOptions(options);
        } catch (error) {
            this.detach();
            throw error;
        }
    }

    public detach(): void {
        this.activeUpdateQueued = false;
        this.observer.disconnect();

        if (this.refreshFrame !== null) this.win.cancelAnimationFrame(this.refreshFrame);
        this.refreshFrame = null;

        this.rows.forEach((row, titleEl) => {
            try {
                this.detachRow(titleEl, row);
            } catch (error) {
                console.error(
                    "obsidian-notebundle: ExplorerViewController row detach error",
                    row.item.file.path,
                    error,
                );
            }
        });
        try {
            this.sort.dispose();
        } catch (error) {
            console.error("obsidian-notebundle: ExplorerViewController sort dispose error", error);
        }
    }

    public applyOptions(options: {
        open_primary_note_on_click: boolean;
        sort_notebundle_as_file: boolean;
    }): void {
        this.open_primary_note_on_click = options.open_primary_note_on_click;

        try {
            this.sort.setEnabled(options.sort_notebundle_as_file);
        } catch (error) {
            console.error(
                "obsidian-notebundle: could not update file explorer sort settings",
                error,
            );
            if (options.sort_notebundle_as_file) this.onUnavailable("sort");
        }
        this.requestRefresh();
    }

    public onFileOpen(): void {
        this.queueActiveUpdate();
    }

    public onFileTreeChange(file: TAbstractFile, oldPath?: string): void {
        let shouldRefreshRender = false;
        if (file instanceof TFolder) shouldRefreshRender = true;

        if (file instanceof TFile) {
            if (this.hasDirectBundleParent(file.path)) shouldRefreshRender = true;
            else if (oldPath !== undefined && this.hasDirectBundleParent(oldPath))
                shouldRefreshRender = true;
        }

        if (shouldRefreshRender === false) return;

        this.requestRefresh();
    }

    public onFileContentChange(file: TAbstractFile): void {
        this.sort.onFileContentChange(file);
    }

    public readonly requestRefresh = (): void => {
        if (this.refreshFrame !== null) return;

        this.refreshFrame = this.win.requestAnimationFrame(() => {
            this.refreshFrame = null;
            this.refreshRows();
        });
    };

    private readonly onDomChange = (records: MutationRecord[]): void => {
        const needsRefresh = records.some((record) => {
            // Ignore this plugin's UI mutations to avoid scheduling another refresh from rendering.
            if (this.isNotebundleUiNode(record.target)) return false;

            if (record.type === "attributes") return true;
            if (record.type === "characterData") return true;

            const changedNodes = [...record.addedNodes, ...record.removedNodes];
            const hasExternalNodeChange = changedNodes.some(
                (node) => !this.isNotebundleUiNode(node),
            );
            return hasExternalNodeChange;
        });

        if (needsRefresh) this.requestRefresh();
    };

    private isNotebundleUiNode(node: Node): boolean {
        const element = node.nodeType === 1 ? (node as Element) : node.parentElement;
        return element !== null && element.closest(`[${NOTEBUNDLE_PATCH_UI_ATTRIBUTE}]`) !== null;
    }

    private refreshRows(): void {
        this.activeFile = this.app.workspace.getActiveFile();

        const retainedTitles = new Set<HTMLElement>();
        const titles = this.root.querySelectorAll<HTMLElement>(".nav-folder-title[data-path]");

        titles.forEach((titleEl) => {
            try {
                if (this.refreshRow(titleEl, this.activeFile)) retainedTitles.add(titleEl);
            } catch (error) {
                console.error(
                    "obsidian-notebundle: file explorer refresh row error",
                    titleEl.getAttribute("data-path"),
                    error,
                );
            }
        });

        Array.from(this.rows)
            .filter(([titleEl]) => !retainedTitles.has(titleEl))
            .forEach(([titleEl, row]) => {
                try {
                    this.detachRow(titleEl, row);
                } catch (error) {
                    console.error(
                        "obsidian-notebundle: file explorer detach row error:",
                        row.item.file.path,
                        error,
                    );
                }
            });
    }

    private refreshRow(titleEl: HTMLElement, activeFile: TFile | null): boolean {
        const path = titleEl.getAttribute("data-path");
        const folder = path === null ? null : this.app.vault.getAbstractFileByPath(path);
        if (!(folder instanceof TFolder) || !hasNotebundleSuffix(folder)) return false;

        const result = getFolderItem(this.view, titleEl, folder);
        if (result.kind === "missing") return false;
        if (result.kind === "unsupported") {
            this.warnUnsupportedRowMember(result.member, folder.path);
            return false;
        }

        const row = this.getOrCreateRow(titleEl, result.item);
        row.render(inspectNotebundle(folder), activeFile);
        return true;
    }

    private getOrCreateRow(titleEl: HTMLElement, item: ExplorerFolderItem): BundleRow {
        const currentRow = this.rows.get(titleEl);

        if (currentRow) {
            if (currentRow.item === item) return currentRow;

            this.detachRow(titleEl, currentRow);
        }

        const row = new BundleRow(
            this.app,
            this.view,
            item,
            () => this.open_primary_note_on_click,
            this.requestRefresh,
        );
        this.rows.set(titleEl, row);
        return row;
    }

    private detachRow(titleEl: HTMLElement, row: BundleRow): void {
        try {
            row.dispose();
        } finally {
            this.rows.delete(titleEl);
        }
    }

    private queueActiveUpdate(): void {
        if (this.activeUpdateQueued) return;
        this.activeUpdateQueued = true;

        queueMicrotask(() => {
            this.activeUpdateQueued = false;
            this.updateActiveRows();
        });
    }

    private updateActiveRows(): void {
        const currentActiveFile = this.app.workspace.getActiveFile();
        if (currentActiveFile === this.activeFile) return;

        this.activeFile = currentActiveFile;
        this.rows.forEach((row) => {
            try {
                row.updateActiveState(currentActiveFile);
            } catch (error) {
                console.debug(
                    "obsidian-notebundle: row.updateActiveState failed",
                    row.item.file.path,
                    error,
                );
            }
        });
    }

    private hasDirectBundleParent(path: string): boolean {
        const separator = path.lastIndexOf("/");
        return separator >= 0 && path.slice(0, separator).endsWith(NOTEBUNDLE_SUFFIX);
    }

    private warnUnsupportedRowMember(member: ExplorerRowApiMember, path: string): void {
        if (this.warnedRowMembers.has(member)) return;

        this.warnedRowMembers.add(member);
        console.warn("obsidian-notebundle: file explorer row api seem unexpected.", {
            member,
            path,
        });
        this.onUnavailable("explorer");
    }
}
