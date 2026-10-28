#!/usr/bin/env python3
"""Run source/compiled network contracts against an isolated loopback service."""
import argparse
import os
from pathlib import Path
import socketserver
import subprocess
import threading
from host_runtime import ape_command

ROOT = Path(__file__).resolve().parents[1]


class Echo(socketserver.BaseRequestHandler):
    def handle(self):
        self.request.settimeout(15)
        try:
            while data := self.request.recv(16384):
                self.request.sendall(data)
        except (OSError, TimeoutError):
            pass


class Service(socketserver.ThreadingTCPServer):
    daemon_threads = True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--executable', type=Path, required=True)
    parser.add_argument('--source', action='store_true')
    args = parser.parse_args()
    with Service(('127.0.0.1', 0), Echo) as service:
        thread = threading.Thread(target=service.serve_forever, daemon=True)
        thread.start()
        environment = dict(os.environ, NODE_COMPAT_NETWORK_PORT=str(service.server_address[1]))
        flags = ['-m', str(ROOT / 'tests/runtime_network.mjs')] if args.source else []
        command = ape_command(args.executable.resolve(), flags, ROOT / 'dist')
        try:
            for extra in ([], ['unref']):
                result = subprocess.run([*map(str, command), *extra], env=environment,
                                        cwd=ROOT, capture_output=True, text=True, timeout=60)
                marker = 'PASS network-unref' if extra else 'PASS runtime-network'
                print(result.stdout, end='')
                print(result.stderr, end='')
                if result.returncode or marker not in result.stdout:
                    raise SystemExit('network contract failed: ' + str(result.returncode))
        finally:
            service.shutdown()
            thread.join(timeout=5)


if __name__ == '__main__':
    main()
