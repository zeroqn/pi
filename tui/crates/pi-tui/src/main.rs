//! `pi-tui` — the walking skeleton of the Rust client.
//!
//! Proves the seam, not the transcript: it spawns (or replays) a host, renders the assistant's text as
//! wrapped lines, owns the terminal, and echoes keystrokes **without waiting for the host**. Ticket 03
//! of `.scratch/tui-rust/map.md`; the bar it is measured against is `acceptance.md` C-1.
//!
//! Two rules shape the loop, and both come from measurements of pi's own TUI:
//!
//! 1. **A keystroke paints immediately.** Streaming frames are coalesced into a 16 ms budget, but an
//!    input event forces a frame at once — the composer is local, so its cost is the paint, not a
//!    round trip. C-1's target is p99 <= 2 ms, which no 16 ms cadence can reach.
//! 2. **Nothing on the paint thread blocks on the host.** The host's stdout is read on its own thread,
//!    its stdin written on another, and the loop only ever `try_recv`s.

// The shared modules live in the library (see `src/lib.rs`) so the benches and the binary use one
// implementation rather than two copies.
use pi_tui::completion;
use pi_tui::composer;
use pi_tui::keymap;
mod host;
mod model;
mod paint;
mod stats;
mod ui;
mod writer;

use std::io::Write;
use std::time::{Duration, Instant};

use crossterm::event::{self, Event, KeyCode, KeyEvent, KeyModifiers};
use crossterm::{cursor, execute, terminal};
use serde_json::{json, Value};

use host::Host;
use model::Transcript;
use completion::Completions;
use composer::Composer;
use keymap::Keymap;
use stats::Stats;
use ui::UiState;

const TICK: Duration = Duration::from_millis(16);
/// How many host lines are folded into one frame before painting regardless: a burst (a 400 KB tool
/// result) must not starve input, and must not hold the loop in the drain either.
const DRAIN_BUDGET: usize = 4_000;

struct Args {
    replay: Option<String>,
    pace_ms: u64,
    pi: Vec<String>,
    /// Flags the client does not own, handed to the host unchanged: `-c`, `-r`, `--session <id>`,
    /// `--session-id`, `-m <model>`, `--thinking …`. The host's own parser honours all of them in RPC
    /// mode (`pi/packages/coding-agent/src/cli/args.ts:111-142`), so the client only has to stop refusing
    /// them — which is what `pi -c` hit before ticket 14 (the client's `unknown argument` exit 2).
    forward: Vec<String>,
    stats: Option<String>,
    once: bool,
    repeat: usize,
}

/// The host command when `--pi` is not given: `PI_TUI_HOST` (a dev shell or the wrapper sets it), else `pi`
/// on PATH. A value may carry arguments (`"/nix/store/.../pi --mode rpc"`).
fn default_host() -> Vec<String> {
    std::env::var("PI_TUI_HOST")
        .ok()
        .map(|value| value.split_whitespace().map(str::to_string).collect::<Vec<String>>())
        .filter(|argv| !argv.is_empty())
        .unwrap_or_else(|| vec!["pi".into()])
}

fn parse_args() -> Args {
    let mut args = Args {
        replay: None,
        pace_ms: 2,
        pi: default_host(),
        forward: Vec::new(),
        stats: None,
        once: false,
        repeat: 1,
    };
    let mut argv = std::env::args().skip(1);
    while let Some(arg) = argv.next() {
        // Everything after `--` belongs to the host, whatever it is.
        if arg == "--" {
            args.forward.extend(argv);
            break;
        }
        match arg.as_str() {
            "--replay" => args.replay = argv.next(),
            "--pace-ms" => args.pace_ms = argv.next().and_then(|v| v.parse().ok()).unwrap_or(2),
            "--pi" => args.pi = argv.next().map(|v| v.split_whitespace().map(str::to_string).collect()).unwrap_or(args.pi),
            "--stats" => args.stats = argv.next(),
            "--repeat" => args.repeat = argv.next().and_then(|v| v.parse().ok()).unwrap_or(1),
            "--once" => args.once = true,
            "--help" | "-h" => {
                println!(
                    "pi-tui [--replay FIXTURE] [--pace-ms N] [--repeat N] [--pi 'CMD ARGS'] [--stats FILE] [--once]\n\n\
                     With no --replay, spawns the host (default `pi`) in RPC mode and talks to it.\n\
                     --stats writes one JSON line of frame and echo samples on exit.\n\
                     Any other argument is passed to the host unchanged (`-c`, `-r`, `--session <id>`, `-m <model>`)."
                );
                std::process::exit(0);
            }
            // Not the client's: the host's. `pi -c`, `pi --session <id>` and `pi -m <model>` are the
            // first act of a working day, and the host has always been able to serve them.
            other => args.forward.push(other.to_string()),
        }
    }
    // RPC mode is how the client speaks to a host; a command that already names a mode keeps it, so a
    // wrapper passing `--pi "pi --mode rpc"` is not given it twice.
    if args.replay.is_none() {
        let has_mode = args.pi.iter().any(|arg| arg == "--mode") || args.forward.iter().any(|arg| arg == "--mode");
        if !has_mode {
            args.pi.push("--mode".into());
            args.pi.push("rpc".into());
        }
        let forward = std::mem::take(&mut args.forward);
        args.pi.extend(forward);
    }
    args
}

/// Whether the client is running under a terminal multiplexer, from the same variables pi reads
/// (`tui-alt-screen.ts:373-385`).
fn multiplexer() -> bool {
    let term = std::env::var("TERM").unwrap_or_default();
    std::env::var("TMUX").is_ok()
        || std::env::var("ZELLIJ").is_ok()
        || std::env::var("STY").is_ok()
        || term.starts_with("screen")
        || term.starts_with("tmux")
}

/// The mouse-reporting sequences: 1000 (press/release), 1006 (SGR coordinates), and either 1002
/// (button-motion, a drag) or 1003 (all motion). `mux` picks pi's conservative pair.
fn mouse_on(mux: bool) -> &'static str {
    if mux {
        "\u{1b}[?1000h\u{1b}[?1002h\u{1b}[?1006h"
    } else {
        "\u{1b}[?1000h\u{1b}[?1003h\u{1b}[?1006h"
    }
}

fn mouse_off() -> &'static str {
    "\u{1b}[?1006l\u{1b}[?1003l\u{1b}[?1002l\u{1b}[?1000l"
}

/// Raw mode and the alternate screen, restored on every path out — including a panic, because a
/// terminal left in raw mode is worse than a crash.
struct Screen {
    active: bool,
}

impl Screen {
    fn enter() -> std::io::Result<Screen> {
        terminal::enable_raw_mode()?;
        execute!(
            std::io::stdout(),
            terminal::EnterAlternateScreen,
            cursor::Hide,
            // Without this a multi-line paste arrives as a stream of keys, and a newline in a paste
            // would submit the prompt mid-paste.
            event::EnableBracketedPaste
        )?;
        // Ticket 04 D1: the client takes the mouse, because native selection is gone once it does — and
        // it takes it in pi's **two modes** (`tui-alt-screen.ts:373-385`): all motion locally, so a drag
        // and a scrollbar are live; **button-motion only** under a multiplexer, because "multiplexers can
        // lag when every pointer movement is forwarded". crossterm's `EnableMouseCapture` turns on
        // 1000+1002+1003 always, so the sequence is written here instead.
        let mut out = std::io::stdout();
        write!(out, "{}", mouse_on(multiplexer()))?;
        // Ticket 10 D1: the kitty keyboard protocol, so escape, alt+enter and shift+enter are
        // distinguishable — ticket 02's follow-up chord needs it. Pushed on every enter and popped on
        // every leave, so a suspend and resume keeps the terminal's own state clean.
        execute!(
            out,
            event::PushKeyboardEnhancementFlags(
                event::KeyboardEnhancementFlags::DISAMBIGUATE_ESCAPE_CODES
                    | event::KeyboardEnhancementFlags::REPORT_EVENT_TYPES
            )
        )?;
        out.flush()?;
        Ok(Screen { active: true })
    }

    /// Re-enter after a suspend: the same sequence as `enter`, on the value the guard already holds.
    fn re_enter(screen: &mut Screen) -> std::io::Result<()> {
        let entered = Screen::enter()?;
        screen.active = entered.active;
        Ok(())
    }

    fn leave(&mut self) {
        if !self.active {
            return;
        }
        self.active = false;
        let mut out = std::io::stdout();
        let _ = execute!(
            out,
            event::PopKeyboardEnhancementFlags,
            cursor::Show,
            terminal::LeaveAlternateScreen,
            event::DisableBracketedPaste
        );
        let _ = write!(out, "{}", mouse_off());
        let _ = out.flush();
        let _ = terminal::disable_raw_mode();
    }
}

impl Drop for Screen {
    fn drop(&mut self) {
        self.leave();
    }
}

/// The cwd as pi writes it in its footer: `~` for home, `~/x` below it, the absolute path otherwise.
fn footer_cwd() -> String {
    let cwd = std::env::current_dir().map(|p| p.display().to_string()).unwrap_or_default();
    let Some(home) = std::env::var("HOME").ok().filter(|home| !home.is_empty()) else {
        return cwd;
    };
    if cwd == home {
        return "~".to_string();
    }
    match cwd.strip_prefix(&format!("{home}/")) {
        Some(rest) => format!("~/{rest}"),
        None => cwd,
    }
}

