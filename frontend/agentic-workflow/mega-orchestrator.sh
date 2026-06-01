#!/bin/bash

# Mega Workflow Orchestrator
# Monitors agent progress and triggers next phases automatically

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "════════════════════════════════════════"
echo "  🚀 MEGA WORKFLOW ORCHESTRATOR"
echo "════════════════════════════════════════"
echo ""

# Track current phase
CURRENT_PHASE="test"
TEST_LOOP_COUNT=0
CODE_LOOP_COUNT=0
UX_LOOP_COUNT=0
MAX_LOOPS=5  # Prevent infinite loops

# Helper: Count open issues by type
count_open_issues() {
    local pattern=$1
    grep -l "status: open" agentic-workflow/.issues/${pattern}-*.md 2>/dev/null | wc -l | tr -d ' '
}

# Helper: Wait for signal file to be consumed
wait_for_signal_consumed() {
    local signal=$1
    local timeout=300  # 5 minutes max
    local elapsed=0

    while [ -f "$signal" ] && [ $elapsed -lt $timeout ]; do
        sleep 2
        elapsed=$((elapsed + 2))
    done

    if [ $elapsed -ge $timeout ]; then
        echo "⚠️  Timeout waiting for $signal to be consumed"
        return 1
    fi
    return 0
}

# Helper: Wait for agent to complete (signal file consumed + small delay)
wait_for_agent() {
    local agent_name=$1
    local signal=$2

    echo "   Waiting for $agent_name to complete..."
    wait_for_signal_consumed "$signal" || return 1
    sleep 5  # Give agent time to write files
    echo "   ✓ $agent_name complete"
    return 0
}

# Phase 1: Test Loop
echo "╔═══════════════════════════════════════╗"
echo "║  PHASE 1: TEST LOOP                   ║"
echo "╚═══════════════════════════════════════╝"
echo ""

while [ $TEST_LOOP_COUNT -lt $MAX_LOOPS ]; do
    TEST_LOOP_COUNT=$((TEST_LOOP_COUNT + 1))
    echo "→ Test Loop Iteration #$TEST_LOOP_COUNT"

    # Trigger test writer (if first iteration, already triggered)
    if [ $TEST_LOOP_COUNT -gt 1 ]; then
        echo "   Triggering Test Writer..."
        touch agentic-workflow/.write-tests
    fi

    # Wait for test writer → runner → auto-fixer chain
    wait_for_agent "Test Writer" "agentic-workflow/.write-tests" || break
    wait_for_agent "Test Runner" "agentic-workflow/.run-tests" || break

    # Check if there are test issues
    OPEN_TEST_ISSUES=$(count_open_issues "ISSUE")

    if [ "$OPEN_TEST_ISSUES" -eq 0 ]; then
        echo ""
        echo "✅ Phase 1 Complete: All tests passing!"
        echo ""
        break
    fi

    echo "   Found $OPEN_TEST_ISSUES open test issues, triggering auto-fixer..."
    touch agentic-workflow/.auto-fix
    wait_for_agent "Auto Fixer" "agentic-workflow/.auto-fix" || break

    # Re-run tests to verify fixes
    echo "   Re-running tests to verify fixes..."
    touch agentic-workflow/.run-tests
    wait_for_agent "Test Runner" "agentic-workflow/.run-tests" || break
done

if [ $TEST_LOOP_COUNT -ge $MAX_LOOPS ]; then
    echo "⚠️  Phase 1: Max iterations reached. Manual intervention needed."
    exit 1
fi

sleep 3

# Phase 2: Code Review Loop
echo "╔═══════════════════════════════════════╗"
echo "║  PHASE 2: CODE REVIEW LOOP            ║"
echo "╚═══════════════════════════════════════╝"
echo ""

while [ $CODE_LOOP_COUNT -lt $MAX_LOOPS ]; do
    CODE_LOOP_COUNT=$((CODE_LOOP_COUNT + 1))
    echo "→ Code Review Loop Iteration #$CODE_LOOP_COUNT"

    # Trigger code reviewer
    echo "   Triggering Code Reviewer..."
    touch agentic-workflow/.review-code
    wait_for_agent "Code Reviewer" "agentic-workflow/.review-code" || break

    # Check if there are code issues
    OPEN_CODE_ISSUES=$(count_open_issues "CODE")

    if [ "$OPEN_CODE_ISSUES" -eq 0 ]; then
        echo ""
        echo "✅ Phase 2 Complete: Code is clean!"
        echo ""
        break
    fi

    echo "   Found $OPEN_CODE_ISSUES open code issues, triggering auto-fixer..."
    touch agentic-workflow/.auto-fix
    wait_for_agent "Auto Fixer" "agentic-workflow/.auto-fix" || break

    # Give time for fixes to be applied
    sleep 3
done

if [ $CODE_LOOP_COUNT -ge $MAX_LOOPS ]; then
    echo "⚠️  Phase 2: Max iterations reached. Manual intervention needed."
    exit 1
fi

sleep 3

# Phase 3: UX Loop
echo "╔═══════════════════════════════════════╗"
echo "║  PHASE 3: UX REVIEW LOOP              ║"
echo "╚═══════════════════════════════════════╝"
echo ""

while [ $UX_LOOP_COUNT -lt $MAX_LOOPS ]; do
    UX_LOOP_COUNT=$((UX_LOOP_COUNT + 1))
    echo "→ UX Review Loop Iteration #$UX_LOOP_COUNT"

    # Trigger UX reviewer
    echo "   Triggering UX Reviewer..."
    touch agentic-workflow/.review-ux
    wait_for_agent "UX Reviewer" "agentic-workflow/.review-ux" || break

    # Check if there are UX issues
    OPEN_UX_ISSUES=$(count_open_issues "UX")

    if [ "$OPEN_UX_ISSUES" -eq 0 ]; then
        echo ""
        echo "✅ Phase 3 Complete: UX is perfect!"
        echo ""
        break
    fi

    echo "   Found $OPEN_UX_ISSUES open UX issues, triggering auto-fixer..."
    touch agentic-workflow/.auto-fix
    wait_for_agent "Auto Fixer" "agentic-workflow/.auto-fix" || break

    # Give time for fixes to be applied
    sleep 3
done

if [ $UX_LOOP_COUNT -ge $MAX_LOOPS ]; then
    echo "⚠️  Phase 3: Max iterations reached. Manual intervention needed."
    exit 1
fi

# Final Summary
echo ""
echo "════════════════════════════════════════"
echo "  🎉 MEGA WORKFLOW COMPLETE 🎉"
echo "════════════════════════════════════════"
echo ""
echo "Phase 1: ✅ All tests passing ($TEST_LOOP_COUNT iteration(s))"
echo "Phase 2: ✅ Code review clean ($CODE_LOOP_COUNT iteration(s))"
echo "Phase 3: ✅ UX review perfect ($UX_LOOP_COUNT iteration(s))"
echo ""
echo "Your project is production-ready!"
echo ""
