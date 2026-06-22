from __future__ import annotations

import os
import socket
import subprocess
import sys
import time
import webbrowser
from pathlib import Path


ROOT = Path(__file__).resolve().parent
RELEASE_DATA_DIR = Path(r"D:\releases\AccountingManagement_V1.3.3\price_offer\data")
DATA_DIR = os.environ.get(
    "PRICE_OFFER_DATA_DIR",
    str(RELEASE_DATA_DIR if RELEASE_DATA_DIR.exists() else ROOT / "data"),
)
DEFAULT_PORT_NUMBER = 4181
DEFAULT_PORT = str(DEFAULT_PORT_NUMBER)
LEGACY_PORT = str(DEFAULT_PORT_NUMBER - 1)
DEFAULT_LAN_HOST = os.environ.get("PRICE_OFFER_DEFAULT_HOST", "192.168.137.1")


def npm_command() -> str:
    return "npm.cmd" if os.name == "nt" else "npm"


def lan_ips() -> list[str]:
    ips: set[str] = set()
    try:
        host = socket.gethostname()
        for item in socket.getaddrinfo(host, None, socket.AF_INET):
            ip = item[4][0]
            if not ip.startswith("127."):
                ips.add(ip)
    except OSError:
        pass
    return sorted(ips, key=lambda ip: (ip != DEFAULT_LAN_HOST, ip))


def default_server_url(port: str) -> str:
    return f"http://{DEFAULT_LAN_HOST}:{port}"


def port_is_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(0.25)
        return probe.connect_ex(("127.0.0.1", port)) != 0


def choose_port() -> str:
    configured = os.environ.get("PRICE_OFFER_PORT")
    if configured:
        return configured
    return DEFAULT_PORT


def stop_port_listener(port: str) -> None:
    if os.name != "nt":
        return
    try:
        result = subprocess.run(
            ["netstat", "-ano", "-p", "tcp"],
            text=True,
            capture_output=True,
            check=False,
        )
    except FileNotFoundError:
        return

    pids: set[str] = set()
    marker = f":{port}"
    current_pid = str(os.getpid())
    for line in result.stdout.splitlines():
        parts = line.split()
        if len(parts) < 5 or parts[0].upper() != "TCP":
            continue
        local_address, state, pid = parts[1], parts[-2].upper(), parts[-1]
        if local_address.endswith(marker) and state == "LISTENING" and pid != current_pid:
            pids.add(pid)

    for pid in sorted(pids):
        subprocess.run(["taskkill", "/PID", pid, "/F"], check=False, capture_output=True)


def run_step(args: list[str]) -> None:
    print(f"\n> {' '.join(args)}")
    subprocess.run(args, cwd=ROOT, check=True)


def main() -> int:
    os.chdir(ROOT)
    port = choose_port()
    stop_port_listener(LEGACY_PORT)
    stop_port_listener(port)
    env = os.environ.copy()
    env["PRICE_OFFER_DATA_DIR"] = DATA_DIR
    env["PRICE_OFFER_PORT"] = port
    env["PRICE_OFFER_DEFAULT_HOST"] = DEFAULT_LAN_HOST

    print("Accounting Management web server")
    print(f"Folder: {ROOT}")
    print(f"Database folder: {DATA_DIR}")
    print(f"Admin password: 23320001")

    try:
        run_step([npm_command(), "run", "build:web"])
    except (subprocess.CalledProcessError, FileNotFoundError) as error:
        print("\nCould not build the web app.")
        print("Make sure Node.js is installed and dependencies are present.")
        print(error)
        return 1

    print(f"\nServer URL: {default_server_url(port)}")
    for ip in lan_ips():
        print(f"LAN URL: http://{ip}:{port}")
    print("\nFor access from outside this network, forward this port on the router")
    print("or attach a tunnel/reverse proxy to the same URL.")
    print("\nStarting server. Leave this window open.")

    try:
        process = subprocess.Popen(["node", "server/index.cjs"], cwd=ROOT, env=env)
    except FileNotFoundError:
        print("Node.js was not found in PATH.")
        return 1

    time.sleep(1.5)
    webbrowser.open(default_server_url(port))

    try:
        return process.wait()
    except KeyboardInterrupt:
        process.terminate()
        return 0


if __name__ == "__main__":
    sys.exit(main())