/// The rows the client opens with: what it is, which host it drives, and the chords it actually answers.
///
/// Only chords that are implemented are named — pi's boot line names `! bash` and startup help, which
/// this client does not have, and a hint that does nothing is worse than no hint.
fn boot_rows(args: &Args, keys: &Keymap) -> Vec<pi_tui::render::StyledRow> {
    use pi_tui::render::StyledRow;
    use pi_tui::theme::Role;
    let version = host_version(&args.pi).unwrap_or_default();
    let title = if version.is_empty() {
        "pi".to_string()
    } else {
        format!("pi {version}")
    };
    let host = args.pi.iter().find(|arg| arg.contains("pi")).cloned().unwrap_or_else(|| "pi".to_string());
    let hint = |id: &str, what: &str| -> String { format!("{} {what}", keys.display(id).unwrap_or_else(|| "-".to_string())) };
    let line = [
        hint("app.interrupt", "interrupt"),
        hint("app.clear", "clear"),
        hint("app.exit", "exit"),
        "/ commands".to_string(),
        "@ files".to_string(),
        hint("app.tools.expand", "expand tools"),
    ]
    .join(" · ");
    let host_line = host.split_whitespace().next().unwrap_or("pi").to_string();
    vec![
        StyledRow::styled(title, Role::Accent),
        StyledRow::styled(line, Role::Dim),
        StyledRow::styled(format!(" rpc host: {host_line}"), Role::Muted),
    ]
}

/// The host's own `--version`, asked once at startup. A host that does not answer is not an error: the
/// boot block simply does not name a version.
fn host_version(pi: &[String]) -> Option<String> {
    let program = pi.first()?;
    let output = std::process::Command::new(program).arg("--version").output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let line = text.lines().next()?.trim().to_string();
    if line.is_empty() {
        None
    } else {
        Some(line)
    }
}

fn main() -> std::io::Result<()> {
    let args = parse_args();
    // A client that owns the screen must not write to a pipe: refuse rather than corrupt a stream (ticket
    // 11's decision). `--help` above is the one path that writes text and exits.
    if !std::io::IsTerminal::is_terminal(&std::io::stdout()) {
        eprintln!("pi-tui: stdout is not a terminal; this client owns the screen and needs a TTY");
        std::process::exit(1);
    }
    let mut host = match &args.replay {
        Some(path) => Host::replay(path, Duration::from_millis(args.pace_ms), args.repeat)?,
        None => Host::spawn(&args.pi, &[])?,
    };
    // The furniture needs three answers before it can draw anything (tickets 07 and 08).
    host.send(json!({"id": "models", "type": "get_available_models"}));
    host.send(json!({"id": "commands", "type": "get_commands"}));
    host.send(json!({"id": "state", "type": "get_state"}));
    // The footer's numbers, from the session the host just opened — a resumed session has them without a
    // new turn (`SessionStats` is accumulated from the entries). The reply is not a notice: nobody asked.
    host.send(json!({"id": "stats", "type": "get_session_stats"}));
    let previous_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let mut out = std::io::stdout();
        let _ = execute!(
            out,
            event::PopKeyboardEnhancementFlags,
            cursor::Show,
            terminal::LeaveAlternateScreen,
            event::DisableBracketedPaste
        );
        let _ = write!(out, "{}", mouse_off());
        let _ = out.flush();
        let _ = terminal::disable_raw_mode();
        previous_hook(info);
    }));
    let mut screen = Screen::enter()?;
    let tty = writer::Writer::spawn();
    let mut state = State::new(args.pace_ms);
    state.transcript.set_theme(state.theme.clone());
    // What pi draws under the composer from the first frame: the directory this session belongs to
    // (ticket 15's F8/F9). The host is spawned in this directory, so the client's own cwd is the session's.
    state.ui.footer.cwd = footer_cwd();
    // pi's boot block (ticket 15's F10): a version, one line of what the client answers, and a tip. An
    // empty screen with one footer row looked like a hang.
    state.transcript.push_boot(&boot_rows(&args, &state.keymap));
    // A binding that does nothing is worse than a notice, so the keymap reports itself once at start.
    for conflict in state.keymap.conflicts.clone() {
        state.ui.notify(format!("[ui] keybinding conflict: {conflict}"));
    }
    if let Some(path) = keymap::keybindings_path() {
        let known: std::collections::BTreeSet<&str> = keymap::default_bindings().into_iter().map(|(id, _)| id).collect();
        let unknown = keymap::unknown_ids(&path, &known);
        if !unknown.is_empty() {
            state.ui.notify(format!("[ui] keybindings this client does not implement: {}", unknown.join(", ")));
        }
    }
    let outcome = run(&mut host, &mut state, &tty, &args, &mut screen);
    tty.finish();
    screen.leave();
    if let Some(path) = &args.stats {
        let mut file = std::fs::File::create(path)?;
        writeln!(file, "{}", state.stats.json())?;
    }
    host.shutdown();
    outcome
}

/// A message the host has queued for the running turn: `steering` is delivered after the current tool
/// calls, `followUp` only when the agent is fully done (ticket 02 D2/D3 of `.scratch/tui-rust-v2/map.md`).
#[derive(Clone)]
struct Pending {
    kind: &'static str,
    text: String,
}

/// A prompt the client has sent. Its text is kept until the host answers, so a failure can put it back
/// (ticket 02 D2: the composer clears on the host's disposition, and nothing typed is lost to an error).
struct Sent {
    text: String,
    behaviour: &'static str,
}

struct State {
    transcript: Transcript,
    composer: Composer,
    keymap: Keymap,
    completions: Completions,
    slash_commands: Vec<String>,
    theme: pi_tui::theme::Theme,
    /// The last OSC 9;4 progress state written (3 = running, 0 = clear).
    progress: Option<u8>, 
    stats: Stats,
    pace_ms: u64,
    screen: paint::Screen,
    ui: UiState,
    /// What the host says is queued for the running turn (`queue_update`).
    pending: Vec<Pending>,
    /// The prompt awaiting the host's disposition, and the text to restore if it fails.
    sent: Option<Sent>,
    /// A prompt the host refused because a compaction was running: re-sent on `compaction_end`
    /// (ticket 02 D5).
    parked: Option<Sent>,
    /// Where the transcript window sits, and whether it follows new rows (ticket 03).
    viewport: pi_tui::viewport::Viewport,
    /// The document's shape at the last painted width: a resize uses it to keep the top **block**.
    last_doc: Option<(u16, pi_tui::viewport::DocMap)>,
    /// The transcript's height in the last frame, which a page-scroll moves by.
    last_height: usize,
    /// pi's `settings.json`, for the knobs the client honours (ticket 04).
    settings: pi_tui::settings::Settings,
    /// The mouse selection, in **document rows** so scrolling keeps it (ticket 04 D6).
    selection: Option<pi_tui::selection::Selection>,
    /// How long the scrollbar stays after the last motion (ticket 03 D4: `auto` fades after a second).
    scrollbar_until: Option<Instant>,
    /// Whether the last frame actually drew the bar, so the fade schedules its own repaint.
    scrollbar_shown: bool,
    /// The candidates a single `fd` run found, and the query they answered: typing more characters
    /// narrows this pool locally instead of spawning `fd` once per keystroke.
    completion_pool: Vec<completion::Suggestion>,
    completion_pool_query: Option<String>,
    /// `app.suspend` was pressed: the loop that owns the screen stops the process and re-enters.
    suspend_requested: bool,
    /// A paste that arrived while a dialog was open: queued, never typed into an invisible editor.
    queued_paste: Option<String>,
    /// Whether the hardware cursor is currently shown, so the sequence is written only on a change.
    hardware_cursor_shown: bool,
    /// The models the host reports as available: `(provider, id, contextWindow, reasoning)` (ticket 07;
// the last two feed the footer's context budget, ticket 15).
    models: Vec<(String, String, u64, bool)>,
    /// The palette: the host's commands and pi's built-ins, with their routes (ticket 08).
    palette: Vec<pi_tui::palette::Entry>,
    /// What `get_state` said, for the notice after a switch and for the picker's current mark.
    current_model: Option<String>,
    current_provider: Option<String>,
    current_thinking: Option<String>,
    /// A `get_session_stats` request is in flight: the turn-end refresh must not stack requests.
    awaiting_stats: bool,
    /// The next stats reply is one the user asked for, so it is also shown as a notice.
    stats_notice: bool,
}

