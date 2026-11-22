//! `pi-rpc`: the wire between the Rust TUI client and `pi --mode rpc`.
//!
//! The host writes one JSON object per line on stdout: a `response` to a command, an
//! `extension_ui_request` from an extension, or an `AgentSessionEvent`. The client writes commands the
//! same way and answers extension requests with `extension_ui_response`.
//!
//! This crate owns three things and nothing else:
//!
//! 1. **The inventory** ([`inventory`]) — every event type, its fields and the assistant deltas, kept
//!    by hand so that a change in pi shows up as a failing test rather than a silent misrender.
//! 2. **Validation** ([`problems`]) — checks one parsed line against the inventory.
//! 3. **Framing** ([`write_command`], [`read_line`]) — newline-delimited JSON, no transport assumption
//!    beyond a pair of pipes, so a socket is a later transport rather than a rewrite.
//!
//! What is deliberately absent: typed payloads for every event. The client renders from the events it
//! needs and the corpus pins their shape; a full serde model of `AgentMessage` would be a second copy
//! of pi's schema to maintain for no test.

pub mod inventory;

use std::io::{BufRead, Write};

use serde_json::Value;

/// One line of the protocol.
#[derive(Debug, Clone, PartialEq)]
pub enum Line {
    /// A reply to a command: `{"type":"response","command":...,"success":...}`.
    Response(Value),
    /// An extension asking the client for something: `{"type":"extension_ui_request",...}`.
    UiRequest(Value),
    /// An `AgentSessionEvent`.
    Event(Value),
    /// A line this crate does not know — reported, never dropped silently by the caller's choice.
    Unknown(Value),
}

impl Line {
    pub fn parse(value: Value) -> Line {
        match value.get("type").and_then(Value::as_str) {
            Some("response") => Line::Response(value),
            Some("extension_ui_request") => Line::UiRequest(value),
            Some(other) if inventory::event_fields(other).is_some() => Line::Event(value),
            _ => Line::Unknown(value),
        }
    }

    pub fn value(&self) -> &Value {
        match self {
            Line::Response(v) | Line::UiRequest(v) | Line::Event(v) | Line::Unknown(v) => v,
        }
    }

    /// The command an extension request needs answered, or `None` for a fire-and-forget method.
    pub fn answer_for(&self) -> Option<String> {
        let request = self.value();
        if request.get("type").and_then(Value::as_str) != Some("extension_ui_request") {
            return None;
        }
        let method = request.get("method").and_then(Value::as_str)?;
        let id = request.get("id").and_then(Value::as_str)?;
        inventory::UI_ANSWERS.contains(&method).then(|| id.to_string())
    }
}

/// One problem found in a line: what the client cannot interpret.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Problem {
    /// A line that is not a JSON object.
    NotAnObject,
    /// An object without a `type`.
    NoType,
    /// A `type` the inventory does not know.
    UnknownType(String),
    /// A field the inventory does not have for that type.
    UnknownField { of: String, field: String },
    /// An `extension_ui_request` whose `method` is not one RPC mode serves.
    UnknownMethod(String),
    /// A `message_update` without a usable `assistantMessageEvent`, or with an unknown one.
    BadAssistantEvent(String),
    /// An unknown field on the assistant delta inside a `message_update`.
    UnknownAssistantField { of: String, field: String },
}

impl std::fmt::Display for Problem {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Problem::NotAnObject => write!(f, "the line is not a JSON object"),
            Problem::NoType => write!(f, "the object has no \"type\""),
            Problem::UnknownType(t) => write!(f, "unknown event type {t:?}"),
            Problem::UnknownField { of, field } => write!(f, "{of:?} has an unknown field {field:?}"),
            Problem::UnknownMethod(m) => write!(f, "unknown extension_ui_request method {m:?}"),
            Problem::BadAssistantEvent(t) => write!(f, "unusable assistantMessageEvent {t:?}"),
            Problem::UnknownAssistantField { of, field } => {
                write!(f, "assistant event {of:?} has an unknown field {field:?}")
            }
        }
    }
}

