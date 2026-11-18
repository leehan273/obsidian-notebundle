import { App, Component } from "obsidian";
import type { DataWriteOptions, TFile, TFolder, Vault } from "obsidian";
import { around } from "monkey-around";

interface AttachmentVault extends Vault {
    getAvailablePathForAttachments(
        name: string,
        extension: string,
        source: TFile | null,
    ): Promise<string>;
}

export interface AttachmentApp extends App {
    vault: AttachmentVault;
    saveAttachment(name: string, extension: string, data: ArrayBuffer): Promise<TFile>;
    importAttachments(files: readonly unknown[], folder: TFolder | null): Promise<TFile[]>;
    importDirectory(path: string, name: string, folder: TFolder | null): Promise<TFolder | null>;
}

interface AttachmentOrigin {
    readonly note: TFile | null;
    readonly onCreated?: (file: TFile) => void;
}

interface PathRequest {
    readonly note: TFile | null;
    readonly createdAt: number;
    readonly ambiguous: boolean;
}

export class AttachmentStorageObserver extends Component {
    private readonly requestsByPath = new Map<string, PathRequest>();
    private synchronousOrigin: AttachmentOrigin | null = null;
    private callingNativeSave = false;
    private listening = false;

    public constructor(
        private readonly app: AttachmentApp,
        private readonly onCreated: (note: TFile, attachment: TFile) => void,
    ) {
        super();
    }

    public override onload(): void {
        this.listening = true;
        const getOrigin = () => this.synchronousOrigin;
        const withOrigin = this.withOrigin.bind(this);
        const runNativeSave = this.runNativeSave.bind(this);
        const recordCreatedAttachment = this.recordCreatedAttachment.bind(this);
        const observePathRequest = this.observePathRequest.bind(this);
        const observeBinaryCreation = this.observeBinaryCreation.bind(this);
        this.register(
            around(this.app, {
                saveAttachment: (next) =>
                    async function (
                        this: AttachmentApp,
                        name: string,
                        extension: string,
                        data: ArrayBuffer,
                    ): Promise<TFile> {
                        const origin = getOrigin() ?? { note: this.workspace.getActiveFile() };
                        const file = await runNativeSave(() =>
                            next.call(this, name, extension, data),
                        );
                        recordCreatedAttachment(origin, file);
                        return file;
                    },
                importAttachments: (next) =>
                    function (
                        this: AttachmentApp,
                        files: readonly unknown[],
                        folder: TFolder | null,
                    ): Promise<TFile[]> {
                        const origin = getOrigin();
                        if (!origin) return next.call(this, files, folder);

                        // Keep this import's origin for later saves without replacing app.saveAttachment.
                        const saveAttachment = this.saveAttachment.bind(this);
                        const importer = Object.create(this) as AttachmentApp;
                        importer.saveAttachment = (name, extension, data) =>
                            withOrigin(origin, () => saveAttachment(name, extension, data));
                        importer.importDirectory = this.importDirectory.bind(this);
                        return next.call(importer, files, folder);
                    },
            }),
        );
        this.register(
            around(this.app.vault, {
                getAvailablePathForAttachments: (next) =>
                    function (
                        this: AttachmentVault,
                        name: string,
                        extension: string,
                        source: TFile | null,
                    ): Promise<string> {
                        return observePathRequest(source, () =>
                            next.call(this, name, extension, source),
                        );
                    },
                createBinary: (next) =>
                    function (
                        this: Vault,
                        path: string,
                        data: ArrayBuffer,
                        options?: DataWriteOptions,
                    ): Promise<TFile> {
                        return observeBinaryCreation(path, () =>
                            next.call(this, path, data, options),
                        );
                    },
            }),
        );
    }

    public override onunload(): void {
        this.listening = false;
        this.requestsByPath.clear();
    }

    public withOrigin<T>(origin: AttachmentOrigin, next: () => T): T {
        // Scope the origin to this synchronous call; keeping it across await would mix concurrent inputs.
        const previous = this.synchronousOrigin;
        this.synchronousOrigin = origin;
        try {
            return next();
        } finally {
            this.synchronousOrigin = previous;
        }
    }

    private recordCreatedAttachment(origin: AttachmentOrigin, file: TFile): void {
        if (
            !this.listening ||
            !origin.note ||
            this.app.vault.getAbstractFileByPath(origin.note.path) !== origin.note
        )
            return;
        if (origin.onCreated) origin.onCreated(file);
        else this.onCreated(origin.note, file);
    }

    private runNativeSave(next: () => Promise<TFile>): Promise<TFile> {
        // Suppress the synchronous path-request attribution; saveAttachment reports the result itself.
        const previous = this.callingNativeSave;
        this.callingNativeSave = true;
        try {
            return next();
        } finally {
            this.callingNativeSave = previous;
        }
    }

    private async observePathRequest(
        source: TFile | null,
        next: () => Promise<string>,
    ): Promise<string> {
        const note = this.callingNativeSave ? null : source;
        const path = await next();
        this.removeExpiredRequests();
        if (!this.listening || this.app.vault.getAbstractFileByPath(path)) return path;
        const previous = this.requestsByPath.get(path);
        this.requestsByPath.set(path, {
            note,
            createdAt: Date.now(),
            ambiguous: previous !== undefined,
        });
        return path;
    }

    private async observeBinaryCreation(path: string, next: () => Promise<TFile>): Promise<TFile> {
        this.removeExpiredRequests();
        const request = this.requestsByPath.get(path);
        this.requestsByPath.delete(path);
        const file = await next();
        if (request?.note && !request.ambiguous)
            this.recordCreatedAttachment({ note: request.note }, file);
        return file;
    }

    private removeExpiredRequests(): void {
        const now = Date.now();
        this.requestsByPath.forEach((request, path) => {
            if (now - request.createdAt > 60_000) this.requestsByPath.delete(path);
        });
    }
}
