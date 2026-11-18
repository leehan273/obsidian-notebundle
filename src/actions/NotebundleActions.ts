import { App, Component, normalizePath, TAbstractFile, TFile, TFolder } from "obsidian";

import { NotebundleConverter } from "./NotebundleConverter";
import {
    getBundleName,
    getAvailableNotebundlePath,
    getNotebundlePrimaryNotePath,
    getNotebundleIfPrimaryNote,
    getValidNotebundle,
    hasNotebundleSuffix,
    NOTEBUNDLE_SUFFIX,
    assertNoteStructure,
    cleanBundleName,
} from "../notebundle";
import { t } from "../i18n";
import { moveAttachments, removeEmptySourceFolders } from "./NotebundleAttachments";
import { NotebundleReferences, NotebundleReviewChangedError } from "./NotebundleReferences";
import type {
    AttachmentEntry,
    AttachmentReview,
    AttachmentSelection,
    AttachmentInspection,
    AttachmentItemResult,
    ConversionReview,
    NotebundleConversionOptions,
    NotebundleOperationResult,
    NewAttachmentResult,
} from "./NotebundleOperation";
import { unwrapNotebundle } from "./NotebundleUnwrapper";

interface CollectionPlan {
    entries: readonly AttachmentEntry[];
    unselected: readonly AttachmentItemResult[];
}

export class NotebundleActions extends Component {
    private operationTail: Promise<unknown> = Promise.resolve();
    private readonly converter: NotebundleConverter;
    private readonly references: NotebundleReferences;

    public constructor(
        private readonly app: App,
        private readonly detachFile: (file: TAbstractFile, path: string) => Promise<void>,
        getExcludedExtensions: () => readonly string[],
    ) {
        super();
        this.converter = new NotebundleConverter(app);
        this.references = this.addChild(new NotebundleReferences(app, getExcludedExtensions));
    }

    public async reviewConversion(
        note: TFile,
        naming: "bundle-name" | "note",
    ): Promise<ConversionReview> {
        this.assertCurrentNoteStructure(note);
        const review = await this.references.review(note);
        return {
            ...review,
            primaryNotePath: getNotebundlePrimaryNotePath(note, review.bundlePath, naming),
        };
    }

    public inspectAttachments(note: TFile): Promise<AttachmentInspection> {
        this.assertCurrentNoteStructure(note);
        return this.references.inspect(note);
    }

    public convert(
        note: TFile,
        options: NotebundleConversionOptions,
    ): Promise<NotebundleOperationResult> {
        return this.runSerialized(() => this.convertInternal(note, options));
    }

    public collectAttachments(note: TFile): Promise<NotebundleOperationResult> {
        return this.runSerialized(() => this.collectAttachmentsInternal(note));
    }

    public collectNewAttachments(
        note: TFile,
        naming: "bundle-name" | "note",
        files: readonly TFile[],
        canCollect: (file: TFile) => boolean,
    ): Promise<NewAttachmentResult> {
        return this.runSerialized(() =>
            this.collectNewAttachmentsInternal(note, naming, files, canCollect),
        );
    }

    public onReferencesChanged(listener: (note: TFile | null) => void): () => void {
        return this.references.onChanged(listener);
    }

    public async renameNotebundleFromModal(
        folder: TFolder,
        raw: string,
        expectedPath = folder.path,
    ): Promise<void> {
        return this.runSerialized(() =>
            this.renameNotebundleFromModalInternal(folder, raw, expectedPath),
        );
    }

    public async unwrapNotebundle(folder: TFolder, expectedPath = folder.path): Promise<void> {
        return this.runSerialized(() => this.unwrapNotebundleInternal(folder, expectedPath));
    }

    private async convertInternal(
        note: TFile,
        options: NotebundleConversionOptions,
    ): Promise<NotebundleOperationResult> {
        let bundle: TFolder | null = getNotebundleIfPrimaryNote(note)?.folder ?? null;
        let referencesComplete: boolean | undefined;
        const items: AttachmentItemResult[] = [];
        try {
            this.assertCurrentNoteStructure(note);
            const selection: AttachmentSelection | undefined =
                typeof options.attachments === "object" ? options.attachments : undefined;
            let review: AttachmentReview | null = null;
            if (selection) {
                review = await this.references.validateReview(selection.review, selection.files);
            } else if (options.attachments !== "none") {
                review = await this.references.review(note);
            }
            referencesComplete = review?.complete;
            let plan: CollectionPlan | null = null;
            if (review) {
                const chosen = new Set(
                    selection?.files ??
                        review.entries
                            .filter((entry) => entry.state === "move")
                            .map((entry) => entry.file),
                );
                plan = {
                    entries: review.entries.filter(
                        (entry) => entry.state !== "move" || chosen.has(entry.file),
                    ),
                    unselected: review.entries
                        .filter((entry) => entry.state === "move" && !chosen.has(entry.file))
                        .map((entry) => ({
                            file: entry.file,
                            from: entry.path,
                            to: entry.path,
                            status: "unselected",
                        })),
                };
            }
            const bundlePath =
                review?.bundlePath ??
                bundle?.path ??
                getAvailableNotebundlePath(note.parent ?? this.app.vault.getRoot(), note.basename);
            const sourceParent = note.parent!;
            const sourceBasename = note.basename;
            const conversion = await this.converter.convert(note, bundlePath, options.naming);
            bundle = conversion.bundle;
            if (plan) {
                items.push(...(await moveAttachments(this.app, plan.entries, bundle, note)));
                items.push(...plan.unselected);
                if (conversion.converted)
                    await removeEmptySourceFolders(this.app, sourceParent, sourceBasename, items);
            }
            return { note, items, referencesComplete };
        } catch (error) {
            return { note, items, referencesComplete, error };
        }
    }

