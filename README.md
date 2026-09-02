# Quizly

Quizly is a Firebase-backed quiz platform for institutions. Administrators manage accounts and courses, teachers create and assess quizzes, and authenticated students join quizzes through shared codes or QR links.

## Architecture

- React frontend (`src/`)
- Firebase Authentication and Cloud Firestore
- Firebase Cloud Functions (`functions/`) for privileged account administration and AI question generation
- Netlify-compatible static frontend deployment

Sensitive operations must remain in Cloud Functions. Passwords are managed by Firebase Authentication and are never stored in Firestore.

## Local development

Requirements: Node.js 20, npm, a Firebase project, and Firebase CLI.

```text
npm install
npm start
```

The checked-in Firebase client configuration identifies the Firebase project but does not grant database access. Firestore rules and authenticated identities provide authorization.

## Verification

```text
npm test -- --watchAll=false
npm run build
node --check functions/index.js
```

## Production deployment

1. Review `.firebaserc` and select the intended production Firebase project.
2. Store the OpenAI key with `firebase functions:secrets:set OPENAI_API_KEY`.
3. Deploy Functions first with `firebase deploy --only functions` so legacy administrators can access the migration callable.
4. Build and deploy the tenant-aware static frontend through the configured hosting provider.
5. For an existing installation, sign in as the current administrator and complete the one-time organization adoption before enforcing the new rules.
6. Deploy tenant enforcement with `firebase deploy --only firestore:rules,firestore:indexes`.
7. Configure Firebase Authentication authorized domains and password policies. Fresh installations can then use **Onboard a new college**.
8. Install Firebase Trigger Email and configure SMTP if invitation emails should be delivered automatically.

Do not restore the former Netlify AI endpoint. It was intentionally removed because it accepted unauthenticated requests.

## Security model

- Unauthenticated Firestore access is denied.
- Administrators manage Authentication accounts through callable backend functions.
- Teachers can modify only courses and quizzes assigned to their UID.
- Student attempts, enrollments, sessions, and integrity events are scoped to the authenticated student.
- Backend administrative actions generate immutable `auditLogs` entries.
- Quiz entry uses backend-issued QR tokens with a teacher-selected expiry; open QR windows rotate automatically when a token expires.
- Every business record is scoped by `organizationId`, with organization-aware queries and security rules.
- New colleges can create isolated pilot workspaces and onboard members through expiring invitations or CSV batches.

See `ONBOARDING.md` for the complete institution, faculty, and student onboarding workflow.

Before a public commercial launch, move answer keys and scoring fully into trusted backend code. See `COMMERCIALIZATION.md`.
