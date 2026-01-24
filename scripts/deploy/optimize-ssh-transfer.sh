#!/bin/bash
#
# SSH Transfer Optimization Script
#
# Configures both local and server-side settings for faster file transfers.
# Run once to set up optimal SSH config for deployments.
#
# Usage: ./optimize-ssh-transfer.sh
#

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SERVER_HOST="mittonvillage.com"
SERVER_USER="root"

log() { echo -e "${GREEN}[SETUP]${NC} $1"; }
info() { echo -e "${BLUE}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

echo ""
echo "=========================================="
echo "  SSH Transfer Optimization"
echo "=========================================="
echo ""

# ============================================
# Step 1: Local SSH config
# ============================================
log "Configuring local SSH settings..."

SSH_CONFIG="$HOME/.ssh/config"
MODIA_CONFIG="
# Modia deployment optimization
Host mittonvillage.com modia-api.mittonvillage.com
    Compression no
    Ciphers aes128-gcm@openssh.com,aes256-gcm@openssh.com
    IPQoS throughput
    TCPKeepAlive yes
    ServerAliveInterval 60
    ServerAliveCountMax 3
"

if grep -q "# Modia deployment optimization" "$SSH_CONFIG" 2>/dev/null; then
    info "Local SSH config already optimized"
else
    echo "$MODIA_CONFIG" >> "$SSH_CONFIG"
    log "Added optimized settings to $SSH_CONFIG"
fi

# ============================================
# Step 2: Install pv if not present (for progress display)
# ============================================
if ! command -v pv >/dev/null 2>&1; then
    warn "pv (pipe viewer) not installed - progress display will be basic"
    info "Install with: sudo apt install pv  (or brew install pv on macOS)"
else
    log "pv is installed - detailed transfer progress available"
fi

# ============================================
# Step 3: Server-side optimizations
# ============================================
log "Configuring server-side TCP settings..."

ssh "${SERVER_USER}@${SERVER_HOST}" << 'REMOTE_CONFIG'
# Optimize TCP buffer sizes for better throughput
# These are temporary (reset on reboot) - add to /etc/sysctl.conf for persistence

# Check current settings
echo "Current TCP settings:"
echo "  tcp_rmem: $(cat /proc/sys/net/ipv4/tcp_rmem)"
echo "  tcp_wmem: $(cat /proc/sys/net/ipv4/tcp_wmem)"
echo "  tcp_window_scaling: $(cat /proc/sys/net/ipv4/tcp_window_scaling)"

# Optimize if not already set
CURRENT_RMEM=$(cat /proc/sys/net/ipv4/tcp_rmem | awk '{print $3}')
if [ "$CURRENT_RMEM" -lt 16777216 ]; then
    echo "Optimizing TCP buffer sizes..."

    # Increase TCP buffer sizes (min, default, max in bytes)
    # These settings allow larger TCP windows for high-bandwidth connections
    sysctl -w net.ipv4.tcp_rmem="4096 87380 16777216" 2>/dev/null || true
    sysctl -w net.ipv4.tcp_wmem="4096 65536 16777216" 2>/dev/null || true

    # Enable window scaling
    sysctl -w net.ipv4.tcp_window_scaling=1 2>/dev/null || true

    # Increase max buffer sizes
    sysctl -w net.core.rmem_max=16777216 2>/dev/null || true
    sysctl -w net.core.wmem_max=16777216 2>/dev/null || true

    echo "TCP settings optimized"
else
    echo "TCP settings already optimized"
fi

# Check for bandwidth limits in SSH config
if grep -q "MaxBandwidth" /etc/ssh/sshd_config 2>/dev/null; then
    echo "WARNING: MaxBandwidth may be set in sshd_config"
fi
REMOTE_CONFIG

log "Server-side configuration complete"

# ============================================
# Step 4: Test connection speed
# ============================================
log "Testing connection speed..."

# Create a test file
TEST_FILE=$(mktemp)
dd if=/dev/urandom of="$TEST_FILE" bs=1M count=10 2>/dev/null

echo "Uploading 10MB test file..."
START_TIME=$(date +%s.%N)
scp -c aes128-gcm@openssh.com -o Compression=no -O "$TEST_FILE" "${SERVER_USER}@${SERVER_HOST}:/tmp/speed_test" 2>/dev/null
END_TIME=$(date +%s.%N)

rm -f "$TEST_FILE"
ssh "${SERVER_USER}@${SERVER_HOST}" "rm -f /tmp/speed_test" 2>/dev/null

DURATION=$(echo "$END_TIME - $START_TIME" | bc)
SPEED=$(echo "scale=2; 10 / $DURATION" | bc)

echo ""
log "Test complete: ${SPEED} MB/s"
echo ""

if (( $(echo "$SPEED < 1" | bc -l) )); then
    warn "Transfer speed is below 1 MB/s - network may be congested"
    info "Consider: checking ISP throttling, server load, or network path"
elif (( $(echo "$SPEED < 5" | bc -l) )); then
    info "Transfer speed is moderate (${SPEED} MB/s)"
else
    log "Transfer speed is good (${SPEED} MB/s)"
fi

echo ""
echo "=========================================="
echo "  Optimization complete"
echo "=========================================="
echo ""
