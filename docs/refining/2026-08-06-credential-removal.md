# RF-008: Committed credential mitigation

- Date: 2026-08-06
- Issue: RF-008
- Priority: P0
- Status: Sanitized for PR publication; blocked on account/external actions

## Outcome

The plaintext demo credential block was removed from the current root README.
The detailed incremental commits were deliberately preserved on the local-only
study branch so the engineering sequence remains available for review.

The publication branch was created separately from `origin/main` and receives
only the final sanitized tree as a squash. The credential-introducing commit is
therefore not an ancestor of the PR branch and is not pushed with the PR.

RF-008 is not marked Resolved because the local study branch still retains the
value, account rotation has not been performed, and local evidence cannot prove
that an earlier copy was never shared.

## Evidence reviewed

The review established all of the following without reproducing the credential
value in this record:

1. The credential block was present in the tracked root `README.md` at the
   review starting point.
2. Checkpoint commit `0490abf` introduced that README together with the first
   refinement implementation checkpoint.
3. The current branch had no configured upstream, and no fetched remote branch
   contained `0490abf` at review time.
4. Item 3 is only local evidence. It does not prove that the commit was never
   pushed to an unfetched ref, copied, exported, or otherwise disclosed.

The refinement register previously called the block "uncommitted." That was no
longer true after `0490abf`, so the register now distinguishes the current tree,
local history, and possible remote exposure.

## Decision and change

The owner asked to preserve the commits already created and to continue in
small, reviewable steps. This change therefore:

- removes only the credential block from the current README;
- does not amend, rebase, filter, or otherwise rewrite existing commits;
- updates RF-008's description and acceptance criteria;
- adds this record so the reason and residual risk remain reviewable.

No account operation was attempted. Rotating or disabling an account is an
external security action and requires the owner's confirmation and access.

## PR publication boundary

The PR is prepared on `refining/2026-08-06-review-fixes-pr`, created directly
from `origin/main`. A squash application copies the study branch's final file
state without copying its parent commits. This preserves both requirements:

- the local study branch retains the small, chronological commits; and
- the remote PR branch does not publish the credential-bearing commit.

The local study branch must remain local unless its history is sanitized later.

## Why the distinction matters

| Location | State after this change | Security meaning |
|---|---|---|
| Current working tree / next commit | Credential absent | New readers do not see it in the latest README. |
| Local study branch | Credential still present in an earlier commit | Anyone with that local history can recover it; do not push this branch. |
| PR branch ancestry | Introducing commit absent | Publishing this branch does not publish that commit. |
| Fetched remote refs at review time | Introducing commit not found | Useful evidence, but not proof that disclosure never occurred. |
| External account | Unknown | Must be rotated or disabled if live, reused, or potentially shared. |

## Remaining external actions

1. Determine whether the account is live and whether its password was used
   anywhere else.
2. Rotate or disable it if it is live, reused, or may have been disclosed.
3. Establish whether commit `0490abf` or a descendant was ever pushed, shared,
   bundled, or copied outside this local repository.
4. If another published ref is found, purge the credential from that ref and
   coordinate replacement clones. Do not push the local study branch as-is.
5. If a public demo account is still wanted, provision a restricted disposable
   account and document access through a safe delivery mechanism rather than a
   reusable plaintext password in Git.

Rotation remains necessary even if history is later rewritten: rewriting Git
history reduces future discovery but cannot revoke copies that already exist.

## Verification

The forward-only change is verified with commands that do not print the former
credential value:

```powershell
git grep -n "test account:" -- README.md
git merge-base --is-ancestor 0490abf HEAD
git diff --check
git status --short
```

Expected result:

- the first command returns no match;
- the ancestry check returns a non-zero status on the sanitized PR branch;
- the diff has no whitespace errors;
- the status lists only the intended PR changes before the squash commit.

## Learning notes

- A working-tree edit changes the next snapshot, not previous snapshots.
- A commit makes a value part of local history even when the branch has not
  been pushed.
- `git branch -a --contains <commit>` describes refs currently known to this
  clone; it is not a complete audit of every possible remote or copy.
- Secret removal and secret revocation solve different problems. A secure
  response normally needs both.
