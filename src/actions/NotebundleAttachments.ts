import { TFolder } from "obsidian";
import type { App, TFile } from "obsidian";

import { getNotebundleIfPrimaryNote } from "../notebundle";
import { t } from "../i18n";
import type { AttachmentEntry, AttachmentItemResult } from "./NotebundleOperation";

export async function moveAttachments(
    app: App,
    entries: readonly AttachmentEntry[],
    bundle: TFolder,
    note: TFile,
): Promise<AttachmentItemResult[]> {
    const items: AttachmentItemResult[] = [];
    const bundlePath = bundle.path;
    const attachmentsPath = `${bundlePath}/attachments`;
    for (const entry of entries) {
        const { file, path: from, to } = entry;
        if (entry.state !== "move") {
            items.push({ file, from, to: file.path, status: entry.state });
            continue;
        }
        try {
            if (file.path !== from || app.vault.getAbstractFileByPath(from) !== file)
                throw new Error(t("operation.review_changed"));
            if (bundle.path !== bundlePath || getNotebundleIfPrimaryNote(note)?.folder !== bundle)
                throw new Error(t("operation.bundle_changed"));
            const folder = app.vault.getAbstractFileByPath(attachmentsPath);
            if (!folder) await app.vault.createFolder(attachmentsPath);
            else if (!(folder instanceof TFolder)) {
                throw new Error(t("operation.attachments_path_is_file", { path: attachmentsPath }));
            }
            // Creating the attachments folder may await, so recheck before moving the file.
            if (
                bundle.path !== bundlePath ||
                file.path !== from ||
                app.vault.getAbstractFileByPath(from) !== file ||
                getNotebundleIfPrimaryNote(note)?.folder !== bundle
            )
                throw new Error(t("operation.bundle_changed"));
            if (app.vault.getAbstractFileByPath(to))
                throw new Error(t("rename.destination_already_exists", { path: to }));
            await app.fileManager.renameFile(file, to);
            items.push({ file, from, to, status: "moved" });
        } catch (error) {
            items.push({ file, from, to, status: "failed", error });
        }
    }
    return items;
}

export async function removeEmptySourceFolders(
    app: App,
    parent: TFolder,
    basename: string,
    items: readonly AttachmentItemResult[],
): Promise<void> {
    const sourceFolders = new Set<TFolder>();
    for (const root of parent.children) {
        if (!(root instanceof TFolder)) continue;
        const name = `${basename}-attachments`;
        if (
            root.name !== name &&
            !(
                root.name.startsWith(`${name} `) &&
                /^[1-9]\d*$/.test(root.name.slice(name.length + 1))
            )
        ) {
            continue;
        }
        for (const item of items) {
            if (item.status !== "moved" || !item.from.startsWith(`${root.path}/`)) continue;
            let path = item.from.slice(0, item.from.lastIndexOf("/"));
            while (path === root.path || path.startsWith(`${root.path}/`)) {
                const folder = app.vault.getAbstractFileByPath(path);
                if (folder instanceof TFolder) sourceFolders.add(folder);
                if (path === root.path) break;
                path = path.slice(0, path.lastIndexOf("/"));
            }
        }
    }
    const deepestFirst = [...sourceFolders].sort((a, b) => b.path.length - a.path.length);
    for (const folder of deepestFirst) {
        if (app.vault.getAbstractFileByPath(folder.path) === folder && !folder.children.length)
            await app.fileManager.trashFile(folder);
    }
}