    private async collectAttachmentsInternal(note: TFile): Promise<NotebundleOperationResult> {
        let bundle: TFolder | null = getNotebundleIfPrimaryNote(note)?.folder ?? null;
        let referencesComplete: boolean | undefined;
        const items: AttachmentItemResult[] = [];
        try {
            this.assertCurrentNoteStructure(note);
            if (!bundle) throw new Error(t("operation.review_changed"));
            const review = await this.references.reviewForCollection(note);
            referencesComplete = review.complete;
            const current = getNotebundleIfPrimaryNote(note);
            if (!current || current.folder.path !== review.bundlePath)
                throw new Error(t("operation.bundle_changed"));
            bundle = current.folder;
            items.push(...(await moveAttachments(this.app, review.entries, bundle, note)));
            return { note, items, referencesComplete };
        } catch (error) {
            return { note, items, referencesComplete, error };
        }
    }

    private async collectNewAttachmentsInternal(
        note: TFile,
        naming: "bundle-name" | "note",
        files: readonly TFile[],
        canCollect: (file: TFile) => boolean,
    ): Promise<NewAttachmentResult> {
        let referencesComplete: boolean | undefined;
        let reviewedCandidates: readonly TFile[] = [];
        const items: AttachmentItemResult[] = [];
        try {
            const candidates = files.filter(canCollect);
            if (!candidates.length) return { result: { note, items }, reviewedCandidates };
            this.assertCurrentNoteStructure(note);
            const review = await this.references.review(note, { kind: "new", files: candidates });
            referencesComplete = review.complete;
            if (!review.complete)
                return {
                    result: { note, items, referencesComplete },
                    reviewedCandidates,
                };

            const entries = review.entries.filter((entry) => canCollect(entry.file));
            reviewedCandidates = entries.map((entry) => entry.file);

            const hasNewAttachment = entries.some(
                (entry) => entry.state === "move" || entry.state === "shared",
            );
            if (hasNewAttachment) {
                const sourceParent = note.parent!;
                const sourceBasename = note.basename;
                const conversion = await this.converter.convert(note, review.bundlePath, naming);
                const bundle = conversion.bundle;
                items.push(...(await moveAttachments(this.app, entries, bundle, note)));
                if (conversion.converted)
                    await removeEmptySourceFolders(this.app, sourceParent, sourceBasename, items);
            } else {
                items.push(
                    ...entries.map((entry): AttachmentItemResult => ({
                        file: entry.file,
                        from: entry.path,
                        to: entry.path,
                        status: entry.state === "inside" ? "inside" : "note",
                    })),
                );
            }

            return {
                result: { note, items, referencesComplete },
                reviewedCandidates,
            };
        } catch (error) {
            if (error instanceof NotebundleReviewChangedError)
                return {
                    result: { note, items, referencesComplete },
                    reviewedCandidates: [],
                };
            return {
                result: { note, items, referencesComplete, error },
                reviewedCandidates,
            };
        }
    }

    private assertCurrentNoteStructure(note: TFile): void {
        if (this.app.vault.getAbstractFileByPath(note.path) !== note)
            throw new Error(t("operation.file_no_longer_exists", { path: note.path }));
        assertNoteStructure(note);
    }

    private runSerialized<T>(action: () => Promise<T>): Promise<T> {
        const result = this.operationTail.then(action, action);
        // Keep the queue usable after failure; the caller still receives the original result.
        this.operationTail = result.catch(() => {});
        return result;
    }

    private async renameNotebundleFromModalInternal(
        folder: TFolder,
        raw: string,
        expectedPath: string,
    ): Promise<void> {
        this.assertCurrentBundleFolder(folder, expectedPath);

        if (raw === getBundleName(folder)) return;
        const name = cleanBundleName(raw);
        if (!name) throw new Error("Name cannot be empty.");
        if (name.startsWith(".")) throw new Error("Name cannot start with a dot.");
        if (/[\\/]/.test(name)) throw new Error("Name cannot contain path separators.");
        const bundle = getValidNotebundle(folder);
        const candidate =
            bundle &&
            folder.children.find(
                (file) =>
                    file instanceof TFile &&
                    file !== bundle.primaryNote &&
                    (file.basename === name || file.basename === "note"),
            );
        if (candidate)
            throw new Error(t("rename.primary_candidate_conflict", { path: candidate.path }));
        const parent = folder.parent;
        const folderName = `${name}${NOTEBUNDLE_SUFFIX}`;
        const newPath = normalizePath(
            !parent || parent.isRoot() ? folderName : `${parent.path}/${folderName}`,
        );
        await this.renameFolder(folder, newPath);
    }

    private async unwrapNotebundleInternal(folder: TFolder, expectedPath: string): Promise<void> {
        this.assertCurrentBundleFolder(folder, expectedPath);
        await unwrapNotebundle(this.app, folder, this.detachFile);
    }

    private assertCurrentBundleFolder(folder: TFolder, expectedPath: string): void {
        if (
            folder.path !== expectedPath ||
            this.app.vault.getAbstractFileByPath(expectedPath) !== folder ||
            !hasNotebundleSuffix(folder)
        ) {
            throw new Error(t("actions.folder_changed_try_again"));
        }
    }

    private async renameFolder(folder: TFolder, newPath: string): Promise<void> {
        if (newPath === folder.path) return;
        const existing = this.app.vault.getAbstractFileByPath(newPath);
        if (existing && existing !== folder)
            throw new Error(t("rename.destination_already_exists", { path: newPath }));

        await this.app.fileManager.renameFile(folder, newPath);
    }
}
