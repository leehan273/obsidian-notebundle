import { App, Component, TFile } from "obsidian";

import type { NotebundlePluginSettings } from "../settings";
import type { NotebundleActions } from "../actions/NotebundleActions";
import { getNotebundleIfPrimaryNote } from "../notebundle";
import { NativeAttachmentOriginAdapter } from "./NativeAttachmentOriginAdapter";
import { t } from "../i18n";
import { reportNotebundleResult, showNotebundleError } from "../ui/NotebundleNotice";

interface AttachmentCollection {
    pending: Map<TFile, { readonly expiresAt: number }> | null;
    running: boolean;
    collectionRequested: boolean;
    expiryTimer: number | null;
}

// Unresolved candidates retain lifetime
const CANDIDATE_LIFETIME_MS = 60_000;

export class NotebundleAttachmentsHandler extends Component {
    private readonly collections = new Map<TFile, AttachmentCollection>();

    public constructor(
        private readonly app: App,
        private readonly actions: NotebundleActions,
        private readonly getSettings: () => NotebundlePluginSettings,
    ) {
        super();
    }

    public override onload(): void {
        this.addChild(
            new NativeAttachmentOriginAdapter(
                this.app,
                (note, file) => this.recordCreatedAttachment(note, file),
                () => showNotebundleError(t("operation.origin_unavailable")),
            ),
        );
        this.register(
            this.actions.onReferencesChanged((note) => {
                if (note) this.requestCollection(note);
                else
                    for (const pendingNote of this.collections.keys())
                        this.requestCollection(pendingNote);
            }),
        );
        this.registerEvent(
            this.app.vault.on("delete", (file) => {
                if (!(file instanceof TFile)) return;
                const collection = this.collections.get(file);
                if (collection) this.clearPending(file, collection);
                for (const [note, collection] of this.collections) {
                    collection.pending?.delete(file);
                    if (collection.pending?.size === 0) this.clearPending(note, collection);
                }
            }),
        );
    }

    public override onunload(): void {
        for (const [note, collection] of this.collections) {
            collection.collectionRequested = false;
            this.clearPending(note, collection);
        }
    }

    private recordCreatedAttachment(note: TFile, file: TFile): void {
        if (!this.canCollectForNote(note)) return;
        const bundle = getNotebundleIfPrimaryNote(note);
        if (bundle && file.path.startsWith(`${bundle.folder.path}/`)) return;
        let collection = this.collections.get(note);
        if (!collection) {
            collection = {
                pending: new Map(),
                running: false,
                collectionRequested: false,
                expiryTimer: null,
            };
            this.collections.set(note, collection);
        }
        collection.pending ??= new Map();
        if (!collection.pending.has(file))
            collection.pending.set(file, { expiresAt: Date.now() + CANDIDATE_LIFETIME_MS });
        this.requestCollection(note);
    }

    private requestCollection(note: TFile): void {
        const collection = this.collections.get(note);
        if (!collection?.pending) return;
        this.expirePending(note, collection);
        if (!collection.pending) return;
        collection.collectionRequested = true;
        if (collection.running) return;
        collection.running = true;
        void this.collectPending(note, collection);
    }

    private clearPending(note: TFile, collection: AttachmentCollection): void {
        if (collection.expiryTimer !== null) window.clearTimeout(collection.expiryTimer);
        collection.expiryTimer = null;
        collection.pending = null;

        if (!collection.running) this.collections.delete(note);
    }

    private async collectPending(note: TFile, collection: AttachmentCollection): Promise<void> {
        try {
            while (collection.collectionRequested) {
                collection.collectionRequested = false;
                const pending = collection.pending;
                if (!pending) return;
                if (
                    !this.canCollectForNote(note) ||
                    this.app.vault.getAbstractFileByPath(note.path) !== note
                ) {
                    this.clearPending(note, collection);
                    return;
                }
                const batch = new Map(pending);
                const files = [...batch.keys()];
                // An awaited operation must not collect a cleared, replaced, or expired candidate.
                const canCollect = (file: TFile): boolean => {
                    const candidate = batch.get(file)!;
                    return (
                        this.canCollectForNote(note) &&
                        collection.pending === pending &&
                        pending.get(file) === candidate &&
                        candidate.expiresAt > Date.now()
                    );
                };

                const { result, reviewedCandidates } = await this.actions.collectNewAttachments(
                    note,
                    this.getSettings().convert_primary_note_file_naming_rule,
                    files,
                    canCollect,
                );
                if (collection.pending === pending) {
                    const failed = "error" in result;
                    const completed =
                        failed && result.referencesComplete === undefined
                            ? files
                            : reviewedCandidates;
                    for (const file of completed) {
                        // Do not remove a new registration of the same file made while awaiting.
                        if (pending.get(file) === batch.get(file)) pending.delete(file);
                    }
                    this.expirePending(note, collection);
                }
                reportNotebundleResult(result);
            }
        } catch (error) {
            this.clearPending(note, collection);
            reportNotebundleResult({
                note,
                items: [],
                error,
            });
        } finally {
            collection.running = false;
            if (collection.collectionRequested && collection.pending) this.requestCollection(note);
            else {
                collection.collectionRequested = false;
                if (!collection.pending) this.collections.delete(note);
            }
        }
    }

    private expirePending(note: TFile, collection: AttachmentCollection): void {
        if (collection.expiryTimer !== null) window.clearTimeout(collection.expiryTimer);
        collection.expiryTimer = null;
        const pending = collection.pending;
        if (!pending) return;
        const now = Date.now();
        let nextExpiry = Infinity;
        for (const [file, candidate] of pending) {
            if (candidate.expiresAt <= now) pending.delete(file);
            else nextExpiry = Math.min(nextExpiry, candidate.expiresAt);
        }
        if (!pending.size) {
            this.clearPending(note, collection);
            return;
        }
        collection.expiryTimer = window.setTimeout(
            () => this.expirePending(note, collection),
            nextExpiry - now,
        );
    }

    private canCollectForNote(note: TFile): boolean {
        if (note.extension !== "md" && note.extension !== "canvas") return false;
        const settings = this.getSettings();
        if (getNotebundleIfPrimaryNote(note))
            return !settings.lab_disable_auto_collect_attachments_in_bundles;
        if (
            !(note.extension === "md"
                ? settings.auto_convert_markdown
                : settings.auto_convert_canvas)
        )
            return false;
        return (
            settings.auto_convert_scope === "vault-global" ||
            settings.auto_convert_whitelist_folders.some((folder) =>
                note.path.startsWith(`${folder}/`),
            )
        );
    }
}
