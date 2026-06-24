import { useState, useEffect, useRef } from "react";

import { auth, firestore } from "./firebase";

import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signOut
} from "firebase/auth";

import {
  collection,
  getDocs,
  getDoc,
  addDoc,
  doc,
  setDoc,
  deleteDoc,
  updateDoc,
  onSnapshot
} from "firebase/firestore";

const genId = () => Math.random().toString(36).substr(2, 9);
const genCode = (prefix) => prefix + Math.random().toString(36).substr(2, 5).toUpperCase();
const shuffleArray = (items) => {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};

const normalizeCorrectAnswers = (question) => {
  if (Array.isArray(question.correctAnswers)) return question.correctAnswers.map(Number).sort();
  return [Number(question.correctAnswer ?? 0)];
};

const normalizeQuestionType = (question) => question?.type || (normalizeCorrectAnswers(question || {}).length > 1 ? "multiple" : "single");
const isChoiceQuestion = (question) => ["single", "multiple", "truefalse"].includes(normalizeQuestionType(question));
const isTextQuestion = (question) => ["fill", "numerical", "descriptive", "case-study"].includes(normalizeQuestionType(question));
const questionTypeLabel = (type) => ({
  single: "Single Correct MCQ",
  multiple: "Multiple Correct MCQ",
  truefalse: "True/False",
  fill: "Fill in the Blank",
  numerical: "Numerical",
  descriptive: "Descriptive",
  "case-study": "Case Study"
}[type] || "Question");

const scoreQuestion = (question, answer) => {
  const type = normalizeQuestionType(question);
  if (type === "fill") {
    const expected = String(question.expectedAnswer || question.answer || "").trim().toLowerCase();
    const given = String(answer || "").trim().toLowerCase();
    return expected && given === expected ? (Number(question.points) || 1) : 0;
  }
  if (type === "numerical") {
    const expected = Number(question.expectedAnswer ?? question.answer);
    const given = Number(answer);
    const tolerance = Math.abs(Number(question.tolerance) || 0);
    if (!Number.isFinite(expected) || !Number.isFinite(given)) return 0;
    return Math.abs(expected - given) <= tolerance ? (Number(question.points) || 1) : 0;
  }
  if (!isChoiceQuestion(question)) return 0;
  const correct = normalizeCorrectAnswers(question);
  const selected = (Array.isArray(answer) ? answer : answer === undefined ? [] : [answer]).map(Number).sort();
  const points = Number(question.points) || 1;
  const negative = Math.abs(Number(question.negativeMarks) || 0);
  if (!selected.length) return 0;
  if (selected.length === correct.length && selected.every((value, index) => value === correct[index])) return points;
  if (question.partialMarking && correct.length > 1) {
    const valid = selected.filter(value => correct.includes(value)).length;
    const invalid = selected.filter(value => !correct.includes(value)).length;
    return Math.max(-negative, (valid / correct.length) * points - invalid * negative);
  }
  return negative ? -negative : 0;
};

const prepareStudentQuiz = (quiz) => {
  let questions = (quiz.questions || []).map(question => {
    if (!isChoiceQuestion(question) || !Array.isArray(question.options)) return { ...question };
    const correct = normalizeCorrectAnswers(question);
    if (!quiz.shuffleOptions) return { ...question, correctAnswers: correct };
    const indexed = question.options.map((text, originalIndex) => ({ text, originalIndex }));
    const shuffled = shuffleArray(indexed);
    return {
      ...question,
      options: shuffled.map(option => option.text),
      correctAnswers: shuffled
        .map((option, index) => correct.includes(option.originalIndex) ? index : null)
        .filter(index => index !== null)
    };
  });
  if (quiz.shuffleQuestions) questions = shuffleArray(questions);
  return { ...quiz, questions };
};

const getQuizMaximumScore = (quiz) =>
  (quiz?.questions || []).reduce((total, question) => total + (Number(question.points) || 1), 0);
const formatDuration = (seconds) => {
  const total = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}m ${String(rest).padStart(2, "0")}s`;
};
const escapeHtml = (value = "") => String(value)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#039;");

const getInstitutionInfo = (faculty = {}, course = {}, quiz = {}) => ({
  college: faculty.college || course.college || quiz.college || "Institution",
  department: faculty.department || course.department || quiz.department || "Department",
  facultyName: faculty.name || quiz.facultyName || "",
  designation: faculty.designation || "",
  employeeId: faculty.employeeId || "",
  courseName: course.name || "",
  quizTitle: quiz.title || "",
  logoUrl: faculty.logoUrl || course.logoUrl || quiz.logoUrl || ""
});

const institutionHeaderHtml = (info, title = "") => `
  <header style="text-align:center;border-bottom:2px solid #111827;margin-bottom:20px;padding-bottom:12px">
    ${info.logoUrl ? `<img src="${escapeHtml(info.logoUrl)}" alt="Logo" style="max-height:64px;margin-bottom:8px">` : ""}
    <h1 style="margin:0;font-size:22px">${escapeHtml((info.college || "Institution").toUpperCase())}</h1>
    <h2 style="margin:4px 0 8px;font-size:16px">${escapeHtml((info.department || "Department").toUpperCase())}</h2>
    ${title ? `<h3 style="margin:8px 0 4px;font-size:15px">${escapeHtml(title)}</h3>` : ""}
    <p style="margin:2px 0;color:#475569">Faculty: ${escapeHtml(info.designation ? `${info.designation} ${info.facultyName}` : info.facultyName || "-")}</p>
    <p style="margin:2px 0;color:#475569">Course: ${escapeHtml(info.courseName || "-")} | Quiz: ${escapeHtml(info.quizTitle || "-")}</p>
    <p style="margin:2px 0;color:#64748b">Date Generated: ${escapeHtml(new Date().toLocaleString())}</p>
  </header>`;


//  Shared UI 
const roleColor = { admin: "#dc2626", teacher: "#2563eb", student: "#059669" };
const roleBg    = { admin: "#fef2f2", teacher: "#eff6ff", student: "#ecfdf5" };

const Badge = ({ role }) => (
  <span style={{ background: roleBg[role], color: roleColor[role], padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>{role}</span>
);

const Btn = ({ children, onClick, variant = "primary", size = "md", disabled, style = {} }) => {
  const base = { border: "none", cursor: disabled ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 600, borderRadius: 8, transition: "all .15s", display: "inline-flex", alignItems: "center", gap: 6, opacity: disabled ? 0.55 : 1, padding: size === "sm" ? "6px 12px" : size === "lg" ? "12px 28px" : "9px 20px", fontSize: size === "sm" ? 13 : 15, ...style };
  const variants = { primary: { background: "#1e293b", color: "#fff" }, danger: { background: "#dc2626", color: "#fff" }, ghost: { background: "transparent", color: "#475569", border: "1.5px solid #e2e8f0" }, success: { background: "#059669", color: "#fff" }, outline: { background: "#fff", color: "#1e293b", border: "1.5px solid #1e293b" }, purple: { background: "#7c3aed", color: "#fff" } };
  return <button onClick={disabled ? undefined : onClick} style={{ ...base, ...variants[variant] }}>{children}</button>;
};

const Card = ({ children, style = {}, ...props }) => (
  <div style={{ background: "#fff", borderRadius: 14, border: "1.5px solid #e2e8f0", padding: 24, ...style }} {...props}>{children}</div>
);

const Modal = ({ title, onClose, children, wide }) => (
  <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
    <div style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: wide ? 680 : 480, maxHeight: "92vh", overflow: "auto", boxShadow: "0 25px 60px rgba(0,0,0,.3)" }}>
      <div style={{ padding: "18px 24px", borderBottom: "1.5px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontWeight: 700, fontSize: 17, color: "#1e293b" }}>{title}</span>
        <button onClick={onClose} aria-label="Close" title="Close" style={{ background: "none", border: "none", fontSize: 24, cursor: "pointer", color: "#94a3b8", fontWeight: 700, lineHeight: 1 }}>X</button>
      </div>
      <div style={{ padding: 24 }}>{children}</div>
    </div>
  </div>
);

const Input = ({ label, ...props }) => (
  <div style={{ marginBottom: 16 }}>
   {label && <label style={{ display: "block", marginBottom: 6, fontWeight: 600, fontSize: 13, color: "#374151" }}>{label}</label>}
    <input {...props} style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1.5px solid #d1d5db", fontSize: 14, fontFamily: "inherit", boxSizing: "border-box", ...(props.style||{}) }} />
  </div>
);

const Textarea = ({ label, ...props }) => (
  <div style={{ marginBottom: 16 }}>
   {label && <label style={{ display: "block", marginBottom: 6, fontWeight: 600, fontSize: 13, color: "#374151" }}>{label}</label>}
    <textarea {...props} style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1.5px solid #d1d5db", fontSize: 14, fontFamily: "inherit", boxSizing: "border-box", resize: "vertical", minHeight: 80, ...(props.style||{}) }} />
  </div>
);

const Select = ({ label, options, ...props }) => (
  <div style={{ marginBottom: 16 }}>
   {label && <label style={{ display: "block", marginBottom: 6, fontWeight: 600, fontSize: 13, color: "#374151" }}>{label}</label>}
    <select {...props} style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1.5px solid #d1d5db", fontSize: 14, fontFamily: "inherit", background: "#fff", boxSizing: "border-box" }}>
     {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </div>
);

const Stat = ({ label, value, icon, color = "#1e293b" }) => (
  <Card style={{ flex: 1, minWidth: 120 }}>
    <div style={{ fontSize: 26, marginBottom: 6 }}>{icon}</div>
    <div style={{ fontSize: 30, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
    <div style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>{label}</div>
  </Card>
);

//  Credentials Panel (admin only, post-login) 
const maskEmail = (email) => {
  const [local, domain] = email.split("@");
  return local.slice(0, 2) + "*".repeat(Math.max(3, local.length - 2)) + "@" + domain;
};

const CredentialsPanel = ({ db }) => {
  const [revealed, setRevealed] = useState({});
  const [activeRole, setActiveRole] = useState("teacher");

  const toggle = (id) => setRevealed(prev => ({ ...prev, [id]: !prev[id] }));
  const revealAll = () => {
    const ids = db.users.filter(u => u.role === activeRole).reduce((acc, u) => ({ ...acc, [u.id]: true }), {});
    setRevealed(ids);
  };
  const hideAll = () => setRevealed({});

  const users = db.users.filter(u => u.role === activeRole);

  const tabStyle = (role) => ({
    padding: "7px 18px", borderRadius: 8, fontWeight: 600, fontSize: 13,
    cursor: "pointer", border: "1.5px solid",
    background: activeRole === role ? roleColor[role] : "#fff",
    color: activeRole === role ? "#fff" : roleColor[role],
    borderColor: roleColor[role],
    transition: "all .15s",
  });

  return (
    <>
     {/* Warning banner */}
      <div style={{ background: "#fef3c7", border: "1.5px solid #fbbf24", borderRadius: 10, padding: "10px 16px", marginBottom: 24, display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 18 }}></span>
        <span style={{ fontSize: 13, color: "#92400e", fontWeight: 500 }}>
          This section is visible to admins only. Login credentials are sensitive  handle with care.
        </span>
      </div>

     {/* Role tabs */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, alignItems: "center" }}>
        <button style={tabStyle("teacher")} onClick={() => { setActiveRole("teacher"); setRevealed({}); }}> Teachers</button>
        <button style={tabStyle("student")} onClick={() => { setActiveRole("student"); setRevealed({}); }}> Students</button>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <Btn size="sm" variant="ghost" onClick={revealAll}> Show All</Btn>
          <Btn size="sm" variant="ghost" onClick={hideAll}> Hide All</Btn>
        </div>
      </div>

     {/* Table */}
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ background: "#f8fafc", borderBottom: "1.5px solid #e2e8f0" }}>
             {["Name", "Email", "Password", "Role", "Reveal"].map(h => (
                <th key={h} style={{ padding: "11px 16px", textAlign: "left", fontWeight: 700, fontSize: 12, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
           {users.map((u, i) => {
              const show = !!revealed[u.id];
              return (
                <tr key={u.id} style={{ borderBottom: i < users.length - 1 ? "1px solid #f1f5f9" : "none", background: show ? "#f0fdf4" : "#fff", transition: "background .2s" }}>
                  <td style={{ padding: "12px 16px", fontWeight: 600, color: "#1e293b" }}>{u.name}</td>
                  <td style={{ padding: "12px 16px", fontFamily: "monospace", fontSize: 13, color: show ? "#0f172a" : "#94a3b8" }}>
                   {show ? u.email : maskEmail(u.email)}
                  </td>
                  <td style={{ padding: "12px 16px", fontFamily: "monospace", fontSize: 13, color: show ? "#0f172a" : "#94a3b8" }}>
                   {show ? u.password : ""}
                  </td>
                  <td style={{ padding: "12px 16px" }}><Badge role={u.role} /></td>
                  <td style={{ padding: "12px 16px" }}>
                    <button
                      onClick={() => toggle(u.id)}
                      title={show ? "Hide credentials" : "Reveal credentials"}
                      style={{ background: show ? "#dcfce7" : "#f1f5f9", border: "none", borderRadius: 6, padding: "5px 12px", cursor: "pointer", fontSize: 13, fontWeight: 600, color: show ? "#059669" : "#475569", transition: "all .15s" }}
                    >
                     {show ? " Hide" : " Show"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </>
  );
};

//  QR Code Modal 
const QRModal = ({ title, code, description, onClose }) => {
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    if (window.QRious) {
      generateQR();
    } else {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrious/4.0.2/qrious.min.js';
      script.async = true;
      script.onerror = () => console.error('Failed to load QR library');
      script.onload = () => { setTimeout(generateQR, 100); };
      document.body.appendChild(script);
    }
    function generateQR() {
      try {
        if (window.QRious) {
          new window.QRious({
            element: canvasRef.current,
            value: `https://quizly-live-app.netlify.app/?code=${code}`,
            size: 280, level: 'H', background: '#ffffff', foreground: '#0f172a',
          });
        }
      } catch (e) { console.error('QR Generation Error:', e); }
    }
  }, [code]);

  const copy = () => {
    navigator.clipboard?.writeText(code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Modal title={`QR Code  ${title}`} onClose={onClose}>
      <div style={{ textAlign: "center" }}>
        <p style={{ color: "#64748b", fontSize: 14, margin: "0 0 20px" }}>{description}</p>
        <div style={{ display: "inline-block", padding: 20, background: "#fff", borderRadius: 16, border: "3px solid #0f172a", marginBottom: 24, boxShadow: "0 10px 30px rgba(0,0,0,.15)" }}>
          <canvas ref={canvasRef} style={{ display: "block", borderRadius: 8 }} />
        </div>
        <div style={{ background: "#0f172a", borderRadius: 12, padding: "16px 24px", marginBottom: 16, display: "inline-flex", alignItems: "center", gap: 16 }}>
          <div>
            <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Join Code</div>
            <div style={{ fontSize: 26, fontWeight: 900, color: "#f8fafc", letterSpacing: 3, fontFamily: "monospace" }}>{code}</div>
          </div>
          <button onClick={copy} style={{ background: copied ? "#059669" : "#1e40af", border: "none", borderRadius: 8, color: "#fff", padding: "8px 14px", cursor: "pointer", fontFamily: "inherit", fontWeight: 600, fontSize: 13, transition: "all .2s" }}>
           {copied ? " Copied" : "Copy"}
          </button>
        </div>
                <p style={{ fontSize: 13, color: "#94a3b8", margin: "0 0 18px" }}>Students scan this QR code or enter the code manually to access this content.</p>
        <Btn variant="ghost" onClick={onClose} style={{ justifyContent: "center" }}>Close</Btn>
      </div>
    </Modal>
  );
};

