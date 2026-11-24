# Security process

## Reporting

Report suspected vulnerabilities privately to the repository administrators.
Use GitHub's private vulnerability reporting if it is enabled. Do not post
credentials, customer records, or exploitation details in a public issue.

## Dependency maintenance

- Dependabot checks npm dependencies and GitHub Actions weekly and opens update
  pull requests when updates are available. Repository administrators must enable
  Dependabot and notifications in GitHub as needed.
- The scheduled **Dependency audit** workflow checks the npm lockfile weekly for
  high and critical advisories. It can also be started manually from Actions.
  A successful scan is not proof that the application is secure.
- Review failed scans and Dependabot alerts promptly. Prioritize exposed runtime
  dependencies, assess whether the affected code is reachable, and document
  accepted risks and follow-up dates privately when an immediate fix is not
  available.
- Review update pull requests, run the relevant tests, and deploy fixes through
  the normal release process. Do not use unattended major-version upgrades or
  `npm audit fix --force` as a substitute for review.

## Ongoing review and incidents

- Review access and permissions when people join, leave, or change roles; disable
  unused accounts. Check Netlify, Stripe, Resend, DNS, storage, and GitHub access
  as well as application accounts.
- Review authentication, customer-data access, uploads, webhooks, and audit
  logs after significant changes and periodically thereafter. Use an isolated
  test environment for active testing; obtain authorization before probing
  production or third-party services.
- If an incident is suspected, restrict access, preserve relevant evidence, and
  notify the repository administrators privately. Rotate affected credentials
  through the appropriate providers and assess customer notification and legal
  obligations without placing sensitive information in public issues or logs.
