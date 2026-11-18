import { TFile, TFolder } from "obsidian";
import type { TAbstractFile } from "obsidian";
import { around } from "monkey-around";

import {
    getBundleName,
    getNotebundleIfPrimaryNote,
    hasNotebundleSuffix,
    inspectNotebundle,
} from "../notebundle";
import type { ExplorerSortInput, ExplorerView } from "./ExplorerInternals";

const SORT_ORDERS = [
    "alphabetical",
    "alphabeticalReverse",
    "byModifiedTime",
    "byModifiedTimeReverse",
    "byCreatedTime",
    "byCreatedTimeReverse",
] as const;

// To prevent sorting duplicate, just transform TFolder as non-TFolder object when it's notebundle
function adaptSortInput(folder: ExplorerSortInput, order: unknown): ExplorerSortInput {
    if (typeof order !== "string" || !(SORT_ORDERS as readonly string[]).includes(order)) {
        return folder;
    }
    if (!folder.children.some((file) => file instanceof TFolder && hasNotebundleSuffix(file))) {
        return folder;
    }

    const isTimeSort = order.startsWith("by");
    const timestampField = order.startsWith("byCreated") ? "ctime" : "mtime";
    const missingTimestamp = order.endsWith("Reverse") ? Infinity : -Infinity;

    const children = folder.children.map((abstract) => {
        if (!(abstract instanceof TFolder) || !hasNotebundleSuffix(abstract)) return abstract;
        const name = getBundleName(abstract) ?? abstract.name;
        const inspection = isTimeSort ? inspectNotebundle(abstract) : null;
        const time =
            inspection?.kind === "valid"
                ? inspection.notebundle.primaryNote.stat[timestampField]
                : undefined;
        return {
            path: abstract.path,
            name,
            basename: name,
            stat: {
                [timestampField]:
                    time !== undefined && Number.isFinite(time) ? time : missingTimestamp,
            },
        };
    });
    const input = Object.create(folder) as ExplorerSortInput;
    return Object.assign(input, { children });
}

export class ExplorerSortPatch {
    private enabled = false;
    private removePatch: (() => void) | null = null;

    public constructor(
        private readonly view: ExplorerView,
        private readonly onUnavailable: () => void,
    ) {}

    public setEnabled(enabled: boolean): void {
        const wasEnabled = this.enabled;
        this.enabled = enabled;
        if (enabled) {
            this.installPatch();
            return;
        }

        const removePatch = this.removePatch;
        this.removePatch = null;
        removePatch?.();
        if (wasEnabled) this.requestSort();
    }

    public onFileContentChange(file: TAbstractFile): void {
        if (!this.enabled) return;
        // Native onModify already requests sorting for both modified-time orders.
        if (
            this.view.sortOrder !== "byCreatedTime" &&
            this.view.sortOrder !== "byCreatedTimeReverse"
        )
            return;
        if (!(file instanceof TFile) || getNotebundleIfPrimaryNote(file) === null) return;

        this.requestSort();
    }

    public dispose(): void {
        this.setEnabled(false);
    }

    private requestSort(): void {
        if (typeof this.view.requestSort !== "function") return;
        this.view.requestSort();
    }

    private installPatch(): void {
        if (this.removePatch) return;
        const methods = ["getSortedFolderItems", "requestSort"] as const;
        const unavailableMethods = methods.filter(
            (method) => typeof this.view[method] !== "function",
        );
        if (unavailableMethods.length > 0) {
            console.warn(
                "Notebundle File Explorer (sort-api):",
                "Private sort methods are unavailable; native sorting retained.",
                { unavailableMethods },
            );
            this.onUnavailable();
            return;
        }

        const interceptor = (
            view: ExplorerView,
            folder: ExplorerSortInput,
            passthrough: (input: ExplorerSortInput) => unknown,
        ): unknown => {
            let input = folder;
            try {
                input = adaptSortInput(folder, view.sortOrder);
            } catch (error) {
                console.error("Notebundle File Explorer (sort-transform):", folder.path, error);
            }
            // Only transformation failures use native input; native sort errors propagate unchanged.
            return passthrough(input);
        };

        const view = this.view as ExplorerView &
            Required<Pick<ExplorerView, "getSortedFolderItems">>;
        this.removePatch = around(view, {
            getSortedFolderItems: (nextSortedFolderItems) =>
                function (this: ExplorerView, folder: ExplorerSortInput): unknown {
                    return interceptor(this, folder, (input) =>
                        nextSortedFolderItems.call(this, input),
                    );
                },
        });
        this.requestSort();
    }
}
