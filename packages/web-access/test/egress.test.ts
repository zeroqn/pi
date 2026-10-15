import { describe, expect, it } from "bun:test";
import { checkEgress, destinationKeys, transportRefusal, unmatched } from "../egress";
import type { GrantComparison } from "../egress";

// ---------------------------------------------------------------------------
// The egress corpus. Every BLOCKED case is a way a shell command can leave this
// host; every ALLOWED case is ordinary local shell use the guard must not
// swallow. The two lists are the contract: widening a rule must not move a pass
// case into the blocked set.
// ---------------------------------------------------------------------------

const BLOCKED: string[] = [
	// 1. direct fetchers and transports, including the basename and wrapper forms.
	"curl https://example.com",
	"curl -s https://example.com/api",
	"curl -o out.txt https://example.com",
	"curl --data x https://example.com",
	"wget https://example.com/file.iso",
	"wget -q -O- https://example.com",
	"nc example.com 80",
	"ncat 10.0.0.1 443",
	"netcat example.com 25",
	"socat - TCP:example.com:80",
	"telnet example.com 23",
	"ftp ftp.example.com",
	"tftp example.com",
	"xh GET https://example.com",
	"httpie https://example.com",
	"http https://example.com",
	"aria2c https://example.com/f.iso",
	"axel https://example.com/f.iso",
	"ssh user@example.com",
	"scp file user@example.com:/tmp",
	"sftp user@example.com",
	"sshpass -p hunter2 ssh user@example.com",
	"mosh user@example.com",
	"/usr/bin/curl https://example.com",
	"sudo curl https://example.com",
	"timeout 10 curl https://example.com",
	"nohup wget https://example.com",

	// 2. remote git subcommands that print what the remote answers (clone/fetch/pull/push
	//    download to disk and fall through to the allow side).
	"git ls-remote origin",
	"git archive --remote=git://example.com/repo HEAD",

	// 3. interpreters with an inline network program.
	"python3 -c 'import urllib.request'",
	'python3 -c "import requests"',
	"python3 -c 'import socket'",
	"python3 -c 'import http.client'",
	"node -e 'fetch(\"https://example.com\")'",
	"node -e 'require(\"http\").get(\"http://example.com\")'",
	"node -e 'require(\"net\").connect(80)'",
	"node -e 'require(\"axios\").get(\"https://example.com\")'",
	"bun -e 'await fetch(\"https://example.com\")'",
	"perl -e 'use LWP::Simple'",
	"ruby -e 'require \"net/http\"'",
	"ruby -e 'require \"open-uri\"'",
	"php -r '$c = curl_init();'",
	"php -r 'file_get_contents(\"https://example.com\");'",

	// 4. shell-native egress.
	"exec 3<>/dev/tcp/example.com/80",
	"cat < /dev/tcp/example.com/80",
	"bash -c 'echo > /dev/udp/1.2.3.4/53'",
	"echo hi > /dev/tcp/example.com/80",

	// composition: a single refused segment refuses the whole command.
	"npm ls && curl https://example.com",
	"echo hi; wget https://example.com",
	"ls | nc example.com 80",
	"echo $(curl https://example.com)",
];

