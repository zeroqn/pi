/**
 * The egress guard — a text gate against a code-mode cell using `bash` to leave this host.
 *
 * A cell can run shell commands on the host (`await bash("curl https://x")`). Web content fetched
 * that way returns into Python and reaches the model **unfenced**, bypassing the
 * `<untrusted_web_content>` guard that `web_access`/`fetch_content` apply. This module is the
 * always-on egress policy for that hole: it refuses the shell command and steers the model to
 * `await fetch_content(url)`, which fences what it returns.
 *
 * ## What this is, and is not
 *
 * It is a **guardrail, not a sandbox**. It reasons about the command *text only* — no imports, no
 * I/O, no network, no environment. Every rule below can be defeated by indirection:
 *
 *   - `sh -c 'curl https://x'`, `bash -lc ...` — the shell word is not an egress word;
 *   - `base64 -d <<< ... | sh`, `eval "$(...)"`, `$(...)`, backtick and heredoc indirection;
 *   - `/p/a/t/h/t/o/curl`-style tricks and interpreters this table does not know (`zsh -c`,
 *     `lua -e`, `tclsh`, a compiled helper);
 *   - `socat`/`nc` spelled as an alias, or any command whose *name* is innocent and whose
 *     *arguments* are a URL the table does not treat as egress.
 *
 * The **primary** defense is the system-prompt rule (`SYSTEM_PROMPT_SECTION` in guard.ts), which
 * tells the model to fetch pages through `fetch_content` and never to shell out for them. This
 * module backs that rule up; it does not replace it. Fail-open is deliberate everywhere it is not
 * clearly egress: a false refusal costs a working local command, and the class of command shapes
 * is unbounded, so this refuses only shapes it recognizes.
 *
 * ## How it reads a command
 *
 * The command is split into segments on unquoted `;`, `&&`, `||`, `|`, `&`, newlines, parentheses
 * and backticks (so `echo $(curl https://x)` and `(curl https://x)` are seen), quoted spans are
 * inert, and comments are stripped. A segment's command word is the basename of its first token
 * (`/usr/bin/curl` is `curl`), after leading `VAR=value` assignments and a handful of wrapper
 * words (`sudo`, `env`, `timeout`, `nohup`, `xargs`, ...). One refused segment refuses the whole
 * command. A URL or a command name merely *appearing* in the text is never a refusal — `grep -rn
 * 'http' .`, `ls https*` and `find . -name '*.json'` all pass.
 *
 * ## The line: what is refused, and what is deliberately not
 *
 * Refused: commands whose **stdout is external content** — the fence bypass itself. A fetcher
 * (`curl`, `wget`, httpie, `aria2c`), a raw transport (`nc`, `socat`, `telnet`, `ftp`, `ssh`,
 * `scp`, `sftp`, `mosh`), a remote-spec `rsync`, the git subcommands that print what a remote
 * answers (`ls-remote`, `remote show`, `archive --remote`), a raw `/dev/tcp` socket, or an
 * interpreter whose inline program names a network capability. Each of these puts text from the
 * network in front of the model with no `<untrusted_web_content>` marker.
 *
 * Deliberately **not** refused: everything that downloads code to disk or talks to a remote API —
 * `npm`/`pnpm`/`yarn`/`pip`/`uv`/`cargo`/`go`/`gem`/`composer`/`apt`/`brew`/`nix` install and build,
 * `npx`/`bunx`/`uvx`, `docker pull`, `git clone`/`fetch`/`pull`/`push`, and
 * `gh`/`aws`/`gcloud`/`az`/`kubectl`/`helm`. Their stdout is progress and status rather than page
 * content, and refusing them would break ordinary work in a session that is not read-only. What they
 * write to disk is a *file* by the time the model reads it — the same as any other file on the host,
 * which no text gate can tell apart. `curl`/`wget` version and help probes pass for the same reason:
 * no text comes back.
 *
 * ## Judgement calls worth stating
 *
 *   - `curl`/`wget` are refused **only when they actually transfer**: `curl --version`, `wget -h`
 *     and a bare `curl` pass, because none of them opens a socket.
 *   - `rsync` is refused only for a **remote spec** (`host:path`, `rsync://`, `-e ssh`); plain
 *     `rsync -a src/ dst/` is a local copy.
 *   - an interpreter's inline program is refused only when it names a network capability, so
 *     `python3 -c 'print(1)'` passes and `python3 -c 'import urllib.request'` does not. The match is
 *     against the whole segment, so a program that merely *mentions* `requests` is refused too — at
 *     this layer the false refusal is the cheaper error.
 */

export type EgressVerdict = { ok: true } | { ok: false; reason: string };

/** The sentence every refusal ends with: the fenced route back. */
const FENCE =
	"use await fetch_content(url) instead — it fences what it returns — or fetch_content(url, via=\"shell\") when the normal route cannot reach the page: it falls back to curl on this host and fences that too";

function block(saw: string): EgressVerdict {
	return { ok: false, reason: `web-access: that command ${saw}; ${FENCE}.` };
}

/** `FOO=bar` before the command word. */
const ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** The `curl`/`wget` flags that are a probe, not a transfer. */
const PROBE = new Set(["--version", "-V", "-v", "--help", "-h", "--manual"]);

/** Commands that are a transport and have no useful local form. */
const NETWORK_TRANSPORTS = new Set([
	"nc", "ncat", "netcat", "socat", "telnet", "ftp", "tftp", "lftp", "curlftpfs",
	"xh", "httpie", "http", "https", "aria2c", "axel",
	"ssh", "scp", "sftp", "sshpass", "mosh",
]);

