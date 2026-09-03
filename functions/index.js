import OpenAI from "openai";
import { createHash, randomBytes } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";

initializeApp();
const db = getFirestore();

const openaiApiKey = defineSecret("OPENAI_API_KEY");
const tenantCollections = ["users", "courses", "quizzes", "attempts", "enrollments", "quizSessions", "integrityLogs", "settings", "departments", "programs", "batches", "academicTerms"];
const invitationHash = (token) => createHash("sha256").update(String(token)).digest("hex");
const slugify = (value) => String(value || "")
  .toLowerCase()
  .trim()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "")
  .slice(0, 48);

const cleanCount = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 10;
  return Math.min(50, Math.max(1, Math.round(parsed)));
};

const normalizeQuestions = (questions) => {
  if (!Array.isArray(questions)) return [];

  return questions
    .map((question) => {
      const options = Array.isArray(question.options)
        ? question.options.map((option) => String(option || "").trim()).filter(Boolean).slice(0, 4)
        : [];

      if (!String(question.text || "").trim() || options.length !== 4) {
        return null;
      }

      const correctAnswers = Array.isArray(question.correctAnswers)
        ? question.correctAnswers.map(Number).filter((value) => value >= 0 && value <= 3)
        : [Number(question.correctAnswer ?? 0)].filter((value) => value >= 0 && value <= 3);

      const uniqueAnswers = [...new Set(correctAnswers)];
      const type = uniqueAnswers.length > 1 ? "multiple" : "single";

      return {
        text: String(question.text).trim(),
        options,
        type,
        correctAnswer: uniqueAnswers[0] ?? 0,
        correctAnswers: uniqueAnswers.length ? uniqueAnswers : [0],
        points: Math.max(0.01, Number(question.points) || 1),
        negativeMarks: Math.max(0, Number(question.negativeMarks) || 0),
        partialMarking: Boolean(question.partialMarking),
        difficulty: ["easy", "medium", "difficult"].includes(question.difficulty)
          ? question.difficulty
          : "medium",
        bloomLevel: ["remember", "understand", "apply", "analyze", "evaluate", "create"].includes(question.bloomLevel)
          ? question.bloomLevel
          : "understand",
        tags: Array.isArray(question.tags)
          ? question.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 6)
          : []
      };
    })
    .filter(Boolean);
};

export const generateQuizQuestions = onCall(
  {
    secrets: [openaiApiKey],
    timeoutSeconds: 120,
    memory: "512MiB"
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Please sign in before generating questions.");
    }

    const userSnap = await db.collection("users").doc(request.auth.uid).get();
    const role = userSnap.exists ? userSnap.data()?.role : null;
    if (!["admin", "teacher"].includes(role)) {
      throw new HttpsError("permission-denied", "Only admins and teachers can generate questions.");
    }
    await enforceTeachingEntitlement(userSnap.data());

    const topic = String(request.data?.topic || "").trim();
    const sourceText = String(request.data?.sourceText || "").trim().slice(0, 24000);
    const count = cleanCount(request.data?.count);

    if (!topic && !sourceText) {
      throw new HttpsError("invalid-argument", "Provide a topic or source text.");
    }

    const client = new OpenAI({ apiKey: openaiApiKey.value() });
    const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";

    const prompt = `
Create ${count} quiz questions for a college quiz app.

Topic:
${topic || "Use the source text below."}

Source text:
${sourceText || "No source text provided."}

Rules:
- Return only valid JSON matching the schema.
- Use exactly 4 options per question.
 - Use zero-based indexes in correctAnswers.
 - Include difficulty, bloomLevel, points, negativeMarks, partialMarking, and tags.
 - Return an object shaped as {"questions": [...]} and no markdown.
`;

    try {
      const response = await client.responses.create({
        model,
        input: [
          { role: "system", content: "You generate accurate, concise quiz questions for teachers. Return JSON only." },
          { role: "user", content: prompt }
        ],
        text: { format: { type: "json_object" } }
      });

      const parsed = JSON.parse(response.output_text || "{}");
      const questions = normalizeQuestions(parsed.questions).slice(0, count);
      if (!questions.length) {
        throw new HttpsError("internal", "AI did not return valid questions. Try a clearer topic or longer source text.");
      }
      return { questions };
    } catch (error) {
      console.error("Question generation failed", error);
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", "Question generation failed. Please try again.");
    }
  }
);

