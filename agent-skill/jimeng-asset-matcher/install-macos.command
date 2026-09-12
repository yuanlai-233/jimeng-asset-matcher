#!/bin/sh
task_skill_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1
if command -v python3 >/dev/null 2>&1; then
  python3 "$task_skill_dir/scripts/install.py" --open "$@"
  task_install_status=$?
else
  echo 'Python 3.9+ is required. See README.md, or load assets/extension manually.'
  task_install_status=1
fi
if [ -t 0 ]; then
  printf '\nPress Enter to close...'
  read -r task_install_reply
fi
exit "$task_install_status"