/// Every problem in one parsed line. An empty vector means the client can interpret all of it.
pub fn problems(value: &Value) -> Vec<Problem> {
    let Value::Object(object) = value else {
        return vec![Problem::NotAnObject];
    };
    let Some(Value::String(event_type)) = object.get("type") else {
        return vec![Problem::NoType];
    };
    let mut found = Vec::new();
    let Some(fields) = inventory::event_fields(event_type) else {
        return vec![Problem::UnknownType(event_type.clone())];
    };
    for key in object.keys() {
        if !fields.contains(&key.as_str()) {
            found.push(Problem::UnknownField { of: event_type.clone(), field: key.clone() });
        }
    }
    if event_type == "extension_ui_request" {
        match object.get("method").and_then(Value::as_str) {
            Some(method) if inventory::UI_METHODS.contains(&method) => {}
            other => found.push(Problem::UnknownMethod(other.unwrap_or("<missing>").to_string())),
        }
    }
    if event_type == "message_update" {
        found.extend(assistant_problems(object));
    }
    found
}

fn assistant_problems(object: &serde_json::Map<String, Value>) -> Vec<Problem> {
    let mut found = Vec::new();
    let Some(delta) = object.get("assistantMessageEvent").and_then(Value::as_object) else {
        return vec![Problem::BadAssistantEvent("<missing>".to_string())];
    };
    let Some(Value::String(kind)) = delta.get("type") else {
        return vec![Problem::BadAssistantEvent("<missing type>".to_string())];
    };
    let Some(fields) = inventory::assistant_event_fields(kind) else {
        return vec![Problem::BadAssistantEvent(kind.clone())];
    };
    for key in delta.keys() {
        if !fields.contains(&key.as_str()) {
            found.push(Problem::UnknownAssistantField { of: kind.clone(), field: key.clone() });
        }
    }
    found
}

/// Write one command (or one `extension_ui_response`) as a line, flushed: the host reads by line.
pub fn write_command(writer: &mut impl Write, value: &Value) -> std::io::Result<()> {
    serde_json::to_writer(&mut *writer, value)?;
    writer.write_all(b"\n")?;
    writer.flush()
}

/// Read one line and parse it; `Ok(None)` at end of stream.
pub fn read_line(reader: &mut impl BufRead) -> std::io::Result<Option<Value>> {
    let mut line = String::new();
    if reader.read_line(&mut line)? == 0 {
        return Ok(None);
    }
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    serde_json::from_str(trimmed)
        .map(Some)
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn classifies_the_three_kinds_of_line() {
        assert!(matches!(Line::parse(json!({"type":"response","command":"prompt","success":true})), Line::Response(_)));
        assert!(matches!(
            Line::parse(json!({"type":"extension_ui_request","id":"1","method":"notify","message":"hi"})),
            Line::UiRequest(_)
        ));
        assert!(matches!(Line::parse(json!({"type":"message_update","usage":{},"assistantMessageEvent":{"type":"text_delta","contentIndex":0,"delta":"x"}})), Line::Event(_)));
        assert!(matches!(Line::parse(json!({"type":"something_new"})), Line::Unknown(_)));
    }

    #[test]
    fn only_dialogs_need_an_answer() {
        let select = Line::parse(json!({"type":"extension_ui_request","id":"abc","method":"select","title":"t","options":["a"]}));
        assert_eq!(select.answer_for().as_deref(), Some("abc"));
        let notify = Line::parse(json!({"type":"extension_ui_request","id":"abc","method":"notify","message":"m"}));
        assert_eq!(notify.answer_for(), None);
    }

    #[test]
    fn reports_what_the_inventory_does_not_know() {
        assert_eq!(problems(&json!({"type":"message_end","message":{},"extra":1})), vec![Problem::UnknownField {
            of: "message_end".to_string(),
            field: "extra".to_string()
        }]);
        assert_eq!(problems(&json!({"type":"nope"})), vec![Problem::UnknownType("nope".to_string())]);
        assert_eq!(
            problems(&json!({"type":"extension_ui_request","id":"1","method":"custom"})),
            vec![Problem::UnknownMethod("custom".to_string())]
        );
        assert_eq!(
            problems(&json!({"type":"message_update","usage":{},"assistantMessageEvent":{"type":"text_delta","contentIndex":0,"delta":"x","partial":{}}})),
            vec![Problem::UnknownAssistantField { of: "text_delta".to_string(), field: "partial".to_string() }]
        );
    }

    #[test]
    fn framing_round_trips_one_line() {
        let mut buffer = Vec::new();
        write_command(&mut buffer, &json!({"id":"1","type":"get_state"})).unwrap();
        let mut reader = std::io::BufReader::new(&buffer[..]);
        assert_eq!(read_line(&mut reader).unwrap(), Some(json!({"id":"1","type":"get_state"})));
        assert_eq!(read_line(&mut reader).unwrap(), None);
    }
}