impl State {
    fn new(pace_ms: u64) -> State {
        State {
            transcript: Transcript::default(),
            composer: Composer::default(),
            keymap: Keymap::load(),
            completions: Completions::default(),
            slash_commands: Vec::new(),
            theme: pi_tui::theme::Theme::find_default(),
            progress: None,
            stats: Stats::default(),
            pace_ms,
            screen: paint::Screen::default(),
            ui: UiState::default(),
            pending: Vec::new(),
            sent: None,
            parked: None,
            viewport: pi_tui::viewport::Viewport::new(),
            last_doc: None,
            last_height: 1,
            settings: pi_tui::settings::Settings::load(),
            selection: None,
            scrollbar_until: None,
            scrollbar_shown: false,
            suspend_requested: false,
            completion_pool: Vec::new(),
            completion_pool_query: None,
            queued_paste: None,
            hardware_cursor_shown: false,
            models: Vec::new(),
            palette: pi_tui::palette::entries(&[], &[]),
            current_model: None,
            current_provider: None,
            current_thinking: None,
            awaiting_stats: false,
            stats_notice: false,
        }
    }
}

fn run(host: &mut Host, state: &mut State, tty: &writer::Writer, args: &Args, screen: &mut Screen) -> std::io::Result<()> {
    // Paint once before any event arrives: an empty screen that never draws looks like a hang.
    let mut dirty_host = true;
    let mut dirty_input = false;
    let mut pending_echo: Option<Instant> = None;
    let mut last_paint = Instant::now();
    let started = Instant::now();
    // Attach: ask for the session's history once. The client renders it through the same path as live
    // traffic (ticket 04), so a resumed session does not start blank (ticket 11).
    let mut asked_history = false;
    loop {
        if !asked_history && !args.replay.is_some() {
            asked_history = true;
            host.send(json!({"id": "attach-history", "type": "get_messages"}));
        }
        // 1. Input. `poll` returns immediately when a key is waiting; otherwise it waits at most until
        //    the next frame is due, so a streaming frame still lands on time.
        let timeout = if dirty_input { Duration::ZERO } else { TICK.saturating_sub(last_paint.elapsed()) };
        if event::poll(timeout)? {
            match event::read()? {
                Event::Key(key) => {
                    dirty_input = true;
                    pending_echo = pending_echo.or(Some(Instant::now()));
                    if !handle_key(key, state, host) {
                        return Ok(());
                    }
                }
                Event::Resize(_, _) => dirty_input = true,
                // Bracketed paste arrives as one event with the whole text: the composer decides whether
                // it stays inline or collapses into an atomic `[paste #N …]` segment.
                Event::Paste(text) => {
                    if state.ui.has_dialog() {
                        // Ticket 10 D5: a dialog owns the keys, so a paste while one is open is kept and
                        // delivered when it closes, rather than editing an editor nobody can see.
                        state.queued_paste = Some(text);
                    } else {
                        state.composer.paste(&text);
                        dirty_input = true;
                        pending_echo = pending_echo.or(Some(Instant::now()));
                    }
                }
                Event::Mouse(mouse) => {
                    if handle_mouse(mouse, state) {
                        dirty_input = true;
                    }
                }
                _ => {}
            }
        }

        // 2. Host lines, bounded: a burst is folded into this frame rather than into the next thousand.
        let mut drained = 0;
        while drained < DRAIN_BUDGET {
            match host.events.try_recv() {
                Ok(value) => {
                    let line = pi_rpc::Line::parse(value);
                    if let Some(request) = line.value().get("type").and_then(|t| t.as_str()).filter(|t| *t == "extension_ui_request") {
                        let _ = request;
                        if let Some(answer) = state.ui.apply(line.value()) {
                            // A request the client has no vocabulary for: answered at once, so the
                            // host's `await` resolves into the extension's own fallback.
                            host.send(answer);
                        }
                        // `set_editor_text` is the one UI method that reaches the composer itself.
                        if line.value().get("method").and_then(|m| m.as_str()) == Some("set_editor_text") {
                            if let Some(text) = line.value().get("text").and_then(|t| t.as_str()) {
                                state.composer.set_text(text);
                            }
                        }
                        dirty_host = true;
                    }
                    // The host's queue for the running turn (ticket 02 D3).
                    if line.value().get("type").and_then(|t| t.as_str()) == Some("queue_update") {
                        apply_queue_update(state, line.value());
                        dirty_host = true;
                    }
                    // The furniture's answers (tickets 07, 08).
                    if let pi_rpc::Line::Response(response) = &line {
                        if apply_response(state, response) {
                            dirty_host = true;
                        }
                    }
                    // A prompt's disposition decides whether the text stays gone (ticket 02 D2/D5).
                    if let pi_rpc::Line::Response(response) = &line {
                        if response.get("command").and_then(|c| c.as_str()) == Some("prompt") {
                            settle_prompt(state, response);
                            dirty_host = true;
                        }
                    }
                    // The slash-command list feeds the client's own completion (ticket 07, decision 2).
                    if let Some(pi_rpc::Line::Response(response)) = Some(&line).map(|l| l.clone()) {
                        if response.get("command").and_then(|c| c.as_str()) == Some("get_commands") {
                            if let Some(items) = response.get("data").and_then(|d| d.get("commands")).and_then(|c| c.as_array()) {
                                let names: Vec<String> = items
                                    .iter()
                                    .filter_map(|item| item.get("name").and_then(|n| n.as_str()).map(|n| format!("/{n}")))
                                    .collect();
                                if !names.is_empty() {
                                    state.slash_commands = names;
                                }
                            }
                        }
                    }
                    if let pi_rpc::Line::Response(response) = &line {
                        if response.get("command").and_then(|c| c.as_str()) == Some("get_messages") {
                            if let Some(messages) = response.get("data").and_then(|d| d.get("messages")) {
                                if state.transcript.apply_history(messages) {
                                    dirty_host = true;
                                }
                            }
                        }
                    }
                    if state.transcript.apply(&line) {
                        dirty_host = true;
                    }
                    // A turn's numbers change when it settles, so that is when the footer asks for them
                    // (`agent_settled` is the host's own "nothing is running now": `rpc-mode.ts:329-333`).
                    if line.value().get("type").and_then(|t| t.as_str()) == Some("agent_settled")
                        && !state.awaiting_stats
                    {
                        state.awaiting_stats = true;
                        state.stats_notice = false;
                        host.send(json!({"id": "stats", "type": "get_session_stats"}));
                    }
                    drained += 1;
                }
                Err(_) => break,
            }
        }

        if let Some(code) = host.exited() {
            if code != 0 {
                state.transcript.apply(&pi_rpc::Line::Unknown(json!({
                    "type": "response", "command": "exit", "success": false, "error": format!("host exited {code}")
                })));
            }
            paint_frame(state, tty, &mut last_paint, pending_echo.take())?;
            return Ok(());
        }

        // A message parked behind a compaction is sent as soon as compaction ends and the turn settles
        // (ticket 02 D5: queued client-side, flushed after, restored on failure).
        if let Some(seat) = state.parked.take() {
            if !state.transcript.streaming && state.composer.is_empty() {
                send_prompt(state, host, seat.text, seat.behaviour);
            } else {
                state.parked = Some(seat);
            }
        }

        // The scrollbar's fade needs a frame of its own: nothing else will repaint the rows it covered.
        if state.scrollbar_shown
            && state
                .scrollbar_until
                .is_some_and(|until| Instant::now() >= until)
        {
            dirty_input = true;
            state.scrollbar_until = None;
        }

        // `app.suspend` (ctrl+z): give the terminal back, stop ourselves, and re-enter on SIGCONT —
        // pi's own sequence (`interactive-mode.ts:4677-4711`). A client that stops in raw mode leaves the
        // shell broken until `stty sane`.
        if state.suspend_requested {
            state.suspend_requested = false;
            suspend(screen);
        }
        if let Some(paste) = state.queued_paste.take() {
            if !state.ui.has_dialog() {
                state.composer.paste(&paste);
                dirty_input = true;
            } else {
                state.queued_paste = Some(paste);
            }
        }

        // 3. Paint: an input event paints at once; a streaming event waits for the budget.
        let due = dirty_input || (dirty_host && last_paint.elapsed() >= TICK);
        if due {
            if dirty_host && dirty_input {
                state.stats.coalesced += 1;
            }
            if dirty_input {
                state.stats.input_frames += 1;
            }
            paint_frame(state, tty, &mut last_paint, pending_echo.take())?;
            dirty_input = false;
            dirty_host = false;
        }

        if args.once && started.elapsed() > Duration::from_secs(30) {
            return Ok(());
        }
        if args.once && !state.transcript.streaming && !state.transcript.lines().is_empty() && !dirty_host {
            // `--once` is for the harness: paint the replay once and leave, so a measurement does not
            // wait for an idle timeout.
            paint_frame(state, tty, &mut last_paint, pending_echo.take())?;
            return Ok(());
        }
        let _ = state.pace_ms;
    }
}

