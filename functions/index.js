import OpenAI from "openai";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";

initializeApp();
const db = getFirestore();

const openaiApiKey = defineSecret("OPENAI_API_KEY");

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