import { describe, expect, it } from "bun:test";
import { checkEgress } from "../egress";

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
