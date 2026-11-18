import { Notice } from "obsidian";

import type { NotebundleInspection } from "../notebundle";
import { t } from "../i18n";

type InvalidNotebundleInspection = Extract<NotebundleInspection, { kind: "invalid" }>;

// prevent duplicate notice spam
let issueNotice: Notice | null = null;
let issueNoticeKey = "";

export function describeNotebundleIssues(inspection: InvalidNotebundleInspection): string {
    return inspection.issues
        .map((issue) => {
            switch (issue.type) {
                case "missing-primary-note":
                    return t("issues.no_primary_note_found_summary");
                case "multiple-primary-notes":
                    return t("issues.multiple_primary_notes_found_summary");
                case "empty-name":
                    console.error("obsidian-notebundle: empty-name bundle", inspection);
                    return "";
            }
        })
        .join("\n");
}

function getIssueNoticeKey(inspection: InvalidNotebundleInspection): string {
    return JSON.stringify([
        inspection.folder.path,
        inspection.issues.map((issue) => {
            switch (issue.type) {
                case "empty-name":
                    return [issue.type];
                case "missing-primary-note":
                    return [issue.type, [...issue.expectedCandidateNames].sort()];
                case "multiple-primary-notes":
                    return [issue.type, issue.candidates.map((file) => file.name).sort()];
            }
        }),
    ]);
}

function createIssueNoticeMessage(inspection: InvalidNotebundleInspection): DocumentFragment {
    const message = createFragment();
    message.createEl("strong", { text: inspection.folder.name });

    inspection.issues.forEach((issue) => {
        switch (issue.type) {
            case "missing-primary-note": {
                message.createEl("p", { text: t("issues.no_primary_note_found_summary") });
                const list = message.createEl("ul");
                issue.expectedCandidateNames.forEach((name) => list.createEl("li", { text: name }));
                break;
            }
            case "multiple-primary-notes": {
                message.createEl("p", { text: t("issues.multiple_primary_notes_found_summary") });
                const list = message.createEl("ul");
                issue.candidates.forEach((file) => list.createEl("li", { text: file.name }));
                break;
            }
        }
    });

    return message;
}

export function showNotebundleIssues(inspection: InvalidNotebundleInspection): void {
    const key = getIssueNoticeKey(inspection);
    if (
        issueNoticeKey === key &&
        issueNotice?.containerEl.isConnected &&
        issueNotice.containerEl.ownerDocument === activeDocument
    ) {
        return;
    }
    const message = createIssueNoticeMessage(inspection);
    issueNotice?.hide();
    issueNotice = new Notice(message, 10000);
    issueNoticeKey = key;
}
