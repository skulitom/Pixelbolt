"""Measure Pixelbolt main f964f40's tools/list and pixel_help reply sizes over stdio. Usage: python measure_sizes.py <out.txt>"""
import json
import os
import subprocess
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
msgs = [
    {"jsonrpc": "2.0", "id": 1, "method": "initialize",
     "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t", "version": "1"}}},
    {"jsonrpc": "2.0", "method": "notifications/initialized"},
    {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
    {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "pixel_help", "arguments": {}}},
]
os.makedirs(os.path.join(BASE, "smoke"), exist_ok=True)
p = subprocess.run(["node", os.path.join(BASE, "pixelbolt-f964f40", "bin", "pixelbolt.js"), "mcp"],
                   input="".join(json.dumps(m) + "\n" for m in msgs).encode(), capture_output=True,
                   cwd=os.path.join(BASE, "smoke"), timeout=60)
replies = {}
for line in p.stdout.splitlines():
    m = json.loads(line)
    replies[m.get("id")] = (m, len(line))
tools, tl_bytes = replies[2][0]["result"]["tools"], replies[2][1]
help_chars = sum(len(c.get("text", "")) for c in replies[3][0]["result"]["content"])
text = ("Pixelbolt main f964f40 (git archive of github.com/skulitom/Pixelbolt; the server reports 0.9.1), "
        "measured 2026-10-26, Node 24.19.0\n"
        f"- tools/list reply: {tl_bytes:,} bytes of JSON-RPC for {len(tools)} tools, one page (no nextCursor: "
        f"{'nextCursor' not in replies[2][0]['result']})\n"
        f"- pixel_help with no arguments: {help_chars:,} characters of text content\n"
        "How: run `node bin/pixelbolt.js mcp`, send initialize, notifications/initialized, tools/list, then\n"
        "tools/call pixel_help {}, and measure the two replies (measure_sizes.py).\n")
open(sys.argv[1], "w", encoding="utf-8", newline="\n").write(text)
print(text)
