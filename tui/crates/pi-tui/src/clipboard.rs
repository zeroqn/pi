//! The clipboard: one OSC 52 write.
//!
//! Ticket 04 D3 of `.scratch/tui-rust-v2/map.md`, after the user overrode the first answer: **OSC 52
//! only**, no spawned `wl-copy`/`xclip`/`xsel`/`pbcopy`, no dependency. pi's warning is the accepted
//! risk — a bare OSC 52 write "can show 'Copied!' while leaving the system clipboard untouched" (macOS
//! Terminal.app, tmux without passthrough, `tui-alt-screen.ts:1486-1503`). Nothing can verify it, so the
//! status line says *sent to the terminal*, never *Copied!*.

/// The escape sequence that asks the terminal to put `text` on the system clipboard.
pub fn osc52(text: &str) -> String {
    format!("\u{1b}]52;c;{}\u{7}", base64(text.as_bytes()))
}

/// Base64, padded, RFC 4648. A local copy rather than a crate: OSC 52 needs nothing else from it.
pub fn base64(bytes: &[u8]) -> String {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0];
        let b1 = chunk.get(1).copied().unwrap_or(0);
        let b2 = chunk.get(2).copied().unwrap_or(0);
        out.push(TABLE[(b0 >> 2) as usize] as char);
        out.push(TABLE[(((b0 & 0b11) << 4) | (b1 >> 4)) as usize] as char);
        out.push(if chunk.len() > 1 { TABLE[(((b1 & 0b1111) << 2) | (b2 >> 6)) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { TABLE[(b2 & 0b111111) as usize] as char } else { '=' });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches_the_standard_vectors() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foob"), "Zm9vYg==");
        assert_eq!(base64(b"hello"), "aGVsbG8=");
        assert_eq!(base64("héllo".as_bytes()), "aMOpbGxv");
    }

    #[test]
    fn the_sequence_is_osc52_with_the_base64_and_a_bel() {
        let sequence = osc52("hi");
        assert_eq!(sequence, "\u{1b}]52;c;aGk=\u{7}");
        assert!(sequence.starts_with("\u{1b}]52;c;"), "the clipboard selector is `c`");
        assert!(sequence.ends_with('\u{7}'), "BEL terminates it, as xterm expects");
    }
}
