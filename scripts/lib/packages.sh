# Package discovery for scripts/check.sh (sourced; testable on its own via scripts/test/check.test.sh).
# Folders that hold Merc packages. spikes/ are throwaway and not gated.
MERC_PKG_ROOTS=(packages shared app infra functions agents procedures evals tests)
# Packages that must be visible in every `make check` summary, even before they exist,
# so a missing one is noticed instead of silently not tested.
MERC_EXPECTED_PKGS=(shared/core shared/llm shared/handlers packages/contracts)

# list_pkgs <root>: package dirs (relative to root), sorted, without node_modules/.cache/dist copies.
list_pkgs() {
  ( cd "$1" && find "${MERC_PKG_ROOTS[@]}" -name package.json \
      -not -path '*/node_modules/*' -not -path '*/.cache/*' -not -path '*/dist/*' 2>/dev/null \
    | xargs -n1 dirname 2>/dev/null | sort -u )
}

# pkg_test_kind <dir>: "test" | "no-script" | "no-tests".
#   no-script: package.json has no real "test" script.
#   no-tests:  it has one but no *.test.* / *.spec.* file exists yet (vitest would exit 1).
pkg_test_kind() {
  local dir="$1" has
  has="$(python3 -I -c 'import json,sys
t=json.load(open(sys.argv[1])).get("scripts",{}).get("test","")
print("1" if t and "no test specified" not in t else "")' "$dir/package.json" 2>/dev/null)"
  [ -n "$has" ] || { echo no-script; return; }
  if [ -z "$(find "$dir" \( -name node_modules -o -name dist -o -name .cache -o -name .git \) -prune -o \
        -type f \( -name '*.test.*' -o -name '*.spec.*' \) -print 2>/dev/null | head -1)" ]; then
    echo no-tests; return
  fi
  echo test
}

# no_tests_output <file>: true if a test run's output says the runner found no test files.
no_tests_output() { grep -Eqi 'No test files found|no tests? (were )?found' "$1"; }
