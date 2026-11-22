//! pi's theme, parsed and converted: 56 colour roles define the client's palette.
//!
//! Ticket 04 decided the client reads pi's own theme files rather than shipping a palette, so your
//! theme — including a custom one — looks the same in the client. The file is
//! `modes/interactive/theme/dark.json`: `vars` hold the base colours as `okhsl(...)` strings, and
//! `colors` reference a var by name or carry their own `okhsl(...)`.
//!
//! okhsl is Björn Ottosson's polar form of OKLab: same hues as CSS `oklch` at the same numbers, which is
//! why the conversion here is oklch → oklab → linear sRGB → sRGB, and why the round-trip values are tested
//! against known colours rather than eyeballed.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct Rgb {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

impl Rgb {
    pub fn new(r: u8, g: u8, b: u8) -> Rgb {
        Rgb { r, g, b }
    }

    /// The SGR sequence that selects this colour as the foreground.
    pub fn fg(&self) -> String {
        format!("\u{1b}[38;2;{};{};{}m", self.r, self.g, self.b)
    }

    pub fn hex(&self) -> String {
        format!("#{:02x}{:02x}{:02x}", self.r, self.g, self.b)
    }
}

/// The role names the renderer asks for. Not all 56 are used yet: ticket 16's first cut colours text,
/// markdown, thinking, tools and diff rows, and ticket 17 extends the set.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Role {
    Text,
    Muted,
    Dim,
    Accent,
    Border,
    Success,
    Error,
    Warning,
    UserText,
    UserBackground,
    ThinkingText,
    ToolTitle,
    ToolOutput,
    ToolErrorBackground,
    DiffAdded,
    DiffRemoved,
    DiffContext,
    MdHeading,
    MdCode,
    MdCodeBlock,
    MdCodeBlockBorder,
    MdLink,
    MdQuote,
    MdQuoteBorder,
    MdListBullet,
    MdHr,
    SyntaxComment,
    SyntaxKeyword,
    SyntaxString,
    SyntaxNumber,
    SyntaxFunction,
    SyntaxType,
    SyntaxVariable,
    SyntaxOperator,
    SyntaxPunctuation,
    /// A cell inside a mouse selection: drawn as reverse video, so the selection costs no new colour
    /// (ticket 04 D6 of `.scratch/tui-rust-v2/map.md`).
    Selected,
}

impl Role {
    pub fn key(self) -> &'static str {
        match self {
            Role::Text => "text",
            Role::Muted => "muted",
            Role::Dim => "dim",
            Role::Accent => "accent",
            Role::Border => "border",
            Role::Success => "success",
            Role::Error => "error",
            Role::Warning => "warning",
            Role::UserText => "userMessageText",
            Role::UserBackground => "userMessageBg",
            Role::ThinkingText => "thinkingText",
            Role::ToolTitle => "toolTitle",
            Role::ToolOutput => "toolOutput",
            Role::ToolErrorBackground => "toolErrorBg",
            Role::DiffAdded => "toolDiffAdded",
            Role::DiffRemoved => "toolDiffRemoved",
            Role::DiffContext => "toolDiffContext",
            Role::MdHeading => "mdHeading",
            Role::MdCode => "mdCode",
            Role::MdCodeBlock => "mdCodeBlock",
            Role::MdCodeBlockBorder => "mdCodeBlockBorder",
            Role::MdLink => "mdLink",
            Role::MdQuote => "mdQuote",
            Role::MdQuoteBorder => "mdQuoteBorder",
            Role::MdListBullet => "mdListBullet",
            Role::MdHr => "mdHr",
            Role::SyntaxComment => "syntaxComment",
            Role::SyntaxKeyword => "syntaxKeyword",
            Role::SyntaxString => "syntaxString",
            Role::SyntaxNumber => "syntaxNumber",
            Role::SyntaxFunction => "syntaxFunction",
            Role::SyntaxType => "syntaxType",
            Role::SyntaxVariable => "syntaxVariable",
            Role::SyntaxOperator => "syntaxOperator",
            Role::SyntaxPunctuation => "syntaxPunctuation",
            Role::Selected => "selected",
        }
    }
}