const requireAdmin = async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Please sign in.");
  }
  const profile = await db.collection("users").doc(request.auth.uid).get();
  if (!profile.exists || profile.data()?.role !== "admin") {
    throw new HttpsError("permission-denied", "Administrator access is required.");
  }
  return profile.data();
};

const isPlatformAdministrator = (profile = {}) => Boolean(profile.isSuperAdmin || profile.legacyVerificationExempt);

const requirePlatformAdministrator = async (request) => {
  const profile = await requireAdmin(request);
  if (!isPlatformAdministrator(profile)) {
    throw new HttpsError("permission-denied", "Quizly super-administrator access is required.");
  }
  return profile;
};

const enforceSeatEntitlement = async (organizationId, role) => {
  const organization = await db.collection("organizations").doc(organizationId).get();
  if (!organization.exists) throw new HttpsError("failed-precondition", "Organization not found.");
  const data = organization.data();
  const subscription = data.subscription || {};
  if (["pending_payment", "suspended", "cancelled"].includes(data.status) || ["pending_payment", "past_due", "cancelled"].includes(subscription.status)) {
    throw new HttpsError("permission-denied", "The organization subscription is not active.");
  }
  if (subscription.status === "trialing" && subscription.trialEndsAt && new Date(subscription.trialEndsAt).getTime() <= Date.now()) {
    throw new HttpsError("failed-precondition", "The pilot period has expired. Contact Quizly to select a plan.");
  }
  const limit = role === "teacher" ? Number(subscription.facultyLimit || 25) : Number(subscription.studentLimit || 1000);
  const countSnapshot = await db.collection("users")
    .where("organizationId", "==", organizationId)
    .where("role", "==", role)
    .count()
    .get();
  if (countSnapshot.data().count >= limit) {
    throw new HttpsError("resource-exhausted", `${role === "teacher" ? "Faculty" : "Student"} seat limit reached.`);
  }
};

const enforceTeachingEntitlement = async (profile = {}) => {
  if (profile.accountType !== "individual_faculty") return;
  const organization = await db.collection("organizations").doc(profile.organizationId || "missing").get();
  if (!organization.exists || organization.data()?.subscription?.status !== "active") {
    throw new HttpsError("permission-denied", "Activate the individual faculty subscription before using teaching tools.");
  }
};

const cleanProfile = (data = {}) => ({
  name: String(data.name || "").trim().slice(0, 120),
  email: String(data.email || "").trim().toLowerCase().slice(0, 254),
  role: ["teacher", "student"].includes(data.role) ? data.role : "student",
  usn: String(data.usn || "").trim().slice(0, 80),
  college: String(data.college || "").trim().slice(0, 160),
  department: String(data.department || "").trim().slice(0, 160),
  designation: String(data.designation || "").trim().slice(0, 120),
  employeeId: String(data.employeeId || "").trim().slice(0, 80),
  programId: String(data.programId || "").trim().slice(0, 128),
  logoUrl: String(data.logoUrl || "").trim().slice(0, 1000)
});

