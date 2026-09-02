# Institution onboarding

## New institution

1. From the sign-in page, select **Onboard a new college**.
2. The owner creates an account and receives a Firebase email-verification message.
3. Quizly creates an isolated organization with a 30-day pilot entitlement.
4. In **Onboarding**, the owner completes branding, departments, programs, batches, and an academic term.
5. The owner invites faculty and students individually or pastes up to 500 CSV rows.
6. Each invitee follows a single-use, seven-day link, creates a password, verifies email, and completes a role-specific profile.
7. The owner activates the institution after the required checklist is complete.

## CSV format

```csv
name,email,role,usn,department,program,batch
Anita Rao,anita@example.edu,teacher,F001,Computer Science,,
Rahul Singh,rahul@example.edu,student,1RV21CS001,Computer Science,B.Tech CSE,2026
```

Roles are `teacher` or `student`. The current parser is intended for simple CSV values without embedded commas.

## Existing installation migration

An administrator whose profile has no `organizationId` receives a one-time migration screen. The migration creates the first organization and assigns all legacy tenant records to it. Deploy Functions before Firestore rules so this callable migration is available when tenant enforcement begins.

## Invitation email delivery

Invitation functions write email jobs to the Firestore `mail` collection in the format used by Firebase's Trigger Email extension. Install and configure that extension with an SMTP provider to deliver messages. Until then, administrators can copy invitation links directly from the onboarding screen.

## Subscription behavior

New organizations receive an internal `pilot` subscription with a 30-day trial, 25 faculty seats, and 1,000 student seats. Backend account creation and invitation claims enforce expiration, suspension, cancellation, and seat limits. Real payment collection is intentionally not enabled until a payment provider is selected and credentials/webhooks are configured.
