#!/usr/bin/env bats
# Every git-tracked shell script must pass shellcheck and parse with bash -n.
# Generated, gitignored files (e.g. .husky/_/husky.sh) are not tracked, so
# they are not part of the release and are skipped by construction.

setup() {
    cd "${BATS_TEST_DIRNAME}/.." || exit 1
    mapfile -t SCRIPTS < <(git ls-files '*.sh')
}

@test "there are tracked shell scripts to check" {
    [ "${#SCRIPTS[@]}" -gt 0 ]
}

@test "every tracked shell script passes shellcheck" {
    run shellcheck "${SCRIPTS[@]}"
    [ "$status" -eq 0 ] || { echo "$output"; false; }
}

@test "every tracked shell script parses with bash -n" {
    for f in "${SCRIPTS[@]}"; do
        run bash -n "$f"
        [ "$status" -eq 0 ] || { echo "$f: $output"; false; }
    done
}
