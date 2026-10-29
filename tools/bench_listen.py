#!/usr/bin/env python3
"""Receives the launcher's on-TV benchmark (POSTed JSON) and prints it.

    python3 tools/bench_listen.py            # then launch with --params '{"bench":true,"report":"http://<mac-ip>:8765/"}'
"""
import http.server
import json
import sys


class Handler(http.server.BaseHTTPRequestHandler):
    count = 0

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get('Content-Length') or 0))
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        try:
            print(json.dumps(json.loads(body), indent=1), flush=True)
        except ValueError:
            print(body, flush=True)
        Handler.count += 1
        if Handler.count >= int(sys.argv[sys.argv.index('--n') + 1] if '--n' in sys.argv else 1 << 30):
            raise SystemExit

    def log_message(self, *args):
        pass


http.server.HTTPServer(('0.0.0.0', 8765), Handler).serve_forever()