/// Build a frame and hand it to the writer. The paint thread never touches the terminal, so a slow
/// terminal costs frames — `Writer::submit` reports a replaced frame — and never a stalled loop.
fn paint_frame(state: &mut State, tty: &writer::Writer, last_paint: &mut Instant, pending_echo: Option<Instant>) -> std::io::Result<()> {
    let started = Instant::now();
    let (width, rows) = terminal::size()?;
    // The composer block: its own wrapped rows and the cursor's place in them. A dialog, when one is
    // open, replaces the buffer with its own prompt text.
    let (composer_rows, _cursor_row, _cursor_col) = if state.ui.dialog.is_some() {
        let mut rows = Vec::new();
        paint::wrap(&state.ui.prompt(), width as usize, &mut rows);
        (rows, 0, 0)
    } else {
        state.composer.render(width as usize)
    };
    // The model picker's rows can arrive after it opens; repoint them rather than showing an empty list.
    if state.ui.has_dialog() && !state.models.is_empty() {
        state.ui.refresh_client_list("model", model_items(state));
    }
    // The model, its thinking level and the session's numbers live in the footer now (ticket 15):
    // `long_transcript.py` (v1's harness) still waits for the model's name before it types, and that name
    // is drawn under the composer where pi draws it, not above it over the buffer.
    let mut composer_block: Vec<String> = composer_rows;
    // The popup draws above the composer, in the transcript's row budget (ticket 09 D5): it must not
    // hide the text being typed, and it is never queued as a dialog.
    let popup = state.completions.render_rows(width as usize, state.settings.list_rows);
    if !popup.is_empty() {
        let mut block: Vec<String> = popup;
        block.extend(composer_block.clone());
        composer_block = block;
    }
    let bottom_strings = state.ui.bottom_rows(&composer_block, width as usize, &state.keymap);
    let bottom: Vec<pi_tui::render::StyledRow> = bottom_strings
        .into_iter()
        .map(pi_tui::render::StyledRow::plain)
        .collect();

    // The bottom block never takes more than half the screen, already wrapped so its height is real.
    let bottom: Vec<pi_tui::render::StyledRow> = paint::bottom_block(&bottom, width as usize, rows as usize);

    // The window: a follower pins the tail, a reader keeps the rows they were reading, and a resize
    // keeps the block that was on top (ticket 03 D1/D2/D5).
    let height = (rows.max(2) as usize).saturating_sub(bottom.len()).max(1);
    let doc = state.transcript.doc_map(width as usize);
    match state.last_doc.take() {
        Some((last_width, last)) if last_width != width => {
            state.viewport.resettle(&last, &doc, height);
        }
        _ => state.viewport.settle(&doc, height),
    }
    state.last_doc = Some((width, doc.clone()));
    state.last_height = height;
    let start = state.viewport.window(&doc, height).0;
    let mut window = state.transcript.window_rows(width as usize, start, height);
    if let Some(selection) = state.selection {
        window = paint::with_selection(window, start, &selection);
    }
    // The bar is drawn last, over the last column, so neither the selection nor the text re-wraps for it.
    let bar_visible = match state.settings.scrollbar {
        pi_tui::settings::Scrollbar::Hidden => false,
        pi_tui::settings::Scrollbar::Always => true,
        pi_tui::settings::Scrollbar::Auto => {
            state.scrollbar_until.is_some_and(|until| Instant::now() < until)
        }
    };
    if bar_visible {
        window = paint::with_scrollbar(window, doc.total(), start, width as usize);
    }
    state.scrollbar_shown = bar_visible;
    let (window, cursor_row, cursor_col) =
        paint::compose(&window, &bottom, width as usize, rows.max(2) as usize);
    // Ticket 10 D3: an IME anchors its candidate window to the **hardware** cursor, so the caret is
    // positioned there each frame. It stays hidden unless pi's `showHardwareCursor` asks for it visible.
    let want_cursor = state.settings.hardware_cursor;
    if want_cursor != state.hardware_cursor_shown {
        let sequence = if want_cursor { "\u{1b}[?25h" } else { "\u{1b}[?25l" };
        let _ = execute!(std::io::stdout(), crossterm::style::Print(sequence));
        state.hardware_cursor_shown = want_cursor;
    }
    if let Some(title) = state.ui.title.take() {
        let _ = execute!(std::io::stdout(), crossterm::terminal::SetTitle(title));
    }
    // OSC 9;4: the taskbar/tab progress indicator. 3 = indeterminate, 0 = clear; only a change is written.
    let progress = if state.transcript.streaming { Some(3u8) } else { Some(0u8) };
    if progress != state.progress {
        state.progress = progress;
        let code = progress.unwrap_or(0);
        let _ = execute!(std::io::stdout(), crossterm::style::Print(format!("\u{1b}]9;4;{code}\u{7}")));
    }
    let (bytes, full) = state.screen.frame_styled(&window, &state.theme, cursor_row, cursor_col);
    let dropped = !tty.submit(bytes.clone());
    state.stats.write_blocked_ms = state.stats.write_blocked_ms.max(tty.counters().blocked_ms.load(std::sync::atomic::Ordering::Relaxed));
    if full {
        state.stats.full_repaints += 1;
    }
    if dropped {
        state.stats.frames_dropped += 1;
        // A dropped frame leaves the terminal holding neither the old window nor the new one, so the
        // next frame must repaint in full. Correctness over bytes (C-6 forbids passing by not drawing).
        state.screen.invalidate();
    }
    let took = started.elapsed();
    state.stats.paint(took, bytes.len());
    if let Some(at) = pending_echo {
        state.stats.echo(at.elapsed());
    }
    *last_paint = Instant::now();
    Ok(())
}

/// Put `text` on the clipboard the only way the client does: OSC 52 (ticket 04 D3). The status line
/// says *sent to the terminal*, never *Copied!*, because nothing here can verify it.
fn copy_text(state: &mut State, text: &str) {
    if text.is_empty() {
        state.ui.notify("nothing to copy".to_string());
        return;
    }
    let sequence = pi_tui::clipboard::osc52(text);
    let mut out = std::io::stdout();
    let _ = out.write_all(sequence.as_bytes());
    let _ = out.flush();
    state.ui.notify(format!("{} characters sent to the terminal", text.chars().count()));
}

/// `app.message.copy` (ctrl+x), pi's own rule: with copy-on-select the chord copies the **last assistant
/// message**; without it, the **active selection** (ticket 04 D4, `docs/keybindings.md:165`).
fn copy_action(state: &mut State) {
    let selection = if state.settings.copy_on_select { None } else { state.selection };
    let text = match selection {
        Some(selection) if !selection.is_empty() => {
            let width = terminal::size().map(|(w, _)| w as usize).unwrap_or(80);
            let rows = state.transcript.all_rows_text(width);
            selection.text(&rows)
        }
        _ => state.transcript.last_assistant(),
    };
    copy_text(state, &text);
}

/// Show the scrollbar for a second after any motion (ticket 03 D4). `Hidden` never arms it.
fn arm_scrollbar(state: &mut State) {
    if state.settings.scrollbar != pi_tui::settings::Scrollbar::Hidden {
        state.scrollbar_until = Some(Instant::now() + Duration::from_millis(1_000));
    }
}


/// Give the terminal back, stop the **process group**, and re-enter when the shell resumes us.
///
/// pi's own sequence (`interactive-mode.ts:4677-4711`): `process.kill(0, "SIGTSTP")` — the group, not this
/// thread — with a SIGCONT handler that restores the UI, and SIGINT ignored while suspended so a ctrl+c in
/// the terminal does not kill a backgrounded client. `raise` on the calling thread was tried first and
/// returned at once without stopping the process.
fn suspend(screen: &mut Screen) {
    use std::sync::atomic::{AtomicBool, Ordering};
    static RESUMED: AtomicBool = AtomicBool::new(false);
    RESUMED.store(false, Ordering::SeqCst);
    // A handler, not a flag polling loop elsewhere: signal-hook's closure registration is async-signal-safe.
    // SAFETY: the handler only stores to a static atomic, which is async-signal-safe.
    let resumed = unsafe {
        signal_hook::low_level::register(signal_hook::consts::SIGCONT, || {
            RESUMED.store(true, Ordering::SeqCst);
        })
    }
    .ok();
    // A no-op SIGINT handler, removed on resume: ctrl+c must not kill a stopped client (pi does the same).
    // SAFETY: an empty handler is async-signal-safe.
    let ignore_int = unsafe { signal_hook::low_level::register(signal_hook::consts::SIGINT, || {}) }.ok();

    screen.leave();
    // SAFETY: `kill` needs no unwinding and touches no Rust state; pid 0 means "every process in my group".
    let sent = unsafe { libc::kill(0, libc::SIGTSTP) };
    if sent != 0 {
        eprintln!("pi-tui: could not stop the process group");
    }
    // Wait for SIGCONT. A stop cannot be detected any other way from inside the stopped process.
    let mut waited = 0u32;
    while !RESUMED.load(Ordering::SeqCst) && waited < 5_000 {
        std::thread::sleep(std::time::Duration::from_millis(1));
        waited += 1;
    }
    for id in [resumed, ignore_int].into_iter().flatten() {
        signal_hook::low_level::unregister(id);
    }
    if let Err(error) = Screen::re_enter(screen) {
        eprintln!("pi-tui: could not re-enter the screen after resuming: {error}");
        std::process::exit(1);
    }
    // Re-entering clears the alternate screen, so every row must be painted again: the diff's memory of
    // what is on screen is worthless now.
    let _ = std::io::stdout().flush();
}