export const createManagedUser = onCall(async (request) => {
  const administrator = await requireAdmin(request);
  if (!administrator.organizationId) {
    throw new HttpsError("failed-precondition", "Complete organization setup before adding users.");
  }
  const profile = cleanProfile(request.data);
  const password = String(request.data?.password || "");
  if (!profile.name || !profile.email) {
    throw new HttpsError("invalid-argument", "Name and email are required.");
  }
  if (password.length < 8) {
    throw new HttpsError("invalid-argument", "The temporary password must contain at least 8 characters.");
  }
  if (profile.role === "teacher") {
    if (!profile.programId) throw new HttpsError("invalid-argument", "Assign the faculty member to a program.");
    const program = await db.collection("programs").doc(profile.programId).get();
    if (!program.exists || program.data()?.organizationId !== administrator.organizationId) {
      throw new HttpsError("invalid-argument", "Select a valid program from this institution.");
    }
  }
  await enforceSeatEntitlement(administrator.organizationId, profile.role);

  let account;
  try {
    account = await getAuth().createUser({
      email: profile.email,
      password,
      displayName: profile.name,
      emailVerified: false,
      disabled: false
    });
    await db.collection("users").doc(account.uid).set({
      ...profile,
      uid: account.uid,
      organizationId: administrator.organizationId,
      mustChangePassword: true,
      onboardingCompleted: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    await db.collection("memberships").doc(`${administrator.organizationId}_${account.uid}`).set({
      organizationId: administrator.organizationId,
      userId: account.uid,
      role: profile.role,
      status: "active",
      createdAt: new Date().toISOString()
    });
    await db.collection("auditLogs").add({
      action: "user.created",
      actorId: request.auth.uid,
      targetId: account.uid,
      targetRole: profile.role,
      organizationId: administrator.organizationId,
      createdAt: new Date().toISOString()
    });
    return { uid: account.uid };
  } catch (error) {
    if (account?.uid) await getAuth().deleteUser(account.uid).catch(() => {});
    console.error("Managed user creation failed", error);
    throw new HttpsError("internal", error.code === "auth/email-already-exists" ? "That email is already registered." : "Unable to create the account.");
  }
});

export const deleteManagedUser = onCall(async (request) => {
  const administrator = await requireAdmin(request);
  const uid = String(request.data?.uid || "").trim();
  if (!uid) throw new HttpsError("invalid-argument", "A user ID is required.");
  if (uid === request.auth.uid) throw new HttpsError("failed-precondition", "You cannot delete your own account.");

  await getAuth().deleteUser(uid).catch((error) => {
    if (error.code !== "auth/user-not-found") throw error;
  });
  await db.collection("users").doc(uid).delete();
  if (administrator.organizationId) {
    await db.collection("memberships").doc(`${administrator.organizationId}_${uid}`).delete();
  }
  await db.collection("auditLogs").add({
    action: "user.deleted",
    actorId: request.auth.uid,
    targetId: uid,
    organizationId: administrator.organizationId || null,
    createdAt: new Date().toISOString()
  });
  return { deleted: true };
});

export const rotateQuizAccess = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Please sign in.");
  const quizId = String(request.data?.quizId || "").trim();
  const requestedDuration = Number(request.data?.durationMinutes);
  const durationMinutes = Math.min(120, Math.max(1, Math.round(requestedDuration || 10)));
  if (!quizId) throw new HttpsError("invalid-argument", "A quiz ID is required.");

  const [profileSnap, quizSnap] = await Promise.all([
    db.collection("users").doc(request.auth.uid).get(),
    db.collection("quizzes").doc(quizId).get()
  ]);
  if (!profileSnap.exists || !quizSnap.exists) {
    throw new HttpsError("not-found", "The quiz or user profile was not found.");
  }
  const role = profileSnap.data()?.role;
  await enforceTeachingEntitlement(profileSnap.data());
  const quiz = quizSnap.data();
  if (role !== "admin" && !(role === "teacher" && quiz.teacherId === request.auth.uid)) {
    throw new HttpsError("permission-denied", "You cannot manage access for this quiz.");
  }

  const token = `QZ-${randomBytes(8).toString("base64url").toUpperCase().slice(0, 10)}`;
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + durationMinutes * 60 * 1000);
  await quizSnap.ref.update({
    accessToken: token,
    accessIssuedAt: issuedAt.toISOString(),
    accessExpiresAt: expiresAt.toISOString(),
    accessDurationMinutes: durationMinutes,
    accessIssuedBy: request.auth.uid
  });
  await db.collection("auditLogs").add({
    action: "quiz.access_rotated",
    actorId: request.auth.uid,
    targetId: quizId,
    organizationId: quiz.organizationId,
    expiresAt: expiresAt.toISOString(),
    createdAt: issuedAt.toISOString()
  });
  return { token, expiresAt: expiresAt.toISOString(), durationMinutes };
});

const organizationDocument = ({ name, ownerId, slug }) => ({
  name,
  slug,
  ownerId,
  status: "setup",
  subscription: {
    plan: "pilot",
    status: "trialing",
    facultyLimit: 25,
    studentLimit: 1000,
    trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  },
  onboarding: {
    profile: false,
    departments: false,
    academicTerm: false,
    faculty: false,
    students: false,
    sampleQuiz: false
  },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
});

