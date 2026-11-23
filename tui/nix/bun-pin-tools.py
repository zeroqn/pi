#!/usr/bin/env python3
"""What the release flow reads from, and writes to, nix/bun-pin.nix.

    bun-pin-tools.py claim                       # JSON: the pin as a claim about upstream Bun
    bun-pin-tools.py asset <system>              # "<asset> <hash>" for one platform, for staging the archive
    bun-pin-tools.py from-entries <file>...      # write the pin from the manifest entries a release built
    bun-pin-tools.py verified <run> <version>    # mark the pin as accepted by a run and a pi version

`from-entries` is what the publish job runs: the pin becomes exactly the Bun archives that release carries,
not whatever upstream happens to serve at publish time. That is the point of copying Bun into the release.
"""

import json
import re
import sys

PIN = "nix/bun-pin.nix"

# The upstream archive each platform's Bun comes from. Fixed by oven-sh's release layout, so a small table is
# cheaper than recording it in the manifest, where it would be dead weight for a downstream user.
UPSTREAM_ASSETS = {
    "x86_64-linux": "bun-linux-x64.zip",
    "aarch64-linux": "bun-linux-aarch64.zip",
    "aarch64-darwin": "bun-darwin-aarch64.zip",
}


def read():
    with open(PIN) as handle:
        return handle.read()


def claim(text):
    return {
        "version": re.search(r'  version = "(.+)";', text).group(1),
        "upstream": re.search(r'  upstream = "(.+)";', text).group(1),
        "archives": {
            system: {"asset": asset, "hash": digest, "etag": etag}
            for system, asset, digest, etag in re.findall(
                r"    (\S+) = \{\n"
                r'      asset = "(.+)";\n'
                r'      hash = "(.+)";\n'
                r'      etag = "(.+)";\n',
                text,
            )
        },
    }


def verified(text, run, pi):
    return re.sub(
        r'  verified = \{ run = ".*"; pi = ".*"; \};',
        '  verified = { run = "%s"; pi = "%s"; };' % (run, pi),
        text,
    )


def from_entries(paths):
    """A pin file built from manifest entries: the bytes a release carries are the bytes it pins."""
    entries = {}
    for path in paths:
        with open(path) as handle:
            text = handle.read()
        for system, body in re.findall(r"  (\S+) = \{\n(.*?)\n  \};", text, re.S):
            block = re.search(
                r"    bunAot = \{\n"
                r'      version = "(.+)";\n'
                r'      url = "(.+)";\n'
                r'      hash = "(.+)";\n',
                body,
            )
            if block:
                entries[system] = {"version": block.group(1), "hash": block.group(3)}
    if not entries:
        raise SystemExit("bun-pin-tools: no bunAot in %s" % ", ".join(paths))

    version = max(entry["version"] for entry in entries.values())
    lines = [
        "# The Bun canary this flake pins. GENERATED; do not edit by hand.",
        "#",
        "# Written by `bun-pin-tools.py from-entries` from the manifest of a release: the hashes are the archives",
        "# that release carries, so the pin names bytes that stay downloadable. `nix/runtime.nix` prefers the",
        "# release asset and falls back to this pin's upstream URL, which is what CI needs before a release",
        "# exists.",
        "{",
        '  version = "%s";' % version,
        '  upstream = "https://github.com/oven-sh/bun/releases/download/canary";',
        "",
        "  archives = {",
    ]
    for system, entry in sorted(entries.items()):
        lines += [
            "    %s = {" % system,
            '      asset = "%s";' % UPSTREAM_ASSETS.get(system, "bun-%s.zip" % system),
            '      hash = "%s";' % entry["hash"],
            '      etag = "";',
            '      lastModified = "";',
            "    };",
        ]
    lines += [
        "  };",
        "",
        "  # Filled by the release workflow: the run that compiled pi with this pin and passed the gate.",
        '  verified = { run = "unverified"; pi = ""; };',
        "}",
    ]
    with open(PIN, "w") as handle:
        handle.write("\n".join(lines) + "\n")
    print("bun-pin-tools: wrote %s from %d entries (%s)" % (PIN, len(entries), version))


def main(argv):
    if argv[1:2] == ["from-entries"] and len(argv) > 2:
        from_entries(argv[2:])
        return 0
    if argv[1:2] == ["asset"] and len(argv) == 3:
        archives = claim(read())["archives"]
        if argv[2] not in archives:
            print("bun-pin-tools: no archive for %s" % argv[2], file=sys.stderr)
            return 1
        entry = archives[argv[2]]
        print("%s %s" % (entry["asset"], entry["hash"]))
        return 0
    if argv[1:2] == ["claim"]:
        print(json.dumps(claim(read()), indent=1))
        return 0
    if argv[1:2] == ["verified"] and len(argv) == 4:
        text = read()
        new = verified(text, *argv[2:])
        if new == text:
            print("bun-pin-tools: the verified line did not change", file=sys.stderr)
            return 1
        with open(PIN, "w") as handle:
            handle.write(new)
        print("bun-pin-tools: verified by %s with pi %s" % tuple(argv[2:]))
        return 0
    print(__doc__, file=sys.stderr)
    return 2


sys.exit(main(sys.argv))
