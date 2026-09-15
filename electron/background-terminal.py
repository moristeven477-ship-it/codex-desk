"""Create/reuse a GNOME Terminal tab without activating its window.

Invoked with a private JSON request on stdin; never execute shell command text.
Only screens recorded by Desk are reused. The terminal and CLI outlive Desk.
"""
import hashlib
import json
import os
from pathlib import Path
import sys
import time
import subprocess

from gi.repository import Gio, GLib

FACTORY = "/org/gnome/Terminal/Factory0"
INTERFACE = "org.gnome.Terminal.Terminal0"


def call(bus, owner, target, interface, method, arguments, result_type=None):
    return bus.call_sync(owner, target, interface, method, arguments,
                         GLib.VariantType(result_type) if result_type else None,
                         Gio.DBusCallFlags.NONE, 5000, None)


def process_start(pid):
    # comm may contain spaces or parentheses. Field 22 is the start time.
    return Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()[19]


def alive(marker):
    try:
        record = json.loads(marker.read_text())
        return process_start(int(record["pid"])) == record["start"]
    except (OSError, ValueError, KeyError, IndexError):
        return False


def valid_screen(bus, owner, screen):
    try:
        xml = call(bus, owner, screen, "org.freedesktop.DBus.Introspectable",
                   "Introspect", None, "(s)").unpack()[0]
        return INTERFACE in xml
    except GLib.Error:
        return False


RUNNER = """
import json, os, sys
from pathlib import Path
marker, binary, *args = sys.argv[1:]
pid = os.getpid()
start = Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()[19]
fd = os.open(marker, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, 'w') as output:
    json.dump({'pid': pid, 'start': start}, output)
os.execvpe(binary, [binary, *args], os.environ)
"""


def main():
    request = json.load(sys.stdin)
    directory = Path(request["directory"])
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    state_path = directory / "native-terminals.json"
    try:
        state = json.loads(state_path.read_text())
    except (OSError, ValueError):
        state = {}
    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    app_id = "io.github.codexdesk.Terminals.h" + hashlib.sha256(str(directory).encode()).hexdigest()[:16]
    def get_owner():
        try:
            return call(bus, "org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus",
                        "GetNameOwner", GLib.Variant("(s)", (app_id,)), "(s)").unpack()[0]
        except GLib.Error:
            return None
    owner = get_owner()
    if not owner:
        library = Path(request["focusLibrary"])
        if not library.is_file():
            raise RuntimeError("The background window helper is missing.")
        environment = dict(request["env"])
        environment["LD_PRELOAD"] = str(library)
        environment.pop("DESKTOP_STARTUP_ID", None)
        environment.pop("XDG_ACTIVATION_TOKEN", None)
        server = subprocess.Popen(["/usr/libexec/gnome-terminal-server", "--app-id", app_id, "--class", "Gnome-terminal"],
                                  env=environment, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                  stderr=subprocess.DEVNULL, start_new_session=True)
        for _ in range(150):
            owner = get_owner()
            if owner:
                break
            if server.poll() is not None:
                raise RuntimeError("GNOME Terminal could not start.")
            time.sleep(0.05)
        if not owner:
            raise RuntimeError("GNOME Terminal did not connect.")
    # A unique bus owner prevents stale object paths being mistaken for a new server.
    state = {key: value for key, value in state.items()
             if value.get("owner") == owner and valid_screen(bus, owner, value["screen"])}
    key = hashlib.sha256((request["codexHome"] + "\0" + request["threadId"]).encode()).hexdigest()
    marker = directory / ("terminal-" + key + ".json")
    entry = state.get(key)
    if entry and alive(marker):
        print(json.dumps({"reused": True, "screen": entry["screen"]}))
        return
    if not entry:
        options = {
            "title": GLib.Variant("s", request["title"]),
            "active": GLib.Variant("b", False),
            "present-window": GLib.Variant("b", False),
            # The private GTK helper maps the first window iconified. Following
            # tabs use present-window=false, without changing the active tab.
            "role": GLib.Variant("s", "codex-desk-conversations"),
        }
        if state:
            options["window-from-screen"] = GLib.Variant("o", next(iter(state.values()))["screen"])
        screen = call(bus, owner, FACTORY, "org.gnome.Terminal.Factory0", "CreateInstance",
                      GLib.Variant("(a{sv})", (options,)), "(o)").unpack()[0]
        entry = {"owner": owner, "screen": screen}
    environment = dict(request["env"])
    environment["CODEX_HOME"] = request["codexHome"]
    # Do not pass the private GTK window helper to Codex or its tools.
    environment.setdefault("LD_PRELOAD", "")
    for name in ("GNOME_TERMINAL_SCREEN", "GNOME_TERMINAL_SERVICE", "DESKTOP_STARTUP_ID", "XDG_ACTIVATION_TOKEN"):
        environment.pop(name, None)
    arguments = ["/usr/bin/python3", "-c", RUNNER, str(marker), request["binary"], *request["args"]]
    options = {
        "cwd": GLib.Variant("ay", os.fsencode(request["cwd"]) + b"\0"),
        "shell": GLib.Variant("b", False),
        "environ": GLib.Variant("aay", [os.fsencode(f"{name}={value}") + b"\0"
                                         for name, value in environment.items()]),
    }
    call(bus, owner, entry["screen"], INTERFACE, "Exec",
         GLib.Variant("(a{sv}aay)", (options, [os.fsencode(arg) + b"\0" for arg in arguments])))
    state[key] = entry
    temporary = state_path.with_suffix(".tmp")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as output:
        json.dump(state, output)
    temporary.replace(state_path)
    # Exec returns after spawning, just before the runner writes its PID marker.
    # Wait for that handshake so a rapid second request cannot execute twice.
    for _ in range(100):
        if alive(marker):
            break
        time.sleep(0.01)
    print(json.dumps({"reused": False, "screen": entry["screen"]}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
