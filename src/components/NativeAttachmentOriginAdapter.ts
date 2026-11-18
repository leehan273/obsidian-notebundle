import { App, Component, MarkdownView, TFile } from "obsidian";
import { around } from "monkey-around";

import { AttachmentStorageObserver } from "./AttachmentStorageObserver";
import type { AttachmentApp } from "./AttachmentStorageObserver";

interface ClipboardManager {
    info: { file: TFile | null };
    saveAttachment(
        name: string,
        extension: string,
        data: ArrayBuffer,
        multiple: boolean,
    ): Promise<void>;
    insertAttachmentEmbed(file: TFile, multiple: boolean): void;
}
interface Canvas {
    view: { file: TFile | null };
    importFileNodes(files: readonly unknown[], position: unknown): Promise<void>;
}
interface Origin {
    readonly note: TFile | null;
    readonly clipboardManager: ClipboardManager;
}

export class NativeAttachmentOriginAdapter extends Component {
    private readonly originsAwaitingEmbed = new WeakMap<TFile, Origin>();
    private readonly inputPatches = new Map<ClipboardManager | Canvas, () => void>();
    private storage!: AttachmentStorageObserver;
    private listening = false;

    public constructor(
        private readonly app: App,
        private readonly onCreated: (note: TFile, attachment: TFile) => void,
        private readonly onUnavailable: () => void,
    ) {
        super();
    }

    public override onload(): void {
        this.listening = true;
        const app = this.app as AttachmentApp;
        if (
            typeof app.saveAttachment !== "function" ||
            typeof app.importAttachments !== "function" ||
            typeof app.vault.getAvailablePathForAttachments !== "function"
        ) {
            this.onUnavailable();
            return;
        }
        this.storage = this.addChild(new AttachmentStorageObserver(app, this.onCreated));
        this.app.workspace.onLayoutReady(() => {
            if (this.listening) this.syncInputPatches();
        });
        this.registerEvent(this.app.workspace.on("layout-change", () => this.syncInputPatches()));
        this.registerEvent(this.app.workspace.on("file-open", () => this.syncInputPatches()));
        this.registerEvent(this.app.workspace.on("editor-paste", () => this.syncInputPatches()));
        this.registerEvent(this.app.workspace.on("editor-drop", () => this.syncInputPatches()));
    }

    public override onunload(): void {
        this.listening = false;
        this.inputPatches.forEach((remove) => remove());
        this.inputPatches.clear();
    }

    private syncInputPatches(): void {
        const retained = new Set<ClipboardManager | Canvas>();
        for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
            if (!(leaf.view instanceof MarkdownView)) continue;
            const view = leaf.view as MarkdownView & {
                editMode?: { clipboardManager?: ClipboardManager };
            };
            const manager = view.editMode?.clipboardManager;
            if (
                !manager ||
                typeof manager.saveAttachment !== "function" ||
                typeof manager.insertAttachmentEmbed !== "function"
            )
                continue;
            retained.add(manager);
            if (this.inputPatches.has(manager)) continue;
            this.inputPatches.set(manager, this.patchClipboardManager(manager));
        }
        for (const leaf of this.app.workspace.getLeavesOfType("canvas")) {
            const canvas = (leaf.view as { canvas?: Canvas }).canvas;
            if (!canvas || typeof canvas.importFileNodes !== "function") continue;
            retained.add(canvas);
            if (this.inputPatches.has(canvas)) continue;
            this.inputPatches.set(canvas, this.patchCanvas(canvas));
        }
        this.inputPatches.forEach((remove, input) => {
            if (!retained.has(input)) {
                remove();
                this.inputPatches.delete(input);
            }
        });
    }

    private patchCanvas(canvas: Canvas): () => void {
        const withOrigin = this.storage.withOrigin.bind(this.storage);
        return around(canvas, {
            importFileNodes: (next) =>
                function (
                    this: Canvas,
                    files: readonly unknown[],
                    position: unknown,
                ): Promise<void> {
                    return withOrigin({ note: this.view.file }, () =>
                        next.call(this, files, position),
                    );
                },
        });
    }

    private patchClipboardManager(manager: ClipboardManager): () => void {
        const withOrigin = this.storage.withOrigin.bind(this.storage);
        const originsAwaitingEmbed = this.originsAwaitingEmbed;
        const confirmEmbedOrigin = (
            manager: ClipboardManager,
            file: TFile,
            next: () => void,
        ): void => {
            const origin = this.originsAwaitingEmbed.get(file);
            this.originsAwaitingEmbed.delete(file);
            const target = manager.info.file;
            next();
            // A saved clipboard file is a candidate only after insertion into the same originating note.
            if (
                this.listening &&
                origin?.clipboardManager === manager &&
                origin.note === target &&
                manager.info.file === target &&
                target
            ) {
                this.onCreated(target, file);
            }
        };
        return around(manager, {
            saveAttachment: (next) =>
                function (
                    this: ClipboardManager,
                    name: string,
                    extension: string,
                    data: ArrayBuffer,
                    multiple: boolean,
                ): Promise<void> {
                    const origin = { note: this.info.file, clipboardManager: this };
                    return withOrigin(
                        {
                            note: origin.note,
                            onCreated: (file) => originsAwaitingEmbed.set(file, origin),
                        },
                        () => next.call(this, name, extension, data, multiple),
                    );
                },
            insertAttachmentEmbed: (next) =>
                function (this: ClipboardManager, file: TFile, multiple: boolean): void {
                    confirmEmbedOrigin(this, file, () => next.call(this, file, multiple));
                },
        });
    }
}
