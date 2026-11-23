#!/usr/bin/env python3
"""The two edits a release makes to nix/bun-pin.nix, kept in one place so the workflow has no heredocs.

    bun-pin-tools.py claim                     # JSON: what the pin claims about upstream Bun
    bun-pin-tools.py verified <run> <version>  # mark the pin as accepted by a run and a pi version
"""

import json
import re
import sys

PIN = "nix/bun-pin.nix"


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


def main(argv):
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