/// The document row under a mouse coordinate. The alt-screen window starts at row 0, and the viewport's
/// offset maps the screen row to the document row (ticket 04 D6).
fn mouse_row(state: &State, screen_row: u16) -> Option<usize> {
    let row = screen_row as usize;
    if row >= state.last_height {
        return None; // the bottom dock, not the transcript
    }
    Some(state.viewport.offset().saturating_add(row))
}

/// Wheel, press, drag and release (ticket 04 D1/D2/D7). A click selects and a drag extends; hover does
/// nothing, so the list cannot move under the pointer.
fn handle_mouse(event: crossterm::event::MouseEvent, state: &mut State) -> bool {
    use crossterm::event::{MouseButton, MouseEventKind};
    match event.kind {
        MouseEventKind::ScrollUp | MouseEventKind::ScrollDown => {
            let step = state.settings.wheel_step(
                event.modifiers.contains(KeyModifiers::ALT),
                cfg!(target_os = "macos"),
            );
            let delta = if matches!(event.kind, MouseEventKind::ScrollUp) { -step } else { step };
            let height = state.last_height;
            if let Some((_, doc)) = state.last_doc.clone() {
                state.viewport.scroll_by(delta, &doc, height);
                arm_scrollbar(state);
            }
            true
        }
        MouseEventKind::Down(MouseButton::Left) => {
            if let Some(row) = mouse_row(state, event.row) {
                state.selection = Some(pi_tui::selection::Selection::new((row, event.column as usize)));
                true
            } else {
                false
            }
        }
        MouseEventKind::Drag(MouseButton::Left) => {
            let Some(mut selection) = state.selection else { return false };
            let row = state.last_height.saturating_sub(1);
            let column = event.column as usize;
            // A drag past the transcript's last row clamps there: the dock is not selectable.
            let row = (event.row as usize).min(row);
            selection.extend((state.viewport.offset().saturating_add(row), column));
            state.selection = Some(selection);
            true
        }
        MouseEventKind::Up(MouseButton::Left) => {
            if state.settings.copy_on_select {
                if let Some(selection) = state.selection.filter(|selection| !selection.is_empty()) {
                    let width = terminal::size().map(|(w, _)| w as usize).unwrap_or(80);
                    let rows = state.transcript.all_rows_text(width);
                    let text = selection.text(&rows);
                    copy_text(state, &text);
                    return true;
                }
            }
            false
        }
        _ => false,
    }
}


/// A response the furniture asked for: models, commands, state, or the result of a switch.
fn apply_response(state: &mut State, response: &Value) -> bool {
    let command = response.get("command").and_then(Value::as_str).unwrap_or("");
    // A notice or a state change that no frame paints is invisible: the caller repaints on `true`.
    let changed = true;
    let success = response.get("success").and_then(Value::as_bool).unwrap_or(false);
    let data = response.get("data");
    match command {
        "get_available_models" => {
            let models = data.and_then(|d| d.get("models")).and_then(Value::as_array);
            if let Some(models) = models {
                state.models = models
                    .iter()
                    .filter_map(|model| {
                        let provider = model.get("provider").and_then(Value::as_str)?;
                        let id = model.get("id").and_then(Value::as_str)?;
                        let window = model.get("contextWindow").and_then(Value::as_u64).unwrap_or(0);
                        let reasoning = model.get("reasoning").and_then(Value::as_bool).unwrap_or(false);
                        state.ui.footer.providers = 0;
                        Some((provider.to_string(), id.to_string(), window, reasoning))
                    })
                    .collect();
                state.ui.footer.providers = state
                    .models
                    .iter()
                    .map(|(provider, _, _, _)| provider.clone())
                    .collect::<std::collections::BTreeSet<_>>()
                    .len();
                footer_model_facts(state);
            }
        }
        "get_commands" => {
            let items: Vec<(String, String)> = data
                .and_then(|d| d.get("commands"))
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|item| {
                            let name = item.get("name").and_then(Value::as_str)?;
                            let description =
                                item.get("description").and_then(Value::as_str).unwrap_or("");
                            Some((name.to_string(), description.to_string()))
                        })
                        .collect()
                })
                .unwrap_or_default();
            let names: Vec<String> = items.iter().map(|(name, _)| name.clone()).collect();
            let descriptions: Vec<String> = items.iter().map(|(_, text)| text.clone()).collect();
            state.slash_commands = names.iter().map(|name| format!("/{name}")).collect();
            state.palette = pi_tui::palette::entries(&names, &descriptions);
        }
        "get_state" => {
            // `get_state` reports the model as an **object** (`{id, provider, …}`), not a string.
            if let Some(model) = data.and_then(|d| d.get("model")) {
                let id = model.get("id").and_then(Value::as_str).map(str::to_string);
                let provider = model.get("provider").and_then(Value::as_str).map(str::to_string);
                state.current_model = id.or_else(|| model.as_str().map(str::to_string));
                state.current_provider = provider;
            }
            if let Some(level) = data.and_then(|d| d.get("thinkingLevel")).and_then(Value::as_str) {
                state.current_thinking = Some(level.to_string());
            }
            // The footer is fed from the host's own state, never from a guess (ticket 15).
            if let Some(enabled) = data.and_then(|d| d.get("autoCompactionEnabled")).and_then(Value::as_bool) {
                state.ui.footer.auto_compaction = enabled;
            }
            state.ui.footer.model = state.current_model.clone().unwrap_or_default();
            state.ui.footer.provider = state.current_provider.clone().unwrap_or_default();
            state.ui.footer.thinking = state.current_thinking.clone().unwrap_or_else(|| "off".to_string());
            footer_model_facts(state);
        }
        "set_model" | "cycle_model" => {
            if success {
                let model = data
                    .and_then(|d| {
                        d.get("model")
                            .or_else(|| d.get("provider"))
                            .and_then(Value::as_str)
                            .map(str::to_string)
                            .or_else(|| {
                                let provider = d.get("provider").and_then(Value::as_str)?;
                                let id = d.get("id").and_then(Value::as_str)?;
                                Some(format!("{provider}/{id}"))
                            })
                    })
                    .unwrap_or_else(|| "the model".to_string());
                state.current_model = Some(model.clone());
                state.ui.notify(format!("Switched to {model} (thinking: {})", thinking(state)));
            } else {
                let error = response.get("error").and_then(Value::as_str).unwrap_or("could not switch model");
                state.ui.notify(format!("[!] {error}"));
            }
        }
        "cycle_thinking_level" => {
            if let Some(level) = data.and_then(|d| d.get("level")).and_then(Value::as_str) {
                state.current_thinking = Some(level.to_string());
                state.ui.notify(format!("Thinking: {level}"));
            } else {
                state.ui.notify("Current model does not support thinking".to_string());
            }
        }
        "get_fork_messages" => {
            let rows = data
                .and_then(|d| d.get("messages"))
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|item| {
                            let id = item.get("entryId").and_then(Value::as_str)?.to_string();
                            let text = item.get("text").and_then(Value::as_str).unwrap_or("");
                            Some((id, text.lines().next().unwrap_or("").chars().take(60).collect::<String>()))
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            if rows.is_empty() {
                state.ui.notify("no earlier messages to fork from".to_string());
                return true;
            }
            let items: Vec<ui::ListItem> = rows
                .iter()
                .map(|(id, label)| ui::ListItem::with_value(label.clone(), id.clone()))
                .collect();
            let mut list = ui::ListDialog::new(items, pi_tui::filter::Mode::Fuzzy, state.settings.list_rows);
            list.title = Some("Fork from a message".to_string());
            list.hint = vec![("tui.select.confirm", "fork"), ("tui.select.cancel", "cancel")];
            state.ui.open_client_list("fork-entry", list);
        }
        "get_tree" => {
            let count = data
                .and_then(|d| d.get("tree"))
                .and_then(Value::as_array)
                .map(|nodes| nodes.len())
                .unwrap_or(0);
            let leaf = data.and_then(|d| d.get("leafId")).and_then(Value::as_str).unwrap_or("");
            // Ticket 06: the tree is display-only — there is no RPC command that moves the leaf.
            state.ui.notify(format!("session tree: {count} node(s), leaf {leaf} (display only — branch with /fork)"));
        }
        "get_session_stats" => {
            if let Some(stats) = data {
                let messages = stats.get("totalMessages").and_then(Value::as_u64).unwrap_or(0);
                let cost = stats.get("cost").and_then(Value::as_f64).unwrap_or(0.0);
                let tokens = stats
                    .pointer("/tokens/total")
                    .and_then(Value::as_u64)
                    .unwrap_or(0);
                // The footer is refreshed from the same reply: pi draws these numbers under the composer
                // on every frame (`components/footer.ts:110-190`), the client only ever showed them as a
                // notice when `/session` was typed (ticket 15's F8).
                state.ui.footer.input_tokens = stats.pointer("/tokens/input").and_then(Value::as_u64).unwrap_or(0);
                state.ui.footer.output_tokens = stats.pointer("/tokens/output").and_then(Value::as_u64).unwrap_or(0);
                state.ui.footer.cache_read = stats.pointer("/tokens/cacheRead").and_then(Value::as_u64).unwrap_or(0);
                state.ui.footer.cache_write = stats.pointer("/tokens/cacheWrite").and_then(Value::as_u64).unwrap_or(0);
                state.ui.footer.cost = cost;
                if let Some(usage) = stats.get("contextUsage") {
                    state.ui.footer.context_percent = usage.get("percent").and_then(Value::as_f64);
                    if let Some(window) = usage.get("contextWindow").and_then(Value::as_u64) {
                        state.ui.footer.context_window = window;
                    }
                }
                if state.stats_notice {
                    state.ui.notify(format!("{messages} messages · {tokens} tokens · ${cost:.4}"));
                    state.stats_notice = false;
                }
                state.awaiting_stats = false;
            }
        }
        "set_session_name" => {
            if success {
                state.ui.notify("session renamed".to_string());
            } else {
                let error = response.get("error").and_then(Value::as_str).unwrap_or("could not rename");
                state.ui.notify(format!("[!] {error}"));
            }
        }
        "fork" | "switch_session" => {
            if success {
                // Ticket 06's central finding: a replacement is **silent** — no session_start reaches the
                // RPC client — so the client re-syncs on the response and nothing else.
                resync(state, response);
            } else {
                let error = response.get("error").and_then(Value::as_str).unwrap_or("could not switch session");
                state.ui.notify(format!("[!] {error}"));
            }
        }
        "clone" | "new_session" | "compact" | "export_html" => {
            if success {
                let detail = data
                    .and_then(|d| d.get("path"))
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .unwrap_or_else(|| command.replace('_', " "));
                state.ui.notify(detail);
            } else {
                let error = response.get("error").and_then(Value::as_str).unwrap_or("refused");
                state.ui.notify(format!("[!] {error}"));
            }
        }
        _ => return false,
    }
    changed
}

