#!/usr/bin/env bats
# Tests for scripts/check-secrets.sh (pre-commit secrets scanner).

SCANNER="${BATS_TEST_DIRNAME}/../scripts/check-secrets.sh"

setup() {
    REPO="$(mktemp -d)"
    cd "$REPO" || exit 1
    git init -q .
}

teardown() {
    rm -rf "$REPO"
}

stage() {
    printf '%s\n' "$2" > "$1"
    git add "$1"
}

@test "passes when nothing is staged" {
    run bash "$SCANNER"
    [ "$status" -eq 0 ]
    [[ "$output" == *"No staged files"* ]]
}

@test "blocks a hardcoded JWT secret" {
    stage config.js "const JWT_SECRET = 'hunter2-real-looking-value';"
    run bash "$SCANNER"
    [ "$status" -eq 1 ]
    [[ "$output" == *"Possible JWT secret"* ]]
}

@test "allows a JWT secret read from the environment with a deferred fallback" {
    stage config.js 'const JWT_SECRET = process.env.JWT_SECRET || (() => {'
    run bash "$SCANNER"
    [ "$status" -eq 0 ]
    [[ "$output" == *"No secrets detected"* ]]
}

@test "blocks an environment read with a literal fallback on the same line" {
    stage config.js "const JWT_SECRET = process.env.JWT_SECRET || 'hunter2-real-looking-value';"
    run bash "$SCANNER"
    [ "$status" -eq 1 ]
    [[ "$output" == *"Possible JWT secret"* ]]
}
