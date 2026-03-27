# 🤖 Qwen Auto-Submit for RepoSentinel PRs

## Quick Start (From Cursor)

### Option 1: Use Cursor Chat (Easiest)

Just type in Cursor chat:

```
@qwen submit pr1
```

Or:

```
@qwen check pr status
```

### Option 2: Use Cursor Command Palette

1. Press `Ctrl+Shift+P` (Windows) or `Cmd+Shift+P` (Mac)
2. Type: `Cursor: Run Command`
3. Enter: `qwen-submit pr1`

---

## Available Commands

### Submit PRs

| Command | What It Does |
|---------|--------------|
| `submit pr1` | Submit PR #1 (Mixed Precision) - **Ready Now** |
| `submit pr2` | Submit PR #2 (LR Scheduling) |
| `submit pr3` | Submit PR #3 (Experiment Logging) |
| `submit all` | Submit all PRs at once |

### Check Status

| Command | What It Does |
|---------|--------------|
| `check pr status` | Check if PRs have comments/responses |
| `check pr 1` | Check status of PR #1 specifically |
| `list my prs` | List all your open PRs |

### Reminders

| Command | What It Does |
|---------|--------------|
| `remind me tomorrow` | Set reminder for tomorrow |
| `remind me weekly` | Set weekly reminder |
| `show reminders` | Show active reminders |

---

## Example Conversations

### Submit PR #1

**You:** `@qwen submit pr1`

**Qwen:** 
```
🚀 Submitting PR #1: Mixed Precision Training

✓ Creating pull request...
✓ PR created successfully!
✓ Added comment tagging @karpathy

View PR: https://github.com/karpathy/autoresearch/pull/NEW
```

### Check PR Status

**You:** `@qwen check pr status`

**Qwen:**
```
📊 PR Status for AmithKumar1/autoresearch

PR #1: Add AMP mixed precision training
   Status: Open • Comments: 0 • Updated: 2 hours ago
   ○ No comments yet

Next action: Wait for response (submitted 2 days ago)
```

### Set Reminder

**You:** `@qwen remind me to check prs tomorrow`

**Qwen:**
```
⏰ Reminder set!

I'll remind you tomorrow at 9:00 AM to:
- Check PR #1 status
- Submit PR #2 if ready

You'll see a notification in Cursor.
```

---

## Setup (One-Time, 2 Minutes)

### Step 1: Make Scripts Executable

Open Cursor terminal and run:

```bash
cd C:\Users\amith\cursor-amith\reposentinel\scripts
chmod +x *.sh
```

### Step 2: Add to Cursor Commands

Create `.cursor/commands/qwen-submit.json`:

```json
{
  "name": "Qwen PR Submit",
  "command": "bash scripts/qwen-submit.sh",
  "description": "Submit PRs to Karpathy's autoresearch"
}
```

### Step 3: Test It

In Cursor chat, type:

```
@qwen help
```

You should see the help menu!

---

## Automation Rules

Add this to `.cursor/rules/pr-automation.json`:

```json
{
  "name": "PR Automation",
  "description": "Automatically submit and monitor PRs",
  "triggers": {
    "daily": {
      "time": "09:00",
      "action": "check_pr_status"
    },
    "on_pr_comment": {
      "action": "notify_user"
    }
  },
  "commands": {
    "submit_pr1": "bash scripts/qwen-submit.sh --pr1",
    "submit_pr2": "bash scripts/qwen-submit.sh --pr2",
    "submit_pr3": "bash scripts/qwen-submit.sh --pr3",
    "check_status": "bash scripts/qwen-submit.sh --status"
  }
}
```

---

## Full Workflow (Set and Forget)

### Week 1: Submit PRs

**Day 1:**
```
@qwen submit pr1
```

**Day 3:**
```
@qwen submit pr2
```

**Day 5:**
```
@qwen submit pr3
```

### Week 2-4: Monitor

**Daily (automatic):**
```
🔔 PR Status Update

PR #1: No new comments
PR #2: No new comments  
PR #3: No new comments

Next check: Tomorrow 9:00 AM
```

**If Karpathy comments:**
```
🚨 @karpathy commented on PR #1!

"Thanks for the contribution! Can you add benchmarks for A100?"

Reply in Cursor: @qwen reply to pr1 "Sure! Adding A100 benchmarks now..."
```

---

## Troubleshooting

### "Command not found"

Make sure scripts are executable:
```bash
chmod +x scripts/*.sh
```

### "Not authenticated"

Login to GitHub:
```bash
gh auth login
```

### "Branch not found"

Make sure you're on the right branch:
```bash
git checkout feature/mixed-precision
```

---

## Quick Reference Card

Copy this for easy reference:

```
╔══════════════════════════════════════════════╗
║    Qwen PR Submit - Quick Commands          ║
╠══════════════════════════════════════════════╣
║ @qwen submit pr1     → Submit PR #1         ║
║ @qwen submit pr2     → Submit PR #2         ║
║ @qwen submit pr3     → Submit PR #3         ║
║ @qwen submit all     → Submit all PRs       ║
║ @qwen check status   → Check PR status      ║
║ @qwen remind me      → Set reminders        ║
║ @qwen help           → Show all commands    ║
╚══════════════════════════════════════════════╝
```

---

## What Happens Automatically

Once you submit a PR, Qwen will:

1. ✅ **Monitor daily** for new comments
2. ✅ **Notify you** if @karpathy responds
3. ✅ **Suggest replies** based on comments
4. ✅ **Track timeline** (when to follow up)
5. ✅ **Prepare next PR** when ready

---

## Need Help?

In Cursor chat, just ask:

```
@qwen how do I submit PRs?
@qwen what's the status?
@qwen what should I do next?
```

I'll guide you through everything! 🚀