fn thinking(state: &State) -> String {
    state.current_thinking.clone().unwrap_or_else(|| "off".to_string())
}

/// The model picker's rows: `provider/id` with the provider in the right column and the current model
/// marked (ticket 07 D4).
/// Copy the current model's context window and reasoning flag into the footer, so the budget reads right
/// before the first turn's stats arrive. The host's model list is the only source for it.
fn footer_model_facts(state: &mut State) {
    let Some(model) = state.current_model.clone() else { return };
    let provider = state.current_provider.clone().unwrap_or_default();
    let facts = state
        .models
        .iter()
        .find(|(candidate_provider, id, _, _)| *id == model && (provider.is_empty() || *candidate_provider == provider))
        .map(|(_, _, window, reasoning)| (*window, *reasoning));
    if let Some((window, reasoning)) = facts {
        if state.ui.footer.context_window == 0 {
            state.ui.footer.context_window = window;
        }
        state.ui.footer.reasoning = reasoning;
    }
}

fn model_items(state: &State) -> Vec<ui::ListItem> {
    state
        .models
        .iter()
        .map(|(provider, id, _, _)| {
            let mut item = ui::ListItem::label(id.clone());
            item.right = provider.clone();
            if state.current_model.as_deref() == Some(id.as_str())
                && state.current_provider.as_deref() == Some(provider.as_str())
            {
                item.right = format!("{provider}  (current)");
            }
            item
        })
        .collect()
}

/// The queued messages a `queue_update` describes (`agent-session.ts:1110`).
fn queued(value: &Value) -> Vec<Pending> {
    let mut next: Vec<Pending> = Vec::new();
    // Steering first: it is delivered before the follow-ups, so it reads in delivery order.
    for (field, kind) in [("steering", "Steering"), ("followUp", "Follow-up")] {
        if let Some(items) = value.get(field).and_then(Value::as_array) {
            for item in items {
                if let Some(text) = item.as_str() {
                    next.push(Pending { kind, text: text.to_string() });
                }
            }
        }
    }
    next
}

/// Rebuild the pending area from the host's `queue_update`.
fn apply_queue_update(state: &mut State, value: &Value) {
    let next = queued(value);
    state.pending = next;
    state.ui.pending =
        state.pending.iter().map(|p| (p.kind.to_string(), p.text.clone())).collect();
}

/// What the host's answer to a prompt means for the text the client has already cleared.
enum PromptOutcome {
    /// `disposition` was `started` or `queued`: the message is in the host's hands.
    Accepted,
    /// A compaction was running (`agent-session.ts:2194`): park it and flush when compaction ends
    /// (ticket 02 D5).
    Parked,
    /// Anything else: the message was not sent, so the text goes back.
    Failed(String),
}

fn prompt_outcome(response: &Value) -> PromptOutcome {
    if response.get("success").and_then(Value::as_bool) == Some(true) {
        return PromptOutcome::Accepted;
    }
    let error = response.get("error").and_then(Value::as_str).unwrap_or("prompt failed");
    if error.contains("compaction") {
        return PromptOutcome::Parked;
    }
    PromptOutcome::Failed(error.to_string())
}

/// The host answered a prompt: accept the clear, or put the text back where it cannot be lost.
fn settle_prompt(state: &mut State, response: &Value) {
    let Some(sent) = state.sent.take() else { return };
    match prompt_outcome(response) {
        PromptOutcome::Accepted => {}
        PromptOutcome::Parked => {
            state.parked = Some(sent);
            state.ui.notify("queued: a compaction is running".to_string());
        }
        PromptOutcome::Failed(error) => {
            if state.composer.is_empty() {
                state.composer.set_text(&sent.text);
            } else {
                // The user kept typing while the prompt was in flight: never overwrite their words.
                state.parked = Some(sent);
            }
            state.ui.notify(format!("[!] {error}"));
        }
    }
}

/// Send a finished prompt with the behaviour its context calls for (ticket 02 D2).
fn send_prompt(state: &mut State, host: &Host, text: String, behaviour: &'static str) {
    let mut command = json!({"id": "prompt", "type": "prompt", "message": text.clone()});
    // `steer` is delivered after the current tool calls, `followUp` only when the agent is done; an
    // idle client sends neither (ticket 02 D2).
    if state.transcript.streaming {
        command["streamingBehavior"] = json!(behaviour);
    }
    state.transcript.push_user(&text);
    state.sent = Some(Sent { text, behaviour });
    host.send(command);
}



/// A session was replaced: the host sends no `session_start` over RPC (ticket 06), so the client clears
/// what belonged to the old session and asks for the new one's transcript, state and furniture again.
fn resync(state: &mut State, response: &Value) {
    let command = response.get("command").and_then(Value::as_str).unwrap_or("session");
    state.transcript.clear();
    state.selection = None;
    state.pending.clear();
    state.ui.pending.clear();
    state.last_doc = None;
    state.viewport = pi_tui::viewport::Viewport::new();
    // A fork hands back the forked message's text; a reader expects to edit it in the composer.
    if command == "fork" {
        if let Some(text) = response.pointer("/data/text").and_then(Value::as_str) {
            state.composer.set_text(text);
        }
    }
    state.ui.notify(format!("switched session ({command})"));
}

/// A list's answer: an extension's goes back over the wire, the client's own becomes its RPC command.
fn route_dialog_answer(state: &mut State, host: &Host, answer: Value) {
    let Some(action) = answer.get("client").and_then(Value::as_str) else {
        host.send(answer);
        return;
    };
    if answer.get("cancelled").is_some() {
        return;
    }
    let value = answer.get("value").and_then(Value::as_str).unwrap_or("");
    match action {
        "model" => {
            if let Some((provider, id)) = model_by_id(state, value) {
                host.send(json!({"id": "set-model", "type": "set_model", "provider": provider, "modelId": id}));
            }
        }
        "fork-entry" => {
            host.send(json!({"id": "fork", "type": "fork", "entryId": value}));
        }
        "session" => {
            host.send(json!({"id": "switch", "type": "switch_session", "sessionPath": value}));
        }
        other => state.ui.notify(format!("[ui] {other}: {value}")),
    }
}

/// The provider and id behind a picker row. A row shows the id; the provider is in its right column, so the
/// lookup is by id and falls back to the only model with that id.
fn model_by_id(state: &State, id: &str) -> Option<(String, String)> {
    state
        .models
        .iter()
        .find(|(_, known, _, _)| known == id)
        .map(|(provider, id, _, _)| (provider.clone(), id.clone()))
}

