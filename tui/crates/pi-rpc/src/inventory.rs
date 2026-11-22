//! What the wire carries: the inventory of event types, their fields and the assistant deltas.
//!
//! Everything here was taken from pi 1.5.0's own types
//! (`packages/coding-agent/src/core/agent-session.ts`, `modes/json-event.ts`,
//! `modes/rpc/rpc-types.ts`) and checked against the recorded corpus
//! (`.scratch/tui-rust/fixtures/`, recorded 2026-11-21). A field or type a later pi version adds is
//! caught by `tests/corpus.rs` the next time the fixtures are re-recorded — that is the point of
//! keeping the tables hand-written instead of generated from the fixtures.

/// Every `type` the host writes to stdout, with the fields it may carry.
///
/// `response` is the reply to a command (`id`, `command`, `success`, `data` or `error`);
/// `extension_ui_request` is an extension asking the client for something. Everything else is an
/// `AgentSessionEvent` as `modes/json-event.ts` serialises it.
pub const EVENT_KEYS: &[(&str, &[&str])] = &[
    ("agent_start", &["type"]),
    ("agent_end", &["type", "messages", "willRetry"]),
    ("agent_settled", &["type", "aborted"]),
    ("turn_start", &["type"]),
    ("turn_end", &["type", "message", "toolResults"]),
    ("message_start", &["type", "message"]),
    ("message_end", &["type", "message"]),
    ("message_update", &["type", "usage", "assistantMessageEvent"]),
    ("tool_execution_start", &["type", "toolCallId", "toolName", "args"]),
    ("tool_execution_update", &["type", "toolCallId", "toolName", "args", "partialResult"]),
    ("tool_execution_end", &["type", "toolCallId", "toolName", "result", "isError", "durationMs"]),
    ("queue_update", &["type", "steering", "followUp"]),
    ("entry_appended", &["type", "entry"]),
    ("session_info_changed", &["type", "name"]),
    ("thinking_level_changed", &["type", "level"]),
    ("compaction_start", &["type", "reason"]),
    ("compaction_end", &["type", "reason", "result", "aborted", "willRetry", "errorMessage"]),
    ("auto_retry_start", &["type", "attempt", "maxAttempts", "delayMs", "errorMessage"]),
    ("auto_retry_end", &["type", "success", "attempt", "finalError"]),
    ("summarization_retry_scheduled", &["type", "attempt", "maxAttempts", "delayMs", "errorMessage"]),
    ("summarization_retry_attempt_start", &["type", "source", "reason"]),
    ("summarization_retry_finished", &["type"]),
    ("bash_execution_update", &["type", "id", "delta"]),
    ("response", &["type", "id", "command", "success", "data", "error"]),
    (
        "extension_ui_request",
        &[
            "type",
            "id",
            "method",
            "title",
            "message",
            "notifyType",
            "options",
            "placeholder",
            "prefill",
            "statusKey",
            "statusText",
            "widgetKey",
            "widgetLines",
            "widgetPlacement",
            "text",
            "timeout",
        ],
    ),
];

/// The deltas inside `message_update.assistantMessageEvent`.
pub const ASSISTANT_EVENT_KEYS: &[(&str, &[&str])] = &[
    ("message_start", &["type"]),
    ("message_end", &["type"]),
    ("text_start", &["type", "contentIndex"]),
    ("text_delta", &["type", "contentIndex", "delta"]),
    ("text_end", &["type", "contentIndex", "content"]),
    ("thinking_start", &["type", "contentIndex"]),
    ("thinking_delta", &["type", "contentIndex", "delta"]),
    ("thinking_end", &["type", "contentIndex", "content"]),
    ("toolcall_start", &["type", "contentIndex", "id", "toolName"]),
    ("toolcall_delta", &["type", "contentIndex", "delta"]),
    ("toolcall_end", &["type", "contentIndex", "toolCall"]),
    ("error", &["type", "error"]),
];

/// The `method` values an `extension_ui_request` may carry: the whole of what RPC mode serves out of
/// `ExtensionUIContext`'s 27 members (`modes/rpc/rpc-mode.ts`).
pub const UI_METHODS: &[&str] = &[
    "select",
    "confirm",
    "input",
    "editor",
    "notify",
    "setStatus",
    "setWidget",
    "setTitle",
    "set_editor_text",
];

/// The methods the client must answer with `extension_ui_response`; the rest are fire-and-forget.
pub const UI_ANSWERS: &[&str] = &["select", "confirm", "input", "editor"];

pub fn event_fields(event_type: &str) -> Option<&'static [&'static str]> {
    EVENT_KEYS.iter().find(|(name, _)| *name == event_type).map(|(_, keys)| *keys)
}

pub fn assistant_event_fields(event_type: &str) -> Option<&'static [&'static str]> {
    ASSISTANT_EVENT_KEYS.iter().find(|(name, _)| *name == event_type).map(|(_, keys)| *keys)
}
