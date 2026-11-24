# Security review summary

The application review examined baseline commit `4b771f3` and local remediation
work. The findings below affect the baseline; the application fixes were
subsequently included in commit `228767f`. Production verification is still
required to confirm the fixes are active and effective. No live security
probing or customer-data inspection was performed for this review.

| Severity | Finding | Baseline location | Confidence | Status |
| --- | --- | --- | --- | --- |
| High | An approved passwordless account could be taken over during first login. | `src/netlify/functions/auth-login.mjs:61-66` | 10/10 | Inbox-verified setup implemented; production verification pending. |
| Medium | The public Stripe refresh route could issue merchant onboarding links. | `src/netlify/functions/stripe-connect-refresh.mjs:22-42` | 8/10 | Account-bound signed refresh capability implemented; production verification pending. |
| Medium | Checkout accepted untrusted return destinations. | `src/netlify/functions/stripe-checkout-session.mjs:29-32,80-84` | 9/10 | Same-origin validation implemented; production verification pending. |
| Medium | Password reset did not revoke existing sessions. | `src/netlify/functions/admin-users.mjs:90-100` | 9/10 | Session revocation implemented; production verification pending. |

Until secure onboarding is deployed and verified, approved passwordless
accounts remain at risk. Disable unused passwordless accounts where possible
and do not use the existing first-login flow for new users.

## Dependency audit

The locally updated lockfile's npm audit reported zero production advisories
and 12 moderate development dependency entries. The entries include transitive
`glob` and `minimatch` advisories in the Netlify CLI dependency tree; a package
being listed does not establish that its advisory is exploitable here. The
suggested automatic remediation is a major CLI downgrade and has not been
applied. Reassess available compatible updates and verify a clean Linux install
and function packaging before release.

## Release and ongoing checks

- Validate the fixes, Node runtime, function packaging, and conditional Blob
  writes in an isolated deployment; staging was not used for this release.
- Confirm secure setup and session revocation end to end using test accounts.
- Review dependency alerts regularly and retain the scheduled audit and
  Dependabot configuration when the implementation changes are deployed.
- Conduct authorized live security verification separately; this review is not
  a guarantee that the application is free of vulnerabilities.