/** Wrapper words: unwrapped so the real command behind them is judged. Bounded. */
type Wrapper = { leadingNumber?: boolean };
const WRAPPERS: Record<string, Wrapper> = {
	sudo: {}, doas: {}, command: {}, nohup: {}, setsid: {}, exec: {}, xargs: {}, stdbuf: {},
	env: {},
	timeout: { leadingNumber: true }, nice: { leadingNumber: true }, ionice: { leadingNumber: true },
};

/** Interpreters whose inline `-c`/`-e`/`-r` program may itself reach the network. */
type InlineRule = { cmds: Set<string>; flags: Set<string>; net: RegExp; label: string };
const INLINE_RULES: InlineRule[] = [
	{
		cmds: new Set(["python", "python3"]),
		flags: new Set(["-c"]),
		net: /urllib|requests|http\.client|httplib|socket|aiohttp|httpx|urlopen|urlretrieve|pycurl|http\.server/,
		label: "python",
	},
	{
		cmds: new Set(["node", "bun"]),
		flags: new Set(["-e", "--eval", "--print"]),
		net: /fetch\s*\(|https?\.(get|request|createServer)|require\s*\(\s*['"](node:)?(http|https|net|axios|node-fetch|undici|got)['"]|from\s+['"](node:)?(http|https|net)['"]|axios|node-fetch|undici|superagent|got\s*\(/,
		label: "javascript",
	},
	{
		cmds: new Set(["perl"]),
		flags: new Set(["-e"]),
		net: /LWP|HTTP::|IO::Socket|Net::(HTTP|FTP|SMTP)|HTTP::Tiny|Mojo::UserAgent|getstore/,
		label: "perl",
	},
	{
		cmds: new Set(["ruby"]),
		flags: new Set(["-e"]),
		net: /net\/http|open-uri|open_uri|URI\.open|URI\.parse|TCPSocket|UDPSocket|Socket\.|httparty|Faraday|RestClient|Net::HTTP/,
		label: "ruby",
	},
	{
		cmds: new Set(["php"]),
		flags: new Set(["-r"]),
		net: /curl_|file_get_contents\s*\(\s*['"]https?:|fsockopen|stream_socket_client|GuzzleHttp|fopen\s*\(\s*['"]https?:|get_headers/,
		label: "php",
	},
];

const GIT_VALUE_FLAGS = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--super-prefix", "--exec-path", "--config-env"]);

const SOCKET_REDIRECT = /\/dev\/(tcp|udp)\//;
const SEPARATORS = new Set([";", "|", "&", "(", ")", "`", "\n"]);

function unquote(token: string): string {
	const match = token.match(/^(['"])(.*)\1$/s);
	return match ? match[2] : token;
}

function basename(token: string): string {
	const text = unquote(token);
	const slash = text.lastIndexOf("/");
	return slash === -1 ? text : text.slice(slash + 1);
}

/** Drop shell comments (`#` at the start of a word, outside quotes). */
function stripComments(text: string): string {
	let out = "";
	let quote: string | null = null;
	let atWordStart = true;
	let i = 0;
	while (i < text.length) {
		const ch = text[i];
		if (quote !== null) {
			out += ch;
			if (ch === "\\" && quote === '"') { out += text[i + 1] ?? ""; i += 2; continue; }
			if (ch === quote) quote = null;
			i += 1;
			continue;
		}
		if (ch === "'" || ch === '"') { quote = ch; out += ch; atWordStart = false; i += 1; continue; }
		if (ch === "#" && atWordStart) {
			while (i < text.length && text[i] !== "\n") i += 1;
			continue;
		}
		out += ch;
		atWordStart = ch === " " || ch === "\t" || ch === "\n" || ch === ";" || ch === "&" || ch === "|" || ch === "(" || ch === ")";
		i += 1;
	}
	return out;
}

/** Split into segments on unquoted separators; quoted spans are kept intact. */
function splitSegments(text: string): string[] {
	const out: string[] = [];
	let cur = "";
	let quote: string | null = null;
	let i = 0;
	while (i < text.length) {
		const ch = text[i];
		if (quote !== null) {
			cur += ch;
			if (ch === "\\" && quote === '"') { cur += text[i + 1] ?? ""; i += 2; continue; }
			if (ch === quote) quote = null;
			i += 1;
			continue;
		}
		if (ch === "'" || ch === '"') { quote = ch; cur += ch; i += 1; continue; }
		if (ch === "\\") { cur += ch; if (i + 1 < text.length) cur += text[i + 1]; i += 2; continue; }
		if (SEPARATORS.has(ch)) { out.push(cur); cur = ""; i += 1; continue; }
		cur += ch;
		i += 1;
	}
	out.push(cur);
	return out;
}

function segmentTokens(segment: string): string[] {
	let tokens = segment.trim().split(/\s+/).filter((token) => token !== "");
	while (tokens.length > 0 && ASSIGN.test(tokens[0])) tokens = tokens.slice(1);
	return tokens;
}

/** Peel wrapper words so the command they run is the one judged. */
function unwrap(tokens: string[]): string[] {
	let depth = 0;
	while (tokens.length > 0 && depth < 4) {
		const name = basename(tokens[0]);
		const wrapper = WRAPPERS[name];
		if (wrapper === undefined) break;
		// `command -v X` / `command -V X` look a command up; they never run it.
		if (name === "command" && (tokens[1] === "-v" || tokens[1] === "-V")) break;
		let rest = tokens.slice(1);
		if (name === "env") {
			while (rest.length > 0 && (ASSIGN.test(rest[0]) || rest[0].startsWith("-"))) rest = rest.slice(1);
		} else {
			while (rest.length > 0 && rest[0].startsWith("-")) rest = rest.slice(1);
			if (wrapper.leadingNumber && rest.length > 0 && /^\d/.test(rest[0])) rest = rest.slice(1);
		}
		tokens = rest;
		depth += 1;
	}
	return tokens;
}

function rsyncRemote(args: string[]): boolean {
	for (const arg of args) {
		if (arg === "-e" || arg === "--rsh" || arg.startsWith("--rsh=")) return true;
		if (arg.startsWith("rsync://")) return true;
		if (!arg.startsWith("-") && /^[^/\\]*:/.test(arg) && !/^[A-Za-z]:[\\/]/.test(arg)) return true;
	}
	return false;
}

function gitParts(args: string[]): { sub: string; rest: string[] } | null {
	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i];
		if (arg === "--") continue;
		if (GIT_VALUE_FLAGS.has(arg)) { i += 1; continue; }
		if ((arg.startsWith("-C") || arg.startsWith("-c")) && arg.length > 2) continue;
		if (
			arg.startsWith("--git-dir=") || arg.startsWith("--work-tree=") || arg.startsWith("--exec-path=") ||
			arg.startsWith("--config-env=") || arg.startsWith("--namespace=") || arg.startsWith("--super-prefix=")
		) continue;
		if (arg.startsWith("-")) continue;
		return { sub: arg, rest: args.slice(i + 1) };
	}
	return null;
}

function checkSegment(segment: string): EgressVerdict {
	const tokens = unwrap(segmentTokens(segment));
	if (tokens.length === 0) return { ok: true };
	const cmd = basename(tokens[0]);
	const args = tokens.slice(1);

	// Interpreters with an inline program: only refused when the program names a network capability.
	for (const rule of INLINE_RULES) {
		if (!rule.cmds.has(cmd)) continue;
		if (!args.some((arg) => rule.flags.has(arg))) continue;
		if (rule.net.test(segment)) return block(`runs an inline ${rule.label} program that can reach the network (${cmd})`);
		return { ok: true };
	}

	if (NETWORK_TRANSPORTS.has(cmd)) return block(`uses the network (${cmd})`);

	if (cmd === "curl" || cmd === "wget") {
		if (args.length === 0 || args.every((arg) => PROBE.has(arg))) return { ok: true };
		return block(`fetches over the network (${cmd})`);
	}

	if (cmd === "rsync") {
		return rsyncRemote(args) ? block("transfers over the network (rsync)") : { ok: true };
	}

	if (cmd === "git") {
		const parts = gitParts(args);
		if (parts === null) return { ok: true };
		if (parts.sub === "ls-remote") return block("talks to a remote git server (git ls-remote)");
		if (parts.sub === "remote") {
			if (parts.rest.some((arg) => arg === "show")) {
				return block("talks to a remote git server (git remote show)");
			}
			return { ok: true };
		}
		if (parts.sub === "archive") {
			if (parts.rest.some((arg) => arg === "--remote" || arg.startsWith("--remote="))) {
				return block("talks to a remote git server (git archive --remote)");
			}
			return { ok: true };
		}
		return { ok: true };
	}

	return { ok: true };
}

// ===========================================================================
// The transport destination matcher (ticket 03): the `{keys, refusal}` companion
// to `checkEgress` for the five commands whose destination is a host.
//
// `checkEgress` decides *whether a command's stdout is external content*. This
// pair decides *which hosts a transport command names*, so the policy (a later
// ticket) can compare the set against a session's grants:
//
//   destinationKeys(command)  ->  { keys, refused? }   // read the text
//   unmatched(keys, granted)  ->  { missing, unmatched } // compare the set
//   transportRefusal(flags)   ->  string                // word the refusal
//
// Nothing here reads session state: the policy holds the grants, and the flags
// that shape the refusal (hasUI/isChild/projectTrusted) are passed in.
//
// It implements the research's grammar (`01-the-destination-grammar.md`) and its
// ambiguity calls A1-A12: options may follow positionals (`ssh host -p 2222`,
// `mosh host --ssh=…`, `rsync src host:dst -av`); `scp`/`rsync` have a
// destination *role*, not a position; the colon is conditional (`a/b:c` local);
// the option tables collide across the family (`scp`/`sftp -P` is the port,
// `ssh -P` a tag, `ssh -p` the port, `rsync -p` `--perms`); and the second hosts
// live inside option values (`-J a,b`, `-o ProxyJump=`, `-W`,
// `-o ProxyCommand=`, rsync's `-e 'ssh -J …'`, mosh's `--ssh=`).
// ===========================================================================

/** The transport family whose destination is a host. */
type FamilyName = "ssh" | "scp" | "sftp" | "mosh" | "rsync";

const FAMILY_NAMES: ReadonlySet<string> = new Set(["ssh", "scp", "sftp", "mosh", "rsync"]);

/** What reading a transport command's text found. */
export type DestinationReading = {
	/** Every destination key the command names, in the order written, deduplicated. */
	keys: string[];
	/**
	 * A refusal about the *text* itself — never about a grant. A complete `web-access: …`
	 * reason, so the policy can pass it straight through.
	 */
	refused?: string;
};

/**
 * What comparing a command's key set against a session's grants found.
 *
 * The pair keeps ticket 03's distinction — *no grant at all* vs *grants held, none
 * matching* — in which of the two arrays is populated:
 *   - `missing`  — the whole key set, when the session holds **no grant at all**;
 *   - `unmatched`— the keys it holds no grant for, when it holds at least one grant.
 * `missing.concat(unmatched)` is always the full list of ungranted keys, and both are
 * empty exactly when the command's whole set is granted.
 */
export type GrantComparison = {
	missing: string[];
	unmatched: string[];
};

/** The session state a transport refusal is shaped by; the policy supplies it. */
export type TransportRefusalFlags = {
	/** The command text, for the "reaches …" clause. */
	command: string;
	/** Every key the command named. */
	keys: readonly string[];
	/** What `unmatched()` returned. */
	comparison: GrantComparison;
	/** Whether a dialog-capable endpoint exists (`ctx.hasUI`). */
	hasUI: boolean;
	/** Whether this session is a spawned `rlm` child, which has no dialog at all. */
	isChild: boolean;
	/** Whether the project's `.pi/ssh-grant.json` was read (`ctx.isProjectTrusted()`). */
	projectTrusted: boolean;
	/** Whether the human already declined one of these keys for this session. */
	declined?: boolean;
};

/** Split a shell segment into logical tokens: whitespace outside quotes, quotes stripped. */
function shellTokens(text: string): string[] {
	const out: string[] = [];
	let cur = "";
	let has = false;
	let quote: string | null = null;
	let i = 0;
	while (i < text.length) {
		const ch = text[i];
		if (quote !== null) {
			if (ch === "\\" && quote === '"') { cur += text[i + 1] ?? ""; i += 2; has = true; continue; }
			if (ch === quote) { quote = null; i += 1; continue; }
			cur += ch; i += 1; has = true; continue;
		}
		if (ch === "'" || ch === '"') { quote = ch; i += 1; has = true; continue; }
		if (ch === "\\") { cur += text[i + 1] ?? ""; i += 2; has = true; continue; }
		if (ch === " " || ch === "\t" || ch === "\n") {
			if (has) { out.push(cur); cur = ""; has = false; }
			i += 1; continue;
		}
		cur += ch; i += 1; has = true;
	}
	if (has) out.push(cur);
	return out;
}

/** Peel leading assignments and wrapper words (`sudo`, `env`, `timeout`, `sshpass`, …). */
function peel(tokens: string[]): string[] {
	let t = tokens;
	while (t.length > 0 && ASSIGN.test(t[0])) t = t.slice(1);
	t = unwrap(t);
	// `sshpass [-p pw] [-f file] [-d n] [-e] ssh …` wraps the real transport; its value options must
	// not be mistaken for the command word.
	while (t.length > 0 && basename(t[0]) === "sshpass") {
		let rest = t.slice(1);
		while (rest.length > 0 && rest[0].startsWith("-") && rest[0].length > 1) {
			const body = rest[0].slice(1);
			const attachedValue = "pfdP".includes(body[0]) && body.length > 1;
			const takesNext = "pfdP".includes(body[0]) && body.length === 1;
			rest = rest.slice(1);
			if (takesNext && rest.length > 0) rest = rest.slice(1);
			if (attachedValue) break;
		}
		if (rest.length > 0 && rest[0] === "--") rest = rest.slice(1);
		t = rest;
	}
	return t;
}

function dedupe(list: string[]): string[] {
	const seen: Set<string> = new Set();
	const out: string[] = [];
	for (const item of list) {
		if (!seen.has(item)) { seen.add(item); out.push(item); }
	}
	return out;
}

/** The per-command option tables. A letter here takes a value; everything else is boolean. */
type FamilyTable = {
	valueShort: string;
	valueLong: readonly string[];
};

const FAMILY_TABLES: Record<FamilyName, FamilyTable> = {
	// ssh.c: `getopt(… "B:D:E:F:I:J:L:O:P:Q:R:S:W:b:c:e:i:l:m:o:p:w:")`
	ssh: { valueShort: "BDEFIJLOPQRSWbceilmopw", valueLong: [] },
	// scp.c: `getopt(… "D:F:J:M:P:S:c:i:l:o:X:")`
	scp: { valueShort: "DFJMPSciloX", valueLong: [] },
	// sftp.c: `getopt(… "c:D:i:l:o:s:S:b:B:F:J:P:R:X:")`
	sftp: { valueShort: "cDilosSbBFJPRX", valueLong: [] },
	// mosh.pl: Getopt::Long — `-p/--port` is the UDP range, not the SSH port.
	mosh: {
		valueShort: "p",
		valueLong: ["client", "server", "predict", "port", "family", "ssh", "bind-server", "experimental-remote-ip"],
	},
	// rsync/popt: short options take their value space-separated; `-p` is `--perms`.
	rsync: {
		valueShort: "eBfMT",
		valueLong: [
			"rsh", "rsync-path", "block-size", "filter", "remote-option", "temp-dir", "out-format",
			"log-format", "log-file", "log-file-format", "password-file", "exclude", "include",
			"exclude-from", "include-from", "files-from", "backup-dir", "suffix", "partial-dir",
			"compare-dest", "copy-dest", "link-dest", "max-size", "min-size", "max-delete", "max-alloc",
			"bwlimit", "timeout", "contimeout", "port", "sockopts", "outbuf", "address", "protocol",
			"checksum-seed", "modify-window", "compress-level", "compress-choice", "iconv", "chown",
			"chmod", "usermap", "groupmap", "copy-as", "early-input", "stop-after", "time-limit",
			"max-connections", "write-batch", "only-write-batch", "read-batch", "stderr", "debug", "info",
		],
	},
};

/** The mutable result of walking one transport invocation's arguments. */
type Parsed = {
	positionals: string[];
	/** Raw host specs mined from `-J`, `-W`, `ProxyJump`, `ProxyCommand`. */
	secondSpecs: string[];
	/** Keys already extracted from a nested command (`-e`, `--rsh`, `--ssh`). */
	extraKeys: string[];
	/** The SSH port the command names (`-p`, `-P`, `-o Port=`, `-e 'ssh -p N'`). */
	port?: string;
	/**
	 * The login the command names as an *option* rather than in the destination: `-l user`, `-o User=`,
	 * or the `-l` of a nested remote shell (`-e 'ssh -l user'`, `--ssh="ssh -l user"`).
	 *
	 * It is folded into the destination key, because `ssh -l root host` reaches `root@host` and a key
	 * that covered every user would be the widening ticket 03 §1 rejected: the human granted one
	 * authority, not the host. An explicit `user@host` in the destination wins over it, as it does for
	 * ssh itself.
	 */
	user?: string;
	/** The rsync daemon port (`--port`). */
	daemonPort?: string;
	/** A dynamic forward (`-D`/`DynamicForward`) — refused even under a grant. */
	dynamicForward: boolean;
	/** A local query (`ssh -V`, `ssh -Q …`, `mosh --version`) — reaches nobody. */
	querySeen: boolean;
	/** A URI whose host or port the text does not determine — refused, not guessed. */
	ambiguous: boolean;
	/** Whether a positional yielded a destination key. */
	destinationFound: boolean;
};

function newParsed(): Parsed {
	return {
		positionals: [],
		secondSpecs: [],
		extraKeys: [],
		dynamicForward: false,
		querySeen: false,
		ambiguous: false,
		destinationFound: false,
	};
}

/** `-J a,b` / `-o ProxyJump=a,b`: a comma-separated hop list, possibly URIs. */
function hops(value: string | undefined): string[] {
	if (value === undefined) return [];
	const out: string[] = [];
	for (const part of value.split(",")) {
		const spec = part.trim();
		if (spec === "" || spec.toLowerCase() === "none") continue;
		out.push(spec);
	}
	return out;
}

/** The `[user@]host[:port]` key of a `-J`/`-W`/`Hostname=` spec; URIs normalise, module/path drops. */
function keyFromHostSpec(spec: string): string | null {
	const s = spec.trim();
	if (s === "" || s.toLowerCase() === "none") return null;
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return keyFromUri(s);
	return s;
}

/** `scheme://[user@]host[:port][/path]` -> `[user@]host[:port]`, or null when undetermined. */
function keyFromUri(uri: string): string | null {
	const match = uri.match(/^[a-z][a-z0-9+.-]*:\/\/(.*)$/i);
	if (match === null) return null;
	const rest = match[1];
	const slash = rest.indexOf("/");
	const authority = slash === -1 ? rest : rest.slice(0, slash);
	return authority === "" ? null : authority;
}

/** True when `spec` has a `scheme://` prefix. */
function isUri(spec: string): boolean {
	return /^[a-z][a-z0-9+.-]*:\/\//i.test(spec);
}

/**
 * The index of the `:` that separates host from path in an `scp`/`rsync` spec, or -1.
 *
 * The colon is conditional (`colon()`, `parse_hostspec()`): a `/` before it makes the token a
 * local path, a leading colon is part of the name, and `[ipv6]:`/`user@[ipv6]:` are handled by
 * the brackets rather than the first colon.
 */
function separatorColon(spec: string): number {
	if (spec.startsWith("[")) {
		const close = spec.indexOf("]");
		return close !== -1 && spec[close + 1] === ":" ? close + 1 : -1;
	}
	const at = spec.indexOf("@");
	if (at !== -1 && spec[at + 1] === "[") {
		const close = spec.indexOf("]", at);
		return close !== -1 && spec[close + 1] === ":" ? close + 1 : -1;
	}
	const colon = spec.indexOf(":");
	if (colon <= 0) return -1;
	const slash = spec.indexOf("/");
	if (slash !== -1 && slash < colon) return -1;
	return colon;
}

/** The `[user@]host` part of an `scp`/`rsync` spec, or null when the spec is local. */
function remoteHostFromSpec(spec: string): string | null {
	if (spec === "") return null;
	if (/^[A-Za-z]:[\\/]/.test(spec)) return null;
	const colon = separatorColon(spec);
	return colon > 0 ? spec.slice(0, colon) : null;
}

/**
 * The host before an rsync daemon `::`, or null when there is no top-level `::`.
 *
 * The `::` inside an IPv6 literal (`[::1]`) is not the daemon marker, so the brackets are skipped
 * before the search.
 */
function daemonHost(spec: string): string | null {
	let start = 0;
	if (spec.startsWith("[")) {
		const close = spec.indexOf("]");
		if (close === -1) return null;
		start = close + 1;
	} else {
		const at = spec.indexOf("@");
		if (at !== -1 && spec[at + 1] === "[") {
			const close = spec.indexOf("]", at);
			if (close === -1) return null;
			start = close + 1;
		}
	}
	const double = spec.indexOf("::", start);
	return double > 0 ? spec.slice(0, double) : null;
}

/**
 * Fold a login named as an option into a key that does not already name one.
 *
 * `ssh -l root build-box` reaches `root@build-box`, so that is the key it needs; an explicit
 * `someone@build-box` in the destination is the text as written and is left alone.
 */
function withUser(key: string, user: string | undefined): string {
	if (user === undefined || user === "" || key.includes("@")) return key;
	return `${user}@${key}`;
}

/** Whether a key already carries a port. */
function hasPort(key: string): boolean {
	const at = key.lastIndexOf("@");
	const host = at === -1 ? key : key.slice(at + 1);
	if (host.startsWith("[")) {
		const close = host.indexOf("]");
		return close !== -1 && host.slice(close + 1).startsWith(":");
	}
	return host.includes(":");
}

/** Fold a named port into a key that does not already have one. */
function withPort(key: string, port: string | undefined): string {
	if (port === undefined || port === "" || hasPort(key)) return key;
	return `${key}:${port}`;
}

/** Host tokens of a command string used as a ProxyCommand (`ssh -W %h:%p bastion`, `nc -x proxy:8080 …`). */
function hostsInCommand(value: string): string[] {
	const tokens = shellTokens(value);
	const out: string[] = [];
	let i = 0;
	while (i < tokens.length && ASSIGN.test(tokens[i])) i += 1;
	i += 1; // the command word
	while (i < tokens.length) {
		const tok = tokens[i];
		if (tok === "-W" || tok === "-x") {
			const arg = tokens[i + 1];
			if (arg !== undefined && !arg.includes("%")) out.push(arg);
			i += 2; continue;
		}
		if (tok.startsWith("-") && tok.length === 2 && "WxXpPlocbeiFJSO".includes(tok[1])) { i += 2; continue; }
		if (tok.startsWith("-")) { i += 1; continue; }
		if (!tok.includes("%")) out.push(tok);
		i += 1;
	}
	return out;
}

/** Mine an `-o` ssh_config directive for the hosts and ports it names. */
function handleDirective(value: string | undefined, p: Parsed): void {
	if (value === undefined) return;
	const eq = value.indexOf("=");
	let key: string;
	let val: string;
	if (eq !== -1) { key = value.slice(0, eq); val = value.slice(eq + 1).trim(); }
	else {
		const space = value.search(/\s/);
		if (space === -1) { key = value; val = ""; }
		else { key = value.slice(0, space); val = value.slice(space + 1).trim(); }
	}
	const name = key.trim().toLowerCase();
	if (name === "proxyjump") p.secondSpecs.push(...hops(val));
	else if (name === "hostname") { if (val !== "") p.secondSpecs.push(val); }
	else if (name === "proxycommand") p.secondSpecs.push(...hostsInCommand(val));
	else if (name === "dynamicforward") p.dynamicForward = true;
	else if (name === "port") { if (val !== "" && p.port === undefined) p.port = val; }
	else if (name === "user") { if (val !== "" && p.user === undefined) p.user = val; }
	// `LocalForward` and `RemoteForward` are deliberately not mined: a forward is covered by the
	// destination's own grant. `User` *is* mined — it names the authority the connection reaches, which
	// is what the key records (see `Parsed.user`).
}

/**
 * The key set of a parsed invocation: destination positionals, then mined second hosts.
 *
 * A login named as an option (`-l`, `-o User=`, a nested `-e 'ssh -l …'`) is folded into the
 * destination key, never into a second host's: a jump host's `user@` is its own.
 */
function keysOfParsed(cmd: FamilyName, p: Parsed): string[] {
	const out: string[] = [];
	// ssh and mosh: the first positional is the destination; what follows it is the remote command.
	// sftp: the single (last) positional. scp and rsync: every positional, because the destination is
	// a *role* there (A6).
	const candidates = cmd === "ssh" || cmd === "mosh"
		? p.positionals.slice(0, 1)
		: cmd === "sftp"
			? p.positionals.slice(-1)
			: p.positionals;
	for (const tok of candidates) {
		const key = positionalKey(cmd, tok, p);
		if (key !== null) out.push(key);
	}
	for (const spec of p.secondSpecs) {
		const key = keyFromHostSpec(spec);
		if (key !== null) out.push(key);
	}
	for (const key of p.extraKeys) out.push(key);
	return dedupe(out);
}

/** A positional's key, per the command's grammar (A5, A6, A9). */
function positionalKey(cmd: FamilyName, tok: string, p: Parsed): string | null {
	if (tok === "") return null;
	if (isUri(tok)) {
		const key = keyFromUri(tok);
		if (key === null) { p.ambiguous = true; return null; }
		p.destinationFound = true;
		// A URI is a spelling of `[user@]host[:port]`, so an option-named login folds into it too.
		return withUser(key, p.user);
	}
	if (cmd === "ssh" || cmd === "mosh") {
		p.destinationFound = true;
		return withUser(withPort(tok, p.port), p.user);
	}
	if (cmd === "sftp") {
		const host = remoteHostFromSpec(tok);
		const key = host !== null ? withPort(host, p.port) : tok.includes(":") ? null : withPort(tok, p.port);
		if (key !== null) p.destinationFound = true;
		return key === null ? null : withUser(key, p.user);
	}
	// scp and rsync: a positional is remote only through the colon or a URI.
	if (cmd === "rsync") {
		const daemon = daemonHost(tok);
		if (daemon !== null) {
			p.destinationFound = true;
			// A daemon spec's `user@` is already in the text; the ssh login reaches it through `-e`.
			return withPort(daemon, p.daemonPort);
		}
	}
	const host = remoteHostFromSpec(tok);
	if (host === null) return null;
	p.destinationFound = true;
	return withUser(withPort(host, p.port), p.user);
}

/** A nested remote-shell command from rsync's `-e`/`--rsh` or mosh's `--ssh`. */
function nestedShell(value: string | undefined, p: Parsed): void {
	if (value === undefined || value.trim() === "") return;
	const tokens = shellTokens(value);
	if (tokens.length === 0) return;
	const nestedCommand = basename(tokens[0]);
	if (nestedCommand === "ssh" || nestedCommand === "scp" || nestedCommand === "sftp") {
		const nested = parseFamily(nestedCommand, tokens.slice(1));
		if (nested.dynamicForward) p.dynamicForward = true;
		if (nested.port !== undefined && p.port === undefined) p.port = nested.port;
		if (nested.user !== undefined && p.user === undefined) p.user = nested.user;
		for (const key of keysOfParsed(nestedCommand, nested)) p.extraKeys.push(key);
		return;
	}
	for (const host of hostsInCommand(value)) p.secondSpecs.push(host);
}

function handleLongOption(cmd: FamilyName, name: string, value: string | undefined, p: Parsed): void {
	if (cmd === "mosh") {
		if (name === "ssh") { nestedShell(value, p); return; }
		if (name === "version" || name === "help") { p.querySeen = true; return; }
		return;
	}
	if (cmd === "rsync") {
		if (name === "rsh") { nestedShell(value, p); return; }
		if (name === "port") { if (value !== undefined && value !== "") p.daemonPort = value; return; }
		return;
	}
	// ssh, scp and sftp take no long options.
}

function handleShortOption(cmd: FamilyName, letter: string, value: string | undefined, p: Parsed): void {
	if (cmd === "ssh") {
		if (letter === "p") { if (value !== undefined && value !== "") p.port = value; return; }
		if (letter === "D") { p.dynamicForward = true; return; }
		if (letter === "V" || letter === "Q") { p.querySeen = true; return; }
		if (letter === "J") { p.secondSpecs.push(...hops(value)); return; }
		if (letter === "W") { if (value !== undefined && value !== "") p.secondSpecs.push(value); return; }
		if (letter === "o") { handleDirective(value, p); return; }
		if (letter === "l") { if (value !== undefined && value !== "" && p.user === undefined) p.user = value; return; }
		return;
	}
	if (cmd === "scp" || cmd === "sftp") {
		if (letter === "P") { if (value !== undefined && value !== "") p.port = value; return; }
		if (letter === "l") { if (value !== undefined && value !== "" && p.user === undefined) p.user = value; return; }
		if (letter === "J") { p.secondSpecs.push(...hops(value)); return; }
		if (letter === "o") { handleDirective(value, p); return; }
		return;
	}
	if (cmd === "rsync" && letter === "e") { nestedShell(value, p); return; }
}

/** Walk every token, consuming each value-taking option's value from the per-command table (A1-A3). */
function parseFamily(cmd: FamilyName, args: string[]): Parsed {
	const table = FAMILY_TABLES[cmd];
	const p = newParsed();
	let endOfOptions = false;
	let i = 0;
	while (i < args.length) {
		const tok = args[i];
		if (!endOfOptions && tok === "--") { endOfOptions = true; i += 1; continue; }
		if (!endOfOptions && tok.startsWith("--") && tok.length > 2) {
			const eq = tok.indexOf("=");
			const name = (eq === -1 ? tok.slice(2) : tok.slice(2, eq)).toLowerCase();
			let value: string | undefined;
			if (eq !== -1) value = tok.slice(eq + 1);
			else if (table.valueLong.includes(name)) { value = args[i + 1]; i += 1; }
			handleLongOption(cmd, name, value, p);
			i += 1; continue;
		}
		if (!endOfOptions && tok.startsWith("-") && tok.length > 1) {
			const body = tok.slice(1);
			let j = 0;
			while (j < body.length) {
				const letter = body[j];
				if (table.valueShort.includes(letter)) {
					let value: string | undefined;
					if (j + 1 < body.length) value = body.slice(j + 1);
					else { value = args[i + 1]; i += 1; }
					handleShortOption(cmd, letter, value, p);
					break;
				}
				handleShortOption(cmd, letter, undefined, p);
				j += 1;
			}
			i += 1; continue;
		}
		p.positionals.push(tok);
		i += 1;
	}
	return p;
}

const DYNAMIC_FORWARD_REFUSAL =
	"web-access: that command opens a dynamic forward (-D), a SOCKS proxy that reaches destinations the command does not name — no grant can bound it, so the gate refuses it even under one. Name a destination and drop -D.";

function unreadableRefusal(cmd: FamilyName): string {
	return `web-access: the shell egress gate refused a ${cmd} invocation whose destination it could not read as a [user@]host[:port] key.`;
}

function ambiguousRefusal(cmd: FamilyName): string {
	return `web-access: the shell egress gate refused a ${cmd} URI whose host it could not determine from the text, so it cannot be keyed to a grant.`;
}

/** Read one transport invocation's arguments into keys and, when the text forces one, a refusal. */
function readTransport(cmd: FamilyName, args: string[]): DestinationReading {
	const parsed = parseFamily(cmd, args);
	const keys = keysOfParsed(cmd, parsed);
	if (parsed.dynamicForward) return { keys, refused: DYNAMIC_FORWARD_REFUSAL };
	if (parsed.querySeen) return { keys: [] };
	if (parsed.ambiguous) return { keys, refused: ambiguousRefusal(cmd) };
	if (!parsed.destinationFound && (cmd === "ssh" || cmd === "mosh" || cmd === "sftp")) {
		return { keys, refused: unreadableRefusal(cmd) };
	}
	return { keys };
}

/**
 * The destination keys a command names, and any refusal that is about its *text*.
 *
 * Walks every segment (so `ssh a && ssh b` names both), peels wrappers, and, for each transport
 * invocation, walks **every** token rather than a prefix — options may follow the destination. A
 * command that names no transport contributes no key. `ssh -V`/`ssh -Q …` return an empty set and
 * no refusal: they reach nobody and a grant that named one would be a fabrication.
 */
export function destinationKeys(command: string): DestinationReading {
	const text = stripComments(command);
	const keys: string[] = [];
	let refused: string | undefined;
	for (const segment of splitSegments(text)) {
		const tokens = peel(shellTokens(segment));
		if (tokens.length === 0) continue;
		const cmd = basename(tokens[0]);
		if (!FAMILY_NAMES.has(cmd)) continue;
		const reading = readTransport(cmd as FamilyName, tokens.slice(1));
		for (const key of reading.keys) keys.push(key);
		if (reading.refused !== undefined && refused === undefined) refused = reading.refused;
	}
	const unique = dedupe(keys);
	return refused !== undefined ? { keys: unique, refused } : { keys: unique };
}

/**
 * The keys the session does not hold, split by why (ticket 03 §5).
 *
 * `missing` is the whole set when the session holds no grant at all; `unmatched` is the ungranted
 * keys when it holds at least one grant. Both empty exactly when the whole set is granted.
 */
export function unmatched(keys: readonly string[], granted: Iterable<string>): GrantComparison {
	const held: Set<string> = new Set(granted);
	const unheld = keys.filter((key) => !held.has(key));
	if (held.size === 0) return { missing: unheld, unmatched: [] };
	return { missing: [], unmatched: unheld };
}

/**
 * The refusal text for a transport command whose key set the session does not hold.
 *
 * A pure builder: it takes the keys, the comparison and the session's *shape* (`hasUI`, `isChild`,
 * `projectTrusted`) rather than reading any state, and it never suggests another spelling — a grant
 * is the only route (ticket 03 §5, ticket 06 §7).
 */
export function transportRefusal(flags: TransportRefusalFlags): string {
	const unheld = [...flags.comparison.missing, ...flags.comparison.unmatched];
	const named = unheld.length > 0 ? unheld : [...flags.keys];
	const keys = named.join(", ");
	const held = flags.comparison.missing.length > 0
		? `this session holds no grant at all`
		: `this session's grants do not include ${keys}`;
	let route: string;
	if (flags.declined === true) {
		route = `the human declined ${keys} for this session; /ssh-grant --revoke clears that.`;
	} else if (flags.isChild) {
		route =
			`a spawned child cannot show a dialog: ask the session that spawned this one — ` +
			`await agent_message.send("please grant ${keys} for this session", receiver_role="parent") — ` +
			`and run the command again, because a grant made there reaches this session.`;
	} else if (!flags.hasUI) {
		route = flags.projectTrusted
			? `nobody can be asked here (no dialog-capable UI), and this project declares no such target in .pi/ssh-grant.json.`
			: `nobody can be asked here (no dialog-capable UI), and this project is not trusted, so its .pi/ssh-grant.json was not read.`;
	} else {
		route =
			`run the command again to be asked, or pre-grant it with /ssh-grant ${keys} — ` +
			`a grant names the key as written, user and port included.`;
	}
	return `web-access: ${flags.command} reaches ${named.join(", ")}, and ${held}; ${route} Do not look for another spelling — a grant is the only route.`;
}

/**
 * The refusal for a shell command that leaves this host, or `{ ok: true }` to let it run.
 */
export function checkEgress(command: string): EgressVerdict {
	const text = stripComments(command);
	// A raw socket redirection is egress wherever it appears (including inside `sh -c "..."`).
	if (SOCKET_REDIRECT.test(text)) return block("opens a raw socket through /dev/tcp or /dev/udp");
	for (const segment of splitSegments(text)) {
		const verdict = checkSegment(segment);
		if (!verdict.ok) return verdict;
	}
	return { ok: true };
}

/** One shell segment of a command, split and peeled exactly as `checkEgress` reads it. */
export type EgressSegment = {
	/** The segment's text, as split (quoting intact, comments already stripped). */
	text: string;
	/** The command word: the basename after leading `VAR=value` assignments and wrapper words. */
	command: string;
	/** The command's arguments, wrappers peeled. */
	args: string[];
};

/**
 * Split a command into the segments `checkEgress` sees, each with its command word and arguments.
 *
 * `checkEgress` itself returns one verdict for the whole text, which is all a refusal needs. The
 * grant-aware policy needs the segments: it routes the **transport family** through
 * `destinationKeys` while every *other* segment keeps `checkEgress`'s rules, so a command that
 * combines a granted `ssh` with a `curl` is still refused for the `curl`. This is a read of the same
 * walk (`stripComments` -> `splitSegments` -> `segmentTokens` -> `unwrap`) rather than a second
 * grammar; the three functions above are unchanged.
 */
export function egressSegments(command: string): EgressSegment[] {
	const out: EgressSegment[] = [];
	for (const segment of splitSegments(stripComments(command))) {
		const tokens = unwrap(segmentTokens(segment));
		out.push({
			text: segment,
			command: tokens.length > 0 ? basename(tokens[0]) : "",
			args: tokens.slice(1),
		});
	}
	return out;
}
