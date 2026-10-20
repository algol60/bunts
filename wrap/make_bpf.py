#!/usr/bin/env python

# Build a Berkeley Packet Filter program that disallows keyctl syscalls.
#

# Add system Python seccomp bindings using Fedora/RHEL: sudo -i dnf install libseccomp-python
# Description
# : The libseccomp library provides an easy to use interface to the Linux Kernel's
# : syscall filtering mechanism, seccomp.  The libseccomp API allows an application
# : to specify which syscalls, and optionally which syscall arguments, the
# : application is allowed to execute, all of which are enforced by the Linux
# : Kernel.
#
# See also https://github.com/seccomp/libseccomp/tree/main/src/python

import seccomp

# Initialize the filter with a default action (e.g., allow everything by default)
# Or use seccomp.KILL to block everything unless explicitly allowed.
#
filter = seccomp.SyscallFilter(defaction=seccomp.ALLOW)

# Add a rule to block a specific system call (e.g., executing binaries via execve)
# This will kill the process immediately if keyctl is called.
#
# filter.add_rule(seccomp.KILL, 'keyctl')

# Disallow keyctl; return errno 1 EPERM "Operation not permitted"
#
filter.add_rule(seccomp.ERRNO(1), 'keyctl')

# Save the BPF program to a file.
#
BPF = 'keyctl.bpf'
with open(BPF, 'wb') as f:
    filter.export_bpf(f)

print(f'BPF filter created at {BPF}')

# We're done, but just to check...
#

import subprocess
print('\nExpect keyctl success')
result = subprocess.run(['keyctl', 'show'])
print(result)

# Load the filter into the Linux kernel.
#
filter.load()

print('\nSeccomp filter is active. Testing restricted syscall...')

# ls should still work.
#
print('\nExpect ls success')
result = subprocess.run(['ls', '-l'])
print(result)

print('\nExpect keyctl failure')
result = subprocess.run(['keyctl', 'show'])
print(result)