/// A parsed theme: every role that resolved to a colour.
#[derive(Default, Clone)]
pub struct Theme {
    pub name: String,
    /// `NO_COLOR` in the environment: the scaffold emits no SGR at all, so a318-colour terminal or a
    /// redirected log is readable (ticket 11's decision: trust config rather than query).
    pub plain: bool,
    roles: BTreeMap<String, Rgb>,
}

impl Theme {
    pub fn color(&self, role: Role) -> Rgb {
        self.roles.get(role.key()).copied().unwrap_or_else(|| fallback(role))
    }

    /// Parse pi's theme file.
    pub fn load(path: &Path) -> Option<Theme> {
        let text = std::fs::read_to_string(path).ok()?;
        Some(Theme::parse(&text)?)
    }

    /// The theme pi would use by default, from the agent's own install or this repo's `pi/` tree.
    pub fn find_default() -> Theme {
        for candidate in theme_candidates() {
            if candidate.is_file() {
                if let Some(theme) = Theme::load(&candidate) {
                    return theme;
                }
            }
        }
        Theme::default()
    }

    pub fn parse(text: &str) -> Option<Theme> {
        let value: serde_json::Value = serde_json::from_str(text).ok()?;
        let mut vars: BTreeMap<String, Rgb> = BTreeMap::new();
        if let Some(object) = value.get("vars").and_then(|v| v.as_object()) {
            for (key, entry) in object {
                if let Some(spec) = entry.as_str() {
                    if let Some(rgb) = parse_color(spec) {
                        vars.insert(key.clone(), rgb);
                    }
                }
            }
        }
        let mut roles = BTreeMap::new();
        if let Some(object) = value.get("colors").and_then(|v| v.as_object()) {
            for (key, entry) in object {
                let Some(spec) = entry.as_str() else { continue };
                let rgb = vars
                    .get(spec)
                    .copied()
                    .or_else(|| parse_color(spec));
                if let Some(rgb) = rgb {
                    roles.insert(key.clone(), rgb);
                }
            }
        }
        let name = value.get("name").and_then(|v| v.as_str()).unwrap_or("default").to_string();
        Some(Theme { name, roles, plain: no_color() })
    }
}

fn no_color() -> bool {
    std::env::var("NO_COLOR").map(|value| !value.is_empty()).unwrap_or(false)
}

