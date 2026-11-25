# Sourced by every script the packaging path runs. A gate step, a launchd job or any other
# non-login shell has no Homebrew in its PATH, so `python3` is the 3.9 system stub and `pkg-config`
# is missing. Homebrew first, then its newest python@3 ahead of the stub (row 20261122-318).
for _p in /opt/homebrew/bin /usr/local/bin; do
  if [ -d "$_p" ] && [[ ":$PATH:" != *":$_p:"* ]]; then export PATH="$_p:$PATH"; fi
done
_hb_py=$(ls -d /opt/homebrew/opt/python@3*/libexec/bin 2>/dev/null | sort -V | tail -1 || true)
if [ -n "$_hb_py" ] && [[ ":$PATH:" != *":$_hb_py:"* ]]; then export PATH="$_hb_py:$PATH"; fi
# Node and npm on this Mac live in the owner's own bin, which a non-login shell does not have either.
if [ -d "$HOME/.local/bin" ] && [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
  export PATH="$PATH:$HOME/.local/bin"
fi
unset _p _hb_py
