import { App, Component, TFile } from "obsidian";
import type { MetadataCache } from "obsidian";
import { around } from "monkey-around";

import { getNotebundleIfPrimaryNote } from "../notebundle";

export class NotebundleAttachmentLinkPatcher extends Component {
    private app: App;
    private getPatchSettingEnabled: () => boolean;

    public constructor(app: App, getPatchSettingEnabled: () => boolean) {
        super();

        this.app = app;
        this.getPatchSettingEnabled = getPatchSettingEnabled;
    }

    public override onload(): void {
        const interceptor = (
            file: TFile,
            sourcePath: string,
            omitMdExtension: boolean,
            passthrough: () => string,
        ): string => {
            return this.interceptFileToLinktext(file, sourcePath, omitMdExtension, passthrough);
        };

        this.register(
            around(this.app.metadataCache, {
                fileToLinktext: (nextFileToLinktext) =>
                    function (
                        this: MetadataCache,
                        file: TFile,
                        sourcePath: string,
                        omitMdExtension = true,
                    ): string {
                        return interceptor(file, sourcePath, omitMdExtension, () =>
                            nextFileToLinktext.call(this, file, sourcePath, omitMdExtension),
                        );
                    },
            }),
        );
    }

    private interceptFileToLinktext(
        file: TFile,
        sourcePath: string,
        omitMdExtension: boolean,
        passthrough: () => string,
    ): string {
        if (this.getPatchSettingEnabled() === false) return passthrough();

        const note = this.app.vault.getAbstractFileByPath(sourcePath);

        if (!(note instanceof TFile)) return passthrough();
        if (note.extension !== "md") return passthrough();

        const bundle = getNotebundleIfPrimaryNote(note);
        if (bundle === null) return passthrough();

        const bundlePrefix = `${bundle.folder.path}/`;
        const attachmentsPrefix = `${bundlePrefix}attachments/`;

        const isInsideAttachments = file.path.startsWith(attachmentsPrefix);

        if (isInsideAttachments === false) return passthrough();

        return this.getRelativeAttachmentLinktext(file, bundlePrefix, omitMdExtension);
    }

    private getRelativeAttachmentLinktext(
        file: TFile,
        bundlePrefix: string,
        omitMdExtension: boolean,
    ): string {
        const relativePath = file.path.replace(bundlePrefix, "./");

        if (file.extension === "md" && omitMdExtension) {
            const extensionLength = ".md".length;
            const pathWithoutExtension = relativePath.slice(
                0,
                relativePath.length - extensionLength,
            );

            return pathWithoutExtension;
        }

        return relativePath;
    }
}