/// The palette used when no theme file is found: pi's dark values, converted once so the client is never
/// colourless. Kept small on purpose — the file is the authority whenever it exists.
fn fallback(role: Role) -> Rgb {
    match role {
        // Reverse video needs no colour; any foreground works, so the plain text colour is used.
        Role::Selected => Rgb::new(0xdd, 0xdd, 0xe0),
        Role::Text => Rgb::new(0xdd, 0xdd, 0xe0),
        Role::Muted => Rgb::new(0x9a, 0x9a, 0xa6),
        Role::Dim => Rgb::new(0x7b, 0x7b, 0x86),
        Role::Accent => Rgb::new(0xc3, 0x8a, 0xf0),
        Role::Border => Rgb::new(0x7f, 0x8f, 0xe3),
        Role::Success => Rgb::new(0x6f, 0xdb, 0xa6),
        Role::Error => Rgb::new(0xe9, 0x84, 0x6f),
        Role::Warning => Rgb::new(0xd6, 0xe3, 0x6f),
        Role::UserText => Rgb::new(0xdd, 0xdd, 0xe0),
        Role::UserBackground => Rgb::new(0x24, 0x28, 0x45),
        Role::ThinkingText => Rgb::new(0x93, 0x93, 0x9c),
        Role::ToolTitle => Rgb::new(0xdd, 0xdd, 0xe0),
        Role::ToolOutput => Rgb::new(0x9a, 0x9a, 0xa6),
        Role::ToolErrorBackground => Rgb::new(0x45, 0x24, 0x24),
        Role::DiffAdded => Rgb::new(0x6f, 0xdb, 0xa6),
        Role::DiffRemoved => Rgb::new(0xe9, 0x84, 0x6f),
        Role::DiffContext => Rgb::new(0x9a, 0x9a, 0xa6),
        Role::MdHeading => Rgb::new(0xd6, 0xe3, 0x6f),
        Role::MdCode => Rgb::new(0xd6, 0xe3, 0x6f),
        Role::MdCodeBlock => Rgb::new(0xc3, 0x8a, 0xf0),
        Role::MdCodeBlockBorder => Rgb::new(0x7b, 0x7b, 0x86),
        Role::MdLink => Rgb::new(0x7f, 0x8f, 0xe3),
        Role::MdQuote => Rgb::new(0x9a, 0x9a, 0xa6),
        Role::MdQuoteBorder => Rgb::new(0x7b, 0x7b, 0x86),
        Role::MdListBullet => Rgb::new(0xc3, 0x8a, 0xf0),
        Role::MdHr => Rgb::new(0x7b, 0x7b, 0x86),
        Role::SyntaxComment => Rgb::new(0x86, 0x86, 0x91),
        Role::SyntaxKeyword => Rgb::new(0xc3, 0x8a, 0xf0),
        Role::SyntaxString => Rgb::new(0x6f, 0xdb, 0xa6),
        Role::SyntaxNumber => Rgb::new(0xe9, 0x84, 0x6f),
        Role::SyntaxFunction => Rgb::new(0x7f, 0x8f, 0xe3),
        Role::SyntaxType => Rgb::new(0xd6, 0xe3, 0x6f),
        Role::SyntaxVariable => Rgb::new(0xdd, 0xdd, 0xe0),
        Role::SyntaxOperator => Rgb::new(0x9a, 0x9a, 0xa6),
        Role::SyntaxPunctuation => Rgb::new(0x7b, 0x7b, 0x86),
    }
}

/// Candidate theme paths, most specific first: the agent directory pi uses, then this repo's pi tree,
/// then the installed pi package.
fn theme_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(dir) = crate::keymap::agent_dir() {
        out.push(dir.join("themes/dark.json"));
        out.push(dir.join("theme/dark.json"));
    }
    if let Some(path) = std::env::var("PI_TUI_THEME").ok() {
        out.push(PathBuf::from(path));
    }
    // This repository: `pi/packages/coding-agent/src/modes/interactive/theme/dark.json`.
    out.push(PathBuf::from("pi/packages/coding-agent/src/modes/interactive/theme/dark.json"));
    out
}

/// `okhsl(...)`, `oklch(...)`, `#rrggbb`, or a named var already resolved.
fn parse_color(spec: &str) -> Option<Rgb> {
    let spec = spec.trim();
    if let Some(hex) = spec.strip_prefix('#') {
        if hex.len() == 6 {
            let r = u8::from_str_radix(&hex[0..2], 16).ok()?;
            let g = u8::from_str_radix(&hex[2..4], 16).ok()?;
            let b = u8::from_str_radix(&hex[4..6], 16).ok()?;
            return Some(Rgb::new(r, g, b));
        }
    }
    let (inner, is_okhsl) = if let Some(rest) = spec.strip_prefix("okhsl(") {
        (rest, true)
    } else if let Some(rest) = spec.strip_prefix("oklch(") {
        (rest, false)
    } else {
        (spec.strip_prefix("hsl(")?, true)
    };
    let inner = inner.trim_end_matches(')');
    let mut numbers = inner.split([' ', ',']).filter(|piece| !piece.is_empty());
    let h = numbers.next()?.parse::<f64>().ok()?;
    let s = numbers.next()?.trim_end_matches('%').parse::<f64>().ok()?;
    let l = numbers.next()?.trim_end_matches('%').parse::<f64>().ok()?;
    // pi writes `okhsl(...)`: saturation is gamut-relative, so it needs the full conversion. A bare
    // `oklch(...)` (CSS spelling) carries chroma directly and takes the short path.
    Some(if is_okhsl {
        okhsl_to_rgb(h, s / 100.0, l / 100.0)
    } else {
        oklch_to_rgb(h, s / 100.0, l / 100.0)
    })
}