const ALLOWED: string[] = [
	// The tricky passes: an URL or an egress word merely appearing in the text.
	"grep -rn 'http' .",
	"grep -rn 'curl' src",
	"cat file.csv",
	"git log",
	"git status",
	"git log --oneline -5",
	"git diff --stat",
	"git remote -v",
	"git -C /repo log --oneline",
	"git --version",
	"python3 -c 'print(1)'",
	"ls https*",
	"find . -name '*.json'",
	"echo curl wget",
	"echo 'https://example.com'",
	"echo $(date)",
	"rg -n 'a|b' src",

	// curl/wget version and help probes are not transfers.
	"curl --version",
	"wget --version",
	"wget -h",
	"curl --help",

	// package managers, local subcommands only.
	"npm ls",
	"npm list --depth=0",
	"npm run build",
	"npm test",
	"npm why react",
	"pip list",
	"pip freeze",
	"cargo build",
	"cargo test",
	"go build ./...",
	"brew --version",
	"apt-get --version",
	"nix --version",
	"deno task build",

	// interpreters without a network program.
	"node -e 'console.log(1)'",
	"node --version",
	"bun -e 'console.log(1)'",
	"perl -e 'print \"hi\"'",
	"ruby -e 'puts 1'",
	"php -r 'echo 1;'",
	"python3 script.py",

	// local rsync, wrapper lookups, and innocuous local tools.
	"rsync -a src/ dst/",
	"command -v curl",
	"sudo ls -la",
	"timeout 5 ls",
	"ssh-keygen -t ed25519",
	"env",
	"sleep 5",
	"docker ps",
	"docker images",
	"kubectl version --client",
	"gh --version",
	"aws --version",
	"gcloud version",
	// network diagnostics: stdout is a status line, not page content.
	"ping -c 1 example.com",
	"dig example.com",
	"nslookup example.com",

	// downloads code to disk or talks to a remote API: stdout is progress, not page content,
	// and refusing these breaks ordinary work.
	"npm install",
	"npm i left-pad",
	"npm add left-pad",
	"npm ci",
	"npm x cowsay",
	"npm exec cowsay",
	"npm create vite",
	"npm update",
	"npm view react",
	"npm info react",
	"npm search react",
	"npm outdated",
	"npm audit",
	"npm publish",
	"pnpm add lodash",
	"pnpm install",
	"yarn add react",
	"yarn dlx cowsay",
	"bun install",
	"bun add react",
	"bun x cowsay",
	"npx cowsay hi",
	"pip install requests",
	"pip3 install --user requests",
	"pip download requests",
	"uv install",
	"uv pip install requests",
	"uv add requests",
	"uv sync",
	"uvx cowsay",
	"cargo add serde",
	"cargo install ripgrep",
	"cargo update",
	"cargo search serde",
	"cargo publish",
	"go get github.com/foo/bar",
	"go install golang.org/x/tools/cmd/stringer@latest",
	"composer require monolog/monolog",
	"gem install rails",
	"apt install curl",
	"apt-get install curl",
	"apt update",
	"dnf install httpd",
	"yum upgrade",
	"pacman -Sy curl",
	"apk add curl",
	"brew install wget",
	"brew upgrade",
	"nix-env -iA nixpkgs.hello",
	"nix shell nixpkgs#hello",
	"nix build nixpkgs#hello",
	"docker pull ubuntu",
	"docker run ubuntu",
	"docker build .",
	"podman pull alpine",
	"deno install",
	"deno cache main.ts",
	"deno run --reload main.ts",
	"git clone https://github.com/foo/bar",
	"git fetch origin",
	"git pull",
	"git push",
	"git submodule update --init",
	"git remote update",
	"gh api repos/foo/bar",
	"gh pr list",
	"aws s3 ls",
	"gcloud compute instances list",
	"az vm list",
	"kubectl get pods",
	"helm list",
	"date && git clone https://github.com/foo/bar",
];

describe("egress guard / blocked corpus", () => {
	it("refuses every command that leaves the host", () => {
		for (const command of BLOCKED) {
			const verdict = checkEgress(command);
			expect(verdict.ok, `expected blocked: ${command}`).toBe(false);
			if (!verdict.ok) {
				expect(verdict.reason.startsWith("web-access: "), `reason prefix for ${command}: ${verdict.reason}`).toBe(true);
				expect(verdict.reason, `fetch_content steer for ${command}`).toContain("fetch_content");
			}
		}
	});
});

describe("egress guard / allowed corpus", () => {
	it("lets ordinary local shell use through", () => {
		for (const command of ALLOWED) {
			const verdict = checkEgress(command);
			expect(verdict.ok, `expected allowed: ${command} (${verdict.ok ? "" : verdict.reason})`).toBe(true);
		}
	});
});

