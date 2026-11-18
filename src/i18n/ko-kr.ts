import type { Messages } from "./en-us";

export const ko_kr = {
    "command.convert_current_note_to_notebundle": "현재 노트를 Notebundle로 변환",
    "command.unwrap_current_notebundle": "현재 Notebundle 해제",
    "menu.convert_to_notebundle": "Notebundle로 변환",
    "menu.show_notebundle_issues": "Notebundle 오류 확인",
    "menu.unwrap_notebundle": "Notebundle 해제",
    "notice.note_is_already_notebundle": "{file_name}는 이미 Notebundle입니다: {folder_name}",
    "settings.about_notebundle": "Notebundle (.notebundle)",
    "settings.notebundle_introduction":
        "Notebundle은 개별 텍스트 노트 파일과 첨부 파일을 각각의 `.notebundle` 폴더에 배치해 한 번에 관리하기 위한 파일 구조입니다.\n예시: `my-note.notebundle/` 내에 `my-note.md`, `attachments/`",
    "settings.open_convention_intro": "Notebundle Convention 설명서",
    "settings.obsidian_plugin_name": "Notebundle Plugin for Obsidian",
    "settings.plugin_repository": "플러그인 저장소",
    "settings.report_an_issue": "이슈 신고",
    "settings.automatic_notebundle_conversion": "Notebundle 자동 변환",
    "settings.automatic_conversion_is_disabled":
        "안내: **현재 자동 변환이 비활성화되어 있습니다.**",
    "settings.automatic_conversion_runs_when_attachment_is_added":
        "안내: **자동 변환은 노트에 새 첨부파일이 추가되었을 때 발생합니다.**",
    "settings.automatic_conversion_scope": "자동 변환 허용 위치",
    "settings.automatic_conversion_scope_description":
        "Vault 전체에서 자동 변환 기능을 활성화할지, 특정 위치에서만 활성화할지 지정합니다.",
    "settings.entire_vault": "Vault 전체",
    "settings.specific_locations": "특정 위치",
    "settings.automatically_convert_markdown_files": "Markdown 파일 자동 변환",
    "settings.automatically_convert_markdown_files_description":
        "Markdown (.md) 파일에 첨부파일이 추가된 경우 자동으로 변환합니다.",
    "settings.automatically_convert_canvas_files": "Canvas 파일 자동 변환",
    "settings.automatically_convert_canvas_files_description":
        "[EXPERIMENTAL] Canvas (.canvas) 파일에 첨부파일이 추가된 경우 자동으로 변환합니다.",
    "settings.file_naming_on_conversion": "변환 시 파일명",
    "settings.note_file_name_on_conversion": "변환 시 노트 파일명",
    "settings.note_file_name_on_conversion_description":
        "Notebundle 변환 시 내부 노트 파일의 명명 방식을 지정합니다.",
    "settings.keep_original_file_name": "원본 유지",
    "settings.conversion_examples": "변환 예시",
    "settings.original_file_label": "(변환 전)",
    "settings.adjust_obsidian_internal_behavior": "Obsidian 내부 동작 보정",
    "settings.adjust_obsidian_internal_behavior_description":
        "**보정 옵션들은 활성화해 두시는 것을 강력히 권장드립니다.**\n상대 경로 옵션은 노트 파일의 이식성을 높이고, 보관함 내에 중복 파일명의 첨부 파일이 존재할 경우 참조 링크가 불필요하게 장황해지는 것을 방지합니다.\n번들 분리 방지 옵션은 비활성화하실 경우 Obsidian에서 대부분의 경우에 notebundle 파일이 오히려 번거로움을 유발할 수 있습니다.",
    "settings.file_explorer": "파일 탐색기",
    "settings.use_relative_paths_for_notebundle_attachments":
        "Notebundle 내 첨부파일의 경로를 상대 경로로 보정",
    "settings.use_relative_paths_for_notebundle_attachments_description":
        "노트에서 해당 번들 내의 첨부 파일을 참조할 경우, Obsidian의 내부 링크 설정과 무관하게 자동으로 상대 경로(`./attachments/image.png`)를 적용합니다. (현재 Markdown에서만 작동)",
    "settings.move_notebundle_when_primary_note_is_moved": "메인 노트 파일 이동 시 번들 분리 방지",
    "settings.move_notebundle_when_primary_note_is_moved_description":
        "번들의 메인 노트 파일을 명령어나 컨텍스트 메뉴 등으로 이동시킬 때, 해당 메인 노트만 이동되어 번들이 분리되는 현상을 방지합니다. 개별 파일 조작이 필요하다면 번들을 해제해야 합니다.",
    "settings.enable_file_explorer_integration": "Obsidian 내부 파일 탐색기 지원 활성화",
    "settings.open_primary_note_when_notebundle_is_clicked":
        "Notebundle 항목 클릭 시 자동으로 노트 파일 열기",
    "settings.open_primary_note_when_notebundle_is_clicked_description":
        "Obsidian 파일 탐색기에서 notebundle 폴더를 클릭하면 자동으로 해당 번들의 노트 파일이 열립니다. 패키지 아이콘을 눌러 폴더를 열고 닫을 수 있습니다.",
    "settings.sort_notebundles_as_regular_files": "Notebundle을 일반 파일처럼 정렬하기",
    "settings.sort_notebundles_as_regular_files_description":
        "Obsidian 파일 탐색기에서 notebundle 항목을 일반 노트 파일처럼 정렬합니다.",
    "settings.folders_allowed_for_automatic_conversion": "자동 변환 허용 범위 목록",
    "settings.no_folders_registered": "등록된 폴더가 없습니다.",
    "settings.add_folder": "폴더 추가",
    "settings.search_and_select_folder": "폴더 선택...",
    "settings.folder_is_already_registered": "이미 등록된 폴더입니다.",
    "actions.folder_changed_try_again": "폴더가 변경되었습니다. 다시 시도하세요.",
    "rename.destination_already_exists": '"{path}"이(가) 이미 존재합니다.',
    "explorer.click_to_expand_folder": "클릭하여 폴더 펼치기",
    "explorer.click_to_collapse_folder": "클릭하여 폴더 접기",
    "explorer.click_to_open_primary_note": "클릭하여 메인 노트 열기",
    "explorer.integration_unavailable": "Notebundle: 파일 탐색기 통합을 활성화하지 못했습니다.",
    "explorer.sort_unavailable": "Notebundle: 번들 정렬 수정 옵션을 적용하지 못했습니다.",
    "issues.no_primary_note_found_summary": "메인 노트를 찾지 못했습니다.",
    "issues.multiple_primary_notes_found_summary": "메인 노트 후보가 여러 개 존재합니다.",
    "rename_sync.cannot_identify_primary_note_of_folder":
        "notebundle 파일명 동기화 실패: '{folder_name}'의 메인 노트를 식별할 수 없습니다",
    "rename_sync.could_not_synchronize_notebundle_name":
        "Notebundle 파일명을 동기화하지 못했습니다.",
    "rename_sync.could_not_restore_original_name":
        "파일명 동기화에 실패했으며 기존 파일명으로 되돌리지 못했습니다.",
    "move.correction_unavailable": "Notebundle: 번들 분리 방지 기능을 활성화하지 못했습니다.",
    "command.collect_attachments": "현재 notebundle의 첨부 파일 모으기",
    "operation.review_changed": "파일이나 참조가 변경되었습니다. 명령을 다시 시도하세요.",
    "operation.file_no_longer_exists": "대상 파일을 찾을 수 없습니다: {path}",
    "operation.bundle_changed": "처리 중 변경 사항이 발생했습니다. 다시 시도하세요.",
    "operation.attachments_path_is_file":
        "attachments가 폴더가 아닌 파일로 이미 존재합니다: {path}",
    "operation.failed": "작업을 완료하지 못했습니다.",
    "operation.origin_unavailable":
        "Notebundle: 첨부 파일 자동 수집 기능을 활성화하는 도중 내부 오류가 발생했습니다. 자동 수집 기능이 작동하지 않습니다.",
    "notice.attachments_collected": "첨부 {count}개를 이동했습니다.",
    "notice.collection_incomplete": "노트 파일을 분석하는 데 실패했습니다.",
    "notice.attachment_collection_unsupported": "첨부 파일 분석을 지원하지 않는 파일 형식입니다.",
    "rename.primary_candidate_conflict": "메인 노트 충돌이 발생합니다: {path}",
} satisfies Partial<Messages>;
