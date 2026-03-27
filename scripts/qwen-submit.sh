#!/bin/bash

# ============================================================================
# Qwen Auto-Submit for RepoSentinel PRs
# ============================================================================
# This script uses Qwen to help you submit PRs automatically
# 
# Quick Start:
#   ./qwen-submit.sh              # Interactive mode
#   ./qwen-submit.sh --pr1        # Submit PR #1 immediately
#   ./qwen-submit.sh --status     # Check PR status
#   ./qwen-submit.sh --remind     # Set up reminders
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_SCRIPT="$SCRIPT_DIR/reposentinel-cli.sh"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

print_banner() {
    echo -e "${BLUE}"
    echo "╔═══════════════════════════════════════════════════════════╗"
    echo "║     RepoSentinel - Qwen Auto-Submit for GitHub PRs       ║"
    echo "╚═══════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

# Make CLI script executable
chmod +x "$CLI_SCRIPT" 2>/dev/null

print_banner

case "${1:-interactive}" in
    --pr1|-1)
        echo -e "${YELLOW}🚀 Submitting PR #1: Mixed Precision Training${NC}"
        echo ""
        $CLI_SCRIPT submit-pr1
        ;;
    
    --pr2|-2)
        echo -e "${YELLOW}🚀 Submitting PR #2: LR Scheduling${NC}"
        echo ""
        $CLI_SCRIPT submit-pr2
        ;;
    
    --pr3|-3)
        echo -e "${YELLOW}🚀 Submitting PR #3: Experiment Logging${NC}"
        echo ""
        $CLI_SCRIPT submit-pr3
        ;;
    
    --all|-a)
        echo -e "${YELLOW}🚀 Submitting All PRs${NC}"
        echo ""
        $CLI_SCRIPT submit-all
        ;;
    
    --status|-s)
        echo -e "${YELLOW}📊 Checking PR Status${NC}"
        echo ""
        $CLI_SCRIPT check-status
        ;;
    
    --remind|-r)
        echo -e "${YELLOW}⏰ Setting Up Reminders${NC}"
        echo ""
        $CLI_SCRIPT remind
        ;;
    
    --help|-h)
        echo "Usage: ./qwen-submit.sh [option]"
        echo ""
        echo "Options:"
        echo "  --pr1, -1      Submit PR #1 (Mixed Precision) - READY NOW"
        echo "  --pr2, -2      Submit PR #2 (LR Scheduling)"
        echo "  --pr3, -3      Submit PR #3 (Experiment Logging)"
        echo "  --all, -a      Submit all PRs"
        echo "  --status, -s   Check PR status"
        echo "  --remind, -r   Set up reminders"
        echo "  --help, -h     Show this help"
        echo "  (no args)      Interactive mode"
        ;;
    
    interactive|*)
        echo -e "${GREEN}Welcome! I'm Qwen, your AI assistant for submitting PRs.${NC}"
        echo ""
        echo "What would you like to do?"
        echo ""
        echo "  1) Submit PR #1 (Mixed Precision) - ✅ Ready Now"
        echo "  2) Submit PR #2 (LR Scheduling)"
        echo "  3) Submit PR #3 (Experiment Logging)"
        echo "  4) Submit ALL PRs at once"
        echo "  5) Check PR status"
        echo "  6) Set up reminders"
        echo "  7) Exit"
        echo ""
        echo -n "Enter your choice [1-7]: "
        read -r choice
        
        case $choice in
            1)
                $CLI_SCRIPT submit-pr1
                ;;
            2)
                $CLI_SCRIPT submit-pr2
                ;;
            3)
                $CLI_SCRIPT submit-pr3
                ;;
            4)
                $CLI_SCRIPT submit-all
                ;;
            5)
                $CLI_SCRIPT check-status
                ;;
            6)
                $CLI_SCRIPT remind
                ;;
            7)
                echo -e "${GREEN}Goodbye! Run ./qwen-submit.sh anytime to submit PRs.${NC}"
                exit 0
                ;;
            *)
                echo -e "${RED}Invalid choice. Please run the script again.${NC}"
                exit 1
                ;;
        esac
        ;;
esac

echo ""
echo -e "${GREEN}✨ Done! Run this script anytime to manage your PRs.${NC}"
echo -e "${BLUE}📚 Documentation: https://github.com/AmithKumar1/reposentinel${NC}"
