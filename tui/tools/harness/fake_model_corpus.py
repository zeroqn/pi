#!/usr/bin/env python3
"""A deterministic OpenAI-compatible streaming model for the RPC event corpus.

A variant of `fake_model.py` for `record_corpus.py`: the answer is chosen from a keyword in the last
user prompt, so one server produces every shape the client must render.

    CODE ...    a Markdown answer whose fenced ```ts block grows over ~120 chunks, plus prose, a list,
                inline code and a link. Exercises incremental highlight and block splitting.
    BASH ...    one `bash` tool call whose command prints 1 200 numbered lines, then a short answer.
                Exercises a large tool result, truncation and a tool card.
    PLAIN ...   prose only.

Everything is streamed a word (or a few bytes) at a time, at `--pace-ms` per event (default: as fast as
the client writes).

Usage: fake_model_corpus.py PORT [--pace-ms N]
"""

import json
import socket
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PROSE = ("The renderer walks the document once and paints only the rows that changed, so a scrolled "
         "viewport costs the rows it shows rather than the transcript it holds ").split()
CODE = """```ts
export function frame(rows: string[], width: number): string[] {
	const out: string[] = [];
	for (const row of rows) {
		out.push(row.length > width ? row.slice(0, width) : row);
	}
	return out;
}
```"""
BASH_COMMAND = "seq 1 1200 | sed 's/^/line /'"


def chunk(delta=None, finish=None, usage=None):
	body = {
		"id": "chatcmpl-corpus",
		"object": "chat.completion.chunk",
		"created": 0,
		"model": "fake-model",
		"choices": [] if usage else [{"index": 0, "delta": delta or {}, "finish_reason": finish}],
	}
	if usage:
		body["usage"] = usage
	return f"data: {json.dumps(body)}\n\n".encode()


class Handler(BaseHTTPRequestHandler):
	protocol_version = "HTTP/1.1"

	def setup(self):
		super().setup()
		self.connection.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)

	def log_message(self, *args):
		pass

	def do_GET(self):
		body = json.dumps({"object": "list", "data": [{"id": "fake-model", "object": "model"}]}).encode()
		self.send_response(200)
		self.send_header("Content-Type", "application/json")
		self.send_header("Content-Length", str(len(body)))
		self.end_headers()
		self.wfile.write(body)

	def do_POST(self):
		body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
		req = json.loads(body or b"{}")
		messages = req.get("messages", [])
		# The last user prompt decides the answer; tool results since then make this a continuation.
		prompt, turn = "", 0
		for m in messages:
			if m.get("role") == "user":
				prompt = json.dumps(m.get("content"))[:400]
				turn = 0
			elif m.get("role") == "tool":
				turn += 1

		out = [chunk({"role": "assistant", "content": ""})]
		if "BASH" in prompt and turn == 0:
			args = json.dumps({"command": BASH_COMMAND, "description": "print 1200 lines"})
			out.append(chunk({"tool_calls": [{"index": 0, "id": "call_bash", "type": "function",
			                                  "function": {"name": "bash", "arguments": ""}}]}))
			for i in range(0, len(args), 6):
				out.append(chunk({"tool_calls": [{"index": 0, "function": {"arguments": args[i:i + 6]}}]}))
			out.append(chunk(finish="tool_calls"))
		elif "CODE" in prompt:
			out.append(chunk({"content": "## Frame rendering\n\n"}))
			for i in range(80):
				out.append(chunk({"content": PROSE[i % len(PROSE)] + " "}))
			out.append(chunk({"content": "\n\nThe frame function:\n\n"}))
			# The fenced block arrives in small pieces, the shape that forces a stateful highlighter.
			for i in range(0, len(CODE), 12):
				out.append(chunk({"content": CODE[i:i + 12]}))
			out.append(chunk({"content": "\n\n- **cost**: rows, not the transcript\n"
			                             "- **write**: one buffer per frame\n\n"
			                             "See `tui-main-screen.ts` and [the map](https://example.com).\n"}))
			out.append(chunk(finish="stop"))
		else:
			out.append(chunk({"content": "## Answer\n\n"}))
			for i in range(90):
				out.append(chunk({"content": PROSE[i % len(PROSE)] + " "}))
			out.append(chunk({"content": "\n\nDone."}))
			out.append(chunk(finish="stop"))
		out.append(chunk(usage={"prompt_tokens": 1200, "completion_tokens": 160, "total_tokens": 1360}))
		out.append(b"data: [DONE]\n\n")

		self.send_response(200)
		self.send_header("Content-Type", "text/event-stream")
		self.send_header("Cache-Control", "no-cache")
		self.send_header("Transfer-Encoding", "chunked")
		self.end_headers()
		pace = PACE_MS / 1000.0
		for part in out:
			self.wfile.write(b"%x\r\n" % len(part) + part + b"\r\n")
			self.wfile.flush()
			if pace:
				time.sleep(pace)
		self.wfile.write(b"0\r\n\r\n")
		self.wfile.flush()


if __name__ == "__main__":
	port = int(sys.argv[1])
	args = sys.argv[2:]
	PACE_MS = float(args[args.index("--pace-ms") + 1]) if "--pace-ms" in args else 0.0
	server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
	server.daemon_threads = True
	server.serve_forever()
