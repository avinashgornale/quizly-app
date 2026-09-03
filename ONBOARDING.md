# Institution onboarding

## New institution

1. The Quizly super administrator opens **Institutions** and creates the institution plus its coordinator login.
2. The super administrator selects complimentary access or a monthly/annual UPI subscription.
3. Subscription-based institutions remain locked until the super administrator records the UPI transaction reference and activates access.
4. The coordinator signs in, changes the temporary password, and creates programs under the institution.
5. The coordinator creates faculty accounts and assigns each faculty member to a program.
6. Faculty create courses within their assigned program and create quizzes under those courses.
7. The coordinator can additionally invite students individually or import up to 500 CSV rows.

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

Managed institutions receive either an active complimentary entitlement or a locked `pending_payment` monthly/annual subscription. The super administrator records the UPI transaction reference to activate a paid institution. Backend account creation, Firestore rules, and the application gate enforce payment status and seat limits. Automated UPI checkout/webhooks can be added after a payment provider is selected.

## Individual faculty

Individual educators can select **Sign up as individual faculty**, verify their email, and choose a monthly or annual package. Quizly provisions a private one-faculty workspace with a 250-student limit and keeps it locked in `pending_payment` until a payment gateway or the Quizly super administrator activates the subscription.

The platform super administrator can create an independent faculty account from **Users → Independent faculty**. Choose **Subscription required** to keep the workspace locked pending payment, or **Complimentary — no charge** to activate it immediately. Platform privileges are granted only to profiles marked `isSuperAdmin` or to the migrated legacy administrator.