// --- OKHSL → sRGB, ported from pi's own reference implementation -------------------------------
//
// `pi/packages/tui/src/oklab.ts` (MIT, Björn Ottosson's colourpicker maths) is what pi itself uses for
// `okhsl(...)` theme values. Porting it rather than approximating matters: treating okhsl as oklch
// disagrees by tens of levels on light tints — `okhsl(234 3% 89%)` is **#dee0e1** in pi and #c8dfec from
// the shortcut (both measured 2026-11-21). The unit tests pin pi's exact outputs.

const K1: f64 = 0.206;
const K2: f64 = 0.03;
const LAB_TO_LMS: [[f64; 3]; 3] = [
    [1.0, 0.3963377773761749, 0.2158037573099136],
    [1.0, -0.1055613458156586, -0.0638541728258133],
    [1.0, -0.0894841775298119, -1.2914855480194092],
];
const LMS_TO_LINEAR_SRGB: [[f64; 3]; 3] = [
    [4.0767416360759583, -3.3077115392580629, 0.2309699031821043],
    [-1.2684379732850315, 2.6097573492876882, -0.341319376002657],
    [-0.0041960761386756, -0.7034186179359362, 1.7076146940746117],
];
const SAT_FIT_AB: [[f64; 2]; 3] = [
    [-1.8817031, -0.80936501],
    [1.8144408, -1.19445267],
    [0.13110758, 1.81333971],
];
const SAT_FIT_K: [[f64; 5]; 3] = [
    [1.19086277, 1.76576728, 0.59662641, 0.75515197, 0.56771245],
    [0.73956515, -0.45954404, 0.08285427, 0.12541073, -0.14503204],
    [1.35733652, -0.00915799, -1.1513021, -0.50559606, 0.00692167],
];

fn k3() -> f64 {
    (1.0 + K1) / (1.0 + K2)
}

fn okhsl_lightness_to_oklab(x: f64) -> f64 {
    (x * x + K1 * x) / (k3() * (x + K2))
}

fn mul3(matrix: &[[f64; 3]; 3], v: [f64; 3]) -> [f64; 3] {
    [
        matrix[0][0] * v[0] + matrix[0][1] * v[1] + matrix[0][2] * v[2],
        matrix[1][0] * v[0] + matrix[1][1] * v[1] + matrix[1][2] * v[2],
        matrix[2][0] * v[0] + matrix[2][1] * v[1] + matrix[2][2] * v[2],
    ]
}

fn linear_to_srgb(value: f64) -> f64 {
    if value > 0.0031308 {
        1.055 * value.powf(1.0 / 2.4) - 0.055
    } else {
        12.92 * value
    }
}

fn oklab_to_linear(lab: [f64; 3]) -> [f64; 3] {
    let lms = mul3(&LAB_TO_LMS, lab);
    let cubed = [lms[0].powi(3), lms[1].powi(3), lms[2].powi(3)];
    mul3(&LMS_TO_LINEAR_SRGB, cubed)
}

fn linear_to_rgb(linear: [f64; 3]) -> Rgb {
    let channel = |value: f64| ((linear_to_srgb(value.clamp(0.0, 1.0)) * 255.0).round()) as u8;
    Rgb::new(channel(linear[0]), channel(linear[1]), channel(linear[2]))
}

fn lms_slopes(a: f64, b: f64) -> [f64; 3] {
    [
        LAB_TO_LMS[0][1] * a + LAB_TO_LMS[0][2] * b,
        LAB_TO_LMS[1][1] * a + LAB_TO_LMS[1][2] * b,
        LAB_TO_LMS[2][1] * a + LAB_TO_LMS[2][2] * b,
    ]
}

