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