const individualOrganizationDocument = ({ name, ownerId, slug, plan, billingMode = "subscription" }) => ({
  name,
  slug,
  ownerId,
  type: "individual_faculty",
  status: billingMode === "complimentary" ? "active" : "pending_payment",
  subscription: {
    plan: plan === "annual" ? "individual_annual" : "individual_monthly",
    billingCycle: plan === "annual" ? "annual" : "monthly",
    billingMode,
    status: billingMode === "complimentary" ? "active" : "pending_payment",
    facultyLimit: 1,
    studentLimit: 250,
    activatedAt: billingMode === "complimentary" ? new Date().toISOString() : null
  },
  onboarding: { profile: false, courses: false, students: false, sampleQuiz: false },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
});

const provisionIndividualFaculty = async ({ uid, email, name, plan, billingMode, createdBy }) => {
  const organizationRef = db.collection("organizations").doc();
  const organizationName = `${name}'s Quizly workspace`;
  const organization = individualOrganizationDocument({
    name: organizationName,
    ownerId: uid,
    slug: `${slugify(name) || "faculty"}-${organizationRef.id.slice(0, 6).toLowerCase()}`,
    plan,
    billingMode
  });
  const now = new Date().toISOString();
  const batch = db.batch();
  batch.set(organizationRef, organization);
  batch.set(db.collection("users").doc(uid), {
    uid,
    email,
    name,
    role: "teacher",
    accountType: "individual_faculty",
    organizationId: organizationRef.id,
    onboardingCompleted: false,
    mustChangePassword: Boolean(createdBy),
    createdBy: createdBy || "self_service",
    createdAt: now,
    updatedAt: now
  });
  batch.set(db.collection("memberships").doc(`${organizationRef.id}_${uid}`), {
    organizationId: organizationRef.id,
    userId: uid,
    role: "owner",
    status: "active",
    createdAt: now
  });
  await batch.commit();
  return { organizationId: organizationRef.id, organization };
};

export const bootstrapIndividualFaculty = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Please create and sign in to your account first.");
  const name = String(request.data?.name || "").trim().slice(0, 120);
  const plan = request.data?.plan === "annual" ? "annual" : "monthly";
  if (name.length < 2) throw new HttpsError("invalid-argument", "Your name is required.");
  const userRef = db.collection("users").doc(request.auth.uid);
  const existing = await userRef.get();
  if (existing.exists && existing.data()?.organizationId) {
    throw new HttpsError("already-exists", "This account already has a Quizly workspace.");
  }
  return provisionIndividualFaculty({
    uid: request.auth.uid,
    email: String(request.auth.token.email || "").toLowerCase(),
    name,
    plan,
    billingMode: "subscription",
    createdBy: null
  });
});

export const createIndependentFaculty = onCall(async (request) => {
  await requirePlatformAdministrator(request);
  const profile = cleanProfile({ ...request.data, role: "teacher" });
  const password = String(request.data?.password || "");
  const plan = request.data?.plan === "annual" ? "annual" : "monthly";
  const billingMode = request.data?.billingMode === "complimentary" ? "complimentary" : "subscription";
  if (!profile.name || !profile.email || password.length < 8) {
    throw new HttpsError("invalid-argument", "Name, email, and a temporary password of at least 8 characters are required.");
  }
  let account;
  try {
    account = await getAuth().createUser({ email: profile.email, password, displayName: profile.name, emailVerified: false });
    const result = await provisionIndividualFaculty({
      uid: account.uid,
      email: profile.email,
      name: profile.name,
      plan,
      billingMode,
      createdBy: request.auth.uid
    });
    await db.collection("auditLogs").add({
      action: "individual_faculty.created",
      actorId: request.auth.uid,
      targetId: account.uid,
      organizationId: result.organizationId,
      billingMode,
      createdAt: new Date().toISOString()
    });
    return { uid: account.uid, organizationId: result.organizationId, subscription: result.organization.subscription };
  } catch (error) {
    if (account?.uid) await getAuth().deleteUser(account.uid).catch(() => {});
    console.error("Independent faculty creation failed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", error.code === "auth/email-already-exists" ? "That email is already registered." : "Unable to create the faculty account.");
  }
});

