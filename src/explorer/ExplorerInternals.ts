import { TAbstractFile, TFolder } from "obsidian";
import type { TFile } from "obsidian";

export type ExplorerInput = MouseEvent | KeyboardEvent;

// Only the properties needed by native sorting and this plugin's sort-input transformation and error reporting.
export interface ExplorerSortInput {
    path: string;
    children: readonly (
        | TAbstractFile
        | {
              path: string;
              name: string;
              basename: string;
              stat: Partial<Pick<TFile["stat"], "mtime" | "ctime">>;
          }
    )[];
}

export interface ExplorerFolderItem {
    file: TFolder;
    selfEl: HTMLElement;
    innerEl: HTMLElement;
    collapsed: boolean;
    onSelfClick(event: ExplorerInput): unknown;
    toggleCollapsed(animate: boolean): unknown;
    startRename(): unknown;
}

export interface ExplorerView {
    containerEl: HTMLElement;
    fileItems?: Record<string, unknown>;
    tree?: {
        handleItemSelection(event: ExplorerInput, item: ExplorerFolderItem): boolean;
    };
    fileBeingRenamed?: TAbstractFile | null;
    searchQuery?: unknown;
    sortOrder?: unknown;
    getSortedFolderItems?: (folder: ExplorerSortInput) => unknown;
    requestSort?: () => void;
}

export type ExplorerRowApiMember =
    | "view.fileItems"
    | "view.tree.handleItemSelection"
    | "item"
    | "item.collapsed"
    | "item.onSelfClick"
    | "item.toggleCollapsed"
    | "item.startRename";

export type FolderItemLookup =
    | { kind: "ready"; item: ExplorerFolderItem }
    | { kind: "missing" }
    | { kind: "unsupported"; member: ExplorerRowApiMember };

export function getFolderItem(
    view: ExplorerView,
    titleEl: HTMLElement,
    folder: TFolder,
): FolderItemLookup {
    if (!view.fileItems || typeof view.fileItems !== "object") {
        return { kind: "unsupported", member: "view.fileItems" };
    }
    if (typeof view.tree?.handleItemSelection !== "function") {
        return { kind: "unsupported", member: "view.tree.handleItemSelection" };
    }

    const value = view.fileItems[folder.path];
    if (value === undefined || value === null) return { kind: "missing" };
    if (typeof value !== "object") return { kind: "unsupported", member: "item" };

    const item = value as Partial<ExplorerFolderItem>;
    const innerEl = titleEl.querySelector<HTMLElement>(".nav-folder-title-content");
    if (item.file !== folder || item.selfEl !== titleEl || !innerEl || item.innerEl !== innerEl) {
        return { kind: "missing" };
    }
    if (typeof item.collapsed !== "boolean") {
        return { kind: "unsupported", member: "item.collapsed" };
    }
    if (typeof item.onSelfClick !== "function") {
        return { kind: "unsupported", member: "item.onSelfClick" };
    }
    if (typeof item.toggleCollapsed !== "function") {
        return { kind: "unsupported", member: "item.toggleCollapsed" };
    }
    if (typeof item.startRename !== "function") {
        return { kind: "unsupported", member: "item.startRename" };
    }

    return { kind: "ready", item: item as ExplorerFolderItem };
}