//  Sidebar 
const Sidebar = ({ user, activeTab, setTab, tabs, onLogout }) => (
  <div style={{ width: 240, minHeight: "100vh", background: "#0f172a", display: "flex", flexDirection: "column", padding: "0 0 24px", flexShrink: 0 }}>
    <div style={{ padding: "28px 20px 20px", borderBottom: "1px solid #1e293b" }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: "#fff", letterSpacing: -0.5 }}> Quizly</div>
      <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 38, height: 38, borderRadius: "50%", background: roleColor[user.role], display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 15, flexShrink: 0 }}>{user.name[0]}</div>
        <div>
          <div style={{ color: "#f1f5f9", fontWeight: 600, fontSize: 13 }}>{user.name}</div>
          <Badge role={user.role} />
        </div>
      </div>
    </div>
    <nav style={{ flex: 1, padding: "16px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
     {tabs.map(t => (
        <button key={t.id} onClick={() => setTab(t.id)} style={{ background: activeTab === t.id ? "#1e40af" : "transparent", color: activeTab === t.id ? "#fff" : "#94a3b8", border: "none", cursor: "pointer", padding: "10px 14px", borderRadius: 8, textAlign: "left", fontFamily: "inherit", fontWeight: 600, fontSize: 14, display: "flex", alignItems: "center", gap: 10, transition: "all .15s" }}>
          <span style={{ fontSize: 18 }}>{t.icon}</span>{t.label}
        </button>
      ))}
    </nav>
    <div style={{ padding: "0 12px" }}>
      <button onClick={onLogout} style={{ width: "100%", background: "transparent", color: "#94a3b8", border: "1px solid #334155", padding: "9px 14px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: 600, fontSize: 14, textAlign: "left" }}> Logout</button>
    </div>
  </div>
);

//  ADMIN MODULE 
const AdminApp = ({ db, setDb, user, onLogout }) => {
  const [tab, setTab]     = useState("overview");
  const [modal, setModal] = useState(null);
  const [form, setForm]   = useState({});
  const [err, setErr]     = useState("");
  const [qrTarget, setQrTarget] = useState(null);

  const teachers = db.users.filter(u => u.role === "teacher");

  //  "Credentials" tab only appears for admin 
  const tabs = [
   { id: "overview",     label: "Overview",     icon: "" },
   { id: "users",        label: "Users",         icon: "" },
   { id: "courses",      label: "Courses",       icon: "" },
   { id: "quizzes",      label: "All Quizzes",   icon: "" },
   { id: "integrity",    label: "Exam Integrity", icon: "" },
   { id: "institution",  label: "Institution", icon: "" },
    ...(user.role === "admin"
      ? [{ id: "credentials", label: "Credentials", icon: "" }]
      : []),
  ];

  const openModal = (type, data = {}) => { setModal(type); setForm(data); setErr(""); };
  const closeModal = () => { setModal(null); setForm({}); setErr(""); };
  const institution = db.settings.find(item => item.id === "institution") || {};

  const saveInstitution = async () => {
    try {
      const data = {
        college: form.college || "",
        department: form.department || "",
        address: form.address || "",
        website: form.website || "",
        accreditation: form.accreditation || "",
        logoUrl: form.logoUrl || "",
        updatedAt: new Date().toISOString()
      };
      await setDoc(doc(firestore, "settings", "institution"), data, { merge: true });
      setDb(d => ({ ...d, settings: [...d.settings.filter(item => item.id !== "institution"), { id: "institution", ...data }] }));
      closeModal();
    } catch (error) {
      alert(error.message);
    }
  };

  const saveUser = async () => {
    try {
      const profile = {
        name: form.name || "",
        email: form.email || "",
        role: form.role || "student",
        usn: form.usn || "",
        college: form.college || "",
        department: form.department || "",
        designation: form.designation || "",
        employeeId: form.employeeId || "",
        logoUrl: form.logoUrl || "",
        updatedAt: new Date().toISOString()
      };
      if (form.id) {
        await setDoc(doc(firestore, "users", form.id), profile, { merge: true });
      } else {
        const cred = await createUserWithEmailAndPassword(auth, form.email, form.password);
        await setDoc(doc(firestore, "users", cred.user.uid), {
          ...profile,
          uid: cred.user.uid,
          createdAt: new Date().toISOString()
        });
      }
      closeModal();
    } catch (error) {
      alert(error.message);
    }
  };

  const deleteUser = async (id) => {
    if (!window.confirm("Delete this user profile?")) return;

    try {
      await deleteDoc(doc(firestore, "users", id));
      setDb(d => ({ ...d, users: d.users.filter(u => u.id !== id) }));
    } catch (err) {
      alert(err.message);
    }
  };

  const saveCourse = async () => {
    if (!form.name || !form.teacherId) return setErr("Name and teacher required.");

    try {
      const courseData = {
        name: form.name,
        description: form.description || "",
        teacherId: form.teacherId,
        joinCode: form.joinCode || genCode("CRS-"),
        createdAt: form.createdAt || new Date().toISOString()
      };

      if (form.id) {
        await setDoc(doc(firestore, "courses", form.id), courseData, { merge: true });
        setDb(d => ({
          ...d,
          courses: d.courses.map(c => c.id === form.id ? { id: form.id, ...courseData } : c)
        }));
      } else {
        const ref = await addDoc(collection(firestore, "courses"), courseData);
        setDb(d => ({
          ...d,
          courses: [...d.courses, { id: ref.id, ...courseData }]
        }));
      }

      closeModal();
    } catch (err) {
      alert(err.message);
    }
  };

  const deleteCourse = async (id) => {
    if (!window.confirm("Delete this course?")) return;

    try {
      const relatedQuizzes = db.quizzes.filter(q => q.courseId === id);
      const relatedQuizIds = relatedQuizzes.map(q => q.id);
      const relatedEnrollments = db.enrollments.filter(e => e.courseId === id);
      const relatedAttempts = db.attempts.filter(a => relatedQuizIds.includes(a.quizId));

      await Promise.all([
        deleteDoc(doc(firestore, "courses", id)),
        ...relatedQuizzes.map(q => deleteDoc(doc(firestore, "quizzes", q.id))),
        ...relatedEnrollments.map(e => deleteDoc(doc(firestore, "enrollments", e.id))),
        ...relatedAttempts.map(a => deleteDoc(doc(firestore, "attempts", a.id)))
      ]);

      setDb(d => ({
        ...d,
        courses: d.courses.filter(c => c.id !== id),
        quizzes: d.quizzes.filter(q => q.courseId !== id),
        enrollments: d.enrollments.filter(e => e.courseId !== id),
        attempts: d.attempts.filter(a => !relatedQuizIds.includes(a.quizId))
      }));

      alert("Course deleted successfully");
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div style={{ display: "flex" }}>
      <Sidebar user={user} activeTab={tab} setTab={setTab} tabs={tabs} onLogout={onLogout} />
      <main style={{ flex: 1, padding: 32, background: "#f8fafc", minHeight: "100vh" }}>

       {tab === "overview" && (
          <>
            <h2 style={{ margin: "0 0 24px", fontWeight: 800, fontSize: 26, color: "#0f172a" }}>Admin Overview</h2>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 32 }}>
              <Stat icon="" label="Teachers"  value={teachers.length}                                      color="#2563eb" />
              <Stat icon=""   label="Students"  value={db.users.filter(u => u.role === "student").length}    color="#059669" />
              <Stat icon=""   label="Courses"   value={db.courses.length}                                    color="#7c3aed" />
              <Stat icon=""   label="Quizzes"   value={db.quizzes.length}                                    color="#d97706" />
              <Stat icon=""   label="Attempts"  value={db.attempts.length}                                   color="#dc2626" />
            </div>
            <Card>
              <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 700 }}>QR-Based Access</h3>
              <p style={{ color: "#64748b", fontSize: 14, margin: "0 0 16px" }}>Each course has a unique QR code. Share it with students to grant access. Students <strong>cannot</strong> browse courses freely  they must scan or enter the code.</p>
              <Btn onClick={() => setTab("courses")}>View Course QR Codes </Btn>
            </Card>
          </>
        )}

       {tab === "users" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <h2 style={{ margin: 0, fontWeight: 800, fontSize: 26, color: "#0f172a" }}>User Management</h2>
              <Btn onClick={() => openModal("user", { role: "student" })}>+ Add User</Btn>
            </div>
           {["teacher", "student"].map(role => (
              <div key={role} style={{ marginBottom: 32 }}>
                <h3 style={{ margin: "0 0 12px", fontWeight: 700, color: roleColor[role], textTransform: "capitalize" }}>
                 {role === "teacher" ? "" : ""} {role}s
                </h3>
                <div style={{ display: "grid", gap: 12 }}>
                 {db.users.filter(u => u.role === role).map(u => (
                    <Card key={u.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 20px" }}>
                      <div>
                        <div style={{ fontWeight: 700, color: "#1e293b" }}>{u.name}</div>
                       {/* Email is masked here  full details only in Credentials tab */}
                        <div style={{ fontSize: 13, color: "#64748b" }}>{maskEmail(u.email)}</div>
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <Btn size="sm" variant="ghost"  onClick={() => openModal("user", { ...u })}>Edit</Btn>
                        <Btn size="sm" variant="danger" onClick={() => deleteUser(u.id)}>Delete</Btn>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}

       {tab === "courses" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <h2 style={{ margin: 0, fontWeight: 800, fontSize: 26, color: "#0f172a" }}>Course Management</h2>
              <Btn onClick={() => openModal("course", {})}>+ Add Course</Btn>
            </div>
            <div style={{ display: "grid", gap: 14 }}>
             {db.courses.map(c => {
                const teacher  = db.users.find(u => u.id === c.teacherId);
                const qCount   = db.quizzes.filter(q => q.courseId === c.id).length;
                const enrolled = db.enrollments.filter(e => e.courseId === c.id).length;
                return (
                  <Card key={c.id}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 16, color: "#1e293b" }}>{c.name}</div>
                        <div style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>{c.description}</div>
                        <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 8, display: "flex", alignItems: "center", gap: 12 }}>
                          <span> {teacher?.name || "Unassigned"}</span>
                          <span> {qCount} quiz{qCount !== 1 ? "zes" : ""}</span>
                          <span> {enrolled} enrolled</span>
                          <span style={{ background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 6, padding: "2px 8px", fontFamily: "monospace", fontWeight: 700, color: "#475569" }}>{c.joinCode}</span>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <Btn size="sm" variant="purple" onClick={() => setQrTarget({ title: c.name, code: c.joinCode, description: `Share this QR to give students access to "${c.name}"` })}> QR Code</Btn>
                        <Btn size="sm" variant="ghost"  onClick={() => openModal("course", { ...c })}>Edit</Btn>
                        <Btn size="sm" variant="danger" onClick={() => deleteCourse(c.id)}>Delete</Btn>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          </>
        )}

       {tab === "quizzes" && (
          <>
            <h2 style={{ margin: "0 0 24px", fontWeight: 800, fontSize: 26, color: "#0f172a" }}>All Quizzes</h2>
           {db.quizzes.length === 0
              ? <Card><p style={{ color: "#94a3b8", textAlign: "center" }}>No quizzes created yet.</p></Card>
              : <div style={{ display: "grid", gap: 14 }}>
               {db.quizzes.map(q => {
                  const course   = db.courses.find(c => c.id === q.courseId);
                  const attempts = db.attempts.filter(a => a.quizId === q.id);
                  const avgScore = attempts.length ? Math.round(attempts.reduce((s, a) => {
                    const maximum = Number(a.maximumScore) || getQuizMaximumScore(q);
                    return s + (maximum ? (Number(a.score) / maximum) * 100 : 0);
                  }, 0) / attempts.length) : null;
                  return (
                    <Card key={q.id}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 16, color: "#1e293b" }}>{q.title}</div>
                          <div style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>{q.description}</div>
                          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 8, display: "flex", gap: 12, alignItems: "center" }}>
                            <span> {course?.name}</span>
                            <span> {q.questions.length} Qs</span>
                            <span> {attempts.length} attempts{avgScore !== null ? `  Avg ${avgScore}%` : ""}</span>
                            <span style={{ background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 6, padding: "2px 8px", fontFamily: "monospace", fontWeight: 700, color: "#475569" }}>{q.joinCode}</span>
                          </div>
                        </div>
                        <Btn size="sm" variant="purple" onClick={() => setQrTarget({ title: q.title, code: q.joinCode, description: `Share this QR so students can directly access the quiz "${q.title}"` })}> QR Code</Btn>
                      </div>
                    </Card>
                  );
                })}
              </div>
            }
          </>
        )}

       {tab === "integrity" && (() => {
          const activeSessions = db.quizSessions.filter(session => session.status === "active");
          const suspiciousStudents = new Set(db.integrityLogs.map(log => log.studentId)).size;
          const autoSubmitted = db.attempts.filter(attempt => attempt.autoSubmitted).length;
          return (
            <>
              <h2 style={{ margin: "0 0 24px", fontWeight: 800, fontSize: 26 }}>Examination Integrity Dashboard</h2>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 24 }}>
                <Stat label="Active Students" value={activeSessions.length} color="#2563eb" />
                <Stat label="Suspicious Students" value={suspiciousStudents} color="#dc2626" />
                <Stat label="Integrity Events" value={db.integrityLogs.length} color="#d97706" />
                <Stat label="Auto Submitted" value={autoSubmitted} color="#7c3aed" />
              </div>
              <Card style={{ padding: 0, overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead><tr style={{ background: "#f8fafc" }}>
                    {["Time", "Student", "USN", "Quiz", "Event", "Violation #"].map(label => <th key={label} style={{ padding: 10, textAlign: "left" }}>{label}</th>)}
                  </tr></thead>
                  <tbody>
                    {[...db.integrityLogs].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 100).map(log => {
                      const quiz = db.quizzes.find(item => item.id === log.quizId);
                      return <tr key={log.id} style={{ borderTop: "1px solid #e2e8f0" }}>
                        <td style={{ padding: 10 }}>{new Date(log.createdAt).toLocaleString()}</td>
                        <td style={{ padding: 10 }}>{log.studentName}</td>
                        <td style={{ padding: 10 }}>{log.studentUSN}</td>
                        <td style={{ padding: 10 }}>{quiz?.title || "-"}</td>
                        <td style={{ padding: 10, color: "#991b1b", fontWeight: 700 }}>{log.type}</td>
                        <td style={{ padding: 10 }}>{log.violationCount}</td>
                      </tr>;
                    })}
                  </tbody>
                </table>
              </Card>
            </>
          );
        })()}

       {tab === "institution" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <h2 style={{ margin: 0, fontWeight: 800, fontSize: 26, color: "#0f172a" }}>Institution Settings</h2>
              <Btn onClick={() => openModal("institution", { ...institution })}>Edit Branding</Btn>
            </div>
            <Card>
              {institution.logoUrl && <img src={institution.logoUrl} alt="College logo" style={{ maxHeight: 72, marginBottom: 14 }} />}
              <h3 style={{ margin: "0 0 6px", fontSize: 20 }}>{institution.college || "College Name Not Set"}</h3>
              <p style={{ margin: "0 0 8px", color: "#475569" }}>{institution.department || "Department Name Not Set"}</p>
              <p style={{ margin: "0 0 4px", color: "#64748b" }}>{institution.address || ""}</p>
              <p style={{ margin: "0 0 4px", color: "#64748b" }}>{institution.website || ""}</p>
              <p style={{ margin: "0", color: "#64748b" }}>{institution.accreditation || ""}</p>
            </Card>
          </>
        )}

       {/*  Credentials tab  admin only, post-login  */}
       {tab === "credentials" && user.role === "admin" && (
          <>
            <h2 style={{ margin: "0 0 24px", fontWeight: 800, fontSize: 26, color: "#0f172a" }}> Login Credentials</h2>
            <CredentialsPanel db={db} />
          </>
        )}

      </main>

     {modal === "user" && (
        <Modal title={form.id ? "Edit User" : "Add User"} onClose={closeModal}>
          <Input label="Full Name"     value={form.name     || ""} onChange={e => setForm({ ...form, name:     e.target.value })} />
          <Input label="FACULTY ID/USN" value={form.usn     || ""} onChange={e => setForm({ ...form, usn:      e.target.value })} />
          <Input label="Email"         value={form.email    || ""} onChange={e => setForm({ ...form, email:    e.target.value })} type="email" />
          <Input label="Password"      value={form.password || ""} onChange={e => setForm({ ...form, password: e.target.value })} />
          <Select label="Role" value={form.role || "student"} onChange={e => setForm({ ...form, role: e.target.value })}
            options={[{ value: "teacher", label: "Teacher" }, { value: "student", label: "Student" }]} />
          {form.role === "teacher" && <>
            <Input label="College Name" value={form.college || ""} onChange={e => setForm({ ...form, college: e.target.value })} />
            <Input label="Department Name" value={form.department || ""} onChange={e => setForm({ ...form, department: e.target.value })} />
            <Input label="Designation" value={form.designation || ""} onChange={e => setForm({ ...form, designation: e.target.value })} />
            <Input label="Employee ID" value={form.employeeId || ""} onChange={e => setForm({ ...form, employeeId: e.target.value })} />
            <Input label="College Logo URL" value={form.logoUrl || ""} onChange={e => setForm({ ...form, logoUrl: e.target.value })} />
          </>}
         {err && <p style={{ color: "#dc2626", fontSize: 13 }}>{err}</p>}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <Btn variant="ghost" onClick={closeModal}>Cancel</Btn>
            <Btn onClick={saveUser}>{form.id ? "Save Changes" : "Add User"}</Btn>
          </div>
        </Modal>
      )}

     {modal === "course" && (
        <Modal title={form.id ? "Edit Course" : "Add Course"} onClose={closeModal}>
          <Input    label="Course Name"   value={form.name        || ""} onChange={e => setForm({ ...form, name:        e.target.value })} />
          <Textarea label="Description"   value={form.description || ""} onChange={e => setForm({ ...form, description: e.target.value })} />
          <Select   label="Assign Teacher" value={form.teacherId  || ""} onChange={e => setForm({ ...form, teacherId:   e.target.value })}
            options={[{ value: "", label: " Select Teacher " }, ...teachers.map(t => ({ value: t.id, label: t.name }))]} />
         {err && <p style={{ color: "#dc2626", fontSize: 13 }}>{err}</p>}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <Btn variant="ghost" onClick={closeModal}>Cancel</Btn>
            <Btn onClick={saveCourse}>{form.id ? "Save Changes" : "Create Course"}</Btn>
          </div>
        </Modal>
      )}

     {modal === "institution" && (
        <Modal title="Institution Branding" onClose={closeModal}>
          <Input label="College Name" value={form.college || ""} onChange={e => setForm({ ...form, college: e.target.value })} />
          <Input label="Department Name" value={form.department || ""} onChange={e => setForm({ ...form, department: e.target.value })} />
          <Textarea label="Address" value={form.address || ""} onChange={e => setForm({ ...form, address: e.target.value })} />
          <Input label="Website" value={form.website || ""} onChange={e => setForm({ ...form, website: e.target.value })} />
          <Input label="Accreditation Details" value={form.accreditation || ""} onChange={e => setForm({ ...form, accreditation: e.target.value })} />
          <Input label="College Logo URL" value={form.logoUrl || ""} onChange={e => setForm({ ...form, logoUrl: e.target.value })} />
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <Btn variant="ghost" onClick={closeModal}>Cancel</Btn>
            <Btn onClick={saveInstitution}>Save Settings</Btn>
          </div>
        </Modal>
      )}

     {qrTarget && <QRModal title={qrTarget.title} code={qrTarget.code} description={qrTarget.description} onClose={() => setQrTarget(null)} />}
    </div>
  );
};