export const listIndependentFaculty = onCall(async (request) => {
  await requirePlatformAdministrator(request);
  const snapshot = await db.collection("users").where("accountType", "==", "individual_faculty").limit(500).get();
  const faculty = await Promise.all(snapshot.docs.map(async document => {
    const profile = document.data();
    const organization = profile.organizationId
      ? await db.collection("organizations").doc(profile.organizationId).get()
      : null;
    const subscription = organization?.exists ? organization.data()?.subscription || {} : {};
    return {
      uid: document.id,
      name: profile.name || "",
      email: profile.email || "",
      organizationId: profile.organizationId || "",
      plan: subscription.plan || "",
      billingCycle: subscription.billingCycle || "",
      billingMode: subscription.billingMode || "",
      subscriptionStatus: subscription.status || "unknown",
      createdAt: profile.createdAt || ""
    };
  }));
  return { faculty: faculty.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))) };
});

export const createManagedInstitution = onCall(async (request) => {
  await requirePlatformAdministrator(request);
  const institutionName = String(request.data?.institutionName || "").trim().slice(0, 160);
  const coordinatorName = String(request.data?.coordinatorName || "").trim().slice(0, 120);
  const coordinatorEmail = String(request.data?.coordinatorEmail || "").trim().toLowerCase().slice(0, 254);
  const password = String(request.data?.password || "");
  const billingCycle = request.data?.billingCycle === "annual" ? "annual" : "monthly";
  const billingMode = request.data?.billingMode === "complimentary" ? "complimentary" : "subscription";
  if (institutionName.length < 3 || coordinatorName.length < 2 || !coordinatorEmail.includes("@") || password.length < 8) {
    throw new HttpsError("invalid-argument", "Institution, coordinator, email, and a temporary password of at least 8 characters are required.");
  }
  let account;
  try {
    account = await getAuth().createUser({ email: coordinatorEmail, password, displayName: coordinatorName, emailVerified: false });
    const organizationRef = db.collection("organizations").doc();
    const now = new Date().toISOString();
    const active = billingMode === "complimentary";
    const organization = {
      name: institutionName,
      slug: `${slugify(institutionName) || "institution"}-${organizationRef.id.slice(0, 6).toLowerCase()}`,
      ownerId: account.uid,
      type: "institution",
      status: active ? "active" : "pending_payment",
      subscription: {
        plan: `institution_${billingCycle}`,
        billingCycle,
        billingMode,
        status: active ? "active" : "pending_payment",
        facultyLimit: 25,
        studentLimit: 1000,
        activatedAt: active ? now : null,
        paymentMethod: billingMode === "subscription" ? "upi" : "complimentary"
      },
      onboarding: { profile: true, programs: false, faculty: false, courses: false, students: false, sampleQuiz: false },
      createdAt: now,
      updatedAt: now
    };
    const batch = db.batch();
    batch.set(organizationRef, organization);
    batch.set(db.collection("users").doc(account.uid), {
      uid: account.uid, email: coordinatorEmail, name: coordinatorName, role: "admin",
      accountType: "institution_coordinator", organizationId: organizationRef.id,
      onboardingCompleted: true, mustChangePassword: true, createdBy: request.auth.uid,
      createdAt: now, updatedAt: now
    });
    batch.set(db.collection("memberships").doc(`${organizationRef.id}_${account.uid}`), {
      organizationId: organizationRef.id, userId: account.uid, role: "coordinator", status: "active", createdAt: now
    });
    batch.set(db.collection("settings").doc(`${organizationRef.id}_institution`), {
      organizationId: organizationRef.id, type: "institution", college: institutionName, updatedAt: now
    });
    await batch.commit();
    return { uid: account.uid, organizationId: organizationRef.id, subscription: organization.subscription };
  } catch (error) {
    if (account?.uid) await getAuth().deleteUser(account.uid).catch(() => {});
    console.error("Managed institution creation failed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", error.code === "auth/email-already-exists" ? "That coordinator email is already registered." : "Unable to create the institution.");
  }
});