fn max_saturation(a: f64, b: f64) -> f64 {
    let mut channel = 2usize;
    for index in 0..2 {
        if SAT_FIT_AB[index][0] * a + SAT_FIT_AB[index][1] * b > 1.0 {
            channel = index;
            break;
        }
    }
    let [k0, k1, k2, k3v, k4] = SAT_FIT_K[channel];
    let weights = LMS_TO_LINEAR_SRGB[channel];
    let saturation = k0 + k1 * a + k2 * b + k3v * a * a + k4 * a * b;
    let slopes = lms_slopes(a, b);
    let base = [1.0 + saturation * slopes[0], 1.0 + saturation * slopes[1], 1.0 + saturation * slopes[2]];
    let dot = |values: [f64; 3]| weights[0] * values[0] + weights[1] * values[1] + weights[2] * values[2];
    let f = dot([base[0].powi(3), base[1].powi(3), base[2].powi(3)]);
    let f1 = dot([
        3.0 * slopes[0] * base[0] * base[0],
        3.0 * slopes[1] * base[1] * base[1],
        3.0 * slopes[2] * base[2] * base[2],
    ]);
    let f2 = dot([
        6.0 * slopes[0] * slopes[0] * base[0],
        6.0 * slopes[1] * slopes[1] * base[1],
        6.0 * slopes[2] * slopes[2] * base[2],
    ]);
    saturation - (f * f1) / (f1 * f1 - 0.5 * f * f2)
}

fn cusp(a: f64, b: f64) -> (f64, f64) {
    let saturation = max_saturation(a, b);
    let linear = oklab_to_linear([1.0, saturation * a, saturation * b]);
    let lightness = (1.0 / linear[0].max(linear[1]).max(linear[2]).max(1e-12)).cbrt();
    (lightness, lightness * saturation)
}

fn max_chroma(a: f64, b: f64, lightness: f64, cusp: (f64, f64)) -> f64 {
    let (cusp_l, cusp_c) = cusp;
    if lightness <= cusp_l {
        return (cusp_c * lightness) / cusp_l;
    }
    let t = (cusp_c * (lightness - 1.0)) / (cusp_l - 1.0);
    let slopes = lms_slopes(a, b);
    let lms = [lightness + t * slopes[0], lightness + t * slopes[1], lightness + t * slopes[2]];
    let cubes = [lms[0].powi(3), lms[1].powi(3), lms[2].powi(3)];
    let first = [3.0 * slopes[0] * lms[0] * lms[0], 3.0 * slopes[1] * lms[1] * lms[1], 3.0 * slopes[2] * lms[2] * lms[2]];
    let second = [6.0 * slopes[0] * slopes[0] * lms[0], 6.0 * slopes[1] * slopes[1] * lms[1], 6.0 * slopes[2] * slopes[2] * lms[2]];
    let mut smallest = f64::MAX;
    for row in LMS_TO_LINEAR_SRGB {
        let f = row[0] * cubes[0] + row[1] * cubes[1] + row[2] * cubes[2] - 1.0;
        let f1 = row[0] * first[0] + row[1] * first[1] + row[2] * first[2];
        let f2 = row[0] * second[0] + row[1] * second[1] + row[2] * second[2];
        let u = f1 / (f1 * f1 - 0.5 * f * f2);
        let step = if u >= 0.0 { -f * u } else { f64::MAX };
        if step < smallest {
            smallest = step;
        }
    }
    t + smallest
}

