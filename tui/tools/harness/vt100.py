#!/usr/bin/env python3
"""A small VT100/xterm screen: feed it a pty's bytes and read back the grid.

The acceptance bar's C-10 and C-15 need this, and nothing else in the harness has it: `screen()` in the
other probes strips ANSI and cannot replay cursor movement, so it cannot answer "what did the user see
after the window scrolled".

Scope is what pi and this client actually emit: cursor position and motion, erase in line/display, scroll
regions and scroll up/down, insert/delete, SGR (held but not rendered as colour), the alternate screen,
save/restore, OSC strings, and wide characters. Anything else is counted and ignored rather than
guessed at — `unknown` in the stats says what was dropped, so a wrong fact is traceable.

    ./vt100.py --selftest        # the checks this file makes about itself
    ./vt100.py --feed <file>     # dump the screen a recorded stream paints
"""

import argparse
import sys
import unicodedata
from pathlib import Path

CSI = "\x1b["
OSC = "\x1b]"


def ch_width(ch):
	"""Terminal cells one character occupies: 2 for East Asian wide and fullwidth, 0 for combining."""
	if unicodedata.combining(ch):
		return 0
	return 2 if unicodedata.east_asian_width(ch) in ("W", "F") else 1


class Screen:
	def __init__(self, cols=80, rows=24):
		self.cols = cols
		self.rows = rows
		self.grid = [[" "] * cols for _ in range(rows)]
		self.row = 0
		self.col = 0
		self.saved = (0, 0)
		self.top = 0
		self.bottom = rows - 1
		self.alt = None
		self.unknown = 0
		self.tail = ""  # an incomplete escape sequence, carried to the next feed

	def _reset_region(self):
		self.top = 0
		self.bottom = self.rows - 1

	def _clamp(self):
		self.row = max(0, min(self.row, self.rows - 1))
		self.col = max(0, min(self.col, self.cols - 1))

	def _scroll_up(self, count=1):
		"""One line up inside the scroll region: the top line leaves, a blank one joins at the bottom."""
		for _ in range(count):
			del self.grid[self.top]
			self.grid.insert(self.bottom, [" "] * self.cols)
			self._reset_grid_len()

	def _scroll_down(self, count=1):
		for _ in range(count):
			del self.grid[self.bottom]
			self.grid.insert(self.top, [" "] * self.cols)
			self._reset_grid_len()

	def _reset_grid_len(self):
		# `del`/`insert` keep the length, but a scroll region that is not the whole screen must not grow it.
		while len(self.grid) > self.rows:
			del self.grid[-1]
		while len(self.grid) < self.rows:
			self.grid.append([" "] * self.cols)

	def _put(self, ch):
		w = ch_width(ch)
		if w == 0:
			return
		if self.col + w > self.cols:
			# Autowrap, unless the terminal disabled it; pi and this client leave it on.
			self.col = 0
			self._linefeed()
		self.grid[self.row][self.col] = ch
		if w == 2 and self.col + 1 < self.cols:
			self.grid[self.row][self.col + 1] = ""
		self.col += w
		# A cursor that just wrote the last cell stays one past it: the terminal is in *pending wrap*, and
		# the next printable character wraps. Clamping to the last column here made a row that fills the
		# pane lose its last cell to the `\x1b[K` a client writes after the row (measured 2026-11-24: the
		# Rust client's rule and footer rows read one column short, pi's did not because pi erases before
		# it paints). Erasing from `self.col == self.cols` now erases nothing, which is what a terminal
		# does.

	def _linefeed(self):
		if self.row == self.bottom:
			self._scroll_up(1)
		else:
			self.row = min(self.row + 1, self.rows - 1)

	def _erase(self, row, start, end):
		for col in range(max(0, start), min(end, self.cols)):
			self.grid[row][col] = " "

	def _csi(self, params, final):
		parts = [p for p in params.split(";")] if params else []
		def num(index, default=1):
			if index >= len(parts) or parts[index] == "":
				return default
			try:
				return int(parts[index].split(":")[0])
			except ValueError:
				return default
		n = num(0)
		if final in "Hf":
			self.row = num(0, 1) - 1
			self.col = num(1, 1) - 1
			self._clamp()
		elif final == "A":
			self.row -= n
			self._clamp()
		elif final == "B":
			self.row += n
			self._clamp()
		elif final == "C":
			self.col += n
			self._clamp()
		elif final == "D":
			self.col -= n
			self._clamp()
		elif final == "E":
			self.row += n
			self.col = 0
			self._clamp()
		elif final == "F":
			self.row -= n
			self.col = 0
			self._clamp()
		elif final == "G" or final == "`":
			self.col = n - 1
			self._clamp()
		elif final == "d":
			self.row = n - 1
			self._clamp()
		elif final == "J":
			mode = num(0, 0) if parts else 0
			if mode == 0:
				self._erase(self.row, self.col, self.cols)
				for row in range(self.row + 1, self.rows):
					self._erase(row, 0, self.cols)
			elif mode in (1,):
				for row in range(0, self.row):
					self._erase(row, 0, self.cols)
				self._erase(self.row, 0, self.col + 1)
			else:
				for row in range(self.rows):
					self._erase(row, 0, self.cols)
		elif final == "K":
			mode = num(0, 0) if parts else 0
			if mode == 0:
				self._erase(self.row, self.col, self.cols)
			elif mode == 1:
				self._erase(self.row, 0, self.col + 1)
			else:
				self._erase(self.row, 0, self.cols)
		elif final == "X":
			self._erase(self.row, self.col, self.col + n)
		elif final == "@":
			line = self.grid[self.row]
			for _ in range(n):
				line.insert(self.col, " ")
				line.pop()
		elif final == "P":
			line = self.grid[self.row]
			for _ in range(n):
				if self.col < len(line):
					del line[self.col]
					line.append(" ")
		elif final == "L":
			for _ in range(n):
				self.grid.insert(self.row, [" "] * self.cols)
				if self.bottom + 1 < len(self.grid):
					del self.grid[self.bottom + 1]
				else:
					del self.grid[-1]
			self._reset_grid_len()
		elif final == "M":
			for _ in range(n):
				del self.grid[self.row]
				self.grid.insert(self.bottom, [" "] * self.cols)
			self._reset_grid_len()
		elif final == "S":
			self._scroll_up(n)
		elif final == "T":
			self._scroll_down(n)
		elif final == "r":
			self.top = num(0, 1) - 1
			self.bottom = num(1, self.rows) - 1
			self.top = max(0, min(self.top, self.rows - 1))
			self.bottom = max(self.top, min(self.bottom, self.rows - 1))
			self.row = self.top
			self.col = 0
		elif final == "h" or final == "l":
			on = final == "h"
			for part in parts:
				if part in ("1049", "47", "1047"):
					if on and self.alt is None:
						self.alt = (self.grid, self.row, self.col)
						self.grid = [[" "] * self.cols for _ in range(self.rows)]
						self.row, self.col = 0, 0
					elif not on and self.alt is not None:
						self.grid, self.row, self.col = self.alt
						self.alt = None
				elif part == "25":
					pass  # cursor visibility: held, not drawn
				else:
					pass  # every other mode is irrelevant to what is on screen
		elif final == "s":
			self.saved = (self.row, self.col)
		elif final == "u":
			self.row, self.col = self.saved
			self._clamp()
		elif final == "m":
			pass  # SGR: colour is not part of "what is on screen" by text
		elif final in "nqtc":
			pass
		else:
			self.unknown += 1

	def feed(self, data):
		"""Consume bytes (or text) and update the grid. Incomplete sequences are carried over."""
		text = self.tail + (data.decode("utf-8", "replace") if isinstance(data, (bytes, bytearray)) else data)
		self.tail = ""
		i = 0
		n = len(text)
		while i < n:
			ch = text[i]
			if ch == "\x1b":
				if i + 1 >= n:
					self.tail = text[i:]
					return
				nxt = text[i + 1]
				if nxt == "[":
					j = i + 2
					params = []
					while j < n and (text[j].isdigit() or text[j] in ";:?>="):
						params.append(text[j])
						j += 1
					if j >= n:
						self.tail = text[i:]
						return
					final = text[j]
					self._csi("".join(params).lstrip("?>="), final)
					i = j + 1
					continue
				if nxt == "]":
					j = i + 2
					while j < n:
						if text[j] == "\x07":
							j += 1
							break
						if text[j] == "\x1b" and j + 1 < n and text[j + 1] == "\\":
							j += 2
							break
						j += 1
					if j >= n:
						self.tail = text[i:]
						return
					i = j
					continue
				if nxt in "()*+":
					i += 3
					continue
				i += 2
				continue
			if ch == "\r":
				self.col = 0
			elif ch == "\n":
				self._linefeed()
			elif ch == "\b":
				self.col = max(0, self.col - 1)
			elif ch == "\t":
				self.col = min(self.cols - 1, (self.col // 8 + 1) * 8)
			elif ch == "\x07":
				pass
			elif ch < " ":
				pass
			else:
				self._put(ch)
			i += 1

	def lines(self):
		"""The grid as text rows, right-trimmed."""
		out = []
		for row in self.grid:
			text = "".join(row).rstrip()
			out.append(text)
		return out

	def text(self):
		return "\n".join(self.lines())

	def find(self, needle):
		"""Which row holds `needle`, or None: the one primitive every fact extractor needs."""
		for index, line in enumerate(self.lines()):
			if needle in line:
				return index
		return None


def selftest():
	"""The checks this file makes about itself: each pairs a stream with the screen it must paint."""
	case = []

	def check(name, stream, expect, cols=20, rows=6):
		screen = Screen(cols, rows)
		screen.feed(stream.encode() if isinstance(stream, str) else stream)
		case.append((name, screen, expect))

	check("plain text lands on the first row", "hello", "hello")
	check("a cursor move writes elsewhere", "\x1b[2;1Hsecond", "second", cols=20, rows=6)
	check("erase from the cursor to the end of the line", "abcdef\r\x1b[3C\x1b[K", "abc")
	check("erase the whole display", "abc\x1b[2J\x1b[1;1Hnew", "new")
	check("carriage return overwrites", "abc\rX", "Xbc")
	check("linefeed scrolls at the bottom", "1\r\n2\r\n3\r\n4\r\n5\r\n6\r\n7", "2\n3\n4\n5\n6\n7", cols=20, rows=6)
	check("scroll up moves the region", "\x1b[2;4r\x1b[4;1H\n", "", cols=20, rows=6)
	check("insert lines pushes down", "\x1b[1;1Htop\x1b[2;1Hsecond\x1b[1;1H\x1b[L", "top\nsecond")
	check("delete lines pulls up", "\x1b[1;1Htop\x1b[2;1Hsecond\x1b[1;1H\x1b[M", "second")
	check("wide characters take two cells", "你好", "你好")
	# A wide character that does not fit moves to the next row, as xterm does.
	check("a wide character that does not fit wraps", "a" * 19 + "你", "a" * 19 + "\n你", cols=20, rows=6)
	check("OSC 52 is consumed whole", "\x1b]52;c;aGk=\x07hi", "hi")
	check("an OSC terminated by ST is consumed", "\x1b]0;title\x1b\\hi", "hi")
	check("an unknown sequence is counted, not guessed", "\x1b[5zhi", "hi")
	check("an incomplete frame is carried over", "\x1b[2;1", "")

	def trimmed(text):
		"""Rows with blank lines removed from both ends: a screen's content, not its padding."""
		rows = text.split("\n")
		while rows and not rows[0].strip():
			rows.pop(0)
		while rows and not rows[-1].strip():
			rows.pop()
		return "\n".join(rows)

	failures = 0
	for name, screen, expect in case:
		got = trimmed(screen.text())
		want = trimmed(expect)
		ok = got == want
		print(("ok   " if ok else "FAIL ") + name)
		if not ok:
			failures += 1
			print("      want:", repr(want))
			print("      got: ", repr(got_cmp))

	# The carry-over case: finishing the sequence must complete the move.
	carry = Screen(20, 6)
	carry.feed("\x1b[2;1")
	carry.feed("Hsecond")
	ok = carry.lines()[1] == "second"
	print(("ok   " if ok else "FAIL ") + "a carried-over sequence completes on the next feed")
	failures += 0 if ok else 1
	return 1 if failures else 0


def main():
	ap = argparse.ArgumentParser()
	ap.add_argument("--selftest", action="store_true")
	ap.add_argument("--feed", help="a file of raw pty bytes to paint")
	ap.add_argument("--cols", type=int, default=80)
	ap.add_argument("--rows", type=int, default=24)
	a = ap.parse_args()
	if a.selftest:
		sys.exit(selftest())
	if a.feed:
		screen = Screen(a.cols, a.rows)
		screen.feed(Path(a.feed).read_bytes())
		for line in screen.lines():
			print(line)
		if screen.unknown:
			print(f"[{screen.unknown} unknown sequences ignored]", file=sys.stderr)
		return
	ap.print_help()


if __name__ == "__main__":
	main()
