const OpenAI = require("openai");

const cleanCount = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 10;
  return Math.min(50, Math.max(1, Math.round(parsed)));
};

const normalizeQuestions = (questions) => {
  if (!Array.isArray(questions)) return [];

  return questions
    .map((question) => {
      const type = ["single", "multiple", "truefalse", "fill", "numerical", "descriptive", "case-study"].includes(question.type)
        ? question.type
        : "single";
      const options = Array.isArray(question.options)
        ? question.options.map((option) => String(option || "").trim()).filter(Boolean).slice(0, 4)
        : [];

      if (!String(question.text || "").trim()) {
        return null;
      }

      if (["single", "multiple", "truefalse"].includes(type) && options.length !== 4) {
        return null;
      }

      const correctAnswers = Array.isArray(question.correctAnswers)
        ? question.correctAnswers.map(Number).filter((value) => value >= 0 && value <= 3)
        : [Number(question.correctAnswer ?? 0)].filter((value) => value >= 0 && value <= 3);

      const answer = correctAnswers[0] ?? 0;

      return {
        text: String(question.text).trim(),
        caseText: String(question.caseText || "").trim(),
        options: ["single", "multiple", "truefalse"].includes(type) ? options : [],
        type,
        correctAnswer: answer,
        correctAnswers: type === "multiple" ? [...new Set(correctAnswers)].slice(0, 4) : [answer],
        expectedAnswer: String(question.expectedAnswer || "").trim(),
        answerGuidelines: String(question.answerGuidelines || "").trim(),
        tolerance: Math.max(0, Number(question.tolerance) || 0),
        points: Math.max(0.01, Number(question.points) || 1),
        negativeMarks: Math.max(0, Number(question.negativeMarks) || 0),
        partialMarking: type === "multiple" ? Boolean(question.partialMarking) : false,
        difficulty: ["easy", "medium", "difficult"].includes(question.difficulty)
          ? question.difficulty
          : "medium",
        bloomLevel: ["remember", "understand", "apply", "analyze", "evaluate", "create"].includes(question.bloomLevel)
          ? question.bloomLevel
          : "understand",
        co: String(question.co || "").trim(),
        po: String(question.po || "").trim(),
        tags: Array.isArray(question.tags)
          ? question.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 6)
          : []
      };
    })
    .filter(Boolean);
};

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Method not allowed" })
    };
  }

  if (!process.env.OPENAI_API_KEY) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "OPENAI_API_KEY is not configured in Netlify." })
    };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const topic = String(body.topic || "").trim();
    const sourceText = String(body.sourceText || body.content || "").trim().slice(0, 24000);
    const count = cleanCount(body.count);
    const mix = String(body.mix || "balanced").trim();

    if (!topic && !sourceText) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Provide a topic or source text." })
      };
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";

    const response = await client.responses.create({
      model,
      input: [
        {
          role: "system",
          content: "You generate accurate, concise quiz questions for teachers."
        },
        {
          role: "user",
          content: `
Create ${count} exam-ready questions for a college quiz app.

Topic:
${topic || "Use the source text below."}

Source text:
${sourceText || "No source text provided."}

Requested mix:
${mix}

Rules:
- Return only valid JSON matching the schema.
- Allowed types: single, multiple, truefalse, fill, numerical, descriptive, case-study.
- For single, multiple, and truefalse questions, use exactly 4 options.
- For multiple-correct questions, include all correct option indexes in correctAnswers.
- For fill and numerical questions, include expectedAnswer. For numerical, include tolerance if useful.
- For descriptive and case-study questions, include answerGuidelines.
- For case-study questions, include a short caseText plus the question text.
- Distribute difficulty as easy, medium, and difficult when count allows.
- Map every question to Bloom's taxonomy.
- Add CO/PO labels when inferable, such as CO1 and PO1. Use empty strings if not inferable.
- Do not include explanations.
- Do not copy long passages verbatim.
- Keep every question clear and exam-ready.
`
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "quiz_questions",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              questions: {
                type: "array",
                minItems: 1,
                maxItems: 50,
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    text: { type: "string" },
                    caseText: { type: "string" },
                    options: {
                      type: "array",
                      maxItems: 4,
                      items: { type: "string" }
                    },
                    type: {
                      type: "string",
                      enum: ["single", "multiple", "truefalse", "fill", "numerical", "descriptive", "case-study"]
                    },
                    correctAnswer: { type: "integer", minimum: 0, maximum: 3 },
                    correctAnswers: {
                      type: "array",
                      minItems: 1,
                      maxItems: 4,
                      items: { type: "integer", minimum: 0, maximum: 3 }
                    },
                    expectedAnswer: { type: "string" },
                    answerGuidelines: { type: "string" },
                    tolerance: { type: "number" },
                    points: { type: "number" },
                    negativeMarks: { type: "number" },
                    partialMarking: { type: "boolean" },
                    difficulty: { type: "string", enum: ["easy", "medium", "difficult"] },
                    bloomLevel: {
                      type: "string",
                      enum: ["remember", "understand", "apply", "analyze", "evaluate", "create"]
                    },
                    co: { type: "string" },
                    po: { type: "string" },
                    tags: {
                      type: "array",
                      maxItems: 6,
                      items: { type: "string" }
                    }
                  },
                  required: [
                    "text",
                    "caseText",
                    "options",
                    "type",
                    "correctAnswer",
                    "correctAnswers",
                    "expectedAnswer",
                    "answerGuidelines",
                    "tolerance",
                    "points",
                    "negativeMarks",
                    "partialMarking",
                    "difficulty",
                    "bloomLevel",
                    "co",
                    "po",
                    "tags"
                  ]
                }
              }
            },
            required: ["questions"]
          }
        }
      }
    });

    const parsed = JSON.parse(response.output_text || "{}");
    const questions = normalizeQuestions(parsed.questions).slice(0, count);

    if (!questions.length) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "AI did not return valid questions. Try a clearer topic or longer source text." })
      };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questions })
    };
  } catch (error) {
    console.error(error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: error.message || "AI generation failed." })
    };
  }
};
