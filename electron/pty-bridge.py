"""A local PTY for the installed Codex TUI; JSON framing stays on private pipes."""
import codecs
import fcntl
import json
import os
import pty
import select
import signal
import struct
import sys
import termios
import time


def emit(value):
    sys.stdout.write(json.dumps(value) + "\n")
    sys.stdout.flush()


def resize(fd, cols, rows):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


cols, rows = int(sys.argv[1]), int(sys.argv[2])
pid, master = pty.fork()
if pid == 0:
    resize(0, cols, rows)
    os.execvpe(sys.argv[3], sys.argv[3:], os.environ)


def terminate(_signum, _frame):
    raise SystemExit(0)


signal.signal(signal.SIGTERM, terminate)
signal.signal(signal.SIGHUP, terminate)
decoder = codecs.getincrementaldecoder("utf-8")("replace")
pending = b""
try:
    while True:
        readable, _, _ = select.select([0, master], [], [])
        if master in readable:
            try:
                data = os.read(master, 32768)
            except OSError:
                break
            if not data:
                break
            emit({"data": decoder.decode(data)})
        if 0 in readable:
            incoming = os.read(0, 65536)
            if not incoming:
                break
            pending += incoming
            while b"\n" in pending:
                line, pending = pending.split(b"\n", 1)
                message = json.loads(line)
                if message["type"] == "write":
                    data = message["data"].encode("utf-8")
                    while data:
                        count = os.write(master, data)
                        data = data[count:]
                elif message["type"] == "resize":
                    resize(master, message["cols"], message["rows"])
finally:
    os.close(master)
    try:
        os.killpg(pid, signal.SIGHUP)
    except ProcessLookupError:
        pass
    status = 0
    for _ in range(40):
        ended, status = os.waitpid(pid, os.WNOHANG)
        if ended:
            break
        time.sleep(0.05)
    else:
        os.killpg(pid, signal.SIGKILL)
        _, status = os.waitpid(pid, 0)
    emit({"exitCode": os.waitstatus_to_exitcode(status)})