fn chroma_stops(lightness: f64, a: f64, b: f64) -> (f64, f64, f64) {
    let peak = cusp(a, b);
    let c_max = max_chroma(a, b, lightness, peak);
    let k = c_max / (lightness * (peak.1 / peak.0)).min((1.0 - lightness) * (peak.1 / (1.0 - peak.0)));
    let mid_s = 0.11516993
        + 1.0
            / (7.4477897
                + 4.1590124 * b
                + a * (-2.19557347
                    + 1.75198401 * b
                    + a * (-2.13704948 - 10.02301043 * b + a * (-4.24894561 + 5.38770819 * b + 4.69891013 * a))));
    let mid_t = 0.11239642
        + 1.0
            / (1.6132032
                - 0.68124379 * b
                + a * (0.40370612
                    + 0.90148123 * b
                    + a * (-0.27087943 + 0.6122399 * b + a * (0.00299215 - 0.45399568 * b - 0.14661872 * a))));
    let c_mid = 0.9 * k * (((1.0 / (1.0 / (lightness * mid_s).powi(4) + 1.0 / ((1.0 - lightness) * mid_t).powi(4))).sqrt()).sqrt());
    let c0 = (1.0 / (1.0 / (lightness * 0.4).powi(2) + 1.0 / ((1.0 - lightness) * 0.8).powi(2))).sqrt();
    (c0, c_mid, c_max)
}

/// OKHSL (hue degrees, saturation 0–1, lightness 0–1) to sRGB, matching pi's own renderer.
pub fn okhsl_to_rgb(hue: f64, saturation: f64, lightness: f64) -> Rgb {
    let l = okhsl_lightness_to_oklab(lightness);
    let mut lab = [l, 0.0, 0.0];
    if l > 0.0 && l < 1.0 && saturation > 0.0 {
        let angle = 2.0 * std::f64::consts::PI * (((hue % 360.0) + 360.0) % 360.0) / 360.0;
        let a = angle.cos();
        let b = angle.sin();
        let (c0, c_mid, c_max) = chroma_stops(l, a, b);
        let chroma = if saturation < 0.8 {
            let t = 1.25 * saturation;
            let k1 = 0.8 * c0;
            (t * k1) / (1.0 - (1.0 - k1 / c_mid) * t)
        } else {
            let t = 5.0 * (saturation - 0.8);
            let k1 = (0.2 * c_mid * c_mid * 1.25 * 1.25) / c0;
            c_mid + (t * k1) / (1.0 - (1.0 - k1 / (c_max - c_mid)) * t)
        };
        lab = [l, chroma * a, chroma * b];
    }
    linear_to_rgb(oklab_to_linear(lab))
}

/// CSS `oklch(...)`: chroma given directly, so oklab is built without the OKHSL gamut mapping.
pub fn oklch_to_rgb(hue_deg: f64, chroma: f64, lightness: f64) -> Rgb {
    let hue = hue_deg.to_radians();
    let lab = [lightness, chroma * hue.cos(), chroma * hue.sin()];
    linear_to_rgb(oklab_to_linear(lab))
}

