import { App, Component, normalizePath, parseLinktext, TFile, TFolder } from "obsidian";
import type { CachedMetadata } from "obsidian";

import { getAvailableNotebundlePath, getNotebundleIfPrimaryNote } from "../notebundle";
import { t } from "../i18n";
import type {
    AttachmentState,
    AttachmentReference,
    AttachmentInspection,
    AttachmentEntry,
    AttachmentReview,
} from "./NotebundleOperation";

export class NotebundleReviewChangedError extends Error {
    public constructor() {
        super(t("operation.review_changed"));
    }
}

interface ReferenceSnapshot extends AttachmentInspection {
    readonly notePath: string;
    readonly noteMtime: number;
    readonly bundle: TFolder | null;
}

interface NoteReferences {
    readonly files: Set<TFile>;
    readonly complete: boolean;
}

type ReferenceScope =
    { readonly kind: "all" } | { readonly kind: "new"; readonly files: readonly TFile[] };

export class NotebundleReferences extends Component {
    private readonly dirtyMarkdownFiles = new Set<TFile>();
    private readonly indexedContent = new WeakMap<TFile, string>();
    private readonly changeListeners = new Set<(note: TFile | null) => void>();
    private readonly collectionWaiters = new Set<() => void>();

    public constructor(
        private readonly app: App,
        private readonly getExcludedExtensions: () => readonly string[],
    ) {
        super();
    }

    public override onload(): void {
        this.registerEvent(
            this.app.vault.on("modify", (file) => {
                if (file instanceof TFile && file.extension === "md")
                    this.dirtyMarkdownFiles.add(file);
                if (file instanceof TFile && file.extension === "canvas") this.notifyChanged(file);
            }),
        );
        this.registerEvent(
            this.app.vault.on("delete", (file) => {
                if (file instanceof TFile) this.dirtyMarkdownFiles.delete(file);
            }),
        );
        this.registerEvent(
            this.app.metadataCache.on("changed", (file, data) => {
                this.indexedContent.set(file, data);
                this.dirtyMarkdownFiles.delete(file);
                this.notifyChanged(file);
            }),
        );
        // Revisit pending attachments after link resolution.
        this.registerEvent(this.app.metadataCache.on("resolved", () => this.notifyChanged(null)));
    }

    public onChanged(listener: (note: TFile | null) => void): () => void {
        this.changeListeners.add(listener);

        return () => this.changeListeners.delete(listener);
    }

    public override onunload(): void {
        for (const cancel of this.collectionWaiters) cancel();
        this.collectionWaiters.clear();
    }

    private notifyChanged(note: TFile | null): void {
        for (const listener of this.changeListeners) listener(note);
    }

    public getMarkdownReferences(note: TFile, cache: CachedMetadata): Set<TFile> {
        const files = new Set<TFile>();

        const references = [
            ...(cache.links ?? []),
            ...(cache.embeds ?? []),
            ...(cache.frontmatterLinks ?? []),
            ...(cache.referenceLinks ?? []),
        ];

        for (const reference of references) {
            const { path } = parseLinktext(reference.link);
            if (!path || path.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(path)) continue;
            const file = this.app.metadataCache.getFirstLinkpathDest(path, note.path);
            if (file && file !== note) files.add(file);
        }
        return files;
    }

    public getReferences(note: TFile): Promise<NoteReferences> {
        switch (note.extension) {
            case "md":
                return this.readMarkdownReferences(note);
            case "canvas":
                return this.readCanvasReferences(note);
            default:
                return Promise.resolve({ files: new Set<TFile>(), complete: false });
        }
    }

    private async readMarkdownReferences(note: TFile): Promise<NoteReferences> {
        const empty = { files: new Set<TFile>(), complete: false };

        // Do not collect from a cache known to be stale or different from the current content.
        if (this.dirtyMarkdownFiles.has(note)) return empty;

        const cache = this.app.metadataCache.getFileCache(note);

        if (!cache) return empty;

        const indexed = this.indexedContent.get(note);

        if (indexed !== undefined && indexed !== (await this.app.vault.cachedRead(note)))
            return empty;

        // The note may have changed while cachedRead was awaiting.
        if (this.dirtyMarkdownFiles.has(note)) return empty;

        return { files: this.getMarkdownReferences(note, cache), complete: true };
    }

    private async readCanvasReferences(note: TFile): Promise<NoteReferences> {
        const empty = { files: new Set<TFile>(), complete: false };

        let data: unknown;

        try {
            data = JSON.parse(await this.app.vault.cachedRead(note));
        } catch (error) {
            if (error instanceof SyntaxError) return empty;
            throw error;
        }

        if (!data || typeof data !== "object" || Array.isArray(data)) return empty;

        // Obsidian can store an empty Canvas as {}. It has no file nodes to inspect.
        const nodes = "nodes" in data ? data.nodes : [];

        if (!Array.isArray(nodes)) return empty;

        const files = new Set<TFile>();

        for (const node of nodes as unknown[]) {
            if (!node || typeof node !== "object" || !("type" in node) || node.type !== "file")
                continue;
            if (!("file" in node) || typeof node.file !== "string") continue;
            const file = this.app.vault.getAbstractFileByPath(normalizePath(node.file));
            if (file instanceof TFile && file !== note) files.add(file);
        }

        return { files, complete: true };
    }