/// The palette's answer after `/`: a built-in with a route runs it, anything else is prompt text.
fn route_command(state: &mut State, host: &Host, text: String) -> bool {
    let trimmed = text.trim_start_matches('/');
    let name = trimmed.split_whitespace().next().unwrap_or("").to_string();
    let entry = state
        .palette
        .iter()
        .find(|entry| entry.name == format!("/{name}"))
        .cloned();
    let Some(entry) = entry else { return false };
    match entry.route {
        pi_tui::palette::Route::Prompt => {
            send_prompt(state, host, text, "steer");
            true
        }
        pi_tui::palette::Route::Command(command) => {
            // A stats reply the user asked for is also shown as a notice; the silent refresh after a turn
            // only feeds the footer (ticket 15).
            if command == "get_session_stats" {
                state.stats_notice = true;
            }
            host.send(json!({"id": "slash", "type": command}));
            state.ui.notify(format!("/{name}: sent"));
            true
        }
        pi_tui::palette::Route::Client(action) => match action {
            "model" => {
                open_model_picker(state);
                true
            }
            "thinking" => {
                host.send(json!({"id": "thinking", "type": "cycle_thinking_level"}));
                true
            }
            "copy" => {
                copy_action(state);
                true
            }
            "quit" => false,
            "hotkeys" => {
                state.ui.notify("ctrl+o tools · ctrl+x copy · esc abort · ctrl+d exit".to_string());
                true
            }
            "session" => {
                // The user asked for the numbers, so the reply is also shown as a notice; the silent
                // refresh after every turn only feeds the footer.
                state.stats_notice = true;
                host.send(json!({"id": "stats", "type": "get_session_stats"}));
                true
            }
            "tree" => {
                host.send(json!({"id": "tree", "type": "get_tree"}));
                true
            }
            "fork" => {
                host.send(json!({"id": "forks", "type": "get_fork_messages"}));
                true
            }
            "resume" => {
                resume_picker(state);
                true
            }
            "name" => {
                let wanted = trimmed.split_whitespace().skip(1).collect::<Vec<_>>().join(" ");
                if wanted.is_empty() {
                    state.ui.notify("give a name: /name <title>".to_string());
                } else {
                    host.send(json!({"id": "name", "type": "set_session_name", "name": wanted}));
                }
                true
            }
            other => {
                state.ui.notify(format!("/{name} is not built into this client yet ({other})"));
                true
            }
        },
        pi_tui::palette::Route::Unsupported => {
            state.ui.notify(format!("/{name} needs a client feature this client does not have yet"));
            true
        }
    }
}

/// The model picker (ticket 07): `get_available_models`' rows, the current one marked, Enter switches.
fn open_model_picker(state: &mut State) {
    let mut list = ui::ListDialog::new(model_items(state), pi_tui::filter::Mode::Fuzzy, state.settings.list_rows);
    list.title = Some("Select model".to_string());
    list.hint = vec![("tui.select.confirm", "switch"), ("tui.select.cancel", "cancel")];
    state.ui.open_client_list("model", list);
}


/// The session picker (ticket 06): no RPC command lists sessions, so the client reads pi's directory.
fn resume_picker(state: &mut State) {
    let cwd = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
    let Some(agent) = pi_tui::keymap::agent_dir() else {
        state.ui.notify("no agent directory to read sessions from".to_string());
        return;
    };
    let rows = pi_tui::sessions::list(&agent, &cwd);
    if rows.is_empty() {
        state.ui.notify(format!("no sessions under {}", pi_tui::sessions::dir_name(&cwd)));
        return;
    }
    let items: Vec<ui::ListItem> = rows
        .iter()
        .map(|row| {
            ui::ListItem::with_value(row.name.clone(), row.path.to_string_lossy().to_string())
        })
        .collect();
    let mut list = ui::ListDialog::new(items, pi_tui::filter::Mode::Fuzzy, state.settings.list_rows);
    list.title = Some("Resume a session".to_string());
    list.hint = vec![("tui.select.confirm", "open"), ("tui.select.cancel", "cancel")];
    state.ui.open_client_list("session", list);
}

/// The slash palette's popup: the entries a typed prefix matches, with their descriptions.
fn refresh_palette_popup(state: &mut State) {
    let text = state.composer.text();
    let first = text.lines().next().unwrap_or("");
    if !first.starts_with('/') || first.contains(' ') {
        return;
    }
    let rows = pi_tui::palette::filtered(&state.palette, first);
    let items: Vec<completion::Suggestion> = rows
        .iter()
        .map(|entry| completion::Suggestion {
            insert: entry.name.clone(),
            label: entry.name.clone(),
            hint: Some(entry.description.clone()),
        })
        .collect();
    state.completions = Completions::new(items);
}

/// Returns false when the client should exit.
/// Route one keypress. The keymap decides (pi's ids), then the composer acts; the host only ever sees
/// a finished prompt, which is ticket 07's wire contract.
fn handle_key(key: KeyEvent, state: &mut State, host: &Host) -> bool {
    let map = state.keymap.clone();
    // `app.exit` (ctrl+d) exits only with an empty composer, so quitting is deliberate; `app.clear`
    // (ctrl+c) clears the composer or cancels the open dialog and never quits — pi's split, which
    // replaces v1's "either chord exits" (ticket 02 D6 of `.scratch/tui-rust-v2/map.md`).
    if map.matches(&key, "app.exit") && state.composer.is_empty() {
        return false;
    }
    if map.matches(&key, "app.clear") {
        if state.ui.has_dialog() {
            if let Some(answer) = state.ui.cancel_dialog() {
                host.send(answer);
            }
        } else {
            state.composer.clear();
        }
        return true;
    }
    if state.ui.has_dialog() {
        if let Some(answer) = state.ui.handle_dialog_key(&key, &state.keymap) {
            route_dialog_answer(state, host, answer);
        }
        return true;
    }

    // Completion first: Tab accepts the highlighted item, Esc dismisses it, arrows move within it.
    if !state.completions.is_empty() {
        if map.matches(&key, "tui.input.tab") {
            if let Some(item) = state.completions.current().cloned() {
                replace_token(&mut state.composer, &item.insert);
            }
            state.completions = Completions::default();
            return true;
        }
        if map.matches(&key, "tui.editor.cursorDown") && !state.completions.is_empty() {
            state.completions.next();
            return true;
        }
        if map.matches(&key, "tui.editor.cursorUp") && !state.completions.is_empty() {
            state.completions.previous();
            return true;
        }
        // Any other key closes the popup and is handled normally below.
        state.completions = Completions::default();
    }

    // pi's order (ticket 02 D1): a dialog, then the completion popup, then a streaming turn, then
    // nothing. Escape here means "cancel or abort", and an abort gives the queued messages back.
    if map.matches(&key, "app.interrupt") {
        if state.transcript.streaming {
            let queued: Vec<String> = state.pending.iter().map(|p| p.text.clone()).collect();
            if !queued.is_empty() {
                host.send(json!({"id": "clear-queue", "type": "clear_queue"}));
                if state.composer.is_empty() {
                    state.composer.set_text(&queued.join("\n"));
                }
                state.pending.clear();
                state.ui.pending.clear();
            }
            host.send(json!({"id": "abort", "type": "abort"}));
        } else if !state.composer.is_empty() {
            // Nothing is running and there is text: pi does nothing here, so the draft stays.
        }
        return true;
    }
    // `app.message.dequeue` (alt+up) takes every queued message back into the editor.
    if map.matches(&key, "app.model.select") {
        open_model_picker(state);
        return true;
    }
    if map.matches(&key, "app.model.cycleForward") || map.matches(&key, "app.model.cycleBackward") {
        let backwards = map.matches(&key, "app.model.cycleBackward");
        let direction = if backwards { "backward" } else { "forward" };
        host.send(json!({"id": "cycle", "type": "cycle_model", "direction": direction}));
        return true;
    }
    if map.matches(&key, "app.thinking.cycle") {
        host.send(json!({"id": "thinking", "type": "cycle_thinking_level"}));
        return true;
    }
    if map.matches(&key, "app.suspend") {
        state.suspend_requested = true;
        return true;
    }
    if map.matches(&key, "app.message.copy") {
        copy_action(state);
        return true;
    }
    if map.matches(&key, "app.message.dequeue") && !state.pending.is_empty() {
        host.send(json!({"id": "clear-queue", "type": "clear_queue"}));
        let queued: Vec<String> = state.pending.iter().map(|p| p.text.clone()).collect();
        let mut text = state.composer.text();
        for message in queued {
            if !text.is_empty() {
                text.push('\n');
            }
            text.push_str(&message);
        }
        state.composer.set_text(&text);
        state.pending.clear();
        state.ui.pending.clear();
        return true;
    }
    // The transcript's motion (ticket 03 D3). The composer keeps its own cursor keys; the page keys
    // are the transcript's, and the jump keys are the transcript's alone.
    if map.matches(&key, "tui.editor.pageUp") || map.matches(&key, "tui.editor.pageDown") {
        let page = state.last_height.saturating_sub(1).max(1) as isize;
        let delta = if map.matches(&key, "tui.editor.pageUp") { -page } else { page };
        let height = state.last_height;
        if let Some((_, doc)) = state.last_doc.clone() {
            state.viewport.scroll_by(delta, &doc, height);
            arm_scrollbar(state);
        }
        return true;
    }
    if map.matches(&key, "app.scroll.top") || map.matches(&key, "app.scroll.bottom") {
        let height = state.last_height;
        if let Some((_, doc)) = state.last_doc.clone() {
            if map.matches(&key, "app.scroll.top") {
                state.viewport.to_top(&doc, height);
            } else {
                state.viewport.to_bottom(&doc, height);
            }
            arm_scrollbar(state);
        }
        return true;
    }
    if map.matches(&key, "app.scroll.prevUserMessage") || map.matches(&key, "app.scroll.nextUserMessage") {
        let width = terminal::size().map(|(w, _)| w as usize).unwrap_or(80);
        let height = state.last_height;
        let anchor = state.viewport.offset();
        let rows = state.transcript.user_rows(width);
        let jump = if map.matches(&key, "app.scroll.prevUserMessage") {
            rows.iter().rev().find(|row| **row < anchor).copied()
        } else {
            rows.iter().find(|row| **row > anchor).copied()
        };
        if let Some(row) = jump {
            if let Some((_, doc)) = state.last_doc.clone() {
                // Land the prompt's first row at the top of the window, and stop following.
                let delta = row as isize - anchor as isize;
                state.viewport.scroll_by(delta, &doc, height);
                arm_scrollbar(state);
            }
        }
        return true;
    }
    if map.matches(&key, "app.tools.expand") {
        state.transcript.toggle_tool_expansion(None);
        return true;
    }
    if map.matches(&key, "app.message.followUp") {
        if let Some(message) = state.composer.submit() {
            send_prompt(state, host, message, "followUp");
        }
        return true;
    }
    if map.matches(&key, "tui.input.submit") {
        // pi's workaround for terminals without Shift+Enter: a backslash before the cursor submits as a
        // newline instead (`editor.ts` `shouldSubmitOnBackslashEnter`).
        if backslash_before_cursor(&state.composer) {
            state.composer.backspace();
            state.composer.newline();
            return true;
        }
        if let Some(message) = state.composer.submit() {
            // A slash command goes through the palette's routing (ticket 08): a built-in with an RPC
            // route runs it, everything else is prompt text the host expands.
            if message.trim_start().starts_with('/') && route_command(state, host, message.clone()) {
                return true;
            }
            // A plain submit is a steer while a turn streams, and a fresh turn when idle (ticket 02 D2).
            send_prompt(state, host, message, "steer");
        }
        return true;
    }
    if map.matches(&key, "tui.input.newLine") {
        state.composer.newline();
        return true;
    }
    if map.matches(&key, "tui.input.tab") {
        offer_completions(state);
        return true;
    }
    if map.matches(&key, "tui.editor.undo") {
        state.composer.undo();
        return true;
    }
    if map.matches(&key, "tui.editor.yank") {
        state.composer.yank();
        return true;
    }
    if map.matches(&key, "tui.editor.yankPop") {
        state.composer.yank_pop();
        return true;
    }
    if map.matches(&key, "tui.editor.deleteCharBackward") {
        state.composer.backspace();
        return true;
    }
    if map.matches(&key, "tui.editor.deleteCharForward") {
        state.composer.delete_forward();
        return true;
    }
    if map.matches(&key, "tui.editor.deleteWordBackward") {
        state.composer.kill_word_backward();
        return true;
    }
    if map.matches(&key, "tui.editor.deleteWordForward") {
        state.composer.kill_word_forward();
        return true;
    }
    if map.matches(&key, "tui.editor.deleteToLineStart") {
        state.composer.kill_to_line_start();
        return true;
    }
    if map.matches(&key, "tui.editor.deleteToLineEnd") {
        state.composer.kill_to_line_end();
        return true;
    }
    // History comes before cursor motion, exactly as pi orders it, and only if bound: pi ships no
    // default keys for history.
    if map.matches(&key, "tui.editor.historyPrevious") {
        state.composer.history_previous();
        return true;
    }
    if map.matches(&key, "tui.editor.historyNext") {
        state.composer.history_next();
        return true;
    }
    if map.matches(&key, "tui.editor.cursorUp") {
        state.composer.move_up();
        return true;
    }
    if map.matches(&key, "tui.editor.cursorDown") {
        state.composer.move_down();
        return true;
    }
    if map.matches(&key, "tui.editor.cursorLeft") {
        state.composer.move_left();
        return true;
    }
    if map.matches(&key, "tui.editor.cursorRight") {
        state.composer.move_right();
        return true;
    }
    if map.matches(&key, "tui.editor.cursorWordLeft") {
        state.composer.move_word_left();
        return true;
    }
    if map.matches(&key, "tui.editor.cursorWordRight") {
        state.composer.move_word_right();
        return true;
    }
    if map.matches(&key, "tui.editor.cursorLineStart") {
        state.composer.move_line_start();
        return true;
    }
    if map.matches(&key, "tui.editor.cursorLineEnd") {
        state.composer.move_line_end();
        return true;
    }
    if map.matches(&key, "tui.editor.pageUp") {
        for _ in 0..4 {
            state.composer.move_up();
        }
        return true;
    }
    if map.matches(&key, "tui.editor.pageDown") {
        for _ in 0..4 {
            state.composer.move_down();
        }
        return true;
    }
    if key.code == KeyCode::Esc {
        return false;
    }
    if let KeyCode::Char(ch) = key.code {
        if !key.modifiers.contains(KeyModifiers::CONTROL) && !key.modifiers.contains(KeyModifiers::ALT) {
            state.composer.insert(&ch.to_string());
            // The palette popup follows the composer's first line (ticket 08): typing `/mo` lists `/model`.
            refresh_palette_popup(state);
            // An `@`-mention opens the file popup and keeps it current as the path is typed (ticket 09 D3).
            if typed_prefix_is_mention(state) {
                offer_completions(state);
            }
        }
    }
    true
}


