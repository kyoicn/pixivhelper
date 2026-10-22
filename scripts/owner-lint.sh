#!/usr/bin/env bash
# owner-lint.sh — vocabulary ratchet for the Owner Decision Protocol.
# RED findings exit non-zero (fix now); YELLOW findings print and exit 0.
set -u
cd "$(dirname "$0")/.." || exit 2
red=0
R() { echo "RED: $*"; red=1; }
Y() { echo "YELLOW: $*"; }

# 1. Owner-pending vocabulary outside owner-queue.md without an R-ID
vocab='待 OWNER|blocked on owner|awaiting owner|needs owner|owner approval|pending owner'
while IFS= read -r line; do
  R "owner-pending vocabulary without R-ID: $line"
done < <(grep -rnE "$vocab" docs --include='*.md' 2>/dev/null | grep -v 'docs/owner-queue.md' | grep -vE 'R-[0-9]+' || true)

# 2. Owner-section heading outside status.md / owner-queue.md
while IFS= read -r line; do
  R "owner-section heading outside allowed files: $line"
done < <(grep -rnE '^#+ *(Owner Action Queue|Owner Queue|待 OWNER)' docs --include='*.md' 2>/dev/null | grep -vE 'docs/(status|owner-queue)\.md' || true)

# 3. Status: blocked without an R-ID in the Blocker section
if [ -f docs/loop-state.md ] && grep -qE '^Status: *blocked' docs/loop-state.md; then
  if ! sed -n '/^## Blocker/,/^## /p' docs/loop-state.md | grep -qE 'R-[0-9]+'; then
    R "docs/loop-state.md is blocked without an R-ID in its Blocker section"
  fi
fi

# 4. Queue entries: required parts + unprocessed answers
if [ -f docs/owner-queue.md ]; then
  awk '
    /^### R-[0-9]+/ { if (id!="") check(); id=$2; opts=0; rec=0; def=0; link=0; slot=0; ans=0; inslot=0; next }
    id!="" {
      if ($0 ~ /^- \*\*[A-Z]\./) opts++
      if ($0 ~ /recommended/) rec=1
      if ($0 ~ /^\*(Unanswered by|No default)/) def=1
      if ($0 ~ /\]\(.*\)/) link=1
      if ($0 ~ /your answer:\*\*/) { slot=1; inslot=1; next }
      if (inslot && $0 ~ /[^[:space:]]/) ans=1
    }
    function check() {
      if (opts<2) print "RED: " id " has fewer than two options"
      if (!rec)   print "RED: " id " has no recommendation"
      if (!def)   print "RED: " id " has no default line (or explicit no-default)"
      if (!link)  print "RED: " id " has no home link"
      if (!slot)  print "RED: " id " has no answer slot"
      if (ans)    print "RED: " id " has a filled answer slot not yet processed"
    }
    END { if (id!="") check() }
  ' docs/owner-queue.md | while IFS= read -r l; do echo "$l"; red=1; done
  # awk runs in a subshell; re-detect RED lines for the exit code
  if awk '/^### R-[0-9]+/{n++} END{exit !(n>0)}' docs/owner-queue.md; then
    if sed -n '/your answer:\*\*/,/^### /p' docs/owner-queue.md | grep -vE 'your answer|^### |^---|^$' | grep -q '[^[:space:]]'; then red=1; fi
  fi
fi

# 5. Registry entries without a Ruling
if [ -f docs/rulings.md ]; then
  awk '
    /^### R-[0-9]+/ { if (id!="" && !rul) print "RED: registry entry " id " has no **Ruling**:"; id=$2; rul=0; next }
    /\*\*Ruling\*\*:/ { rul=1 }
    END { if (id!="" && !rul) print "RED: registry entry " id " has no **Ruling**:" }
  ' docs/rulings.md | while IFS= read -r l; do echo "$l"; done
  if awk '/^### R-[0-9]+/{if(id!=""&&!rul)bad=1; id=$2; rul=0} /\*\*Ruling\*\*:/{rul=1} END{if(id!=""&&!rul)bad=1; exit bad}' docs/rulings.md; then :; else red=1; fi
fi

# 6. YELLOW: entries pending >= 3 iters (best effort: "(N iters)" in metadata line)
if [ -f docs/owner-queue.md ]; then
  grep -nE '\(([3-9]|[1-9][0-9]+) iters\)' docs/owner-queue.md | while IFS= read -r l; do Y "entry pending 3+ iterations: $l"; done
fi

exit $red