export const listManagedInstitutions = onCall(async (request) => {
  await requirePlatformAdministrator(request);
  const snapshot = await db.collection("organizations").where("type", "==", "institution").limit(500).get();
  const institutions = await Promise.all(snapshot.docs.map(async document => {
    const data = document.data();
    const coordinator = data.ownerId ? await db.collection("users").doc(data.ownerId).get() : null;
    return {
      id: document.id,
      name: data.name || "",
      status: data.status || "",
      coordinatorName: coordinator?.exists ? coordinator.data()?.name || "" : "",
      coordinatorEmail: coordinator?.exists ? coordinator.data()?.email || "" : "",
      billingCycle: data.subscription?.billingCycle || "",
      billingMode: data.subscription?.billingMode || "",
      subscriptionStatus: data.subscription?.status || "unknown",
      paymentReference: data.subscription?.paymentReference || "",
      createdAt: data.createdAt || ""
    };
  }));
  return { institutions: institutions.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))) };
});

export const activateInstitutionSubscription = onCall(async (request) => {
  await requirePlatformAdministrator(request);
  const organizationId = String(request.data?.organizationId || "").trim();
  const paymentReference = String(request.data?.paymentReference || "").trim().slice(0, 120);
  if (!organizationId || !paymentReference) throw new HttpsError("invalid-argument", "Organization and UPI transaction reference are required.");
  const reference = db.collection("organizations").doc(organizationId);
  const organization = await reference.get();
  if (!organization.exists || organization.data()?.type !== "institution") throw new HttpsError("not-found", "Institution not found.");
  const now = new Date().toISOString();
  await reference.update({
    status: "active",
    "subscription.status": "active",
    "subscription.paymentMethod": "upi",
    "subscription.paymentReference": paymentReference,
    "subscription.activatedAt": now,
    updatedAt: now
  });
  await db.collection("auditLogs").add({ action: "institution.subscription_activated", actorId: request.auth.uid, organizationId, paymentReference, createdAt: now });
  return { active: true };
});

export const bootstrapOrganization = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Please create and sign in to your account first.");
  const name = String(request.data?.name || "").trim().slice(0, 160);
  const ownerName = String(request.data?.ownerName || "").trim().slice(0, 120);
  if (name.length < 3 || ownerName.length < 2) {
    throw new HttpsError("invalid-argument", "Institution and administrator names are required.");
  }
  const userRef = db.collection("users").doc(request.auth.uid);
  const existing = await userRef.get();
  if (existing.exists && existing.data()?.organizationId) {
    throw new HttpsError("already-exists", "This account already belongs to an organization.");
  }
  const baseSlug = slugify(name) || "institution";
  const organizationRef = db.collection("organizations").doc();
  const slug = `${baseSlug}-${organizationRef.id.slice(0, 6).toLowerCase()}`;
  const organization = organizationDocument({ name, ownerId: request.auth.uid, slug });
  const batch = db.batch();
  batch.set(organizationRef, organization);
  batch.set(userRef, {
    uid: request.auth.uid,
    email: request.auth.token.email || "",
    name: ownerName,
    role: "admin",
    organizationId: organizationRef.id,
    onboardingCompleted: false,
    mustChangePassword: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }, { merge: true });
  batch.set(db.collection("memberships").doc(`${organizationRef.id}_${request.auth.uid}`), {
    organizationId: organizationRef.id,
    userId: request.auth.uid,
    role: "owner",
    status: "active",
    createdAt: new Date().toISOString()
  });
  batch.set(db.collection("settings").doc(`${organizationRef.id}_institution`), {
    organizationId: organizationRef.id,
    college: name,
    updatedAt: new Date().toISOString()
  });
  await batch.commit();
  return { organizationId: organizationRef.id, organization };
});

