"""Run through npm run test:terminal: private X11 display, bus and process tree."""
import ctypes
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

import gi
gi.require_version("Gtk", "3.0")
from gi.repository import Gtk

assert os.environ.get("DESK_TERMINAL_TEST") == "1", "Use npm run test:terminal for isolation."
root = Path(sys.argv[1])
wm = subprocess.Popen([os.environ.get("DESK_TEST_WM", "openbox")], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(0.5)
assert wm.poll() is None, "Install Openbox or set DESK_TEST_WM."
if "--native" in sys.argv:
    try:
        code = subprocess.call(["node", "scripts/native-smoke.mjs"])
    finally:
        wm.terminate()
    sys.exit(code)

window = Gtk.Window(title="Desk input focus sentinel")
entry = Gtk.Entry()
window.add(entry)
window.show_all()
window.present()
entry.grab_focus()


def pump():
    for _ in range(20):
        while Gtk.events_pending():
            Gtk.main_iteration_do(False)
        time.sleep(0.02)


def property_value(target, name):
    return subprocess.check_output(["xprop", "-root" if target is None else "-id", *([] if target is None else [target]), name], text=True).strip()


def active():
    return property_value(None, "_NET_ACTIVE_WINDOW").split("#")[-1].strip()


def terminal_windows():
    ids = property_value(None, "_NET_CLIENT_LIST").split("#")[-1].split(",")
    return [wid.strip() for wid in ids if "codex-desk-conversations" in property_value(wid.strip(), "WM_WINDOW_ROLE")]


def type_text(text):
    x11 = ctypes.CDLL("libX11.so.6")
    xtst = ctypes.CDLL("libXtst.so.6")
    x11.XOpenDisplay.restype = ctypes.c_void_p
    x11.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
    x11.XKeysymToKeycode.restype = ctypes.c_ubyte
    x11.XFlush.argtypes = [ctypes.c_void_p]
    x11.XCloseDisplay.argtypes = [ctypes.c_void_p]
    xtst.XTestFakeKeyEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
    display = x11.XOpenDisplay(None)
    for character in text:
        key = x11.XKeysymToKeycode(display, 0xff0d if character == "\n" else ord(character))
        xtst.XTestFakeKeyEvent(display, key, 1, 0)
        xtst.XTestFakeKeyEvent(display, key, 0, 0)
    x11.XFlush(display)
    x11.XCloseDisplay(display)
    pump()


def activate_window(wid):
    # The same EWMH activation request a taskbar/window switcher sends.
    class Data(ctypes.Union):
        _fields_ = [("l", ctypes.c_long * 5)]
    class Message(ctypes.Structure):
        _fields_ = [("type", ctypes.c_int), ("serial", ctypes.c_ulong), ("send_event", ctypes.c_int),
                    ("display", ctypes.c_void_p), ("window", ctypes.c_ulong), ("message_type", ctypes.c_ulong),
                    ("format", ctypes.c_int), ("data", Data)]
    class Event(ctypes.Union):
        _fields_ = [("client", Message), ("pad", ctypes.c_long * 24)]
    x11 = ctypes.CDLL("libX11.so.6")
    x11.XOpenDisplay.restype = ctypes.c_void_p
    x11.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
    x11.XDefaultRootWindow.restype = ctypes.c_ulong
    x11.XInternAtom.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int]
    x11.XInternAtom.restype = ctypes.c_ulong
    x11.XSendEvent.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int, ctypes.c_long, ctypes.POINTER(Event)]
    x11.XFlush.argtypes = [ctypes.c_void_p]
    x11.XCloseDisplay.argtypes = [ctypes.c_void_p]
    display = x11.XOpenDisplay(None)
    event = Event()
    event.client.type, event.client.format = 33, 32
    event.client.window = int(wid, 16)
    event.client.message_type = x11.XInternAtom(display, b"_NET_ACTIVE_WINDOW", 0)
    event.client.data.l[0] = 2
    x11.XSendEvent(display, x11.XDefaultRootWindow(display), 0, (1 << 19) | (1 << 20), ctypes.byref(event))
    x11.XFlush(display)
    x11.XCloseDisplay(display)
    pump()


def prepare(thread):
    child_code = "import sys; from pathlib import Path; print('TERMINAL READY', flush=True);\nfor line in sys.stdin: Path(sys.argv[1]).write_text(line)"
    request = {"directory": str(root / "terminals"), "codexHome": str(root), "threadId": thread,
               "title": "Codex Desk · " + thread, "cwd": str(root), "binary": "/usr/bin/python3",
               "args": ["-u", "-c", child_code, str(root / (thread + ".txt"))], "env": dict(os.environ),
               "focusLibrary": str(Path("dist-electron/background-window.so").resolve())}
    result = subprocess.run(["/usr/bin/python3", "electron/background-terminal.py"], input=json.dumps(request), text=True, capture_output=True, timeout=20)
    assert result.returncode == 0, result.stderr
    pump()
    return json.loads(result.stdout)


def marker(thread):
    key = hashlib.sha256((str(root) + "\0" + thread).encode()).hexdigest()
    return json.loads((root / "terminals" / ("terminal-" + key + ".json")).read_text())


try:
    pump()
    sentinel = active()
    assert sentinel not in ("0x0", ""), "The sentinel must be focused."
    first = prepare("first")
    assert not first["reused"]
    assert active() == sentinel, "The first terminal stole focus."
    windows = terminal_windows()
    assert len(windows) == 1
    assert "_NET_WM_STATE_HIDDEN" in property_value(windows[0], "_NET_WM_STATE")
    pid = marker("first")["pid"]
    assert Path(f"/proc/{pid}").exists(), "Terminal must outlive the request helper."
    again = prepare("first")
    assert again == {"reused": True, "screen": first["screen"]}
    assert marker("first")["pid"] == pid
    prepare("second")
    assert len(terminal_windows()) == 1
    assert active() == sentinel, "A new tab stole focus."
    type_text("abc")
    assert entry.get_text() == "abc", f"Typing must stay in Desk: text={entry.get_text()!r}, focused={entry.has_focus()}, active={active()}"
    # Explicit user activation can restore the window. The GTK helper only
    # suppresses the first automatic presentation, never subsequent activation.
    activate_window(windows[0])
    assert "_NET_WM_STATE_HIDDEN" not in property_value(windows[0], "_NET_WM_STATE")
    assert active() == windows[0]
    type_text("first\n")
    assert (root / "first.txt").read_text().strip() == "first", "Adding the second tab changed the selected tab."
    prepare("third")
    type_text("stillfirst\n")
    assert (root / "first.txt").read_text().strip() == "stillfirst"
    window.present()
    pump()
    os.kill(pid, signal.SIGTERM)
    pump()
    replacement = prepare("first")
    assert not replacement["reused"]
    assert marker("first")["pid"] != pid
    assert active() == sentinel, "Reopening a closed terminal stole focus."
    print(json.dumps({"passed": True, "checks": ["first window iconified without focus", "same tab and PID reused across helper restarts", "background tabs preserve current selection", "explicit activation and real PTY typing", "closed CLI recreated without focus"]}))
finally:
    wm.terminate()
