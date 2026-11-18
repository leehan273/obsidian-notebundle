import { Notice } from "obsidian";

import type { NotebundleOperationResult } from "../actions/NotebundleOperation";
import { NotebundleIssueError } from "../notebundle";
import { showNotebundleIssues } from "./NotebundleIssueNotice";
import { t } from "../i18n";

export function getNotebundleFailureMessage(result: NotebundleOperationResult): string {
    const messages: string[] = [];
    if (result.error !== undefined) messages.push(getOperationErrorMessage(result.error));
    for (const item of result.items) {
        if (item.status !== "failed") continue;
        if (result.error !== undefined && item.error === result.error) continue;
        const message = getOperationErrorMessage(item.error);
        messages.push(`${item.file.path}: ${message}`);
    }
    return messages.join("\n");
}

export function hasNotebundleFailures(result: NotebundleOperationResult): boolean {
    return result.error !== undefined || result.items.some((item) => item.status === "failed");
}

function getOperationErrorMessage(error: unknown): string {
    return error instanceof Error && error.message ? error.message : t("operation.failed");
}

export function reportNotebundleResult(result: NotebundleOperationResult): void {
    if (result.error instanceof NotebundleIssueError) {
        showNotebundleIssues(result.error.inspection);
        return;
    }
    const message = getNotebundleFailureMessage(result);
    if (message) new Notice(`${result.note.path}\n${message}`, 10000);
}

export function showNotebundleError(error: unknown): void {
    if (error instanceof NotebundleIssueError) {
        showNotebundleIssues(error.inspection);
        return;
    }
    const message =
        error instanceof Error
            ? error.message
            : typeof error === "string"
              ? error
              : t("operation.failed");
    new Notice(message);
}