export const adoptLegacyOrganization = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Please sign in.");
  const userRef = db.collection("users").doc(request.auth.uid);
  const profile = await userRef.get();
  if (!profile.exists || profile.data()?.role !== "admin") {
    throw new HttpsError("permission-denied", "Only the existing administrator can adopt legacy data.");
  }
  if (profile.data()?.organizationId) {
    return { organizationId: profile.data().organizationId, migrated: 0 };
  }
  const name = String(request.data?.name || profile.data()?.college || "Quizly Institution").trim().slice(0, 160);
  const organizationRef = db.collection("organizations").doc();
  await organizationRef.set(organizationDocument({
    name,
    ownerId: request.auth.uid,
    slug: `${slugify(name) || "institution"}-${organizationRef.id.slice(0, 6).toLowerCase()}`
  }));

  const writer = db.bulkWriter();
  let migrated = 0;
  for (const collectionName of tenantCollections) {
    const snapshot = await db.collection(collectionName).get();
    for (const document of snapshot.docs) {
      if (!document.data().organizationId) {
        writer.update(document.ref, { organizationId: organizationRef.id, updatedAt: new Date().toISOString() });
        migrated += 1;
      }
    }
  }
  writer.set(db.collection("memberships").doc(`${organizationRef.id}_${request.auth.uid}`), {
    organizationId: organizationRef.id,
    userId: request.auth.uid,
    role: "owner",
    status: "active",
    createdAt: new Date().toISOString()
  });
  writer.set(userRef, {
    organizationId: organizationRef.id,
    legacyVerificationExempt: true,
    updatedAt: new Date().toISOString()
  }, { merge: true });
  await writer.close();
  return { organizationId: organizationRef.id, migrated, legacyVerificationExempt: true };
});

const createInvitationRecord = async ({ organizationId, email, role, createdBy, name = "", metadata = {}, inviteBaseUrl = "" }) => {
  const normalizedEmail = String(email || "").trim().toLowerCase().slice(0, 254);
  if (!normalizedEmail || !normalizedEmail.includes("@")) throw new Error("A valid email is required.");
  const token = randomBytes(24).toString("base64url");
  const tokenDigest = invitationHash(token);
  await db.collection("invitations").doc(tokenDigest).set({
    organizationId,
    email: normalizedEmail,
    name: String(name || "").trim().slice(0, 120),
    role: role === "teacher" ? "teacher" : "student",
    metadata,
    status: "pending",
    createdBy,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date().toISOString()
  });
  if (/^https?:\/\//i.test(inviteBaseUrl)) {
    const organization = await db.collection("organizations").doc(organizationId).get();
    const invitationUrl = `${inviteBaseUrl}${inviteBaseUrl.includes("?") ? "&" : "?"}invite=${encodeURIComponent(token)}`;
    await db.collection("mail").add({
      to: normalizedEmail,
      message: {
        subject: `Invitation to ${organization.data()?.name || "Quizly"}`,
        text: `You have been invited to join ${organization.data()?.name || "your institution"} on Quizly as a ${role === "teacher" ? "faculty member" : "student"}. Accept within 7 days: ${invitationUrl}`
      },
      organizationId,
      createdAt: new Date().toISOString()
    });
  }
  return token;
};

export const createInvitation = onCall(async (request) => {
  const administrator = await requireAdmin(request);
  if (!administrator.organizationId) throw new HttpsError("failed-precondition", "Complete organization setup first.");
  try {
    const token = await createInvitationRecord({
      organizationId: administrator.organizationId,
      email: request.data?.email,
      name: request.data?.name,
      role: request.data?.role,
      createdBy: request.auth.uid,
      metadata: request.data?.metadata || {}
      ,inviteBaseUrl: String(request.data?.inviteBaseUrl || "")
    });
    return { token, expiresInDays: 7 };
  } catch (error) {
    throw new HttpsError("invalid-argument", error.message);
  }
});

export const bulkCreateInvitations = onCall(async (request) => {
  const administrator = await requireAdmin(request);
  const rows = Array.isArray(request.data?.rows) ? request.data.rows.slice(0, 500) : [];
  if (!administrator.organizationId || !rows.length) {
    throw new HttpsError("invalid-argument", "Organization setup and at least one row are required.");
  }
  const invitations = [];
  const errors = [];
  for (let index = 0; index < rows.length; index += 1) {
    try {
      const row = rows[index] || {};
      const token = await createInvitationRecord({
        organizationId: administrator.organizationId,
        email: row.email,
        name: row.name,
        role: row.role,
        createdBy: request.auth.uid,
        metadata: {
          usn: String(row.usn || "").trim(),
          department: String(row.department || "").trim(),
          program: String(row.program || "").trim(),
          batch: String(row.batch || "").trim()
        },
        inviteBaseUrl: String(request.data?.inviteBaseUrl || "")
      });
      invitations.push({ row: index + 2, email: String(row.email || "").trim().toLowerCase(), token });
    } catch (error) {
      errors.push({ row: index + 2, error: error.message });
    }
  }
  return { invitations, errors };
});