//  TEACHER MODULE 
const TeacherApp = ({ db, setDb, user, onLogout }) => {
  const saveCourse = async () => {
    if (!form.name) return setErr("Course name is required.");

    try {
      const courseData = {
        name: form.name,
        description: form.description || "",
        teacherId: user.id,
        joinCode: form.joinCode || genCode("CRS-"),
        createdAt: form.createdAt || new Date().toISOString()
      };

      if (form.id) {
        await setDoc(doc(firestore, "courses", form.id), courseData, { merge: true });
        setDb(d => ({
          ...d,
          courses: d.courses.map(c => c.id === form.id ? { id: form.id, ...courseData } : c)
        }));
      } else {
        const ref = await addDoc(collection(firestore, "courses"), courseData);
        setDb(d => ({
          ...d,
          courses: [...d.courses, { id: ref.id, ...courseData }]
        }));
      }

      setModal(null);
      setErr("");
    } catch (err) {
      alert(err.message);
    }
  };
  const [tab, setTab]           = useState("overview");
  const [modal, setModal]       = useState(null);
  const [form, setForm]         = useState({});
  const [err, setErr]           = useState("");
  const [editingQuiz, setEditingQuiz] = useState(null);
  const emptyQuestion = {
    text: "", options: ["", "", "", ""], type: "single", correctAnswer: 0,
    correctAnswers: [0], points: 1, negativeMarks: 0, partialMarking: false,
    difficulty: "medium", bloomLevel: "understand", tags: "",
    expectedAnswer: "", answerGuidelines: "", tolerance: 0, caseText: "", co: "", po: ""
  };
  const [questionForm, setQuestionForm] = useState(emptyQuestion);
  const [editingQuestionId, setEditingQuestionId] = useState(null);
  const [importPreview, setImportPreview] = useState([]);
  const [importErrors, setImportErrors] = useState([]);
  const [aiTopic, setAiTopic] = useState("");
  const [aiSourceText, setAiSourceText] = useState("");
  const [aiQuestionCount, setAiQuestionCount] = useState(10);
  const [aiQuestionMix, setAiQuestionMix] = useState("20 MCQs, 5 numerical, 5 descriptive, 2 case-study questions");
  const [aiLoading, setAiLoading] = useState(false);
  const [qrTarget, setQrTarget] = useState(null);
  const [selectedQuizId, setSelectedQuizId] = useState("all");
  const [resultSort, setResultSort] = useState("latest");
  const [bankSearch, setBankSearch] = useState("");
  const [bankDifficulty, setBankDifficulty] = useState("all");
  const [bankBloom, setBankBloom] = useState("all");
  const [bankType, setBankType] = useState("all");

  const myCourses   = db.courses.filter(c => c.teacherId === user.id);
  const myCourseIds = myCourses.map(c => c.id);
  const myQuizzes   = db.quizzes.filter(q => myCourseIds.includes(q.courseId));
  const myQuizIds   = myQuizzes.map(q => q.id);
  const teacherAttempts = db.attempts.filter(a => myQuizIds.includes(a.quizId));
  const institution = db.settings.find(item => item.id === "institution") || {};

  const tabs = [
   { id: "overview", label: "Overview",   icon: "" },
   { id: "courses",  label: "My Courses", icon: "" },
   { id: "quizzes",  label: "My Quizzes", icon: "" },
   { id: "results",  label: "Results",    icon: "" },
   { id: "questionBank", label: "Question Bank", icon: "" },
   { id: "obe", label: "OBE Reports", icon: "" },
   { id: "attendance", label: "Attendance", icon: "" },
    ...(editingQuiz ? [{ id: "editor", label: "Quiz Editor", icon: "" }] : []),
  ];

  const openQuizModal = (data = {}) => {
    setModal("quiz");
    setForm(data.id ? { ...data } : { courseId: myCourseIds[0] || "", title: "", description: "" });
    setErr("");
  };

  const saveQuiz = async () => {
    if (!form.title || !form.courseId) return setErr("Title and course required.");

    try {
      const quizData = {
        title: form.title,
        description: form.description || "",
        courseId: form.courseId,
        teacherId: user.id,
        college: user.college || "",
        department: user.department || "",
        facultyName: user.name || "",
        designation: user.designation || "",
        employeeId: user.employeeId || "",
        logoUrl: form.logoUrl || user.logoUrl || "",
        joinCode: form.joinCode || genCode("QZ-"),
        questions: form.questions || [],
        durationMinutes: Math.max(0, Number(form.durationMinutes) || 0),
        hideIdentityOnScoreboard: Boolean(form.hideIdentityOnScoreboard),
        secureMode: Boolean(form.secureMode),
        maxViolations: Math.max(1, Number(form.maxViolations) || 3),
        shuffleQuestions: Boolean(form.shuffleQuestions),
        shuffleOptions: Boolean(form.shuffleOptions),
        createdAt: form.createdAt || new Date().toISOString()
      };

      if (form.id) {
        await setDoc(doc(firestore, "quizzes", form.id), quizData, { merge: true });
        setDb(d => ({
          ...d,
          quizzes: d.quizzes.map(q => q.id === form.id ? { id: form.id, ...quizData } : q)
        }));
      } else {
        const ref = await addDoc(collection(firestore, "quizzes"), quizData);
        setDb(d => ({
          ...d,
          quizzes: [...d.quizzes, { id: ref.id, ...quizData }]
        }));
      }

      setModal(null);
      setErr("");
    } catch (err) {
      alert(err.message);
    }
  };

  const deleteQuiz = async (id) => {
    if (!window.confirm("Delete this quiz?")) return;

    try {
      const relatedAttempts = db.attempts.filter(a => a.quizId === id);

      await Promise.all([
        deleteDoc(doc(firestore, "quizzes", id)),
        ...relatedAttempts.map(a => deleteDoc(doc(firestore, "attempts", a.id)))
      ]);

      setDb(d => ({
        ...d,
        quizzes: d.quizzes.filter(q => q.id !== id),
        attempts: d.attempts.filter(a => a.quizId !== id)
      }));
      if (editingQuiz?.id === id) { setEditingQuiz(null); setTab("quizzes"); }
    } catch (err) {
      alert(err.message);
    }
  };

  const duplicateQuiz = async (quiz) => {
    try {
      const quizData = {
        ...quiz,
        title: `${quiz.title} (Copy)`,
        joinCode: genCode("QZ-"),
        questions: (quiz.questions || []).map(q => ({ ...q, id: genId() })),
        createdAt: new Date().toISOString()
      };
      delete quizData.id;
      const ref = await addDoc(collection(firestore, "quizzes"), quizData);
      setDb(d => ({ ...d, quizzes: [...d.quizzes, { id: ref.id, ...quizData }] }));
    } catch (error) {
      alert(error.message);
    }
  };

  const deleteTeacherCourse = async (course) => {
    if (course.teacherId !== user.id) return;
    if (!window.confirm(`Delete "${course.name}" and all enrollments, quizzes, and attempts?`)) return;

    const relatedQuizzes = db.quizzes.filter(q => q.courseId === course.id);
    const relatedQuizIds = relatedQuizzes.map(q => q.id);
    const relatedEnrollments = db.enrollments.filter(e => e.courseId === course.id);
    const relatedAttempts = db.attempts.filter(a => relatedQuizIds.includes(a.quizId));

    try {
      await Promise.all([
        deleteDoc(doc(firestore, "courses", course.id)),
        ...relatedQuizzes.map(q => deleteDoc(doc(firestore, "quizzes", q.id))),
        ...relatedEnrollments.map(e => deleteDoc(doc(firestore, "enrollments", e.id))),
        ...relatedAttempts.map(a => deleteDoc(doc(firestore, "attempts", a.id)))
      ]);
      setDb(d => ({
        ...d,
        courses: d.courses.filter(c => c.id !== course.id),
        quizzes: d.quizzes.filter(q => q.courseId !== course.id),
        enrollments: d.enrollments.filter(e => e.courseId !== course.id),
        attempts: d.attempts.filter(a => !relatedQuizIds.includes(a.quizId))
      }));
    } catch (error) {
      alert(error.message);
    }
  };

  const openEditor = (quiz) => {
    setEditingQuiz(quiz);
    setTab("editor");
    setQuestionForm(emptyQuestion);
    setEditingQuestionId(null);
    setImportPreview([]);
    setImportErrors([]);
    setErr("");
  };

  const saveQuestion = async () => {
    const questionType = normalizeQuestionType(questionForm);
    if (!questionForm.text) return setErr("Question text is required.");
    if (["single", "multiple", "truefalse"].includes(questionType) && questionForm.options.some(o => !o)) return setErr("Fill all option fields.");
    if (["fill", "numerical"].includes(questionType) && !String(questionForm.expectedAnswer || "").trim()) return setErr("Expected answer is required.");
    if (["descriptive", "case-study"].includes(questionType) && !String(questionForm.answerGuidelines || "").trim()) return setErr("Answer guidelines are required.");
    const normalizedQuestion = {
      ...questionForm,
      options: ["single", "multiple", "truefalse"].includes(questionType) ? questionForm.options : [],
      type: questionType,
      correctAnswer: questionType === "single" || questionType === "truefalse" ? Number(questionForm.correctAnswer) : Number(questionForm.correctAnswers[0] ?? 0),
      correctAnswers: questionType === "single" || questionType === "truefalse"
        ? [Number(questionForm.correctAnswer)]
        : questionType === "multiple" ? [...new Set(questionForm.correctAnswers.map(Number))].sort() : [],
      points: Math.max(0.01, Number(questionForm.points) || 1),
      negativeMarks: Math.max(0, Number(questionForm.negativeMarks) || 0),
      tolerance: Math.max(0, Number(questionForm.tolerance) || 0),
      tags: String(questionForm.tags || "").split(",").map(tag => tag.trim()).filter(Boolean)
    };
    if (["single", "multiple", "truefalse"].includes(questionType) && !normalizedQuestion.correctAnswers.length) return setErr("Select at least one correct answer.");
    const nextQuestions = editingQuestionId
      ? (currentQuiz?.questions || []).map(q => q.id === editingQuestionId ? { ...q, ...normalizedQuestion } : q)
      : [...(currentQuiz?.questions || []), { id: genId(), ...normalizedQuestion }];

    try {
      await updateDoc(doc(firestore, "quizzes", editingQuiz.id), {
        questions: nextQuestions
      });

      setDb(d => ({
        ...d,
        quizzes: d.quizzes.map(q => q.id === editingQuiz.id ? { ...q, questions: nextQuestions } : q)
      }));
      setEditingQuiz(prev => ({ ...prev, questions: nextQuestions }));
      setQuestionForm(emptyQuestion);
      setEditingQuestionId(null);
      setErr("");
    } catch (err) {
      alert(err.message);
    }
  };

  const editQuestion = (question) => {
    setQuestionForm({
      text: question.text,
      options: [...question.options],
      type: question.type || (normalizeCorrectAnswers(question).length > 1 ? "multiple" : "single"),
      correctAnswer: normalizeCorrectAnswers(question)[0],
      correctAnswers: normalizeCorrectAnswers(question),
      points: Number(question.points) || 1,
      negativeMarks: Number(question.negativeMarks) || 0,
      partialMarking: Boolean(question.partialMarking),
      difficulty: question.difficulty || "medium",
      bloomLevel: question.bloomLevel || "understand",
      tags: Array.isArray(question.tags) ? question.tags.join(", ") : question.tags || "",
      expectedAnswer: question.expectedAnswer || "",
      answerGuidelines: question.answerGuidelines || "",
      tolerance: Number(question.tolerance) || 0,
      caseText: question.caseText || "",
      co: question.co || "",
      po: question.po || ""
    });
    setEditingQuestionId(question.id);
    setErr("");
  };

  const importQuestions = async () => {
    if (!importPreview.length) return;
    const nextQuestions = [...(currentQuiz?.questions || []), ...importPreview];
    try {
      await updateDoc(doc(firestore, "quizzes", editingQuiz.id), { questions: nextQuestions });
      setDb(d => ({
        ...d,
        quizzes: d.quizzes.map(q => q.id === editingQuiz.id ? { ...q, questions: nextQuestions } : q)
      }));
      setEditingQuiz(prev => ({ ...prev, questions: nextQuestions }));
      setImportPreview([]);
      setImportErrors([]);
    } catch (error) {
      alert(error.message);
    }
  };

  const generateQuestionsWithAi = async () => {
    if (!aiTopic.trim() && !aiSourceText.trim()) {
      return setImportErrors(["Enter a topic or syllabus first."]);
    }

    setAiLoading(true);
    setImportErrors([]);

    try {
      const response = await fetch("/.netlify/functions/generate-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: aiTopic.trim(),
          sourceText: aiSourceText.trim(),
          count: Number(aiQuestionCount) || 10,
          mix: aiQuestionMix.trim()
        })
      });

      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "AI generation failed.");

      const questions = (payload.questions || []).map(question => ({
        id: genId(),
        text: question.text,
        caseText: question.caseText || "",
        options: Array.isArray(question.options) ? question.options : [],
        type: question.type || "single",
        correctAnswer: Number(question.correctAnswer ?? 0),
        correctAnswers: Array.isArray(question.correctAnswers) ? question.correctAnswers.map(Number) : [Number(question.correctAnswer ?? 0)],
        expectedAnswer: question.expectedAnswer || "",
        answerGuidelines: question.answerGuidelines || "",
        tolerance: Number(question.tolerance) || 0,
        points: Number(question.points) || 1,
        negativeMarks: Number(question.negativeMarks) || 0,
        partialMarking: Boolean(question.partialMarking),
        difficulty: question.difficulty || "medium",
        bloomLevel: question.bloomLevel || "understand",
        co: question.co || "",
        po: question.po || "",
        tags: Array.isArray(question.tags) && question.tags.length ? question.tags : [aiTopic.trim()].filter(Boolean)
      }));

      if (!questions.length) throw new Error("AI did not return valid questions.");
      setImportPreview(questions);
    } catch (error) {
      setImportErrors([error.message]);
    } finally {
      setAiLoading(false);
    }
  };

  const deleteQuestion = async (qid) => {
    const nextQuestions = (currentQuiz?.questions || []).filter(qq => qq.id !== qid);

    try {
      await updateDoc(doc(firestore, "quizzes", editingQuiz.id), {
        questions: nextQuestions
      });

      setDb(d => ({
        ...d,
        quizzes: d.quizzes.map(q => q.id === editingQuiz.id ? { ...q, questions: nextQuestions } : q)
      }));
      setEditingQuiz(prev => ({ ...prev, questions: nextQuestions }));
    } catch (err) {
      alert(err.message);
    }
  };

  const currentQuiz = editingQuiz ? db.quizzes.find(q => q.id === editingQuiz.id) : null;

  //  Results helpers 
  const filteredAttempts = selectedQuizId === "all"
    ? teacherAttempts
    : teacherAttempts.filter(a => a.quizId === selectedQuizId);

  const deleteAttempt = async (attempt) => {
    if (!window.confirm(`Delete the attempt by ${attempt.studentName || "this student"}?`)) return;
    try {
      await deleteDoc(doc(firestore, "attempts", attempt.id));
      setDb(d => ({ ...d, attempts: d.attempts.filter(a => a.id !== attempt.id) }));
    } catch (error) {
      alert(error.message);
    }
  };

  const getScorePercent = (attempt) => {
    const quiz = db.quizzes.find(q => q.id === attempt.quizId);
    if (!quiz || !quiz.questions.length) return 0;
    const num = typeof attempt.score === "number" ? attempt.score : parseInt(attempt.score, 10);
    const maximum = Number(attempt.maximumScore) || getQuizMaximumScore(quiz);
    return maximum > 0 ? Math.round((num / maximum) * 100) : 0;
  };

  const getScoreColor = (pct) => {
    if (pct >= 80) return { color: "#065f46", bg: "#d1fae5" };
    if (pct >= 50) return { color: "#92400e", bg: "#fef3c7" };
    return { color: "#991b1b", bg: "#fee2e2" };
  };

  const sortedAttempts = [...filteredAttempts].sort((a, b) => {
    if (resultSort === "highest") return getScorePercent(b) - getScorePercent(a);
    if (resultSort === "lowest") return getScorePercent(a) - getScorePercent(b);
    if (resultSort === "nameAsc") return (a.studentName || "").localeCompare(b.studentName || "");
    if (resultSort === "nameDesc") return (b.studentName || "").localeCompare(a.studentName || "");
    if (resultSort === "oldest") return new Date(a.completedAt || 0) - new Date(b.completedAt || 0);
    return new Date(b.completedAt || 0) - new Date(a.completedAt || 0);
  });

  const exportResults = () => {
    const BOM  = "\uFEFF"; // UTF-8 BOM so Excel opens file correctly
    const rows = [["Name", "USN", "Quiz", "Course", "Score", "Score %"]];
    filteredAttempts.forEach(a => {
      const quiz   = db.quizzes.find(q => q.id === a.quizId);
      const course = db.courses.find(c => c.id === quiz?.courseId);
      const pct    = getScorePercent(a);
      const total  = Number(a.maximumScore) || (quiz ? getQuizMaximumScore(quiz) : "?");
      const num    = typeof a.score === "number" ? a.score : parseInt(a.score, 10);
      // "X out of Y" format  plain words that Excel will never misread as a date
      const scoreCell = `${isNaN(num) ? "?" : num} out of ${total}`;
      rows.push([
        a.studentName || "",
        a.studentUSN  || "",
        quiz?.title   || "",
        course?.name  || "",
        scoreCell,
        `${pct}%`,
      ]);
    });
    const csv  = BOM + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = "quiz_results.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const exportResultsPdf = () => {
    const reportQuiz = selectedQuizId === "all" ? myQuizzes[0] : myQuizzes.find(q => q.id === selectedQuizId);
    const reportCourse = db.courses.find(c => c.id === reportQuiz?.courseId);
    const reportFaculty = db.users.find(item => item.id === reportQuiz?.teacherId) || user;
    const reportInfo = getInstitutionInfo({ ...institution, ...reportFaculty }, { ...institution, ...reportCourse }, reportQuiz || {});
    const rows = filteredAttempts.map((a, i) => {
      const quiz = db.quizzes.find(q => q.id === a.quizId);
      const course = db.courses.find(c => c.id === quiz?.courseId);
      const pct = getScorePercent(a);
      const total = Number(a.maximumScore) || (quiz ? getQuizMaximumScore(quiz) : "?");
      const num = typeof a.score === "number" ? a.score : parseInt(a.score, 10);
      return `
        <tr>
          <td>${i + 1}</td>
          <td>${a.studentName || "-"}</td>
          <td>${a.studentUSN || "-"}</td>
          <td>${quiz?.title || "-"}</td>
          <td>${course?.name || "-"}</td>
          <td>${isNaN(num) ? "?" : num} / ${total}</td>
          <td>${pct}%</td>
        </tr>`;
    }).join("");

    const html = `
      <html>
        <head>
          <title>Quiz Results</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; color: #111827; }
            h1 { font-size: 22px; margin-bottom: 4px; }
            p { color: #64748b; margin-top: 0; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 12px; }
            th, td { border: 1px solid #e5e7eb; padding: 8px; text-align: left; }
            th { background: #f8fafc; }
          </style>
        </head>
        <body>
          ${institutionHeaderHtml(reportInfo, "Student Result Sheet")}
          <table>
            <thead><tr><th>#</th><th>Name</th><th>USN</th><th>Quiz</th><th>Course</th><th>Score</th><th>Score %</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="7">No results available.</td></tr>'}</tbody>
          </table>
          <script>window.onload = () => window.print();</script>
        </body>
      </html>`;

    const win = window.open("", "_blank");
    if (!win) {
      alert("Please allow popups to export PDF.");
      return;
    }
    win.document.write(html);
    win.document.close();
  };

  const printAttempt = (attempt) => {
    const quiz = db.quizzes.find(q => q.id === attempt.quizId);
    if (!quiz) return alert("The quiz for this attempt no longer exists.");
    const course = db.courses.find(item => item.id === quiz.courseId);
    const faculty = db.users.find(item => item.id === quiz.teacherId) || user;
    const info = getInstitutionInfo({ ...institution, ...faculty }, { ...institution, ...course }, quiz);
    const questionRows = quiz.questions.map((q, index) => {
      const rawAnswer = attempt.answers?.[index];
      const selected = Array.isArray(rawAnswer) ? rawAnswer : [rawAnswer];
      const selectedText = isChoiceQuestion(q)
        ? selected.filter(value => value !== undefined).map(value => (q.options || [])[Number(value)]).filter(Boolean).join(", ")
        : String(rawAnswer || "");
      const correctText = isChoiceQuestion(q)
        ? normalizeCorrectAnswers(q).map(value => (q.options || [])[value]).filter(Boolean).join(", ")
        : (q.expectedAnswer || q.answerGuidelines || "Manual evaluation required");
      return `
        <section>
          ${q.caseText ? `<p><strong>Case:</strong> ${escapeHtml(q.caseText)}</p>` : ""}
          <h3>Q${index + 1}. ${escapeHtml(q.text)}</h3>
          <p><strong>Type:</strong> ${escapeHtml(questionTypeLabel(normalizeQuestionType(q)))} | <strong>Bloom:</strong> ${escapeHtml(q.bloomLevel || "-")} | <strong>Difficulty:</strong> ${escapeHtml(q.difficulty || "-")}</p>
          <p><strong>Student answer:</strong> ${escapeHtml(selectedText || "Not answered")}</p>
          <p><strong>${isChoiceQuestion(q) ? "Correct answer" : "Expected answer / guidelines"}:</strong> ${escapeHtml(correctText)}</p>
        </section>`;
    }).join("");
    const win = window.open("", "_blank");
    if (!win) return alert("Please allow popups to print the answer sheet.");
    win.document.write(`
      <html><head><title>${escapeHtml(quiz.title)} - Answer Sheet</title>
      <style>
        body{font-family:Arial,sans-serif;padding:32px;color:#111827} header{border-bottom:2px solid #111827;margin-bottom:24px}
        section{break-inside:avoid;border-bottom:1px solid #e5e7eb;padding:10px 0} h3{font-size:15px;margin:0 0 8px}
        p{font-size:13px;margin:4px 0}.meta{display:grid;grid-template-columns:1fr 1fr;gap:8px}
      </style></head><body>
      ${institutionHeaderHtml(info, "Student Answer Sheet")}
      <div class="meta" style="text-align:left">
      <p><strong>Name:</strong> ${escapeHtml(attempt.studentName || "-")}</p>
      <p><strong>USN:</strong> ${escapeHtml(attempt.studentUSN || "-")}</p>
      <p><strong>Score:</strong> ${escapeHtml(attempt.score)} / ${escapeHtml(attempt.maximumScore || getQuizMaximumScore(quiz))}</p>
      <p><strong>Submitted:</strong> ${escapeHtml(attempt.completedAt ? new Date(attempt.completedAt).toLocaleString() : "-")}</p>
      </div>${questionRows}<script>window.onload=()=>window.print()</script></body></html>`);
    win.document.close();
  };

  // Per-quiz summary cards for the results header
  const quizSummaries = myQuizzes.map(q => {
    const attempts = teacherAttempts.filter(a => a.quizId === q.id);
    const avg = attempts.length
      ? Math.round(attempts.reduce((s, a) => s + getScorePercent(a), 0) / attempts.length)
      : null;
    return { quiz: q, attempts, avg };
  }).filter(s => s.attempts.length > 0);

  const questionBank = myQuizzes.flatMap(quiz => (quiz.questions || []).map(question => {
    const course = db.courses.find(item => item.id === quiz.courseId);
    return { ...question, sourceQuizId: quiz.id, sourceQuizTitle: quiz.title, sourceCourseName: course?.name || "" };
  }));
  const filteredQuestionBank = questionBank.filter(question => {
    const text = `${question.text} ${question.sourceQuizTitle} ${question.sourceCourseName} ${Array.isArray(question.tags) ? question.tags.join(" ") : question.tags || ""}`.toLowerCase();
    return (!bankSearch.trim() || text.includes(bankSearch.trim().toLowerCase())) &&
      (bankDifficulty === "all" || (question.difficulty || "medium") === bankDifficulty) &&
      (bankBloom === "all" || (question.bloomLevel || "understand") === bankBloom) &&
      (bankType === "all" || normalizeQuestionType(question) === bankType);
  });
  const bloomLevels = ["remember", "understand", "apply", "analyze", "evaluate", "create"];
  const difficultyLevels = ["easy", "medium", "difficult"];
  const getQuestionPerformance = (quiz, questionIndex) => {
    const attempts = teacherAttempts.filter(item => item.quizId === quiz.id);
    if (!attempts.length) return null;
    const question = quiz.questions?.[questionIndex];
    const scored = attempts.map(attempt => scoreQuestion(question, attempt.answers?.[questionIndex]));
    const max = Number(question?.points) || 1;
    const avg = scored.reduce((sum, value) => sum + value, 0) / attempts.length;
    return Math.round((avg / max) * 100);
  };
  const classifyDifficultyFromPerformance = (pct, fallback) => {
    if (pct === null || pct === undefined) return fallback || "medium";
    if (pct >= 75) return "easy";
    if (pct >= 45) return "medium";
    return "difficult";
  };
  const getOutcomeRows = (field) => {
    const rows = {};
    myQuizzes.forEach(quiz => (quiz.questions || []).forEach((question, index) => {
      const key = String(question[field] || "Unmapped").trim() || "Unmapped";
      const performance = getQuestionPerformance(quiz, index);
      if (!rows[key]) rows[key] = { key, count: 0, scores: [] };
      rows[key].count += 1;
      if (performance !== null) rows[key].scores.push(performance);
    }));
    return Object.values(rows).map(row => ({
      ...row,
      attainment: row.scores.length ? Math.round(row.scores.reduce((sum, value) => sum + value, 0) / row.scores.length) : null
    })).sort((a, b) => a.key.localeCompare(b.key));
  };
  const reuseQuestionInCurrentQuiz = async (question) => {
    if (!currentQuiz) return alert("Open a quiz in the editor before reusing a question.");
    const cleanQuestion = { ...question, id: genId() };
    delete cleanQuestion.sourceQuizId;
    delete cleanQuestion.sourceQuizTitle;
    delete cleanQuestion.sourceCourseName;
    const nextQuestions = [...(currentQuiz.questions || []), cleanQuestion];
    await updateDoc(doc(firestore, "quizzes", currentQuiz.id), { questions: nextQuestions });
    setDb(d => ({ ...d, quizzes: d.quizzes.map(q => q.id === currentQuiz.id ? { ...q, questions: nextQuestions } : q) }));
    setEditingQuiz(prev => ({ ...prev, questions: nextQuestions }));
    alert("Question added to the open quiz.");
  };
  const attendanceRows = myCourses.flatMap(course => {
    const enrollments = db.enrollments.filter(item => item.courseId === course.id);
    const courseQuizzes = myQuizzes.filter(quiz => quiz.courseId === course.id);
    return enrollments.map(enrollment => {
      const student = db.users.find(item => item.id === enrollment.studentId);
      const attempts = teacherAttempts.filter(attempt => courseQuizzes.some(quiz => quiz.id === attempt.quizId) && attempt.studentId === enrollment.studentId);
      return { course, enrollment, student, attempts };
    });
  });

  return (
    <div style={{ display: "flex" }}>
      <Sidebar user={user} activeTab={tab} setTab={t => { setTab(t); if (!["editor", "questionBank"].includes(t)) setEditingQuiz(null); }} tabs={tabs} onLogout={onLogout} />
      <main style={{ flex: 1, padding: 32, background: "#f8fafc", minHeight: "100vh" }}>

       {tab === "overview" && (
          <>
            <h2 style={{ margin: "0 0 24px", fontWeight: 800, fontSize: 26, color: "#0f172a" }}>Welcome, {user.name.split(" ")[0]} </h2>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 32 }}>
              <Stat icon="" label="My Courses"     value={myCourses.length}      color="#2563eb" />
              <Stat icon="" label="My Quizzes"     value={myQuizzes.length}      color="#7c3aed" />
              <Stat icon="" label="Total Attempts" value={teacherAttempts.length} color="#059669" />
            </div>
            <Card>
              <h3 style={{ margin: "0 0 8px", fontWeight: 700 }}>Share Course Access via QR</h3>
              <p style={{ color: "#64748b", fontSize: 14, margin: "0 0 16px" }}>Go to <strong>My Courses</strong> or <strong>My Quizzes</strong> to generate QR codes. Students must scan or enter the code to join.</p>
              <div style={{ display: "flex", gap: 10 }}>
                <Btn onClick={() => setTab("courses")} variant="outline">My Courses </Btn>
                <Btn onClick={() => { setTab("quizzes"); openQuizModal(); }}>+ New Quiz</Btn>
              </div>
            </Card>
          </>
        )}

       {tab === "courses" && (
  <>
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        marginBottom: 16
      }}
    >
      <h2>My Courses</h2>

      <Btn
        onClick={() => {
          setForm({
            title: "",
            code: ""
          });
          setModal("course");
        }}
      >
        + New Course
      </Btn>
    </div>

    <Card>
     {myCourses.length === 0 ? (
        <div
  style={{
    textAlign: "center",
    padding: "40px",
    color: "#64748b"
  }}
>
  No courses assigned yet.
</div>
      ) : (
        myCourses.map(course => (
          <div key={course.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: "1px solid #e2e8f0" }}>
            <div>
              <div style={{ fontWeight: 700 }}>{course.name}</div>
              <div style={{ color: "#64748b", fontSize: 13 }}>{course.description}</div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn size="sm" variant="ghost" onClick={() => { setForm({ ...course }); setModal("course"); }}>Edit</Btn>
              <Btn size="sm" variant="danger" onClick={() => deleteTeacherCourse(course)}>Delete</Btn>
            </div>
          </div>
        ))
      )}
    </Card>
  </>
)}

       {tab === "quizzes" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <h2 style={{ margin: 0, fontWeight: 800, fontSize: 26, color: "#0f172a" }}>My Quizzes</h2>
              <Btn onClick={() => openQuizModal()}>+ New Quiz</Btn>
            </div>
           {myQuizzes.length === 0
              ? <Card><p style={{ color: "#94a3b8", textAlign: "center" }}>No quizzes yet. Click "+ New Quiz".</p></Card>
              : <div style={{ display: "grid", gap: 14 }}>
               {myQuizzes.map(q => {
                  const course   = db.courses.find(c => c.id === q.courseId);
                  const attempts = db.attempts.filter(a => a.quizId === q.id);
                  return (
                    <Card key={q.id}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 700, fontSize: 16, color: "#1e293b" }}>{q.title}</div>
                          <div style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>{q.description}</div>
                          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 8, display: "flex", gap: 12, alignItems: "center" }}>
                            <span> {course?.name}</span>
                            <span> {q.questions.length} questions</span>
                            <span> {attempts.length} attempts</span>
                            <span style={{ background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 6, padding: "2px 8px", fontFamily: "monospace", fontWeight: 700, color: "#475569" }}>{q.joinCode}</span>
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <Btn size="sm" variant="purple"  onClick={() => setQrTarget({ title: q.title, code: q.joinCode, description: `Share this QR so students can directly access "${q.title}"` })}> QR</Btn>
                          <Btn size="sm" variant="outline" onClick={() => openEditor(q)}> Questions</Btn>
                          <Btn size="sm" variant="ghost"   onClick={() => openQuizModal(q)}>Edit</Btn>
                          <Btn size="sm" variant="success" onClick={() => duplicateQuiz(q)}>Duplicate</Btn>
                          <Btn size="sm" variant="danger"  onClick={() => deleteQuiz(q.id)}>Delete</Btn>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            }
          </>
        )}

       {tab === "editor" && currentQuiz && (
          <>
            <button onClick={() => { setTab("quizzes"); setEditingQuiz(null); }} style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontWeight: 600, padding: 0, fontSize: 14, marginBottom: 12 }}> Back to Quizzes</button>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
              <div>
                <h2 style={{ margin: "0 0 4px", fontWeight: 800, fontSize: 24, color: "#0f172a" }}> {currentQuiz.title}</h2>
                <p style={{ margin: 0, color: "#64748b", fontSize: 14 }}>{currentQuiz.questions.length} question{currentQuiz.questions.length !== 1 ? "s" : ""} added</p>
              </div>
              <Btn variant="purple" size="sm" onClick={() => setQrTarget({ title: currentQuiz.title, code: currentQuiz.joinCode, description: `Share this QR so students can directly access "${currentQuiz.title}"` })}> QR Code</Btn>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
              <Card>
                <h3 style={{ margin: "0 0 16px", fontWeight: 700, fontSize: 15 }}>{editingQuestionId ? "Edit Question" : "Add New Question"}</h3>
                <Select label="Question Type" value={questionForm.type} onChange={e => {
                  const type = e.target.value;
                  const defaults = type === "truefalse"
                    ? { options: ["True", "False", "Cannot be determined", "None of the above"], correctAnswer: 0, correctAnswers: [0] }
                    : {};
                  setQuestionForm({ ...questionForm, ...defaults, type, correctAnswers: type === "single" || type === "truefalse" ? [questionForm.correctAnswer] : questionForm.correctAnswers });
                }} options={[
                  { value: "single", label: "Single correct MCQ" },
                  { value: "multiple", label: "Multiple correct MCQ" },
                  { value: "truefalse", label: "True/False" },
                  { value: "fill", label: "Fill in the Blank" },
                  { value: "numerical", label: "Numerical" },
                  { value: "descriptive", label: "Descriptive" },
                  { value: "case-study", label: "Case Study" }
                ]} />
                {questionForm.type === "case-study" && <Textarea label="Case Text" value={questionForm.caseText || ""} onChange={e => setQuestionForm({ ...questionForm, caseText: e.target.value })} placeholder="Enter the case passage or scenario..." />}
                <Textarea label="Question Text" value={questionForm.text} onChange={e => setQuestionForm({ ...questionForm, text: e.target.value })} placeholder="Enter your question..." />
               {["single", "multiple", "truefalse"].includes(questionForm.type) && [0,1,2,3].map(i => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                    <input
                      type={questionForm.type === "multiple" ? "checkbox" : "radio"}
                      name="correct"
                      checked={questionForm.type === "multiple" ? questionForm.correctAnswers.includes(i) : questionForm.correctAnswer === i}
                      onChange={() => {
                        if (questionForm.type === "single") {
                          setQuestionForm({ ...questionForm, correctAnswer: i, correctAnswers: [i] });
                        } else {
                          const selected = questionForm.correctAnswers.includes(i)
                            ? questionForm.correctAnswers.filter(value => value !== i)
                            : [...questionForm.correctAnswers, i];
                          setQuestionForm({ ...questionForm, correctAnswers: selected });
                        }
                      }}
                      style={{ accentColor: "#059669", width: 16, height: 16 }}
                    />
                    <input value={questionForm.options[i]} onChange={e => { const opts = [...questionForm.options]; opts[i] = e.target.value; setQuestionForm({ ...questionForm, options: opts }); }} placeholder={`Option ${String.fromCharCode(65+i)}`}
                      style={{ flex: 1, padding: "7px 10px", border: "1.5px solid #d1d5db", borderRadius: 8, fontSize: 13, fontFamily: "inherit" }} />
                  </div>
                ))}
                {["fill", "numerical"].includes(questionForm.type) && <Input label={questionForm.type === "numerical" ? "Expected Numerical Answer" : "Expected Answer"} value={questionForm.expectedAnswer || ""} onChange={e => setQuestionForm({ ...questionForm, expectedAnswer: e.target.value })} />}
                {questionForm.type === "numerical" && <Input label="Tolerance (+/-)" type="number" min="0" step="0.01" value={questionForm.tolerance || 0} onChange={e => setQuestionForm({ ...questionForm, tolerance: e.target.value })} />}
                {["descriptive", "case-study"].includes(questionForm.type) && <Textarea label="Answer Guidelines / Rubric" value={questionForm.answerGuidelines || ""} onChange={e => setQuestionForm({ ...questionForm, answerGuidelines: e.target.value })} placeholder="Mention key points expected in the answer..." />}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <Input label="Marks" type="number" min="0.01" step="0.25" value={questionForm.points} onChange={e => setQuestionForm({ ...questionForm, points: e.target.value })} />
                  <Input label="Negative Marks" type="number" min="0" step="0.25" value={questionForm.negativeMarks} onChange={e => setQuestionForm({ ...questionForm, negativeMarks: e.target.value })} />
                </div>
                <Select label="Difficulty" value={questionForm.difficulty} onChange={e => setQuestionForm({ ...questionForm, difficulty: e.target.value })} options={["easy", "medium", "difficult"].map(value => ({ value, label: value[0].toUpperCase() + value.slice(1) }))} />
                <Select label="Bloom's Taxonomy" value={questionForm.bloomLevel} onChange={e => setQuestionForm({ ...questionForm, bloomLevel: e.target.value })} options={["remember", "understand", "apply", "analyze", "evaluate", "create"].map(value => ({ value, label: value[0].toUpperCase() + value.slice(1) }))} />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <Input label="Course Outcome (CO)" value={questionForm.co || ""} onChange={e => setQuestionForm({ ...questionForm, co: e.target.value })} placeholder="e.g. CO1" />
                  <Input label="Program Outcome (PO)" value={questionForm.po || ""} onChange={e => setQuestionForm({ ...questionForm, po: e.target.value })} placeholder="e.g. PO2" />
                </div>
                <Input label="Tags (comma separated)" value={questionForm.tags} onChange={e => setQuestionForm({ ...questionForm, tags: e.target.value })} />
                {questionForm.type === "multiple" && <label style={{ display: "flex", gap: 8, marginBottom: 12, fontSize: 13 }}>
                  <input type="checkbox" checked={questionForm.partialMarking} onChange={e => setQuestionForm({ ...questionForm, partialMarking: e.target.checked })} />
                  Enable partial marking
                </label>}
               {err && <p style={{ color: "#dc2626", fontSize: 13, margin: "0 0 10px" }}>{err}</p>}
                <div style={{ display: "flex", gap: 8 }}>
                  <Btn onClick={saveQuestion} variant="success">{editingQuestionId ? "Save Question" : "+ Add Question"}</Btn>
                  {editingQuestionId && <Btn variant="ghost" onClick={() => { setEditingQuestionId(null); setQuestionForm(emptyQuestion); }}>Cancel</Btn>}
                </div>                <div style={{ borderTop: "1px solid #e2e8f0", marginTop: 22, paddingTop: 18 }}>
                  <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>AI Question Generator</h3>
                  <Input label="Topic" value={aiTopic} onChange={e => setAiTopic(e.target.value)} placeholder="e.g. Water, Photosynthesis, Data Structures" />
                  <Textarea label="Syllabus / Content (optional)" value={aiSourceText} onChange={e => setAiSourceText(e.target.value)} placeholder="Paste syllabus points or content here if you want more specific MCQs..." />
                  <Input label="Question Mix" value={aiQuestionMix} onChange={e => setAiQuestionMix(e.target.value)} placeholder="e.g. 20 MCQs, 10 numerical, 5 descriptive" />
                  <Input label="Number of Questions" type="number" min="1" max="50" value={aiQuestionCount} onChange={e => setAiQuestionCount(e.target.value)} />
                  <Btn size="sm" variant="purple" disabled={aiLoading} onClick={generateQuestionsWithAi}>{aiLoading ? "Generating Questions..." : "Generate with AI"}</Btn>
                  <p style={{ fontSize: 11, color: "#64748b" }}>Enter a topic or syllabus. AI can generate MCQs, multiple-correct, numerical, descriptive, and case-study questions with difficulty and Bloom mapping.</p>
                  {importErrors.map(message => <p key={message} style={{ color: "#dc2626", fontSize: 12 }}>{message}</p>)}
                  {importPreview.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <p style={{ fontSize: 13, fontWeight: 700 }}>{importPreview.length} question(s) ready to save.</p>
                      <div style={{ maxHeight: 180, overflow: "auto", background: "#f8fafc", padding: 10, borderRadius: 8 }}>
                        {importPreview.map((q, index) => <div key={q.id} style={{ fontSize: 12, marginBottom: 8 }}><strong>Q{index + 1}.</strong> {q.text}</div>)}
                      </div>
                      <Btn size="sm" onClick={importQuestions} style={{ marginTop: 10 }}>Save AI Questions</Btn>
                    </div>
                  )}
                </div>
              </Card>

              <div>
                <h3 style={{ margin: "0 0 16px", fontWeight: 700, fontSize: 15 }}>Questions ({currentQuiz.questions.length})</h3>
               {currentQuiz.questions.length === 0
                  ? <Card><p style={{ color: "#94a3b8", textAlign: "center", margin: 0 }}>No questions yet.</p></Card>
                  : currentQuiz.questions.map((q, i) => (
                    <Card key={q.id} style={{ marginBottom: 12, padding: "14px 16px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700, marginBottom: 5 }}>{questionTypeLabel(normalizeQuestionType(q))}</div>
                          {q.caseText && <div style={{ fontSize: 13, background: "#f8fafc", padding: 8, borderRadius: 6, marginBottom: 8 }}>{q.caseText}</div>}
                          <div style={{ fontWeight: 700, fontSize: 14, color: "#1e293b", marginBottom: 8 }}>Q{i+1}. {q.text}</div>
                         {isChoiceQuestion(q) && (q.options || []).map((opt, oi) => {
                            const isCorrect = normalizeCorrectAnswers(q).includes(oi);
                            return <div key={oi} style={{ fontSize: 13, padding: "4px 8px", borderRadius: 6, marginBottom: 4, background: isCorrect ? "#d1fae5" : "#f8fafc", color: isCorrect ? "#065f46" : "#475569", fontWeight: isCorrect ? 700 : 400 }}>
                             {String.fromCharCode(65+oi)}. {opt}{isCorrect ? " (Correct)" : ""}
                            </div>
                          })}
                          {!isChoiceQuestion(q) && <div style={{ fontSize: 13, color: "#475569", background: "#f8fafc", padding: 8, borderRadius: 6 }}>
                            {q.expectedAnswer ? `Expected: ${q.expectedAnswer}` : `Guidelines: ${q.answerGuidelines || "Manual evaluation required"}`}
                          </div>}
                          <div style={{ fontSize: 11, color: "#64748b", marginTop: 6 }}>{q.difficulty || "medium"} | {q.bloomLevel || "understand"} | {q.points || 1} mark(s)</div>
                        </div>
                        <div style={{ display: "flex", gap: 6, marginLeft: 8 }}>
                          <Btn size="sm" variant="ghost" onClick={() => editQuestion(q)}>Edit</Btn>
                          <Btn size="sm" variant="danger" onClick={() => deleteQuestion(q.id)}>Delete</Btn>
                        </div>
                      </div>
                    </Card>
                  ))
                }
              </div>
            </div>
          </>
        )}

       {tab === "questionBank" && (
          <>
            <h2 style={{ margin: "0 0 6px", fontWeight: 800, fontSize: 26, color: "#0f172a" }}>Intelligent Question Bank</h2>
            <p style={{ margin: "0 0 20px", color: "#64748b" }}>Subject, unit, difficulty, Bloom level, and tag metadata from all your quizzes in one reusable bank.</p>
            <Card style={{ marginBottom: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 10 }}>
                <Input label="Search" value={bankSearch} onChange={e => setBankSearch(e.target.value)} placeholder="Search question, quiz, course, or tag" />
                <Select label="Difficulty" value={bankDifficulty} onChange={e => setBankDifficulty(e.target.value)} options={[{ value: "all", label: "All" }, ...difficultyLevels.map(level => ({ value: level, label: level }))]} />
                <Select label="Bloom" value={bankBloom} onChange={e => setBankBloom(e.target.value)} options={[{ value: "all", label: "All" }, ...bloomLevels.map(level => ({ value: level, label: level }))]} />
                <Select label="Type" value={bankType} onChange={e => setBankType(e.target.value)} options={[{ value: "all", label: "All" }, ...["single", "multiple", "truefalse", "fill", "numerical", "descriptive", "case-study"].map(type => ({ value: type, label: questionTypeLabel(type) }))]} />
              </div>
            </Card>
            <Card style={{ padding: 0, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead><tr style={{ background: "#f8fafc" }}>
                  {["Question", "Type", "Source", "Difficulty", "Bloom", "Tags", "Action"].map(label => <th key={label} style={{ padding: 10, textAlign: "left" }}>{label}</th>)}
                </tr></thead>
                <tbody>
                  {filteredQuestionBank.length === 0 ? <tr><td colSpan="7" style={{ padding: 18, color: "#94a3b8", textAlign: "center" }}>No matching questions in the bank.</td></tr> : filteredQuestionBank.map(question => (
                    <tr key={`${question.sourceQuizId}-${question.id}`} style={{ borderTop: "1px solid #e2e8f0" }}>
                      <td style={{ padding: 10, fontWeight: 600, color: "#1e293b" }}>{question.text}</td>
                      <td style={{ padding: 10 }}>{questionTypeLabel(normalizeQuestionType(question))}</td>
                      <td style={{ padding: 10, color: "#64748b" }}>{question.sourceCourseName} / {question.sourceQuizTitle}</td>
                      <td style={{ padding: 10 }}>{question.difficulty || "medium"}</td>
                      <td style={{ padding: 10 }}>{question.bloomLevel || "understand"}</td>
                      <td style={{ padding: 10 }}>{Array.isArray(question.tags) ? question.tags.join(", ") : question.tags || "-"}</td>
                      <td style={{ padding: 10 }}><Btn size="sm" variant="outline" onClick={() => reuseQuestionInCurrentQuiz(question)}>Reuse</Btn></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </>
        )}

       {tab === "obe" && (
          <>
            <h2 style={{ margin: "0 0 6px", fontWeight: 800, fontSize: 26, color: "#0f172a" }}>OBE & Bloom Reports</h2>
            <p style={{ margin: "0 0 20px", color: "#64748b" }}>Bloom distribution, difficulty distribution, and performance-based difficulty classification for accreditation review.</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 16, marginBottom: 20 }}>
              <Card>
                <h3 style={{ margin: "0 0 12px" }}>Bloom Taxonomy Mapping</h3>
                {bloomLevels.map(level => {
                  const count = questionBank.filter(question => (question.bloomLevel || "understand") === level).length;
                  return <div key={level} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #f1f5f9" }}><span>{level}</span><strong>{count}</strong></div>;
                })}
              </Card>
              <Card>
                <h3 style={{ margin: "0 0 12px" }}>Difficulty Classification</h3>
                {difficultyLevels.map(level => {
                  const count = questionBank.filter(question => (question.difficulty || "medium") === level).length;
                  return <div key={level} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #f1f5f9" }}><span>{level}</span><strong>{count}</strong></div>;
                })}
              </Card>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 16, marginBottom: 20 }}>
              <Card>
                <h3 style={{ margin: "0 0 12px" }}>CO Attainment</h3>
                {getOutcomeRows("co").map(row => <div key={row.key} style={{ display: "grid", gridTemplateColumns: "1fr 70px 90px", padding: "6px 0", borderBottom: "1px solid #f1f5f9" }}>
                  <span>{row.key}</span><strong>{row.count} Qs</strong><span>{row.attainment === null ? "No data" : `${row.attainment}%`}</span>
                </div>)}
              </Card>
              <Card>
                <h3 style={{ margin: "0 0 12px" }}>PO Attainment</h3>
                {getOutcomeRows("po").map(row => <div key={row.key} style={{ display: "grid", gridTemplateColumns: "1fr 70px 90px", padding: "6px 0", borderBottom: "1px solid #f1f5f9" }}>
                  <span>{row.key}</span><strong>{row.count} Qs</strong><span>{row.attainment === null ? "No data" : `${row.attainment}%`}</span>
                </div>)}
              </Card>
            </div>
            <Card style={{ padding: 0, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead><tr style={{ background: "#f8fafc" }}>
                  {["Quiz", "Question", "CO", "PO", "Bloom", "Set Difficulty", "Performance", "AI/Performance Difficulty"].map(label => <th key={label} style={{ padding: 10, textAlign: "left" }}>{label}</th>)}
                </tr></thead>
                <tbody>
                  {myQuizzes.flatMap(quiz => (quiz.questions || []).map((question, index) => {
                    const performance = getQuestionPerformance(quiz, index);
                    return <tr key={`${quiz.id}-${question.id || index}`} style={{ borderTop: "1px solid #e2e8f0" }}>
                      <td style={{ padding: 10 }}>{quiz.title}</td>
                      <td style={{ padding: 10 }}>{question.text}</td>
                      <td style={{ padding: 10 }}>{question.co || "-"}</td>
                      <td style={{ padding: 10 }}>{question.po || "-"}</td>
                      <td style={{ padding: 10 }}>{question.bloomLevel || "understand"}</td>
                      <td style={{ padding: 10 }}>{question.difficulty || "medium"}</td>
                      <td style={{ padding: 10 }}>{performance === null ? "No attempts" : `${performance}% avg`}</td>
                      <td style={{ padding: 10, fontWeight: 700 }}>{classifyDifficultyFromPerformance(performance, question.difficulty)}</td>
                    </tr>;
                  }))}
                </tbody>
              </table>
            </Card>
          </>
        )}

       {tab === "attendance" && (
          <>
            <h2 style={{ margin: "0 0 6px", fontWeight: 800, fontSize: 26, color: "#0f172a" }}>QR Attendance</h2>
            <p style={{ margin: "0 0 20px", color: "#64748b" }}>Course QR joins and quiz attempts are treated as attendance evidence with timestamps.</p>
            <Card style={{ padding: 0, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead><tr style={{ background: "#f8fafc" }}>
                  {["Course", "Student", "USN", "Joined", "Quiz Attempts", "Last Activity"].map(label => <th key={label} style={{ padding: 10, textAlign: "left" }}>{label}</th>)}
                </tr></thead>
                <tbody>
                  {attendanceRows.length === 0 ? <tr><td colSpan="6" style={{ padding: 18, color: "#94a3b8", textAlign: "center" }}>No QR attendance records yet.</td></tr> : attendanceRows.map(row => {
                    const latest = row.attempts.map(item => item.completedAt).filter(Boolean).sort().pop();
                    return <tr key={row.enrollment.id} style={{ borderTop: "1px solid #e2e8f0" }}>
                      <td style={{ padding: 10 }}>{row.course.name}</td>
                      <td style={{ padding: 10 }}>{row.student?.name || row.enrollment.studentName || "-"}</td>
                      <td style={{ padding: 10 }}>{row.student?.usn || row.enrollment.studentUSN || "-"}</td>
                      <td style={{ padding: 10 }}>{row.enrollment.createdAt ? new Date(row.enrollment.createdAt).toLocaleString() : "-"}</td>
                      <td style={{ padding: 10 }}>{row.attempts.length}</td>
                      <td style={{ padding: 10 }}>{latest ? new Date(latest).toLocaleString() : "-"}</td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </Card>
          </>
        )}

       {/*  Results Tab  */}
       {tab === "results" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <h2 style={{ margin: 0, fontWeight: 800, fontSize: 26, color: "#0f172a" }}> Student Results</h2>
              <div style={{ display: "flex", gap: 8 }}><Btn variant="success" onClick={exportResults}>Export CSV</Btn><Btn variant="outline" onClick={exportResultsPdf}>Export PDF</Btn></div>
            </div>

           {/* Summary cards per quiz */}
           {quizSummaries.length > 0 && (
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 28 }}>
               {quizSummaries.map(({ quiz, attempts, avg }) => (
                  <div
                    key={quiz.id}
                    onClick={() => setSelectedQuizId(selectedQuizId === quiz.id ? "all" : quiz.id)}
                    style={{ flex: "1 1 160px", minWidth: 160, background: selectedQuizId === quiz.id ? "#eff6ff" : "#fff", border: selectedQuizId === quiz.id ? "2px solid #2563eb" : "1.5px solid #e2e8f0", borderRadius: 12, padding: "14px 18px", cursor: "pointer", transition: "all .15s" }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b", marginBottom: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{quiz.title}</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: "#2563eb", lineHeight: 1 }}>{attempts.length}</div>
                    <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>attempt{attempts.length !== 1 ? "s" : ""}{avg !== null ? `  Avg ${avg}%` : ""}</div>
                  </div>
                ))}
               {selectedQuizId !== "all" && (
                  <div onClick={() => setSelectedQuizId("all")} style={{ flex: "0 0 auto", display: "flex", alignItems: "center", padding: "0 16px", background: "#f1f5f9", border: "1.5px solid #e2e8f0", borderRadius: 12, cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#475569" }}>
                    Show All
                  </div>
                )}
              </div>
            )}

            {selectedQuizId !== "all" && (() => {
              const scoreboardQuiz = myQuizzes.find(q => q.id === selectedQuizId);
              const leaders = teacherAttempts
                .filter(a => a.quizId === selectedQuizId)
                .sort((a, b) => getScorePercent(b) - getScorePercent(a) || (Number(a.timeTakenSeconds) || 999999) - (Number(b.timeTakenSeconds) || 999999))
                .slice(0, 10);
              return (
                <Card style={{ marginBottom: 20 }}>
                  <h3 style={{ margin: "0 0 12px" }}>Live Leaderboard: {scoreboardQuiz?.title}</h3>
                  {leaders.length === 0 ? <p style={{ color: "#64748b" }}>Waiting for submissions...</p> : leaders.map((attempt, index) => (
                    <div key={attempt.id} style={{ display: "grid", gridTemplateColumns: "60px 1fr 90px 100px 150px", padding: "8px 0", borderBottom: "1px solid #f1f5f9", gap: 8 }}>
                      <strong>#{index + 1}</strong>
                      <span>{scoreboardQuiz?.hideIdentityOnScoreboard ? `Student ${index + 1}` : attempt.studentName}</span>
                      <strong>{getScorePercent(attempt)}%</strong>
                      <span>{attempt.timeTakenSeconds ? formatDuration(attempt.timeTakenSeconds) : "-"}</span>
                      <span style={{ color: "#64748b", fontSize: 12 }}>{attempt.completedAt ? new Date(attempt.completedAt).toLocaleTimeString() : "Live"}</span>
                    </div>
                  ))}
                </Card>
              );
            })()}

           {/* Filter bar */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Filter by quiz:</label>
              <select
                value={selectedQuizId}
                onChange={e => setSelectedQuizId(e.target.value)}
                style={{ padding: "7px 12px", borderRadius: 8, border: "1.5px solid #d1d5db", fontSize: 13, fontFamily: "inherit", background: "#fff" }}
              >
                <option value="all">All Quizzes ({teacherAttempts.length} attempts)</option>
               {myQuizzes.map(q => {
                  const cnt = teacherAttempts.filter(a => a.quizId === q.id).length;
                  return <option key={q.id} value={q.id}>{q.title} ({cnt})</option>;
                })}
              </select>
              <select
                value={resultSort}
                onChange={e => setResultSort(e.target.value)}
                style={{ padding: "7px 12px", borderRadius: 8, border: "1.5px solid #d1d5db", fontSize: 13, background: "#fff" }}
              >
                <option value="latest">Latest submission</option>
                <option value="oldest">Oldest submission</option>
                <option value="highest">Highest score first</option>
                <option value="lowest">Lowest score first</option>
                <option value="nameAsc">Student name (A-Z)</option>
                <option value="nameDesc">Student name (Z-A)</option>
              </select>
              <span style={{ marginLeft: "auto", fontSize: 13, color: "#64748b" }}>
               {filteredAttempts.length} result{filteredAttempts.length !== 1 ? "s" : ""}
              </span>
            </div>

           {/* Results table */}
           {filteredAttempts.length === 0 ? (
              <Card><p style={{ color: "#94a3b8", textAlign: "center", margin: 0 }}>No attempts recorded yet.</p></Card>
            ) : (
              <Card style={{ padding: 0, overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                  <thead>
                    <tr style={{ background: "#f8fafc", borderBottom: "1.5px solid #e2e8f0" }}>
                     {["#", "Name", "USN", "Quiz", "Course", "Score", "Score %", "Time", "Actions"].map(h => (
                        <th key={h} style={{ padding: "11px 14px", textAlign: "left", fontWeight: 700, fontSize: 12, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                   {sortedAttempts.map((a, i) => {
                      const quiz   = db.quizzes.find(q => q.id === a.quizId);
                      const course = db.courses.find(c => c.id === quiz?.courseId);
                      const pct    = getScorePercent(a);
                      const { color, bg } = getScoreColor(pct);
                      return (
                        <tr key={a.id} style={{ borderBottom: "1px solid #f1f5f9", background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                          <td style={{ padding: "11px 14px", color: "#94a3b8", fontSize: 12 }}>{i + 1}</td>
                          <td style={{ padding: "11px 14px", fontWeight: 600, color: "#1e293b" }}>{a.studentName || ""}</td>
                          <td style={{ padding: "11px 14px", fontFamily: "monospace", fontSize: 13, color: "#475569" }}>{a.studentUSN || ""}</td>
                          <td style={{ padding: "11px 14px", color: "#1e293b" }}>{quiz?.title || ""}</td>
                          <td style={{ padding: "11px 14px", color: "#64748b", fontSize: 13 }}>{course?.name || ""}</td>
                          <td style={{ padding: "11px 14px", fontWeight: 700, color: "#1e293b" }}>
                           {typeof a.score === "number" ? a.score : parseFloat(a.score)} / {a.maximumScore || (quiz ? getQuizMaximumScore(quiz) : "?")}
                          </td>
                          <td style={{ padding: "11px 14px" }}>
                            <span style={{ background: bg, color, borderRadius: 20, padding: "3px 10px", fontSize: 12, fontWeight: 700 }}>{pct}%</span>
                          </td>
                          <td style={{ padding: "11px 14px", color: "#64748b", fontSize: 13 }}>{a.timeTakenSeconds ? formatDuration(a.timeTakenSeconds) : "-"}</td>
                          <td style={{ padding: "11px 14px", display: "flex", gap: 6 }}>
                            <Btn size="sm" variant="outline" onClick={() => printAttempt(a)}>Print</Btn>
                            <Btn size="sm" variant="danger" onClick={() => deleteAttempt(a)}>Delete</Btn>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

               {/* Footer summary */}
               {filteredAttempts.length > 0 && (() => {
                  const avg = Math.round(filteredAttempts.reduce((s, a) => s + getScorePercent(a), 0) / filteredAttempts.length);
                  const high = Math.max(...filteredAttempts.map(a => getScorePercent(a)));
                  const low  = Math.min(...filteredAttempts.map(a => getScorePercent(a)));
                  return (
                    <div style={{ display: "flex", gap: 24, padding: "14px 20px", background: "#f8fafc", borderTop: "1.5px solid #e2e8f0" }}>
                      <span style={{ fontSize: 13, color: "#64748b" }}>Average: <strong style={{ color: "#1e293b" }}>{avg}%</strong></span>
                      <span style={{ fontSize: 13, color: "#64748b" }}>Highest: <strong style={{ color: "#059669" }}>{high}%</strong></span>
                      <span style={{ fontSize: 13, color: "#64748b" }}>Lowest: <strong style={{ color: "#dc2626" }}>{low}%</strong></span>
                      <span style={{ fontSize: 13, color: "#64748b" }}>Total: <strong style={{ color: "#1e293b" }}>{filteredAttempts.length} attempts</strong></span>
                    </div>
                  );
                })()}
              </Card>
            )}
          </>
        )}

      </main>

     {modal === "course" && (
        <Modal title={form.id ? "Edit Course" : "New Course"} onClose={() => setModal(null)}>
          <Input label="Course Name" value={form.name || ""} onChange={e => setForm({ ...form, name: e.target.value })} />
          <Textarea label="Description" value={form.description || ""} onChange={e => setForm({ ...form, description: e.target.value })} />
         {err && <p style={{ color: "#dc2626", fontSize: 13 }}>{err}</p>}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <Btn variant="ghost" onClick={() => setModal(null)}>Cancel</Btn>
            <Btn onClick={saveCourse}>{form.id ? "Save" : "Create Course"}</Btn>
          </div>
        </Modal>
      )}
     {modal === "quiz" && (
        <Modal title={form.id ? "Edit Quiz" : "New Quiz"} onClose={() => setModal(null)}>
          <Input    label="Quiz Title"   value={form.title       || ""} onChange={e => setForm({ ...form, title:       e.target.value })} />
          <Textarea label="Description"  value={form.description || ""} onChange={e => setForm({ ...form, description: e.target.value })} />
          <Select   label="Course"       value={form.courseId    || ""} onChange={e => setForm({ ...form, courseId:    e.target.value })} options={myCourses.map(c => ({ value: c.id, label: c.name }))} />
          <Input label="Institution Logo URL (optional)" value={form.logoUrl || ""} onChange={e => setForm({ ...form, logoUrl: e.target.value })} />
          <Input label="Timer (minutes, 0 = no timer)" type="number" min="0" value={form.durationMinutes || 0} onChange={e => setForm({ ...form, durationMinutes: e.target.value })} />
          <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, fontSize: 13 }}>
            <input type="checkbox" checked={Boolean(form.shuffleQuestions)} onChange={e => setForm({ ...form, shuffleQuestions: e.target.checked })} />
            Randomize question order for each student
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, fontSize: 13 }}>
            <input type="checkbox" checked={Boolean(form.shuffleOptions)} onChange={e => setForm({ ...form, shuffleOptions: e.target.checked })} />
            Randomize option order for each student
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, fontSize: 13 }}>
            <input type="checkbox" checked={Boolean(form.secureMode)} onChange={e => setForm({ ...form, secureMode: e.target.checked })} />
            Enable secure examination mode
          </label>
          {form.secureMode && <Input label="Auto-submit after violations" type="number" min="1" value={form.maxViolations || 3} onChange={e => setForm({ ...form, maxViolations: e.target.value })} />}
          <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16, fontSize: 13 }}>
            <input type="checkbox" checked={Boolean(form.hideIdentityOnScoreboard)} onChange={e => setForm({ ...form, hideIdentityOnScoreboard: e.target.checked })} />
            Hide student identities on live scoreboard
          </label>
         {err && <p style={{ color: "#dc2626", fontSize: 13 }}>{err}</p>}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <Btn variant="ghost" onClick={() => setModal(null)}>Cancel</Btn>
            <Btn onClick={saveQuiz}>{form.id ? "Save" : "Create Quiz"}</Btn>
          </div>
        </Modal>
      )}

     {qrTarget && <QRModal title={qrTarget.title} code={qrTarget.code} description={qrTarget.description} onClose={() => setQrTarget(null)} />}
    </div>
  );
};

//  STUDENT MODULE 
const StudentApp = ({ db, setDb, user, onLogout }) => {
  const [tab, setTab]             = useState("join");
  const [codeInput, setCodeInput] = useState("");
  const [codeError, setCodeError] = useState("");
  const [selectedCourse, setSelectedCourse]     = useState(null);
  const [activeQuiz, setActiveQuiz]             = useState(null);
  const [answers, setAnswers]                   = useState({});
  const [submitted, setSubmitted]               = useState(false);
  const [result, setResult]                     = useState(null);
  const [currentQuestion, setCurrentQuestion]   = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState(null);
  const [submitting, setSubmitting]             = useState(false);
  const submitQuizRef                           = useRef(null);
  const [violationCount, setViolationCount]     = useState(0);
  const [startedAt, setStartedAt]               = useState(null);
  const [showRegistration, setShowRegistration] = useState(false);
  const [pendingQuiz, setPendingQuiz]           = useState(null);

  const [studentName, setStudentName] = useState(user.name || "");
  const [studentUSN, setStudentUSN]   = useState(user.usn  || "");

  const myEnrollments = db.enrollments.filter(e => e.studentId === user.id);
  const myCourseIds   = myEnrollments.map(e => e.courseId);
  const myAttempts    = db.attempts.filter(a => a.studentId === user.id);
  const quizSessionKey = `quizlyActiveQuiz:${user.id}`;

  useEffect(() => {
    const saved = localStorage.getItem(quizSessionKey);
    if (!saved || activeQuiz) return;
    try {
      const session = JSON.parse(saved);
      const sourceQuiz = db.quizzes.find(q => q.id === session.quizId);
      const quiz = sourceQuiz && session.questions ? { ...sourceQuiz, questions: session.questions } : sourceQuiz;
      if (!quiz) return localStorage.removeItem(quizSessionKey);
      setActiveQuiz(quiz);
      setAnswers(session.answers || {});
      setStudentName(session.studentName || user.name || "");
      setStudentUSN(session.studentUSN || user.usn || "");
      setCurrentQuestion(session.currentQuestion || 0);
      setRemainingSeconds(session.endsAt ? Math.max(0, Math.ceil((session.endsAt - Date.now()) / 1000)) : null);
      setViolationCount(session.violationCount || 0);
      setStartedAt(session.startedAt || new Date().toISOString());
    } catch {
      localStorage.removeItem(quizSessionKey);
    }
  }, [db.quizzes, activeQuiz, quizSessionKey, user.name, user.usn]);

  useEffect(() => {
    if (!activeQuiz || submitted) return;
    const existing = localStorage.getItem(quizSessionKey);
    let endsAt = null;
    try { endsAt = existing ? JSON.parse(existing).endsAt : null; } catch { endsAt = null; }
    if (!endsAt && activeQuiz.durationMinutes > 0) endsAt = Date.now() + activeQuiz.durationMinutes * 60 * 1000;
    localStorage.setItem(quizSessionKey, JSON.stringify({
      quizId: activeQuiz.id,
      answers,
      studentName,
      studentUSN,
      currentQuestion,
      endsAt,
      questions: activeQuiz.questions,
      violationCount,
      startedAt
    }));
  }, [activeQuiz, answers, currentQuestion, studentName, studentUSN, submitted, quizSessionKey, violationCount, startedAt]);

  useEffect(() => {
    if (!activeQuiz || submitted) return;
    const timer = window.setTimeout(async () => {
      const sessionId = `${activeQuiz.id}_${user.id}`;
      const saved = localStorage.getItem(quizSessionKey);
      let endsAt = null;
      try { endsAt = saved ? JSON.parse(saved).endsAt : null; } catch { endsAt = null; }
      try {
        await setDoc(doc(firestore, "quizSessions", sessionId), {
          quizId: activeQuiz.id,
          studentId: user.id,
          studentName: studentName.trim(),
          studentUSN: studentUSN.trim(),
          answers,
          currentQuestion,
          questions: activeQuiz.questions,
          endsAt,
          startedAt: startedAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          violationCount,
          status: "active"
        }, { merge: true });
      } catch (error) {
        console.error("Quiz autosave failed:", error);
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [activeQuiz, answers, currentQuestion, studentName, studentUSN, submitted, user.id, quizSessionKey, violationCount, startedAt]);

  //  Read QR code from URL once on mount only 
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");

  if (!code) return;

  const upper = code.toUpperCase();

  setCodeInput(upper);

  const quiz =
    db.quizzes.find(
      q => q.joinCode === upper
    );

  if (quiz) {
    setPendingQuiz(quiz);
    setShowRegistration(true);
  }

}, [db.quizzes]);//  empty: run once on mount only

  const tabs = [
   { id: "join",      label: "Join via Code", icon: "" },
   { id: "mycourses", label: "My Courses",     icon: "" },
   { id: "myresults", label: "My Results",     icon: "" },
  ];

  //  Join via code 
  const handleJoin = async () => {
    const code = codeInput.trim().toUpperCase();
    if (!code) { setCodeError("Please enter a code."); return; }

    const course = db.courses.find(c => c.joinCode?.toUpperCase() === code);
    if (course) {
      const already = myEnrollments.find(e => e.courseId === course.id);
      if (!already) {
        try {
          const enrollmentData = {
            studentId: user.id,
            studentName: user.name || studentName || "",
            studentUSN: user.usn || studentUSN || "",
            courseId: course.id,
            createdAt: new Date().toISOString()
          };
          const ref = await addDoc(collection(firestore, "enrollments"), enrollmentData);
          setDb(d => ({
            ...d,
            enrollments: [...d.enrollments, { id: ref.id, ...enrollmentData }]
          }));
        } catch (err) {
          alert(err.message);
          return;
        }
      }
      alert(`Joined ${course.name}`);
      setCodeInput("");
      setCodeError("");
      return;
    }

    const quiz = db.quizzes.find(q => q.joinCode?.toUpperCase() === code);
    if (quiz) {
      setPendingQuiz(quiz);
      setShowRegistration(true);
      setCodeInput("");
      setCodeError("");
      return;
    }

    setCodeError("Invalid code.");
  };

  //  Launch quiz (after registration) 
  const launchQuiz = async (quiz) => {
    const alreadyAttempted = db.attempts.find(
      a => a.studentId === user.id && a.quizId === quiz.id
    );
    if (alreadyAttempted) {
      alert("You have already attempted this quiz.");
      return;
    }
    const sessionId = `${quiz.id}_${user.id}`;
    try {
      const saved = await getDoc(doc(firestore, "quizSessions", sessionId));
      if (saved.exists() && saved.data().status === "active") {
        const session = saved.data();
        setActiveQuiz({ ...quiz, questions: session.questions || quiz.questions });
        setAnswers(session.answers || {});
        setCurrentQuestion(session.currentQuestion || 0);
        setRemainingSeconds(session.endsAt ? Math.max(0, Math.ceil((session.endsAt - Date.now()) / 1000)) : null);
        setViolationCount(session.violationCount || 0);
        setStartedAt(session.startedAt || new Date().toISOString());
        setSubmitted(false);
        setResult(null);
        return;
      }
    } catch (error) {
      console.error("Unable to restore Firestore quiz session:", error);
    }
    const preparedQuiz = prepareStudentQuiz(quiz);
    setActiveQuiz(preparedQuiz);
    setAnswers({});
    setCurrentQuestion(0);
    setViolationCount(0);
    setStartedAt(new Date().toISOString());
    setRemainingSeconds(preparedQuiz.durationMinutes > 0 ? preparedQuiz.durationMinutes * 60 : null);
    setSubmitted(false);
    setResult(null);
    if (preparedQuiz.secureMode && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  };

  //  Registration screen handler 
  const startRegisteredQuiz = () => {
    if (!studentName.trim()) { alert("Please enter your name."); return; }
    if (!studentUSN.trim()) { alert("Please enter your USN."); return; }

    const normalizedUSN = studentUSN.trim().toLowerCase();
    const sameUsnAttempt = db.attempts.find(a =>
      a.quizId === pendingQuiz?.id &&
      (a.studentUSN || "").trim().toLowerCase() === normalizedUSN
    );

    if (sameUsnAttempt) {
      alert("This USN has already attempted this quiz.");
      return;
    }

    setShowRegistration(false);
    launchQuiz(pendingQuiz);
  };

  //  Open registration before launching from course view 
  const openRegistrationFor = (quiz) => {
    const alreadyAttempted = db.attempts.find(
      a => a.studentId === user.id && a.quizId === quiz.id
    );
    if (alreadyAttempted) {
      alert("You have already attempted this quiz.");
      return;
    }
    setPendingQuiz(quiz);
    setShowRegistration(true);
  };

  //  Submit quiz 
  const submitQuiz = async (force = false, autoSubmitReason = "") => {
    if (submitting || submitted) return;
    const answeredCount = activeQuiz.questions.filter((question, index) => {
      const answer = answers[index];
      if (isTextQuestion(question)) return String(answer || "").trim().length > 0;
      return Array.isArray(answer) ? answer.length > 0 : answer !== undefined;
    }).length;
    if (!force && answeredCount < activeQuiz.questions.length) {
      alert("Please answer all questions before submitting.");
      return;
    }

    const normalizedUSN = studentUSN.trim().toLowerCase();
    const sameUsnAttempt = db.attempts.find(a =>
      a.quizId === activeQuiz.id &&
      (a.studentUSN || "").trim().toLowerCase() === normalizedUSN
    );

    if (sameUsnAttempt) {
      alert("This USN has already attempted this quiz.");
      setActiveQuiz(null);
      setTab("myresults");
      return;
    }

    const score = activeQuiz.questions.reduce((total, question, index) =>
      total + scoreQuestion(question, answers[index]), 0);
    const maximumScore = getQuizMaximumScore(activeQuiz);

    const attemptData = {
      studentId: user.id,
      studentName: studentName.trim(),
      studentUSN: studentUSN.trim(),
      quizId: activeQuiz.id,
      answers: { ...answers },
      score: Number(score.toFixed(2)),
      maximumScore,
      autoSubmitted: Boolean(autoSubmitReason),
      autoSubmitReason,
      violationCount,
      startedAt,
      timeTakenSeconds: startedAt ? Math.max(0, Math.round((Date.now() - new Date(startedAt).getTime()) / 1000)) : null,
      completedAt: new Date().toISOString()
    };

    try {
      setSubmitting(true);
      const ref = await addDoc(collection(firestore, "attempts"), attemptData);
      const attempt = { id: ref.id, ...attemptData };

      setDb(d => ({ ...d, attempts: [...d.attempts, attempt] }));
      await setDoc(doc(firestore, "quizSessions", `${activeQuiz.id}_${user.id}`), {
        status: "completed",
        completedAt: attemptData.completedAt,
        updatedAt: attemptData.completedAt
      }, { merge: true });
      setResult({ score: attemptData.score, total: maximumScore });
      setSubmitted(true);
      localStorage.removeItem(quizSessionKey);
    } catch (err) {
      alert(err.message);
    } finally {
      setSubmitting(false);
    }
  };
  submitQuizRef.current = submitQuiz;

  useEffect(() => {
    if (!activeQuiz?.secureMode || submitted) return;
    const recordViolation = async (type) => {
      const nextCount = violationCount + 1;
      setViolationCount(nextCount);
      try {
        await addDoc(collection(firestore, "integrityLogs"), {
          quizId: activeQuiz.id,
          studentId: user.id,
          studentName: studentName.trim(),
          studentUSN: studentUSN.trim(),
          type,
          violationCount: nextCount,
          createdAt: new Date().toISOString()
        });
      } catch (error) {
        console.error("Unable to record integrity event:", error);
      }
      if (nextCount >= (activeQuiz.maxViolations || 3)) {
        submitQuizRef.current?.(true, `Integrity limit reached: ${type}`);
      }
    };
    const blockContextMenu = event => { event.preventDefault(); recordViolation("Right-click blocked"); };
    const blockClipboard = event => { event.preventDefault(); recordViolation(`${event.type} blocked`); };
    const blockKeys = event => {
      if (event.ctrlKey && ["c", "a", "x", "v"].includes(event.key.toLowerCase())) {
        event.preventDefault();
        recordViolation(`Ctrl+${event.key.toUpperCase()} blocked`);
      }
    };
    const monitorVisibility = () => {
      if (document.hidden) recordViolation("Browser tab switched");
    };
    const monitorFullscreen = () => {
      if (!document.fullscreenElement) recordViolation("Fullscreen exited");
    };
    document.addEventListener("contextmenu", blockContextMenu);
    document.addEventListener("copy", blockClipboard);
    document.addEventListener("cut", blockClipboard);
    document.addEventListener("paste", blockClipboard);
    document.addEventListener("keydown", blockKeys);
    document.addEventListener("visibilitychange", monitorVisibility);
    document.addEventListener("fullscreenchange", monitorFullscreen);
    return () => {
      document.removeEventListener("contextmenu", blockContextMenu);
      document.removeEventListener("copy", blockClipboard);
      document.removeEventListener("cut", blockClipboard);
      document.removeEventListener("paste", blockClipboard);
      document.removeEventListener("keydown", blockKeys);
      document.removeEventListener("visibilitychange", monitorVisibility);
      document.removeEventListener("fullscreenchange", monitorFullscreen);
    };
  }, [activeQuiz, submitted, violationCount, user.id, studentName, studentUSN]);

  useEffect(() => {
    if (!activeQuiz || submitted || remainingSeconds === null) return;
    if (remainingSeconds <= 0) {
      submitQuizRef.current?.(true, "Time expired");
      return;
    }
    const timer = window.setTimeout(() => setRemainingSeconds(value => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [activeQuiz, submitted, remainingSeconds]);

  //  Registration screen 
  if (showRegistration) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", justifyContent: "center", alignItems: "center", background: "#f8fafc" }}>
        <Card style={{ width: 450 }}>
          <h2 style={{ margin: "0 0 6px", fontWeight: 800, fontSize: 22, color: "#0f172a" }}>Student Registration</h2>
          <p style={{ margin: "0 0 24px", fontSize: 14, color: "#64748b" }}>
            Enter your details to start: <strong>{pendingQuiz?.title}</strong>
          </p>
          <Input
            label="Full Name"
            value={studentName}
            onChange={e => setStudentName(e.target.value)}
            placeholder="e.g. Priya Patel"
          />
          <Input
            label="USN / Faculty ID"
            value={studentUSN}
            onChange={e => setStudentUSN(e.target.value)}
            placeholder="e.g. 1RV21CS001"
          />
          <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
            <Btn variant="ghost" onClick={() => { setShowRegistration(false); setPendingQuiz(null); }}>
              Cancel
            </Btn>
            <Btn onClick={startRegisteredQuiz}>Start Quiz </Btn>
          </div>
        </Card>
      </div>
    );
  }

  //  Quiz taking / results screen 
  if (activeQuiz) {
    const pct        = submitted ? Math.round((result.score / result.total) * 100) : 0;
    const grade      = pct >= 90 ? "A" : pct >= 75 ? "B" : pct >= 60 ? "C" : pct >= 50 ? "D" : "F";
    const gradeColor = pct >= 75 ? "#059669" : pct >= 50 ? "#d97706" : "#dc2626";
    const answeredCount = activeQuiz.questions.filter((question, index) => {
      const answer = answers[index];
      if (isTextQuestion(question)) return String(answer || "").trim().length > 0;
      return Array.isArray(answer) ? answer.length > 0 : answer !== undefined;
    }).length;

    return (
      <div style={{ minHeight: "100vh", background: "#f8fafc", userSelect: activeQuiz.secureMode ? "none" : "auto" }}>
        <div style={{ background: "#0f172a", padding: "16px 32px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ color: "#fff", fontWeight: 800, fontSize: 18 }}> Quizly {activeQuiz.title}</div>
         {!submitted && (
            <button onClick={() => setActiveQuiz(null)} style={{ background: "none", border: "1px solid #475569", color: "#94a3b8", padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit" }}>
              Exit Quiz
            </button>
          )}
        </div>

        <div style={{ maxWidth: 760, margin: "40px auto", padding: "0 20px" }}>
         {!submitted ? (
            <>
              <div style={{ marginBottom: 28 }}>
                <h2 style={{ margin: "0 0 6px", fontWeight: 800, fontSize: 24, color: "#0f172a" }}>{activeQuiz.title}</h2>
                <p style={{ margin: "0 0 12px", color: "#64748b" }}>{activeQuiz.description} {activeQuiz.questions.length} questions</p>
                {remainingSeconds !== null && (
                  <div style={{ marginBottom: 12, padding: "10px 14px", borderRadius: 8, background: remainingSeconds < 60 ? "#fee2e2" : "#eff6ff", color: remainingSeconds < 60 ? "#991b1b" : "#1e40af", fontWeight: 800 }}>
                    Time left: {String(Math.floor(remainingSeconds / 60)).padStart(2, "0")}:{String(remainingSeconds % 60).padStart(2, "0")}
                    <span style={{ marginLeft: 12, fontWeight: 500, fontSize: 12 }}>
                      Suggested pace: {Math.ceil((activeQuiz.durationMinutes * 60) / activeQuiz.questions.length)} seconds per question
                    </span>
                  </div>
                )}
                {activeQuiz.secureMode && (
                  <div style={{ marginBottom: 12, padding: "8px 12px", borderRadius: 8, background: "#fff7ed", color: "#9a3412", fontSize: 13 }}>
                    Secure exam mode active. Integrity violations: <strong>{violationCount} / {activeQuiz.maxViolations || 3}</strong>
                  </div>
                )}
                <div style={{ background: "#e2e8f0", borderRadius: 20, height: 6 }}>
                  <div style={{ height: 6, borderRadius: 20, background: "#1e40af", width: `${(answeredCount / activeQuiz.questions.length) * 100}%`, transition: "width .3s" }} />
                </div>
                <p style={{ margin: "6px 0 0", fontSize: 13, color: "#64748b" }}>
                  Question {currentQuestion + 1} of {activeQuiz.questions.length} | {answeredCount} answered
                </p>
              </div>

             {activeQuiz.questions[currentQuestion] && (() => {
                const q = activeQuiz.questions[currentQuestion];
                const qi = currentQuestion;
                return <Card key={q.id} style={{ marginBottom: 16, border: answers[qi] !== undefined ? "2px solid #bfdbfe" : "1.5px solid #e2e8f0" }}>
                  {q.caseText && <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 12, marginBottom: 14, color: "#475569", fontSize: 14 }}>{q.caseText}</div>}
                  <div style={{ fontWeight: 700, marginBottom: 14, color: "#1e293b" }}>
                    <span style={{ color: "#2563eb", marginRight: 8 }}>Q{qi + 1}.</span>{q.text}
                  </div>
                  {isChoiceQuestion(q) ? <div style={{ display: "grid", gap: 8 }}>
                   {(q.options || []).map((opt, oi) => (
                      <label key={oi} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 8, cursor: "pointer", background: (Array.isArray(answers[qi]) ? answers[qi].includes(oi) : answers[qi] === oi) ? "#eff6ff" : "#f8fafc", border: (Array.isArray(answers[qi]) ? answers[qi].includes(oi) : answers[qi] === oi) ? "2px solid #2563eb" : "1.5px solid #e2e8f0", transition: "all .15s" }}>
                        <input
                          type={(q.type === "multiple" || normalizeCorrectAnswers(q).length > 1) ? "checkbox" : "radio"}
                          name={`q${qi}`}
                          checked={(q.type === "multiple" || normalizeCorrectAnswers(q).length > 1)
                            ? (answers[qi] || []).includes(oi)
                            : answers[qi] === oi}
                          onChange={() => {
                            if (q.type === "multiple" || normalizeCorrectAnswers(q).length > 1) {
                              const selected = Array.isArray(answers[qi]) ? answers[qi] : [];
                              const next = selected.includes(oi) ? selected.filter(value => value !== oi) : [...selected, oi];
                              setAnswers({ ...answers, [qi]: next });
                            } else {
                              setAnswers({ ...answers, [qi]: oi });
                            }
                          }}
                          style={{ accentColor: "#2563eb" }}
                        />
                        <span style={{ fontSize: 14 }}>{String.fromCharCode(65 + oi)}. {opt}</span>
                      </label>
                    ))}
                  </div> : (
                    <Textarea
                      label={normalizeQuestionType(q) === "numerical" ? "Your numerical answer" : "Your answer"}
                      value={answers[qi] || ""}
                      onChange={e => setAnswers({ ...answers, [qi]: e.target.value })}
                      placeholder={normalizeQuestionType(q) === "descriptive" || normalizeQuestionType(q) === "case-study" ? "Write your answer here..." : "Type your answer..."}
                      rows={normalizeQuestionType(q) === "descriptive" || normalizeQuestionType(q) === "case-study" ? 5 : 2}
                    />
                  )}
                  {(q.type === "multiple" || normalizeCorrectAnswers(q).length > 1) && <p style={{ color: "#64748b", fontSize: 12, marginBottom: 0 }}>Select all applicable answers.</p>}
                </Card>;
              })()}

              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center", marginBottom: 18 }}>
                {activeQuiz.questions.map((q, index) => (
                  <button key={q.id} onClick={() => setCurrentQuestion(index)} style={{
                    width: 34, height: 34, borderRadius: 6, cursor: "pointer",
                    border: index === currentQuestion ? "2px solid #1e40af" : "1px solid #cbd5e1",
                    background: answers[index] === undefined || (Array.isArray(answers[index]) && !answers[index].length) || (isTextQuestion(q) && !String(answers[index] || "").trim()) ? "#fff" : "#dbeafe",
                    fontWeight: 700
                  }}>{index + 1}</button>
                ))}
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 24 }}>
                <Btn variant="ghost" disabled={currentQuestion === 0} onClick={() => setCurrentQuestion(i => i - 1)}>Previous</Btn>
                {currentQuestion < activeQuiz.questions.length - 1
                  ? <Btn onClick={() => setCurrentQuestion(i => i + 1)}>Next</Btn>
                  : <Btn size="lg" variant="success" disabled={submitting} onClick={() => submitQuiz(false)}>{submitting ? "Submitting..." : "Submit Quiz"}</Btn>}
              </div>
            </>
          ) : (
            <>
              <Card style={{ textAlign: "center", marginBottom: 24, padding: 40 }}>
                <div style={{ width: 110, height: 110, borderRadius: "50%", background: gradeColor, margin: "0 auto 20px", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 0 40px ${gradeColor}44` }}>
                  <span style={{ color: "#fff", fontSize: 34, fontWeight: 900 }}>{grade}</span>
                </div>
                <h2 style={{ margin: "0 0 6px", fontSize: 28, fontWeight: 800, color: gradeColor }}>{pct}%</h2>
                <p style={{ margin: "0 0 6px", fontSize: 16, color: "#374151" }}>
                  You scored <strong>{result.score}</strong> out of <strong>{result.total}</strong>
                </p>
                <p style={{ margin: "0 0 6px", fontSize: 14, color: "#475569" }}>
                  <strong>{studentName}</strong> | USN: <strong>{studentUSN}</strong>
                </p>
                <p style={{ margin: "0 0 24px", fontSize: 14, color: "#64748b" }}>
                 {pct === 100 ? " Perfect!" : pct >= 75 ? "Great job!" : pct >= 50 ? "Keep practicing!" : "Better luck next time."}
                </p>
                <Btn onClick={() => { setActiveQuiz(null); setTab("myresults"); }} variant="outline">View My Results</Btn>
              </Card>

              <Card style={{ textAlign: "center", color: "#475569" }}>
                The answer key is hidden after submission. Your teacher can review and print the complete answer sheet.
              </Card>
            </>
          )}
        </div>
      </div>
    );
  }

  //  Main student dashboard 
  return (
    <div style={{ display: "flex" }}>
      <Sidebar user={user} activeTab={tab} setTab={t => { setTab(t); setSelectedCourse(null); }} tabs={tabs} onLogout={onLogout} />
      <main style={{ flex: 1, padding: 32, background: "#f8fafc", minHeight: "100vh" }}>

       {/*  JOIN TAB  */}
       {tab === "join" && (
          <div style={{ maxWidth: 520, margin: "0 auto" }}>
            <h2 style={{ margin: "0 0 6px", fontWeight: 800, fontSize: 26, color: "#0f172a" }}>Join via QR Code</h2>
            <p style={{ margin: "0 0 32px", color: "#64748b" }}>Scan the QR code shared by your teacher, or enter the code manually below.</p>

            <Card style={{ textAlign: "center", marginBottom: 28, padding: 36, background: "linear-gradient(135deg,#0f172a,#1e3a5f)", border: "none" }}>
              <div style={{ fontSize: 64, marginBottom: 12 }}></div>
              <div style={{ color: "#94a3b8", fontSize: 14, marginBottom: 6 }}>Point your camera at the QR code</div>
              <div style={{ color: "#64748b", fontSize: 12 }}>or enter the code below</div>
            </Card>

            <Card>
              <h3 style={{ margin: "0 0 16px", fontWeight: 700, fontSize: 16, color: "#1e293b" }}>Enter Code Manually</h3>
              <div style={{ display: "flex", gap: 10 }}>
                <input
                  value={codeInput}
                  onChange={e => { setCodeInput(e.target.value.toUpperCase()); setCodeError(""); }}
                  onKeyDown={e => e.key === "Enter" && handleJoin()}
                  placeholder="e.g. CRS-MATH1 or QZ-ALG01"
                  style={{ flex: 1, padding: "11px 14px", borderRadius: 8, border: codeError ? "2px solid #dc2626" : "1.5px solid #d1d5db", fontSize: 15, fontFamily: "monospace", fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", outline: "none" }}
                />
                <Btn size="md" onClick={handleJoin}>Join </Btn>
              </div>
             {codeError && <p style={{ color: "#dc2626", fontSize: 13, margin: "10px 0 0" }}> {codeError}</p>}
              <p style={{ fontSize: 12, color: "#94a3b8", margin: "14px 0 0" }}>
                Use a <strong>CRS-XXXXX</strong> code to join a full course, or a <strong>QZ-XXXXX</strong> code to directly attempt a quiz.
              </p>

              <div style={{ marginTop: 20, padding: 14, background: "#f1f5f9", borderRadius: 10, border: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>Demo Codes to Try</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                 {[
                   { code: "CRS-MATH1", label: "Mathematics 101" },
                   { code: "CRS-PHYS2", label: "Physics" },
                   { code: "CRS-DATA3", label: "Data Structures" },
                   { code: "QZ-ALG01",  label: "Algebra Quiz" },
                   { code: "QZ-NEW02",  label: "Newton's Quiz" },
                  ].map(d => (
                    <button key={d.code} onClick={() => { setCodeInput(d.code); setCodeError(""); }}
                      style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: 8, padding: "5px 10px", cursor: "pointer", fontFamily: "monospace", fontWeight: 700, fontSize: 12, color: "#1e293b" }}>
                     {d.code}
                    </button>
                  ))}
                </div>
              </div>
            </Card>
          </div>
        )}

       {/*  MY COURSES TAB  course list  */}
       {tab === "mycourses" && !selectedCourse && (
          <>
            <h2 style={{ margin: "0 0 6px", fontWeight: 800, fontSize: 26, color: "#0f172a" }}>My Courses</h2>
            <p style={{ margin: "0 0 24px", color: "#64748b" }}>Courses you have joined. Click a course to take its quizzes.</p>
           {myCourseIds.length === 0 ? (
              <Card style={{ textAlign: "center", padding: 48 }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}></div>
                <div style={{ fontWeight: 700, fontSize: 16, color: "#1e293b", marginBottom: 8 }}>No courses joined yet</div>
                <div style={{ color: "#64748b", marginBottom: 20 }}>Scan a QR code or enter a course code from your teacher.</div>
                <Btn onClick={() => setTab("join")}>Join a Course </Btn>
              </Card>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px,1fr))", gap: 16 }}>
               {db.courses.filter(c => myCourseIds.includes(c.id)).map(c => {
                  const teacher = db.users.find(u => u.id === c.teacherId);
                  const qCount  = db.quizzes.filter(q => q.courseId === c.id).length;
                  const done    = myAttempts.filter(a => db.quizzes.find(q => q.id === a.quizId && q.courseId === c.id)).length;
                  return (
                    <Card key={c.id} style={{ cursor: "pointer" }} onClick={() => setSelectedCourse(c)}>
                      <div style={{ width: 44, height: 44, borderRadius: 10, background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, marginBottom: 12 }}></div>
                      <div style={{ fontWeight: 700, fontSize: 16, color: "#1e293b", marginBottom: 4 }}>{c.name}</div>
                      <div style={{ fontSize: 13, color: "#64748b", marginBottom: 12 }}>{c.description}</div>
                      <div style={{ fontSize: 12, color: "#94a3b8" }}> {teacher?.name || ""}  {qCount} quiz{qCount !== 1 ? "zes" : ""}  {done} done</div>
                    </Card>
                  );
                })}
              </div>
            )}
          </>
        )}

       {/*  MY COURSES TAB  quiz list inside a course  */}
       {tab === "mycourses" && selectedCourse && (
          <>
            <button onClick={() => setSelectedCourse(null)} style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontWeight: 600, padding: 0, fontSize: 14, marginBottom: 12 }}> Back to My Courses</button>
            <h2 style={{ margin: "0 0 4px", fontWeight: 800, fontSize: 24, color: "#0f172a" }}>{selectedCourse.name}</h2>
            <p style={{ margin: "0 0 24px", color: "#64748b" }}>{selectedCourse.description}</p>
           {db.quizzes.filter(q => q.courseId === selectedCourse.id).length === 0
              ? <Card><p style={{ color: "#94a3b8", textAlign: "center" }}>No quizzes available yet.</p></Card>
              : (
                <div style={{ display: "grid", gap: 14 }}>
                 {db.quizzes.filter(q => q.courseId === selectedCourse.id).map(q => {
                    const attempt = [...myAttempts].reverse().find(a => a.quizId === q.id);
                    const score   = attempt ? (typeof attempt.score === "number" ? attempt.score : parseInt(attempt.score, 10)) : null;
                    const maximum = Number(attempt?.maximumScore) || getQuizMaximumScore(q);
                    const pct     = (attempt && score !== null && maximum > 0) ? Math.round((score / maximum) * 100) : null;
                    return (
                      <Card key={q.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 16, color: "#1e293b" }}>{q.title}</div>
                          <div style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>{q.description}</div>
                          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 6 }}>
                            {q.questions.length} questions
                           {pct !== null && (
                              <span style={{ color: pct >= 75 ? "#059669" : "#d97706", fontWeight: 700, marginLeft: 8 }}>
                                 Last: {pct}%
                              </span>
                            )}
                          </div>
                        </div>
                       {attempt ? (
                          <Btn size="sm" disabled variant="outline">Completed </Btn>
                        ) : (
                          //  goes through registration so name/USN are always captured
                          <Btn size="sm" onClick={() => openRegistrationFor(q)}>Start Quiz </Btn>
                        )}
                      </Card>
                    );
                  })}
                </div>
              )
            }
          </>
        )}

       {/*  MY RESULTS TAB  */}
       {tab === "myresults" && (
          <>
            <h2 style={{ margin: "0 0 6px", fontWeight: 800, fontSize: 26, color: "#0f172a" }}>My Results</h2>
            <p style={{ margin: "0 0 24px", color: "#64748b" }}>All your quiz attempts.</p>
           {myAttempts.length === 0
              ? <Card><p style={{ color: "#94a3b8", textAlign: "center" }}>No attempts yet.</p></Card>
              : (
                <div style={{ display: "grid", gap: 14 }}>
                 {[...myAttempts].reverse().map(a => {
                    const quiz   = db.quizzes.find(q => q.id === a.quizId);
                    const course = quiz ? db.courses.find(c => c.id === quiz.courseId) : null;
                    const num    = typeof a.score === "number" ? a.score : parseInt(a.score, 10);
                    const total  = Number(a.maximumScore) || (quiz ? getQuizMaximumScore(quiz) : 0);
                    const pct    = total > 0 ? Math.round((num / total) * 100) : 0;
                    const color  = pct >= 75 ? "#059669" : pct >= 50 ? "#d97706" : "#dc2626";
                    return (
                      <Card key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 15, color: "#1e293b" }}>{quiz?.title || "Deleted Quiz"}</div>
                          <div style={{ fontSize: 13, color: "#64748b" }}> {course?.name || ""}</div>
                          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>
                           {a.completedAt ? new Date(a.completedAt).toLocaleString() : ""}
                          </div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontWeight: 900, fontSize: 28, color }}>{pct}%</div>
                          <div style={{ fontSize: 13, color: "#94a3b8" }}>
                           {isNaN(num) ? "?" : num} / {total || "?"} correct
                          </div>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )
            }
          </>
        )}

      </main>
    </div>
  );
};

//  LOGIN PAGE 
const LoginPage = ({ onLogin }) => {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr]           = useState("");

  

  //  Fix 1: handleLogin defined inside the component 
 

const handleLogin = async () => {

  try {

const cred = await signInWithEmailAndPassword(
  auth,
  email.trim(),
  password.trim()
);

    const userRef =
      doc(
        firestore,
        "users",
        cred.user.uid
      );

    const snap =
      await getDoc(userRef);

    if (!snap.exists()) {
      setErr("User profile not found");
      return;
    }

    onLogin({
      id: cred.user.uid,
      ...snap.data()
    });

  } catch (err) {

  alert(
    "ERROR CODE: " +
    err.code +
    "\n\nMESSAGE: " +
    err.message
  );

  setErr(err.code);

}
};

const handleResetPassword = async () => {
  if (!email.trim()) {
    alert("Enter your email address first.");
    return;
  }

  try {
    await sendPasswordResetEmail(auth, email.trim());
    alert("Password reset email sent. Check your inbox.");
  } catch (err) {
    alert(err.message);
  }
};
  return (
    <div style={{ minHeight: "100vh", display: "flex", background: "#f1f5f9" }}>

     {/*  Left panel  */}
      <div style={{ flex: 1, background: "#0f172a", display: "flex", flexDirection: "column", justifyContent: "center", padding: "60px", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(circle at 30% 50%, #1e40af22 0%, transparent 60%), radial-gradient(circle at 80% 20%, #7c3aed22 0%, transparent 50%)" }} />
        <div style={{ position: "relative", zIndex: 1 }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}></div>
          <h1 style={{ color: "#fff", fontWeight: 900, fontSize: 40, margin: "0 0 16px", letterSpacing: -1 }}>Quizly</h1>
          <p style={{ color: "#94a3b8", fontSize: 16, lineHeight: 1.6, maxWidth: 380, marginBottom: 48 }}>
            QR-powered quiz platform. Teachers share QR codes  students scan to access only their assigned courses.
          </p>
        </div>
      </div>

     {/*  Right panel  */}
      <div style={{ width: 440, display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
        <div style={{ width: "100%" }}>
          <h2 style={{ fontWeight: 800, fontSize: 26, color: "#0f172a", margin: "0 0 6px" }}>Welcome back</h2>
          <p style={{ color: "#64748b", margin: "0 0 32px" }}>Sign in to your account</p>

          <Input
            label="Email Address"
            type="email"
            value={email}
            onChange={e => { setEmail(e.target.value); setErr(""); }}
            placeholder="Enter your email"
          />
          <Input
            label="Password"
            type="password"
            value={password}
            onChange={e => { setPassword(e.target.value); setErr(""); }}
            placeholder="Enter your password"
            onKeyDown={e => e.key === "Enter" && handleLogin()}
          />

         {err && (
            <p style={{ color: "#dc2626", fontSize: 13, margin: "-8px 0 12px" }}> {err}</p>
          )}

          <Btn size="lg" onClick={handleLogin} style={{ width: "100%", justifyContent: "center" }}>
            Sign In
          </Btn>
          <button onClick={handleResetPassword} style={{ marginTop: 12, width: "100%", background: "transparent", border: "none", color: "#2563eb", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>
            Reset Password
          </button>
        </div>
      </div>
    </div>
  );
};

//  ROOT 
export default function App() {

  const [db, setDb] = useState({
  users: [],
  courses: [],
  quizzes: [],
  attempts: [],
  enrollments: [],
  quizSessions: [],
  integrityLogs: [],
  settings: []
});
const [dataLoading, setDataLoading] = useState(true);

  useEffect(() => {

  const loadData = async () => {

    const usersSnap =
      await getDocs(
        collection(firestore, "users")
      );

    const coursesSnap =
      await getDocs(
        collection(firestore, "courses")
      );

    const quizzesSnap =
      await getDocs(
        collection(firestore, "quizzes")
      );

    const attemptsSnap =
      await getDocs(
        collection(firestore, "attempts")
      );

    const enrollmentsSnap =
      await getDocs(
        collection(firestore, "enrollments")
      );
    const sessionsSnap = await getDocs(collection(firestore, "quizSessions"));
    const integritySnap = await getDocs(collection(firestore, "integrityLogs"));
    const settingsSnap = await getDocs(collection(firestore, "settings"));

    setDb({
      users: usersSnap.docs.map(d => ({
        id: d.id,
        ...d.data()
      })),

      courses: coursesSnap.docs.map(d => ({
        id: d.id,
        ...d.data()
      })),

      quizzes: quizzesSnap.docs.map(d => ({
        id: d.id,
        ...d.data()
      })),

      attempts: attemptsSnap.docs.map(d => ({
        id: d.id,
        ...d.data()
      })),

      enrollments: enrollmentsSnap.docs.map(d => ({
        id: d.id,
        ...d.data()
      })),
      quizSessions: sessionsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
      integrityLogs: integritySnap.docs.map(d => ({ id: d.id, ...d.data() })),
      settings: settingsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    });
    setDataLoading(false);
  };

  loadData();

}, []);

  useEffect(() => {
    const unsubUsers = onSnapshot(collection(firestore, "users"), snap => {
      setDb(prev => ({ ...prev, users: snap.docs.map(d => ({ id: d.id, ...d.data() })) }));
    });
    const unsubCourses = onSnapshot(collection(firestore, "courses"), snap => {
      setDb(prev => ({ ...prev, courses: snap.docs.map(d => ({ id: d.id, ...d.data() })) }));
    });
    const unsubQuizzes = onSnapshot(collection(firestore, "quizzes"), snap => {
      setDb(prev => ({ ...prev, quizzes: snap.docs.map(d => ({ id: d.id, ...d.data() })) }));
    });
    const unsubAttempts = onSnapshot(collection(firestore, "attempts"), snap => {
      setDb(prev => ({ ...prev, attempts: snap.docs.map(d => ({ id: d.id, ...d.data() })) }));
    });
    const unsubEnrollments = onSnapshot(collection(firestore, "enrollments"), snap => {
      setDb(prev => ({ ...prev, enrollments: snap.docs.map(d => ({ id: d.id, ...d.data() })) }));
    });
    const unsubSessions = onSnapshot(collection(firestore, "quizSessions"), snap => {
      setDb(prev => ({ ...prev, quizSessions: snap.docs.map(d => ({ id: d.id, ...d.data() })) }));
    });
    const unsubIntegrity = onSnapshot(collection(firestore, "integrityLogs"), snap => {
      setDb(prev => ({ ...prev, integrityLogs: snap.docs.map(d => ({ id: d.id, ...d.data() })) }));
    });
    const unsubSettings = onSnapshot(collection(firestore, "settings"), snap => {
      setDb(prev => ({ ...prev, settings: snap.docs.map(d => ({ id: d.id, ...d.data() })) }));
    });

    return () => {
      unsubUsers();
      unsubCourses();
      unsubQuizzes();
      unsubAttempts();
      unsubEnrollments();
      unsubSessions();
      unsubIntegrity();
      unsubSettings();
    };
  }, []);

  const [currentUser, setCurrentUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [guestId] = useState(() => {
    const existing = sessionStorage.getItem("quizlyGuestId");
    if (existing) return existing;
    const id = genId();
    sessionStorage.setItem("quizlyGuestId", id);
    return id;
  });

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        setCurrentUser(null);
        setAuthLoading(false);
        return;
      }

      try {
        const snap = await getDoc(doc(firestore, "users", firebaseUser.uid));
        if (snap.exists()) {
          setCurrentUser({ id: firebaseUser.uid, ...snap.data() });
        } else {
          setCurrentUser(null);
        }
      } catch (error) {
        console.error("Unable to restore user session:", error);
        setCurrentUser(null);
      } finally {
        setAuthLoading(false);
      }
    });

    return () => unsub();
  }, []);

  const logout = async () => {
    await signOut(auth);
    setCurrentUser(null);
  };

  //  QR code from URL 
  const params = new URLSearchParams(window.location.search);
  const qrCode = params.get("code");

  if (authLoading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc", color: "#475569", fontFamily: "Arial, sans-serif" }}>
        Restoring your session...
      </div>
    );
  }

  //  Fix 3: guest gets a unique id per session, not "guest" 
  if (!currentUser) {
    if (qrCode && dataLoading) {
      return (
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc", color: "#475569", fontFamily: "Arial, sans-serif" }}>
          Loading quiz...
        </div>
      );
    }

    if (qrCode) {
      const quiz = db.quizzes.find(
        q => q.joinCode?.toUpperCase() === qrCode.toUpperCase()
      );
      if (quiz) {
        const guestUser = {
          id:   guestId, // stable per browser session so results stay visible
          name: "",
          usn:  "",
          role: "student",
        };
        return (
          <StudentApp
            db={db}
            setDb={setDb}
            user={guestUser}
            onLogout={() => {}}
          />
        );
      }
    }

    return <LoginPage onLogin={setCurrentUser} />;
  }

  //  Route by role 
  if (currentUser.role === "admin") {
    return <AdminApp   db={db} setDb={setDb} user={currentUser} onLogout={logout} />;
  }
  if (currentUser.role === "teacher") {
    return <TeacherApp db={db} setDb={setDb} user={currentUser} onLogout={logout} />;
  }
  return   <StudentApp db={db} setDb={setDb} user={currentUser} onLogout={logout} />;
}