/// The alternative OKLab path kept for `oklch(...)` documents. Unused by the okhsl port.
#[allow(dead_code)]
fn to_srgb(linear: f64) -> u8 {
    let clamped = linear.clamp(0.0, 1.0);
    let encoded = if clamped <= 0.003_130_8 {
        12.92 * clamped
    } else {
        1.055 * clamped.powf(1.0 / 2.4) - 0.055
    };
    (encoded.clamp(0.0, 1.0) * 255.0).round() as u8
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Values produced by pi's own renderer (`pi/packages/tui/src/oklab.ts` via `okhslToRgb`), captured
    /// 2026-11-21 so a conversion regression is a failing test rather than a different-looking palette.
    #[test]
    fn okhsl_matches_pi_exactly() {
        let cases = [
            ("234 3% 89%", "#dee0e1"),
            ("229 6% 67%", "#9da5a9"),
            ("295 50% 67%", "#a798d7"),
            ("231 57% 65%", "#5fa8cc"),
            ("159 59% 67%", "#68b78d"),
            ("20 72% 67%", "#ea7f81"),
            ("83 88% 67%", "#cd9a22"),
            ("233 41% 24%", "#213b49"),
            ("229 8% 56%", "#7e888e"),
            ("226 7% 65%", "#96a0a4"),
        ];
        for (spec, expected) in cases {
            let rgb = parse_color(&format!("okhsl({spec})")).expect("a colour");
            assert_eq!(rgb.hex(), expected, "okhsl({spec})");
        }
    }

    #[test]
    fn black_and_white_convert_exactly() {
        assert_eq!(okhsl_to_rgb(0.0, 0.0, 0.0), Rgb::new(0, 0, 0));
        assert_eq!(okhsl_to_rgb(0.0, 0.0, 1.0), Rgb::new(255, 255, 255));
    }

    #[test]
    fn a_known_green_converts_within_a_few_steps() {
        // CSS `oklch(60% 0.15 145)` is a mid green; the exact sRGB is ~#4b9a5e.
        let rgb = okhsl_to_rgb(145.0, 0.60, 0.60);
        assert!(rgb.g > rgb.r + 30 && rgb.g > rgb.b + 20, "green dominant: {:?}", rgb);
        assert!(rgb.g > 100 && rgb.g < 200, "mid-tone green: {:?}", rgb);
    }

    #[test]
    fn a_pi_theme_file_parses_its_vars_and_roles() {
        let text = r#"{
            "name": "dark",
            "vars": {"text": "okhsl(234 3% 89%)", "violet": "okhsl(295 50% 67%)"},
            "colors": {"accent": "violet", "text": "text", "border": "okhsl(231 57% 65%)"}
        }"#;
        let theme = Theme::parse(text).expect("a theme");
        assert_eq!(theme.name, "dark");
        // A role that names a var resolves through it.
        assert_eq!(theme.color(Role::Accent), parse_color("okhsl(295 50% 67%)").unwrap());
        // Light text is light, and it is not the fallback.
        let text_rgb = theme.color(Role::Text);
        assert!(text_rgb.r > 150 && text_rgb.b > 150, "light text: {text_rgb:?}");
        // A parsed role wins over the built-in palette: the file is the authority.
        assert_ne!(text_rgb, fallback(Role::Text));
    }

    #[test]
    fn an_unknown_role_falls_back_to_the_built_in_palette() {
        let theme = Theme::parse(r#"{"colors": {"text": "okhsl(234 3% 89%)"}}"#).expect("a theme");
        assert_eq!(theme.color(Role::MdHeading), fallback(Role::MdHeading));
    }

    #[test]
    fn the_repository_theme_file_parses_and_has_the_advertised_role_count() {
        // crates/pi-tui -> crates -> tui -> extensions -> repo root
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .ancestors()
            .nth(4)
            .expect("the repository root")
            .to_path_buf();
        let path = root.join("pi/packages/coding-agent/src/modes/interactive/theme/dark.json");
        let theme = Theme::load(&path).unwrap_or_else(|| panic!("a theme at {}", path.display()));
        // 56 roles in dark.json (ticket 04's fact); every one of the roles this module names must resolve.
        for role in [
            Role::Text,
            Role::MdHeading,
            Role::MdCode,
            Role::SyntaxKeyword,
            Role::SyntaxString,
            Role::ToolTitle,
            Role::DiffAdded,
            Role::ThinkingText,
            Role::UserBackground,
        ] {
            let _ = theme.color(role);
        }
        assert!(theme.roles.len() >= 50, "roles parsed: {}", theme.roles.len());
        // Every role pi ships resolves to a colour that differs from the fallback, so a typo in a key
        // name cannot pass as "the palette is fine".
        let text = theme.color(Role::Text);
        assert_eq!(text.hex(), "#dee0e1", "pi's dark text colour is #dee0e1, got {}", text.hex());
    }

    #[test]
    fn a_false_hex_is_not_a_colour_but_a_hex_is() {
        assert_eq!(parse_color("#ff8000"), Some(Rgb::new(255, 128, 0)));
        assert_eq!(parse_color("not-a-colour"), None);
    }
}
