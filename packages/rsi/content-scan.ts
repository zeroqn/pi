/**
 * The content scan for learned skills (spec §4.4, ticket 10).
 *
 * Every shipped file is scanned, not just SKILL.md: an instruction-override
 * matters most in a file a future agent reads, and scripts are read too.
 *
 * A **hard hit** — a credential or an instruction-override — rejects the write
 * and surfaces immediately. A **soft hit** — a machine-specific path, a private
 * host or an address — blocks the write with the offending text named so the
 * fork can retry once without it. Both are heuristics, deliberately biased
 * toward refusing: a false soft hit costs one retry, a missed credential is a
 * secret in the library.
 */

export interface ScanFile {
	path: string;
	content: string;
}

export interface ContentHit {
	path: string;
	kind: "hard" | "soft";
	label: string;
	/** The matched text, trimmed, so the fork can find and remove it. */
	excerpt: string;
}

export interface ContentScanResult {
	hard: ContentHit[];
	soft: ContentHit[];
}

interface Pattern {
	label: string;
	pattern: RegExp;
}

/** Rejections: a secret, or content that tries to countermand the prompt. */
const HARD_PATTERNS: Pattern[] = [
	{ label: "private key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
	{ label: "AWS access key id", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
	{ label: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
	{ label: "OpenAI-style key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
	{ label: "JSON web token", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
	{
		label: "assigned secret",
		pattern: /\b(?:api[_-]?key|secret|password|passwd|access[_-]?token|auth[_-]?token)\b\s*[:=]\s*["']?[A-Za-z0-9_\-./+]{20,}/i,
	},
	{
		label: "instruction override",
		pattern: /\b(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|prior|above|earlier)\s+(?:instructions|prompts|rules|messages)\b/i,
	},
	{ label: "instruction override", pattern: /\byou\s+are\s+now\b/i },
	{ label: "instruction override", pattern: /\boverride\s+(?:the\s+)?system\s+prompt\b/i },
	{ label: "instruction override", pattern: /\bnew\s+system\s+instructions?\b/i },
];

/**
 * Refusals with one retry: content that only makes sense on one machine. Public
 * documentation hostnames are intentionally not flagged — only machine-local
 * ones, which is what makes a skill environment-dependent.
 */
const SOFT_PATTERNS: Pattern[] = [
	{ label: "absolute home path", pattern: /\/home\/[A-Za-z0-9._-]+\// },
	{ label: "absolute home path", pattern: /\/Users\/[A-Za-z0-9._-]+\// },
	{ label: "temp path", pattern: /(?:^|[^A-Za-z0-9_-])\/tmp\/[A-Za-z0-9._/-]+/ },
	{ label: "private host", pattern: /\b(?:[a-z0-9-]+\.)+(?:internal|local|lan|intranet|corp)\b/i },
	{ label: "loopback host", pattern: /\blocalhost\b/i },
	{ label: "private address", pattern: /\b(?:10|192\.168|172\.(?:1[6-9]|2[0-9]|3[01]))\.\d{1,3}\.\d{1,3}\b/ },
];

export function scanSkillContent(files: readonly ScanFile[]): ContentScanResult {
	const hard: ContentHit[] = [];
	const soft: ContentHit[] = [];

	for (const file of files) {
		for (const { label, pattern } of HARD_PATTERNS) {
			const match = pattern.exec(file.content);
			if (match) hard.push({ path: file.path, kind: "hard", label, excerpt: excerpt(match[0]) });
		}
		for (const { label, pattern } of SOFT_PATTERNS) {
			const match = pattern.exec(file.content);
			if (match) soft.push({ path: file.path, kind: "soft", label, excerpt: excerpt(match[0]) });
		}
	}

	return { hard, soft };
}

/** One line per hit, for the tool error the fork reads. */
export function formatContentHits(hits: readonly ContentHit[]): string {
	return hits.map((hit) => `${hit.kind} hit in ${hit.path}: ${hit.label} — "${hit.excerpt}"`).join("\n");
}

function excerpt(match: string): string {
	const collapsed = match.replace(/\s+/g, " ").trim();
	return collapsed.length > 80 ? `${collapsed.slice(0, 77)}...` : collapsed;
}