    public inspect(note: TFile): Promise<AttachmentInspection> {
        return this.analyze(note);
    }

    private async analyze(
        note: TFile,
        scope: ReferenceScope = { kind: "all" },
    ): Promise<ReferenceSnapshot> {
        const notePath = note.path;
        const noteMtime = note.stat.mtime;
        const references = await this.getReferences(note);
        const targets =
            scope.kind === "new"
                ? scope.files.filter((file) => references.files.has(file))
                : [...references.files];
        const bundle = getNotebundleIfPrimaryNote(note)?.folder ?? null;
        const sharedFiles = this.findSharedReferences(notePath, targets, bundle);
        const complete = references.complete;

        if (note.path !== notePath || note.stat.mtime !== noteMtime) {
            throw new NotebundleReviewChangedError();
        }

        const entries = targets.map((file): AttachmentReference => {
            let state: AttachmentState = "move";
            if (bundle && file.path.startsWith(`${bundle.path}/`)) state = "inside";
            else if (
                // Extension exclusions apply only to full collection.
                // Another bundle's primary is protected in both full and new-attachment collection.
                (scope.kind === "all" && this.getExcludedExtensions().includes(file.extension)) ||
                getNotebundleIfPrimaryNote(file)
            )
                state = "note";
            else if (sharedFiles.has(file)) state = "shared";
            return { file, path: file.path, state };
        });
        return { notePath, noteMtime, bundle, entries, complete };
    }

    private findSharedReferences(
        notePath: string,
        targets: readonly TFile[],
        bundle: TFolder | null,
    ): Set<TFile> {
        const sharedFiles = new Set<TFile>();
        if (!targets.some((file) => !bundle || !file.path.startsWith(`${bundle.path}/`)))
            return sharedFiles;

        for (const [source, links] of Object.entries(this.app.metadataCache.resolvedLinks)) {
            if (source === notePath) continue;
            for (const target of targets) {
                if ((links[target.path] ?? 0) > 0) sharedFiles.add(target);
            }
        }
        return sharedFiles;
    }

    public async review(
        note: TFile,
        scope: ReferenceScope = { kind: "all" },
    ): Promise<AttachmentReview> {
        const analysis = await this.analyze(note, scope);
        if (note.path !== analysis.notePath || note.stat.mtime !== analysis.noteMtime)
            throw new NotebundleReviewChangedError();
        const bundlePath =
            analysis.bundle?.path ??
            getAvailableNotebundlePath(note.parent ?? this.app.vault.getRoot(), note.basename);
        const reserved = new Set<string>();
        const entries = analysis.entries.map((entry): AttachmentEntry => {
            const to =
                entry.state === "move"
                    ? this.getAvailableAttachmentPath(
                          entry.file,
                          `${bundlePath}/attachments`,
                          reserved,
                      )
                    : entry.path;
            reserved.add(to);
            return { ...entry, to };
        });
        return {
            note,
            notePath: analysis.notePath,
            noteMtime: analysis.noteMtime,
            bundlePath,
            entries,
            complete: analysis.complete,
        };
    }

    public async reviewForCollection(note: TFile): Promise<AttachmentReview> {
        if (note.extension !== "md") return this.review(note);

        let resolveChanged = (): void => {};
        let cancelled = false;
        const cancel = (): void => {
            cancelled = true;
            resolveChanged();
        };
        const unsubscribe = this.onChanged((changed) => {
            if (changed === note || changed === null) resolveChanged();
        });
        const deleted = this.app.vault.on("delete", (file) => {
            if (file === note) cancel();
        });
        this.collectionWaiters.add(cancel);
        try {
            while (!cancelled) {
                // Subscribe before reading so a cache update during the read is not missed.
                const changed = new Promise<void>((resolve) => {
                    resolveChanged = resolve;
                });
                const review = await this.review(note);
                if (review.complete && !cancelled) return review;
                await changed;
            }
            throw new NotebundleReviewChangedError();
        } finally {
            unsubscribe();
            this.app.vault.offref(deleted);
            this.collectionWaiters.delete(cancel);
        }
    }

    public async validateReview(
        review: AttachmentReview,
        selected: readonly TFile[],
    ): Promise<AttachmentReview> {
        if (review.note.path !== review.notePath || review.note.stat.mtime !== review.noteMtime)
            throw new Error(t("operation.review_changed"));
        const latest = await this.review(review.note);
        if (review.bundlePath !== latest.bundlePath) throw new Error(t("operation.review_changed"));
        for (const file of selected) {
            const before = review.entries.find((entry) => entry.file === file);
            const now = latest.entries.find((entry) => entry.file === file);
            if (
                !before ||
                !now ||
                before.path !== file.path ||
                now.state !== "move" ||
                before.to !== now.to
            ) {
                throw new Error(t("operation.review_changed"));
            }
        }
        return latest;
    }

    private getAvailableAttachmentPath(file: TFile, folder: string, reserved: Set<string>): string {
        const extension = file.extension ? `.${file.extension}` : "";
        let to = `${folder}/${file.name}`;
        let i = 1;
        while (reserved.has(to) || this.app.vault.getAbstractFileByPath(to))
            to = `${folder}/${file.basename} ${i++}${extension}`;
        return to;
    }
}
