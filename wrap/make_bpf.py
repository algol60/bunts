#!/usr/bin/env python3
"""Build the seccomp BPF program used by oc.sh.

bwrap installs the exported program with --seccomp.  It allows everything by
default and returns EPERM for a handful of sandbox-escape and persistence
syscalls.  The program is architecture specific, so regenerate it on the
machine that will run the sandbox.

Add the Python seccomp bindings (Fedora/RHEL):
    sudo dnf install libseccomp-python
Description
: The libseccomp library provides an easy to use interface to the Linux Kernel's
: syscall filtering mechanism, seccomp.  The libseccomp API allows an application
: to specify which syscalls, and optionally which syscall arguments, the
: application is allowed to execute, all of which are enforced by the Linux
: Kernel.

See also https://github.com/seccomp/libseccomp/tree/main/src/python
"""

import argparse
import errno
import shutil
import subprocess
import sys
from pathlib import Path

import seccomp

HERE = Path(__file__).resolve().parent
DEFAULT_BPF = HERE / 'keyctl.bpf'

# Denied with EPERM.  These are the usual sandbox-escape and persistence
# vectors; a normal opencode session has no reason to use any of them.
DENIED_SYSCALLS = (
    'keyctl',
    'process_vm_readv',
    'process_vm_writev',
    'ptrace',
    'mount',
    'bpf',
    'userfaultfd',
    'perf_event_open',
)


def build_filter():
    """Return a filter allowing everything except DENIED_SYSCALLS."""
    filt = seccomp.SyscallFilter(defaction=seccomp.ALLOW)
    applied = []
    for name in DENIED_SYSCALLS:
        try:
            filt.add_rule(seccomp.ERRNO(errno.EPERM), name)
        except (RuntimeError, ValueError) as exc:
            # The call may not exist on this architecture.
            print(f'warning: not filtering {name}: {exc}', file=sys.stderr)
        else:
            applied.append(name)
    return filt, applied


def run(cmd):
    """Run cmd, returning its exit status (None if it is not installed)."""
    if shutil.which(cmd[0]) is None:
        print(f'skipped: {cmd[0]} is not installed')
        return None
    print(f"$ {' '.join(cmd)}")
    return subprocess.run(cmd).returncode


def main():
    # Keep our messages in order with the output of the self-test commands.
    sys.stdout.reconfigure(line_buffering=True)

    parser = argparse.ArgumentParser(
        description='Build the seccomp BPF program used by oc.sh.')
    parser.add_argument(
        '-o', '--output', type=Path, default=DEFAULT_BPF,
        help=f'output file (default: {DEFAULT_BPF})')
    parser.add_argument(
        '--no-selftest', action='store_true',
        help='write the filter without loading it into this process')
    args = parser.parse_args()

    filt, applied = build_filter()

    with args.output.open('wb') as f:
        filt.export_bpf(f)
    print(f'BPF filter written to {args.output} '
          f'({len(applied)} syscalls denied)')

    if args.no_selftest:
        return 0

    # Self-test: keyctl works before the filter is loaded...
    run(['keyctl', 'show'])

    # ...and fails afterwards.  Filters are inherited by child processes, and
    # loading cannot be undone, so this must be the last thing we do.
    filt.load()
    print('\nSeccomp filter is active. Testing restricted syscalls...')

    # ls should still work.
    run(['ls', '-l'])

    if run(['keyctl', 'show']) == 0:
        print('error: keyctl still works after loading the filter',
              file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
