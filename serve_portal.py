from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import ssl
import subprocess

PORT = 8081
PORTAL_DIR = Path(__file__).resolve().parent
CERT_FILE = Path(__file__).resolve().parent / "localhost-cert.pem"
KEY_FILE = Path(__file__).resolve().parent / "localhost-key.pem"


class Handler(SimpleHTTPRequestHandler):
    def _set_cors_headers(self):
        origin = self.headers.get("Origin", "*")
        req_headers = self.headers.get("Access-Control-Request-Headers")
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS, HEAD")
        self.send_header(
            "Access-Control-Allow-Headers",
            req_headers if req_headers else "Content-Type, Authorization",
        )
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Cross-Origin-Resource-Policy", "cross-origin")

    def end_headers(self):
        self._set_cors_headers()
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()


def ensure_cert():
    if CERT_FILE.exists() and KEY_FILE.exists():
        return

    cmd_with_san = [
        "openssl",
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        str(KEY_FILE),
        "-out",
        str(CERT_FILE),
        "-days",
        "365",
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=DNS:localhost,IP:127.0.0.1",
    ]
    cmd_fallback = [
        "openssl",
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        str(KEY_FILE),
        "-out",
        str(CERT_FILE),
        "-days",
        "365",
        "-subj",
        "/CN=localhost",
    ]

    try:
        subprocess.run(cmd_with_san, check=True, capture_output=True, text=True)
    except Exception:
        subprocess.run(cmd_fallback, check=True, capture_output=True, text=True)


if __name__ == "__main__":
    if not PORTAL_DIR.exists():
        raise FileNotFoundError(f"Portal directory not found: {PORTAL_DIR}")

    ensure_cert()
    handler = partial(Handler, directory=str(PORTAL_DIR))
    httpd = ThreadingHTTPServer(("0.0.0.0", PORT), handler)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(certfile=str(CERT_FILE), keyfile=str(KEY_FILE))
    httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
    print(f"Serving {PORTAL_DIR} at https://0.0.0.0:{PORT}")
    httpd.serve_forever()
