#!/usr/bin/env bash
#
# check-secrets.sh - Pre-commit secrets scanner for Modia
#
# Scans staged files for potential secrets like API keys, passwords, and private keys.
# Designed to be fast and run on every commit via husky pre-commit hook.
#
# Exit code 0 = no secrets found, 1 = secrets detected (commit blocked)
#

# Colors and symbols (consistent with doctor.sh)
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color
CHECK="${GREEN}✓${NC}"
BLOCKED="${RED}BLOCKED${NC}"

# Track findings
FOUND_SECRETS=0

echo "Checking staged files for secrets..."
echo ""

# Check if there are any staged files (only existing files, not deleted)
if ! git diff --cached --name-only --diff-filter=d -z 2>/dev/null | grep -qz .; then
    echo -e "${CHECK} No staged files to check"
    exit 0
fi

# Function to check a file for secrets
check_file() {
    local file="$1"
    local findings=0

    # Skip .env.example files (they contain placeholder values)
    if [[ "$file" == *".env.example"* ]]; then
        return 0
    fi

    # Skip seed files (they contain intentional test credentials)
    if [[ "$file" == *"seed.js"* ]] || [[ "$file" == *"seed.ts"* ]]; then
        return 0
    fi

    # Skip binary files
    if file "$file" 2>/dev/null | grep -q "binary"; then
        return 0
    fi

    # Skip if file doesn't exist (shouldn't happen with --diff-filter=d but be safe)
    if [ ! -f "$file" ]; then
        return 0
    fi

    # Pattern 1: AWS Access Keys (AKIA followed by 16 alphanumeric chars)
    while IFS=: read -r line_num content; do
        if [ -n "$line_num" ]; then
            echo -e "${BLOCKED}: Possible AWS key found in ${file}:${line_num}"
            echo "  Content: ${content}"
            findings=1
        fi
    done < <(grep -nE 'AKIA[0-9A-Z]{16}' "$file" 2>/dev/null)

    # Pattern 2: Generic API keys (api_key = "value" or api-key: value)
    while IFS=: read -r line_num content; do
        if [ -n "$line_num" ]; then
            # Skip lines that are clearly comments or examples
            if echo "$content" | grep -qE '^\s*(#|//|\*|<!--)'; then
                continue
            fi
            # Skip placeholder values
            if echo "$content" | grep -qiE '(your[_-]?api[_-]?key|example|placeholder|xxx|replace[_-]?me|changeme|todo)'; then
                continue
            fi
            echo -e "${BLOCKED}: Possible API key found in ${file}:${line_num}"
            echo "  Content: ${content}"
            findings=1
        fi
    done < <(grep -nEi 'api[_-]?key\s*[=:]\s*['\''"]?[a-zA-Z0-9]{20,}' "$file" 2>/dev/null)

    # Pattern 3: JWT secrets
    while IFS=: read -r line_num content; do
        if [ -n "$line_num" ]; then
            # Skip lines that are clearly comments
            if echo "$content" | grep -qE '^\s*(#|//|\*|<!--)'; then
                continue
            fi
            # Skip placeholder values
            if echo "$content" | grep -qiE '(your[_-]?secret|example|placeholder|xxx|replace[_-]?me|changeme|todo)'; then
                continue
            fi
            # Skip environment reads that carry no string literal on the line
            # (a literal fallback on the same line is still blocked)
            if echo "$content" | grep -qiE 'jwt[_-]?secret\s*[=:]\s*process\.env\.' \
                && ! echo "$content" | grep -qE "['\"\`]"; then
                continue
            fi
            echo -e "${BLOCKED}: Possible JWT secret found in ${file}:${line_num}"
            echo "  Content: ${content}"
            findings=1
        fi
    done < <(grep -nEi 'jwt[_-]?secret\s*[=:]\s*['\''"]?[^\s'\''\"]+' "$file" 2>/dev/null)

    # Pattern 4: Private keys
    while IFS=: read -r line_num content; do
        if [ -n "$line_num" ]; then
            echo -e "${BLOCKED}: Possible private key found in ${file}:${line_num}"
            echo "  Content: ${content}"
            findings=1
        fi
    done < <(grep -nE '\-\-\-\-\-BEGIN .* PRIVATE KEY\-\-\-\-\-' "$file" 2>/dev/null)

    # Pattern 5: Hardcoded passwords (password = "value")
    while IFS=: read -r line_num content; do
        if [ -n "$line_num" ]; then
            # Skip lines that are clearly comments
            if echo "$content" | grep -qE '^\s*(#|//|\*|<!--)'; then
                continue
            fi
            # Skip placeholder values and environment variable reads
            if echo "$content" | grep -qiE '(your[_-]?password|password[_-]?here|example|placeholder|xxx|replace[_-]?me|changeme|todo|\$\{|\$\(|process\.env\.)'; then
                continue
            fi
            # Skip empty or null values
            if echo "$content" | grep -qEi 'password\s*[=:]\s*['\''"]?\s*['\''"]?\s*$'; then
                continue
            fi
            # Skip test files with obvious fake values
            if [[ "$file" == *"test"* ]] || [[ "$file" == *"spec"* ]]; then
                if echo "$content" | grep -qiE '(test|fake|mock|dummy|sample)'; then
                    continue
                fi
            fi
            # Skip DOM element references (getElementById, querySelector, etc.)
            if echo "$content" | grep -qE '(getElementById|querySelector|\.value|fieldsTouched|touched|\.password)'; then
                continue
            fi
            # Skip boolean/null state assignments (password: false, password: true, password: null)
            if echo "$content" | grep -qEi 'password\s*:\s*(false|true|null)'; then
                continue
            fi
            echo -e "${BLOCKED}: Possible hardcoded password found in ${file}:${line_num}"
            echo "  Content: ${content}"
            findings=1
        fi
    done < <(grep -nEi 'password\s*[=:]\s*['\''"]?[^\s'\''\"]+' "$file" 2>/dev/null)

    return $findings
}

# Check each staged file
while IFS= read -r -d '' file; do
    # Skip .env.example files
    if [[ "$file" == *".env.example"* ]]; then
        continue
    fi

    # Skip CI workflow files (they use public dev defaults from .env.example)
    if [[ "$file" == ".github/workflows/"* ]]; then
        continue
    fi

    # Skip E2E and load test files (they contain test fixture passwords)
    if [[ "$file" == "e2e/"* ]] || [[ "$file" == "load-tests/"* ]]; then
        continue
    fi

    # Skip binary files
    if file "$file" 2>/dev/null | grep -q 'binary\|executable\|image\|archive'; then
        continue
    fi

    check_file "$file"
    if [ $? -eq 1 ]; then
        FOUND_SECRETS=1
    fi
done < <(git diff --cached --name-only --diff-filter=d -z 2>/dev/null)

# Summary
echo ""
if [ $FOUND_SECRETS -eq 1 ]; then
    echo -e "${RED}Commit blocked. Remove secrets before committing.${NC}"
    exit 1
else
    echo -e "${CHECK} No secrets detected"
    exit 0
fi
