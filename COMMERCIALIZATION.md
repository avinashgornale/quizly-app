# Commercialization roadmap

## Completed foundation

- Deny-by-default Firestore rules with role and ownership checks
- Authenticated AI generation through Firebase Functions
- Backend-managed user creation and deletion
- Removal of stored and displayed passwords
- Administrative audit events
- Auth-aware, student-scoped Firestore queries
- Baseline authentication UI test and production deployment instructions
- Expiring, automatically rotating quiz QR access tokens
- Organization and membership records with tenant-scoped rules and queries
- New-institution signup and one-time legacy-data adoption
- Faculty/student invitations, CSV batches, profile completion, and password replacement
- Departments, programs, batches, academic terms, onboarding checklist, and activation
- Pilot subscription state, trial expiration, and faculty/student seat enforcement

## Required before a production pilot

- Move scoring and attempt submission into a callable backend transaction so clients cannot submit trusted scores.
- Store answer keys separately from student-readable quiz documents.
- Add App Check, function rate limits, structured logging, alerting, backups, and retention policies.
- Add Firestore emulator tests for every rule and role.
- Add scoring, quiz lifecycle, resumability, and account-management tests.
- Replace runtime CDN QR generation with a pinned package dependency.
- Add accessible validation and remove raw error details from user-facing dialogs.
- Establish separate development, staging, and production Firebase projects.

## Remaining SaaS integrations

- Select a payment provider and add checkout, invoicing, signed webhooks, proration, and cancellation flows.
- Configure Firebase Trigger Email with the production SMTP provider.
- Add support tooling, audit-log viewing, data export/deletion, and organization offboarding.

## Launch governance

- Commission an independent security assessment and load test.
- Obtain jurisdiction-specific legal review for terms, privacy, educational records, retention, and subprocessors.
- Define incident response, backup restoration, support, uptime, and change-management procedures.
- Run a controlled institutional pilot before enabling self-service registration.