describe("egress guard / corpus shape", () => {
	it("covers the required mechanisms and exceeds fifty cases", () => {
		expect(BLOCKED.length + ALLOWED.length).toBeGreaterThanOrEqual(50);
		expect(BLOCKED.length).toBeGreaterThanOrEqual(40);
		expect(ALLOWED.length).toBeGreaterThanOrEqual(25);
	});

	it("has no duplicate cases", () => {
		expect(new Set(BLOCKED).size).toBe(BLOCKED.length);
		expect(new Set(ALLOWED).size).toBe(ALLOWED.length);
	});

	it("never refuses an empty command", () => {
		expect(checkEgress("").ok).toBe(true);
		expect(checkEgress("   ").ok).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// The transport destination matcher and its comparator (ticket 03). These
// tables pin the PAIR, not the parser: each row is read with `destinationKeys`,
// compared with `unmatched` against a named grant set, and judged allowed only
// when the text reads cleanly and every key it names is held. A row that pins a
// key set says so in its reason, and every row carries why it sits where it
// does. The A-rows are ticket 01's ambiguity list (research §6) — all twelve
// land somewhere below.
// ---------------------------------------------------------------------------

type PairRow = {
	command: string;
	/** The session's grants for this row. */
	granted: string[];
	/** Why the row sits in its table. */
	reason: string;
	/** When present, the exact key set the matcher must produce. */
	keys?: string[];
	/** When present, the text-level refusal must match this. */
	refusal?: RegExp;
};

const PAIR_ALLOWED: PairRow[] = [
	{ command: "ssh dev@build-box", granted: ["dev@build-box"], keys: ["dev@build-box"], reason: "A1/A11: the exact-text key, user included; the first positional is the destination." },
	{ command: "ssh build-box", granted: ["build-box"], keys: ["build-box"], reason: "A11: an alias is keyed as written, never resolved through ~/.ssh/config." },
	{ command: "ssh dev@build-box -p 2222 uptime", granted: ["dev@build-box:2222"], keys: ["dev@build-box:2222"], reason: "A1: options after the destination are re-parsed; -p folds the port into the key and the remote command is not a key." },
	{ command: "ssh dev@build-box uptime -p 2222", granted: ["dev@build-box:2222"], keys: ["dev@build-box:2222"], reason: "A1: the whole token list is walked, not a prefix." },
	{ command: "ssh -J ops@bastion -p 2222 dev@build-box uptime", granted: ["dev@build-box:2222", "ops@bastion"], keys: ["dev@build-box:2222", "ops@bastion"], reason: "A4/A12: the -J hop is a second plain-text host; the port applies to the destination only." },
	{ command: 'mosh dev@build-box --ssh="ssh -p 2222"', granted: ["dev@build-box:2222"], keys: ["dev@build-box:2222"], reason: "A2: mosh permutes options past the host; the ssh port lives inside --ssh, not mosh's own -p." },
	{ command: 'mosh --ssh="ssh -p 2222 -J ops@bastion" dev@build-box', granted: ["dev@build-box:2222", "ops@bastion"], keys: ["dev@build-box:2222", "ops@bastion"], reason: "A2/A12: the --ssh value is a nested ssh command and its -J is a second host." },
	{ command: "rsync -av dev@build-box:/srv/ ./dst/", granted: ["dev@build-box"], keys: ["dev@build-box"], reason: "A3/A6: rsync's destination is a role, so a remote SRC is a key." },
	{ command: "rsync ./dst/ dev@build-box:/srv/ -av", granted: ["dev@build-box"], keys: ["dev@build-box"], reason: "A3: options may follow the paths; the remote DEST is a key." },
	{ command: "rsync -a src/ dst/", granted: [], keys: [], reason: "A6: no colon, no URI — a local copy names no key." },
	{ command: "ssh -o ProxyJump=ops@bastion dev@build-box", granted: ["dev@build-box", "ops@bastion"], keys: ["dev@build-box", "ops@bastion"], reason: "A4: -o's value is a route; ProxyJump names a second host." },
	{ command: "ssh -o Hostname=build-box.internal dev@build-box", granted: ["dev@build-box", "build-box.internal"], keys: ["dev@build-box", "build-box.internal"], reason: "A4: -o Hostname= is a second plain-text host." },
	{ command: "ssh -o ProxyCommand='ssh -W %h:%p bastion' dev@build-box", granted: ["dev@build-box", "bastion"], keys: ["dev@build-box", "bastion"], reason: "A4: a ProxyCommand's host tokens, read as the nested command line they are." },
	{ command: "ssh -o ProxyCommand='nc -X connect -x proxy:8080 %h %p' dev@build-box", granted: ["dev@build-box", "proxy:8080"], keys: ["dev@build-box", "proxy:8080"], reason: "A4: the nc proxy's host:port is a second host; %h/%p are placeholders." },
	{ command: "scp a/b:c local/", granted: [], keys: [], reason: "A5: a colon after a slash is part of the path — local, no key." },
	{ command: "scp dev@build-box:/srv/file ./", granted: ["dev@build-box"], keys: ["dev@build-box"], reason: "A5/A6: a remote source is a key; the colon separator is host:path." },
	{ command: "scp ./file dev@build-box:/srv/", granted: ["dev@build-box"], keys: ["dev@build-box"], reason: "A6: the push target is a remote key." },
	{ command: "scp -3 dev@build-a:/etc/hosts dev@build-b:/tmp/", granted: ["dev@build-a", "dev@build-b"], keys: ["dev@build-a", "dev@build-b"], reason: "A6: -3 makes two positionals remote; both are keys." },
	{ command: "rsync -avp src/ dev@build-box:/srv/", granted: ["dev@build-box"], keys: ["dev@build-box"], reason: "A7: rsync's -p is --perms, a boolean; it is not a port and adds no :port to the key." },
	{ command: "rsync -e 'ssh -p 2222' dev@build-box:/srv/", granted: ["dev@build-box:2222"], keys: ["dev@build-box:2222"], reason: "A7/A9: the ssh port inside -e is part of the key." },
	{ command: "rsync --rsh ssh dev@build-box:/srv/", granted: ["dev@build-box"], keys: ["dev@build-box"], reason: "A7: the --rsh space form is consumed, so ssh is a value and the host:path is the key (the fixed defect)." },
	{ command: "rsync --rsh=ssh dev@build-box:/srv/", granted: ["dev@build-box"], keys: ["dev@build-box"], reason: "A7: the --rsh= form reads identically." },
	{ command: "rsync -avz --rsh 'ssh -p 2222' dev@build-box:/srv/ ./dst", granted: ["dev@build-box:2222"], keys: ["dev@build-box:2222"], reason: "A7: the nested ssh's -p folds into the rsync host key." },
	{ command: "ssh ssh://dev@build-box:2222/srv", granted: ["dev@build-box:2222"], keys: ["dev@build-box:2222"], reason: "A9: an ssh URI normalises to the same [user@]host:port key." },
	{ command: "scp scp://dev@build-box:2222/srv ./", granted: ["dev@build-box:2222"], keys: ["dev@build-box:2222"], reason: "A9: an scp URI normalises; the path is not part of the key." },
	{ command: "sftp sftp://dev@build-box:2222/srv", granted: ["dev@build-box:2222"], keys: ["dev@build-box:2222"], reason: "A9: an sftp URI normalises." },
	{ command: "rsync rsync://dev@build-box:984/module/ ./", granted: ["dev@build-box:984"], keys: ["dev@build-box:984"], reason: "A9: the rsync module drops out of the key; the URI's port stays." },
	{ command: "rsync dev@build-box::module/ ./", granted: ["dev@build-box"], keys: ["dev@build-box"], reason: "A9: the :: spelling is the same destination as rsync://; the module is not part of the key." },
	{ command: "ssh -V", granted: [], keys: [], reason: "A10: -V reaches nobody; the empty set needs no grant." },
	{ command: "ssh -Q cipher", granted: [], keys: [], reason: "A10: -Q is a local query." },
	{ command: "ssh -G dev@build-box", granted: ["dev@build-box"], keys: ["dev@build-box"], reason: "A10/fork 6: -G is a mode flag over a destination, not the absence of one." },
	{ command: "ssh -T dev@build-box uptime", granted: ["dev@build-box"], keys: ["dev@build-box"], reason: "A10/fork 6: -T is a mode flag; the destination is still the first positional, and the remote command is not a key." },
	{ command: "ssh -J a,b dev@build-box", granted: ["dev@build-box", "a", "b"], keys: ["dev@build-box", "a", "b"], reason: "A12: -J is a comma-separated hop list; every hop is a key." },
	{ command: "ssh -J ssh://ops@bastion:22 dev@build-box", granted: ["dev@build-box", "ops@bastion:22"], keys: ["dev@build-box", "ops@bastion:22"], reason: "A12: a -J hop may be an ssh URI and normalises with its port." },
	{ command: "ssh -W build-box:22 ops@bastion", granted: ["ops@bastion", "build-box:22"], keys: ["ops@bastion", "build-box:22"], reason: "A4: -W host:port is a second host, port included." },
	{ command: "rsync -e 'ssh -J ops@bastion' dev@build-box:/srv/ ./", granted: ["dev@build-box", "ops@bastion"], keys: ["dev@build-box", "ops@bastion"], reason: "A4: the hop inside rsync's -e 'ssh -J …' is a key." },
	{ command: "ssh -P tagname dev@build-box", granted: ["dev@build-box"], keys: ["dev@build-box"], reason: "A: cross-family collision — ssh -P is a tag (a value), not a port; it contributes no key." },
	{ command: "scp -P 2222 dev@build-box:/f ./", granted: ["dev@build-box:2222"], keys: ["dev@build-box:2222"], reason: "A: cross-family collision — scp -P is the port." },
	{ command: "sftp -P 2222 dev@build-box", granted: ["dev@build-box:2222"], keys: ["dev@build-box:2222"], reason: "A: cross-family collision — sftp -P is the port." },
	{ command: "ssh -p 2222 dev@build-box", granted: ["dev@build-box:2222"], keys: ["dev@build-box:2222"], reason: "A: cross-family collision — ssh -p is the port." },
	{ command: "rsync -P src/ dev@build-box:/srv/", granted: ["dev@build-box"], keys: ["dev@build-box"], reason: "A: rsync -P is --partial --progress, a boolean; it adds no port." },
	{ command: 'mosh --ssh="ssh" dev@build-box', granted: ["dev@build-box"], keys: ["dev@build-box"], reason: "A2: a nested ssh with no port leaves the key portless." },
	{ command: "sshpass -p hunter2 ssh user@example.com", granted: ["user@example.com"], keys: ["user@example.com"], reason: "A: sshpass is a wrapper; its -p value is a password, not the destination." },
	{ command: "ssh dev@build-box -o ProxyJump=ops@bastion", granted: ["dev@build-box", "ops@bastion"], keys: ["dev@build-box", "ops@bastion"], reason: "A1/A4: an -o route may stand after the destination." },
];

const PAIR_BLOCKED: PairRow[] = [
	{ command: "ssh dev@build-box", granted: [], keys: ["dev@build-box"], reason: "A: no grant at all — the refusal says so rather than 'your grants do not match'." },
	{ command: "ssh dev@build-box", granted: ["build-box"], keys: ["dev@build-box"], reason: "A1: the user is part of the key; a bare build-box does not cover dev@build-box." },
	{ command: "ssh build-box", granted: ["dev@build-box"], keys: ["build-box"], reason: "A11: the alias is keyed as written; the resolved name is not." },
	{ command: "ssh -p 2222 dev@build-box", granted: ["dev@build-box"], keys: ["dev@build-box:2222"], reason: "A: a port is part of the key; dev@build-box does not cover dev@build-box:2222." },
	{ command: "ssh dev@build-box -p 2222 uptime", granted: ["dev@build-box"], keys: ["dev@build-box:2222"], reason: "A1: same command, port after the destination — still a different key." },
	{ command: "ssh -J ops@bastion -p 2222 dev@build-box uptime", granted: ["dev@build-box:2222"], keys: ["dev@build-box:2222", "ops@bastion"], reason: "A4: one ungranted second host (ops@bastion) refuses the call." },
	{ command: 'mosh --ssh="ssh -p 2222 -J ops@bastion" dev@build-box', granted: ["dev@build-box:2222"], keys: ["dev@build-box:2222", "ops@bastion"], reason: "A2: the jump inside --ssh is ungranted." },
	{ command: "rsync -e 'ssh -p 2222' dev@build-box:/srv/", granted: ["dev@build-box"], keys: ["dev@build-box:2222"], reason: "A7/A9: the port inside -e is part of the key and is ungranted." },
	{ command: "rsync rsync://dev@build-box:984/module/ ./", granted: ["dev@build-box"], keys: ["dev@build-box:984"], reason: "A9: the URI's port is part of the key." },
	{ command: "ssh -D 1080 dev@build-box", granted: ["dev@build-box"], keys: ["dev@build-box"], refusal: /dynamic forward/, reason: "A8: -D is refused even under a grant — a SOCKS proxy has no destination in the text." },
	{ command: "ssh -o DynamicForward=1080 dev@build-box", granted: ["dev@build-box"], keys: ["dev@build-box"], refusal: /dynamic forward/, reason: "A8: the same route spelled as an -o directive." },
	{ command: "ssh -o ProxyJump=ops@bastion dev@build-box", granted: ["dev@build-box"], keys: ["dev@build-box", "ops@bastion"], reason: "A4: the ProxyJump host is ungranted." },
	{ command: "ssh -o Hostname=build-box.internal dev@build-box", granted: ["dev@build-box"], keys: ["dev@build-box", "build-box.internal"], reason: "A4: the Hostname= host is ungranted." },
	{ command: "ssh -o ProxyCommand='ssh -W %h:%p bastion' dev@build-box", granted: ["dev@build-box"], keys: ["dev@build-box", "bastion"], reason: "A4: the ProxyCommand's bastion is ungranted." },
	{ command: "ssh -J a,b dev@build-box", granted: ["dev@build-box", "a"], keys: ["dev@build-box", "a", "b"], reason: "A12: the second hop b is ungranted." },
	{ command: "ssh -J ssh://ops@bastion:22 dev@build-box", granted: ["dev@build-box"], keys: ["dev@build-box", "ops@bastion:22"], reason: "A12: the URI hop is ungranted." },
	{ command: "ssh -W build-box:22 ops@bastion", granted: ["ops@bastion"], keys: ["ops@bastion", "build-box:22"], reason: "A4: the -W host is ungranted." },
	{ command: "rsync -e 'ssh -J ops@bastion' dev@build-box:/srv/ ./", granted: ["dev@build-box"], keys: ["dev@build-box", "ops@bastion"], reason: "A4: the hop inside rsync's -e is ungranted." },
	{ command: "scp -3 dev@build-a:/etc/hosts dev@build-b:/tmp/", granted: ["dev@build-a"], keys: ["dev@build-a", "dev@build-b"], reason: "A6: the second remote end is ungranted." },
	{ command: "ssh", granted: ["dev@build-box"], refusal: /could not read/, reason: "A: an invocation the gate cannot read as a destination is refused." },
	{ command: "sftp", granted: [], refusal: /could not read/, reason: "A: no destination at all." },
	{ command: "ssh -J ops@bastion", granted: ["ops@bastion"], refusal: /could not read/, reason: "A: a second host with no destination is still unreadable." },
	{ command: "ssh -G dev@build-box", granted: [], keys: ["dev@build-box"], reason: "A10: -G names a destination, so it needs a grant like any other." },
	{ command: "rsync --rsh ssh dev@build-box:/srv/", granted: [], keys: ["dev@build-box"], reason: "A7: the --rsh space form is read; with no grant it is refused (the fix's blocked half)." },
];

// The fold's blocked half: a key that names no user covers no user.
PAIR_BLOCKED.push({
	command: "ssh -l root build-box",
	granted: ["build-box"],
	keys: ["root@build-box"],
	reason: "A: -l is a different authority, so a bare key does not cover it (review correction, 2026-10-15).",
});

/** Read one row through the pair: the matcher, then the comparator. */
function pairVerdict(row: PairRow) {
	const reading = destinationKeys(row.command);
	const comparison = unmatched(reading.keys, row.granted);
	return { reading, comparison, unheld: [...comparison.missing, ...comparison.unmatched], refused: reading.refused };
}

const PAIR_ALLOWED_FOLD: PairRow[] = [
	// The login named as an option folds into the destination key (review correction, 2026-10-15):
	// `ssh -l root build-box` reaches `root@build-box`, so that is the key it needs — a bare key must
	// not cover every user, which is the widening ticket 03 §1 rejected.
	{ command: "ssh -l dev build-box", granted: ["dev@build-box"], keys: ["dev@build-box"], reason: "A: -l names the authority, so the key carries it." },
	{ command: "ssh -oUser=dev build-box", granted: ["dev@build-box"], keys: ["dev@build-box"], reason: "A: the coalesced -oUser= form folds like -l (A1's coalesced rule)." },
	{ command: "ssh -o User=dev build-box", granted: ["dev@build-box"], keys: ["dev@build-box"], reason: "A: the spaced -o User= form folds like -l." },
	{ command: "rsync -e 'ssh -l dev' build-box:/srv/ ./", granted: ["dev@build-box"], keys: ["dev@build-box"], reason: "A: the nested remote shell's -l is the destination's login." },
	{ command: "mosh build-box --ssh='ssh -l dev'", granted: ["dev@build-box"], keys: ["dev@build-box"], reason: "A: mosh's --ssh login folds, and options after the host are read (A3)." },
	{ command: "ssh -l root someone@build-box", granted: ["someone@build-box"], keys: ["someone@build-box"], reason: "A: an explicit user@ in the destination is the text as written and wins over -l." },
	{ command: "ssh -J jump -l dev build-box", granted: ["dev@build-box", "jump"], keys: ["dev@build-box", "jump"], reason: "A12: the destination's login folds and the hop stays its own bare key." },
];
PAIR_ALLOWED.push(...PAIR_ALLOWED_FOLD);

describe("transport matcher / allowed pair corpus", () => {
	it("allows every command whose whole key set the session holds", () => {
		for (const row of PAIR_ALLOWED) {
			expect(row.reason.length, `a row needs a reason: ${row.command}`).toBeGreaterThan(10);
			if (row.keys !== undefined) {
				expect([...destinationKeys(row.command).keys].sort(), `keys: ${row.command} (${row.reason})`).toEqual([...row.keys].sort());
			}
			const verdict = pairVerdict(row);
			expect(verdict.refused, `expected allowed: ${row.command} (${row.reason})`).toBeUndefined();
			expect(verdict.unheld, `expected allowed: ${row.command} (${row.reason})`).toEqual([]);
		}
	});
});

describe("transport matcher / blocked pair corpus", () => {
	it("refuses every command whose text or key set it cannot satisfy", () => {
		for (const row of PAIR_BLOCKED) {
			expect(row.reason.length, `a row needs a reason: ${row.command}`).toBeGreaterThan(10);
			if (row.keys !== undefined) {
				expect([...destinationKeys(row.command).keys].sort(), `keys: ${row.command} (${row.reason})`).toEqual([...row.keys].sort());
			}
			const verdict = pairVerdict(row);
			if (row.refusal !== undefined) {
				expect(verdict.refused, `expected a text refusal: ${row.command}`).toBeDefined();
				expect(verdict.refused ?? "", `refusal: ${row.command}`).toMatch(row.refusal);
			} else {
				expect(verdict.unheld.length, `expected an ungranted key: ${row.command} (${row.reason})`).toBeGreaterThan(0);
			}
		}
	});
});

describe("transport matcher / corpus shape", () => {
	it("covers every A1-A12 row of the research", () => {
		const reasons = [...PAIR_ALLOWED, ...PAIR_BLOCKED].map((row) => row.reason).join("\n");
		for (const tag of ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "A10", "A11", "A12"]) {
			expect(reasons, `research row ${tag} is not represented`).toContain(tag);
		}
	});

	it("has no duplicate rows and a corpus worth running", () => {
		// The same command recurs across the two tables on purpose (a grant moves it from
		// BLOCKED to ALLOWED); a repeated *row* would be a copy-paste slip.
		const rows = [...PAIR_ALLOWED, ...PAIR_BLOCKED].map((row) => `${row.command}\u0000${row.granted.join(",")}`);
		expect(new Set(rows).size).toBe(rows.length);
		expect(PAIR_ALLOWED.length).toBeGreaterThanOrEqual(40);
		expect(PAIR_BLOCKED.length).toBeGreaterThanOrEqual(20);
	});
});

describe("transport matcher / the comparator's distinction", () => {
	it("separates no grant at all from grants held that do not match", () => {
		expect(unmatched(["dev@build-box"], [])).toEqual({ missing: ["dev@build-box"], unmatched: [] });
		expect(unmatched(["dev@build-box"], ["other@host"])).toEqual({ missing: [], unmatched: ["dev@build-box"] });
		// A partial miss is the 'grants held' case: the held grant does not cover the missing key.
		expect(unmatched(["a", "b"], ["a"])).toEqual({ missing: [], unmatched: ["b"] });
		expect(unmatched(["a"], ["a"])).toEqual({ missing: [], unmatched: [] });
		expect(unmatched([], [])).toEqual({ missing: [], unmatched: [] });
	});
});

describe("transport matcher / the refusal builder", () => {
	const refused = {
		command: "ssh dev@build-box",
		keys: ["dev@build-box"],
		comparison: { missing: [], unmatched: ["dev@build-box"] } as GrantComparison,
		hasUI: true,
		isChild: false,
		projectTrusted: false,
	};

	it("names the key, the mismatch and the route, and never the fetch sentence", () => {
		const text = transportRefusal(refused);
		expect(text).toContain("dev@build-box");
		expect(text).toContain("/ssh-grant dev@build-box");
		expect(text).toContain("Do not look for another spelling");
		expect(text).not.toContain("fetch_content");
	});

	it("says 'no grant at all' when the session holds none", () => {
		const text = transportRefusal({ ...refused, comparison: { missing: ["dev@build-box"], unmatched: [] } });
		expect(text).toContain("holds no grant at all");
	});

	it("names the parent and the escalation for a child", () => {
		const text = transportRefusal({ ...refused, isChild: true });
		expect(text).toContain("agent_message.send");
		expect(text).toContain("parent");
		expect(text).not.toContain("/ssh-grant dev@build-box");
	});

	it("names why nobody can be asked when no dialog exists", () => {
		expect(transportRefusal({ ...refused, hasUI: false, projectTrusted: false })).toContain("not trusted");
		expect(transportRefusal({ ...refused, hasUI: false, projectTrusted: true })).toContain(".pi/ssh-grant.json");
	});

	it("remembers a decline", () => {
		const text = transportRefusal({ ...refused, declined: true });
		expect(text).toContain("declined");
		expect(text).toContain("--revoke");
	});
});

describe("transport matcher / the --rsh ssh defect", () => {
	it("consumes the space-separated value so the option is not invisible", () => {
		const reading = destinationKeys("rsync --rsh ssh dev@build-box:/srv/ ./");
		expect(reading.keys).toEqual(["dev@build-box"]);
		expect(reading.refused).toBeUndefined();
	});
});