export const previewInvitation = onCall(async (request) => {
  const token = String(request.data?.token || "");
  const invitation = await db.collection("invitations").doc(invitationHash(token)).get();
  if (!invitation.exists) throw new HttpsError("not-found", "Invitation not found.");
  const data = invitation.data();
  if (data.status !== "pending" || new Date(data.expiresAt).getTime() <= Date.now()) {
    throw new HttpsError("failed-precondition", "This invitation is no longer valid.");
  }
  const organization = await db.collection("organizations").doc(data.organizationId).get();
  return { email: data.email, name: data.name, role: data.role, organizationName: organization.data()?.name || "Institution" };
});

export const claimInvitation = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Create and sign in to your account first.");
  const invitationRef = db.collection("invitations").doc(invitationHash(request.data?.token || ""));
  const invitation = await invitationRef.get();
  if (!invitation.exists) throw new HttpsError("not-found", "Invitation not found.");
  const data = invitation.data();
  if (data.status !== "pending" || new Date(data.expiresAt).getTime() <= Date.now()) {
    throw new HttpsError("failed-precondition", "This invitation is no longer valid.");
  }
  const authenticatedEmail = String(request.auth.token.email || "").toLowerCase();
  if (authenticatedEmail !== data.email) throw new HttpsError("permission-denied", "Sign in using the invited email address.");
  await enforceSeatEntitlement(data.organizationId, data.role);
  const now = new Date().toISOString();
  const profile = {
    uid: request.auth.uid,
    email: data.email,
    name: String(request.data?.name || data.name || "").trim().slice(0, 120),
    role: data.role,
    organizationId: data.organizationId,
    usn: String(data.metadata?.usn || "").trim(),
    department: String(data.metadata?.department || "").trim(),
    program: String(data.metadata?.program || "").trim(),
    batch: String(data.metadata?.batch || "").trim(),
    onboardingCompleted: false,
    mustChangePassword: false,
    createdAt: now,
    updatedAt: now
  };
  const batch = db.batch();
  batch.set(db.collection("users").doc(request.auth.uid), profile, { merge: true });
  batch.set(db.collection("memberships").doc(`${data.organizationId}_${request.auth.uid}`), {
    organizationId: data.organizationId,
    userId: request.auth.uid,
    role: data.role,
    status: "active",
    createdAt: now
  });
  batch.update(invitationRef, { status: "accepted", acceptedBy: request.auth.uid, acceptedAt: now });
  await batch.commit();
  return { profile };
});

export const activateOrganization = onCall(async (request) => {
  const administrator = await requireAdmin(request);
  if (!request.auth.token.email_verified && !administrator.legacyVerificationExempt) {
    throw new HttpsError("failed-precondition", "Verify the administrator email before activation.");
  }
  const organizationId = administrator.organizationId;
  if (!organizationId) throw new HttpsError("failed-precondition", "Organization setup is incomplete.");
  const [settings, departments, terms, faculty, students, quizzes] = await Promise.all([
    db.collection("settings").where("organizationId", "==", organizationId).limit(1).get(),
    db.collection("departments").where("organizationId", "==", organizationId).limit(1).get(),
    db.collection("academicTerms").where("organizationId", "==", organizationId).limit(1).get(),
    db.collection("users").where("organizationId", "==", organizationId).where("role", "==", "teacher").limit(1).get(),
    db.collection("users").where("organizationId", "==", organizationId).where("role", "==", "student").limit(1).get(),
    db.collection("quizzes").where("organizationId", "==", organizationId).limit(1).get()
  ]);
  const onboarding = {
    profile: !settings.empty && Boolean(settings.docs[0].data()?.college),
    departments: !departments.empty,
    academicTerm: !terms.empty,
    faculty: !faculty.empty,
    students: !students.empty,
    sampleQuiz: !quizzes.empty
  };
  const missing = Object.entries(onboarding).filter(([, complete]) => !complete).map(([item]) => item);
  if (missing.length) throw new HttpsError("failed-precondition", `Complete these onboarding steps: ${missing.join(", ")}.`);
  await db.collection("organizations").doc(organizationId).set({
    status: "active",
    onboarding,
    activatedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }, { merge: true });
  return { active: true };
});