/// Whether the token under the cursor is an `@`-mention, which keeps the file popup open while typing.
fn typed_prefix_is_mention(state: &State) -> bool {
    let (row, col) = state.composer.cursor();
    let text = state.composer.text();
    text.split('\n').nth(row).map(|line| completion::prefix_before_cursor(line, col).at).unwrap_or(false)
}

/// Replace the token before the cursor with a completion.
fn replace_token(composer: &mut Composer, insert: &str) {
    // Delete the token's characters, then insert the completion. Counting in characters, not bytes,
    // because the token may hold a wide or multi-codepoint grapheme — and a quoted mention holds spaces,
    // which is why the width comes from the same prefix scan that offered the completion.
    let (row, col) = composer.cursor();
    let text = composer.text();
    let lines: Vec<&str> = text.split('\n').collect();
    let width = lines
        .get(row)
        .map(|line| completion::prefix_before_cursor(line, col).width())
        .unwrap_or(0);
    for _ in 0..width {
        composer.backspace();
    }
    composer.insert(insert);
}

fn backslash_before_cursor(composer: &Composer) -> bool {
    let (row, col) = composer.cursor();
    let text = composer.text();
    let lines: Vec<&str> = text.split('\n').collect();
    lines.get(row).map(|line| line[..col].ends_with('\\')).unwrap_or(false)
}

/// Tab: offer slash names when the line starts with `/`, else paths for the token before the cursor.
fn offer_completions(state: &mut State) {
    let (row, col) = state.composer.cursor();
    let text = state.composer.text();
    let lines: Vec<&str> = text.split('\n').collect();
    let Some(line) = lines.get(row) else { return };
    let prefix = completion::prefix_before_cursor(line, col);
    let token = completion::token_before_cursor(line, col).to_string();
    let at_line_start = row == 0 || line[..col].trim_start().starts_with('/');
    let items = if token.starts_with('/') || (token.is_empty() && at_line_start) {
        completion::slash(&state.slash_commands, &token, at_line_start)
    } else {
        // `fd` is a process: one run per pool, narrowed locally while the path is still being typed.
        // Spawning it on every keystroke blocked the event loop long enough to lose characters.
        let reusable = match &state.completion_pool_query {
            Some(previous) if !state.completion_pool.is_empty() && prefix.text.starts_with(previous.as_str()) => {
                Some(completion::narrow(&state.completion_pool, &prefix))
            }
            _ => None,
        };
        match reusable {
            Some(items) => items,
            None => {
                let cwd = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
                let fresh = completion::paths(&prefix, &cwd);
                state.completion_pool = fresh.clone();
                state.completion_pool_query = Some(prefix.text.clone());
                fresh
            }
        }
    };
    state.completions = Completions::new(items);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_queue_update_reads_steering_before_follow_ups() {
        let value = json!({"type": "queue_update", "steering": ["first"], "followUp": ["second", "third"]});
        let rows = queued(&value);
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].kind, "Steering");
        assert_eq!(rows[0].text, "first");
        assert_eq!(rows[2].kind, "Follow-up");
        assert_eq!(rows[2].text, "third");
    }

    #[test]
    fn an_empty_queue_update_clears_the_area() {
        let value = json!({"type": "queue_update", "steering": [], "followUp": []});
        assert!(queued(&value).is_empty());
    }

    #[test]
    fn an_accepted_prompt_leaves_the_composer_clear() {
        let outcome = prompt_outcome(&json!({"success": true, "data": {"disposition": "steer"}}));
        assert!(matches!(outcome, PromptOutcome::Accepted));
    }

    #[test]
    fn a_prompt_refused_by_a_compaction_is_parked_not_failed() {
        // `agent-session.ts:2194`: "Cannot submit a prompt while compaction is in progress".
        let outcome = prompt_outcome(&json!({
            "success": false,
            "error": "Cannot submit a prompt while compaction is in progress",
        }));
        assert!(matches!(outcome, PromptOutcome::Parked));
    }

    #[test]
    fn any_other_refusal_returns_the_text() {
        let outcome = prompt_outcome(&json!({"success": false, "error": "No API key"}));
        match outcome {
            PromptOutcome::Failed(message) => assert_eq!(message, "No API key"),
            _ => panic!("a plain refusal must not be parked"),
        }
    }
}
