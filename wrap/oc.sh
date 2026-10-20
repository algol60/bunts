#!/usr/bin/env bash

# Bubblewrap wrapper around OpenCode.
#
# bwrap uses --seccomp to install a Berkeley Packet Filter program that
# denies access to the keyctl syscall. See make_bpf.py to make the BPF program.
#

# Add Python seccomp bindings: dnf install libseccomp-python
# Description
# : The libseccomp library provides an easy to use interface to the Linux Kernel's
# : syscall filtering mechanism, seccomp.  The libseccomp API allows an application
# : to specify which syscalls, and optionally which syscall arguments, the
# : application is allowed to execute, all of which are enforced by the Linux
# : Kernel.
#
# See also https://github.com/seccomp/libseccomp/

# The read-write user directories we want to see in the sandbox.
# Note: this will require adjustment, depending on whether opencode
# is installed in ~/.local/bin or ~/.bun/bin. Dependencies are in ../install.
#
dirs=( \
    $HOME/tmp \
    $HOME/Projects \
    $HOME/.cache/opencode \
    $HOME/.config/opencode \
    $HOME/.local/state/opencode \
    $HOME/.local/share/opencode \
    $HOME/.local/bin \
    $HOME/.bun \
)
echo "DIRS ${dirs[@]}"

wrap_dirs=''
for dir in "${dirs[@]}"; do
    wrap_dirs="$wrap_dirs --bind $dir $dir"

    if [ ! -d "$dir" ]; then
        echo "mkdir $dir"
        mkdir -p "$dir"
    fi
done

# Use this to experiment with the sandboxed process.
#
#EXE=bash

# Use this to start opencode.
# Further investigation required to block more stuff; for example, localhost only.
#
# Apropos of nothing, opencode calls https://models.opencode.ai/api.json (OPENCODE_MODELS_URL)
# and returns a dictionary of models.
#
EXE='opencode --standalone'

exec                            \
  bwrap                         \
    --proc /proc                \
    --dev /dev                  \
    --tmpfs /tmp                \
    --unshare-pid               \
    --die-with-parent           \
    --setenv TMPDIR $HOME/tmp   \
    --ro-bind /usr /usr         \
    --symlink usr/lib64 /lib64  \
    --ro-bind /etc/ssl /etc/ssl \
    $wrap_dirs                  \
    --chdir $HOME/Projects      \
    --seccomp 11                \
    $EXE                        \
    11< <(cat keyctl.bpf)
