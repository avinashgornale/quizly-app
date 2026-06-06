import { useState, useEffect, useRef } from "react";

import { auth, firestore } from "./firebase";

import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword
} from "firebase/auth";

import {
  doc,
  setDoc,
  getDoc
} from "firebase/firestore";

const genId = () => Math.random().toString(36).substr(2, 9);
const genCode = (prefix) => prefix + Math.random().toString(36).substr(2, 5).toUpperCase();

// ─── Seed Data ───────────────────────────────────────────────────────────────
const SEED = {
  users: [
    { id: "u1", name: "Super Admin",       email: "admin@quizly.com",  password: "admin123", role: "admin"   },
    { id: "u2", name: "Dr. Ananya Sharma", email: "ananya@quizly.com", password: "pass123",  role: "teacher" },
    { id: "u3", name: "Prof. Rahul Mehta", email: "rahul@quizly.com",  password: "pass123",  role: "teacher" },
    { id: "u4", name: "Priya Patel",       email: "priya@quizly.com",  password: "pass123",  role: "student" },
    { id: "u5", name: "Arjun Nair",        email: "arjun@quizly.com",  password: "pass123",  role: "student" },
  ],
  courses: [
    { id: "c1", joinCode: "CRS-MATH1", name: "Mathematics 101",      description: "Algebra, calculus, and number theory fundamentals.", teacherId: "u2" },
    { id: "c2", joinCode: "CRS-PHYS2", name: "Physics Fundamentals", description: "Newton's laws, thermodynamics, and wave mechanics.",  teacherId: "u3" },
    { id: "c3", joinCode: "CRS-DATA3", name: "Data Structures",      description: "Arrays, linked lists, trees, and graph algorithms.", teacherId: "u2" },
  ],
  quizzes: [
    {
      id: "q1", joinCode: "QZ-ALG01", courseId: "c1", title: "Algebra Basics", description: "Test your understanding of basic algebraic concepts.",
      questions: [
        { id: "qq1", text: "What is 2 + 2?",       options: ["3","4","5","6"],                                         correctAnswer: 1 },
        { id: "qq2", text: "Solve: x + 5 = 10",    options: ["x = 3","x = 4","x = 5","x = 6"],                        correctAnswer: 2 },
        { id: "qq3", text: "What is 3²?",           options: ["6","8","9","12"],                                        correctAnswer: 2 },
        { id: "qq4", text: "Factor: x² - 4",        options: ["(x+2)(x-2)","(x+1)(x-4)","(x-2)²","(x+4)(x-1)"],      correctAnswer: 0 },
      ]
    },
    {
      id: "q2", joinCode: "QZ-NEW02", courseId: "c2", title: "Newton's Laws", description: "A quiz on the three laws of motion.",
      questions: [
        { id: "qq5", text: "What is the SI unit of force?",                      options: ["Watt","Newton","Joule","Pascal"],       correctAnswer: 1 },
        { id: "qq6", text: "F = ma represents Newton's ___ Law.",                options: ["First","Second","Third","Fourth"],      correctAnswer: 1 },
        { id: "qq7", text: "An object at rest tends to stay at rest. Which law?",options: ["2nd","3rd","1st","None"],               correctAnswer: 2 },
      ]
    },
    {
      id: "q3", joinCode: "QZ-DSA03", courseId: "c3", title: "Arrays & Searching", description: "Test on array operations and search algorithms.",
      questions: [
        { id: "qq8", text: "Time complexity of binary search?",  options: ["O(n)","O(log n)","O(n²)","O(1)"], correctAnswer: 1 },
        { id: "qq9", text: "Which data structure uses LIFO?",    options: ["Queue","Stack","Array","Tree"],    correctAnswer: 1 },
      ]
    },
  ],
  attempts: [],
  enrollments: [],
};

// ─── Shared UI ────────────────────────────────────────────────────────────────
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
        <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 24, cursor: "pointer", color: "#94a3b8" }}>×</button>
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

// ─── Credentials Panel (admin only, post-login) ───────────────────────────────
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
        <span style={{ fontSize: 18 }}>🔒</span>
        <span style={{ fontSize: 13, color: "#92400e", fontWeight: 500 }}>
          This section is visible to admins only. Login credentials are sensitive — handle with care.
        </span>
      </div>

      {/* Role tabs */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, alignItems: "center" }}>
        <button style={tabStyle("teacher")} onClick={() => { setActiveRole("teacher"); setRevealed({}); }}>🧑‍🏫 Teachers</button>
        <button style={tabStyle("student")} onClick={() => { setActiveRole("student"); setRevealed({}); }}>🎓 Students</button>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <Btn size="sm" variant="ghost" onClick={revealAll}>👁 Show All</Btn>
          <Btn size="sm" variant="ghost" onClick={hideAll}>🙈 Hide All</Btn>
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
                    {show ? u.password : "••••••••"}
                  </td>
                  <td style={{ padding: "12px 16px" }}><Badge role={u.role} /></td>
                  <td style={{ padding: "12px 16px" }}>
                    <button
                      onClick={() => toggle(u.id)}
                      title={show ? "Hide credentials" : "Reveal credentials"}
                      style={{ background: show ? "#dcfce7" : "#f1f5f9", border: "none", borderRadius: 6, padding: "5px 12px", cursor: "pointer", fontSize: 13, fontWeight: 600, color: show ? "#059669" : "#475569", transition: "all .15s" }}
                    >
                      {show ? "👁 Hide" : "🔍 Show"}
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

// ─── QR Code Modal ────────────────────────────────────────────────────────────
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
    <Modal title={`QR Code — ${title}`} onClose={onClose}>
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
            {copied ? "✓ Copied" : "Copy"}
          </button>
        </div>
        <p style={{ fontSize: 13, color: "#94a3b8", margin: 0 }}>Students scan this QR code or enter the code manually to access this content.</p>
      </div>
    </Modal>
  );
};

// ─── Sidebar ──────────────────────────────────────────────────────────────────
const Sidebar = ({ user, activeTab, setTab, tabs, onLogout }) => (
  <div style={{ width: 240, minHeight: "100vh", background: "#0f172a", display: "flex", flexDirection: "column", padding: "0 0 24px", flexShrink: 0 }}>
    <div style={{ padding: "28px 20px 20px", borderBottom: "1px solid #1e293b" }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: "#fff", letterSpacing: -0.5 }}>📋 Quizly</div>
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
      <button onClick={onLogout} style={{ width: "100%", background: "transparent", color: "#94a3b8", border: "1px solid #334155", padding: "9px 14px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: 600, fontSize: 14, textAlign: "left" }}>⬅ Logout</button>
    </div>
  </div>
);

// ─── ADMIN MODULE ─────────────────────────────────────────────────────────────
const AdminApp = ({ db, setDb, user, onLogout }) => {
  const [tab, setTab]     = useState("overview");
  const [modal, setModal] = useState(null);
  const [form, setForm]   = useState({});
  const [err, setErr]     = useState("");
  const [qrTarget, setQrTarget] = useState(null);

  const teachers = db.users.filter(u => u.role === "teacher");

  // ── "Credentials" tab only appears for admin ──────────────────────────────
  const tabs = [
    { id: "overview",     label: "Overview",     icon: "🏠" },
    { id: "users",        label: "Users",         icon: "👥" },
    { id: "courses",      label: "Courses",       icon: "📚" },
    { id: "quizzes",      label: "All Quizzes",   icon: "📝" },
    ...(user.role === "admin"
      ? [{ id: "credentials", label: "Credentials", icon: "🔑" }]
      : []),
  ];

  const openModal = (type, data = {}) => { setModal(type); setForm(data); setErr(""); };
  const closeModal = () => { setModal(null); setForm({}); setErr(""); };

  const saveUser = async () => {

  try {

    const cred =
      await createUserWithEmailAndPassword(
        auth,
        form.email,
        form.password
      );

    await setDoc(
  doc(firestore, "users", cred.user.uid),
      {
        uid: cred.user.uid,
        name: form.name,
        email: form.email,
        role: form.role,
        createdAt: new Date().toISOString()
      }
    );

    alert("User created successfully");

    setModal(null);

  } catch (err) {

    alert(err.message);

  }

};

  const deleteUser = (id) => { if (!window.confirm("Delete this user?")) return; setDb(d => ({ ...d, users: d.users.filter(u => u.id !== id) })); };

  const saveCourse = () => {
    if (!form.name || !form.teacherId) return setErr("Name and teacher required.");
    setDb(d => ({ ...d, courses: form.id ? d.courses.map(c => c.id === form.id ? { ...c, ...form } : c) : [...d.courses, { ...form, id: genId(), joinCode: genCode("CRS-") }] }));
    closeModal();
  };

  const deleteCourse = (id) => { if (!window.confirm("Delete this course?")) return; setDb(d => ({ ...d, courses: d.courses.filter(c => c.id !== id), quizzes: d.quizzes.filter(q => q.courseId !== id) })); };

  return (
    <div style={{ display: "flex" }}>
      <Sidebar user={user} activeTab={tab} setTab={setTab} tabs={tabs} onLogout={onLogout} />
      <main style={{ flex: 1, padding: 32, background: "#f8fafc", minHeight: "100vh" }}>

        {tab === "overview" && (
          <>
            <h2 style={{ margin: "0 0 24px", fontWeight: 800, fontSize: 26, color: "#0f172a" }}>Admin Overview</h2>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 32 }}>
              <Stat icon="🧑‍🏫" label="Teachers"  value={teachers.length}                                      color="#2563eb" />
              <Stat icon="🎓"   label="Students"  value={db.users.filter(u => u.role === "student").length}    color="#059669" />
              <Stat icon="📚"   label="Courses"   value={db.courses.length}                                    color="#7c3aed" />
              <Stat icon="📝"   label="Quizzes"   value={db.quizzes.length}                                    color="#d97706" />
              <Stat icon="✅"   label="Attempts"  value={db.attempts.length}                                   color="#dc2626" />
            </div>
            <Card>
              <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 700 }}>QR-Based Access</h3>
              <p style={{ color: "#64748b", fontSize: 14, margin: "0 0 16px" }}>Each course has a unique QR code. Share it with students to grant access. Students <strong>cannot</strong> browse courses freely — they must scan or enter the code.</p>
              <Btn onClick={() => setTab("courses")}>View Course QR Codes →</Btn>
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
                  {role === "teacher" ? "🧑‍🏫" : "🎓"} {role}s
                </h3>
                <div style={{ display: "grid", gap: 12 }}>
                  {db.users.filter(u => u.role === role).map(u => (
                    <Card key={u.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 20px" }}>
                      <div>
                        <div style={{ fontWeight: 700, color: "#1e293b" }}>{u.name}</div>
                        {/* Email is masked here — full details only in Credentials tab */}
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
                          <span>👨‍🏫 {teacher?.name || "Unassigned"}</span>
                          <span>📝 {qCount} quiz{qCount !== 1 ? "zes" : ""}</span>
                          <span>🎓 {enrolled} enrolled</span>
                          <span style={{ background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 6, padding: "2px 8px", fontFamily: "monospace", fontWeight: 700, color: "#475569" }}>{c.joinCode}</span>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <Btn size="sm" variant="purple" onClick={() => setQrTarget({ title: c.name, code: c.joinCode, description: `Share this QR to give students access to "${c.name}"` })}>📱 QR Code</Btn>
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
                  const avgScore = attempts.length ? Math.round(attempts.reduce((s, a) => s + (a.score / q.questions.length) * 100, 0) / attempts.length) : null;
                  return (
                    <Card key={q.id}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 16, color: "#1e293b" }}>{q.title}</div>
                          <div style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>{q.description}</div>
                          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 8, display: "flex", gap: 12, alignItems: "center" }}>
                            <span>📚 {course?.name}</span>
                            <span>❓ {q.questions.length} Qs</span>
                            <span>🎯 {attempts.length} attempts{avgScore !== null ? ` · Avg ${avgScore}%` : ""}</span>
                            <span style={{ background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 6, padding: "2px 8px", fontFamily: "monospace", fontWeight: 700, color: "#475569" }}>{q.joinCode}</span>
                          </div>
                        </div>
                        <Btn size="sm" variant="purple" onClick={() => setQrTarget({ title: q.title, code: q.joinCode, description: `Share this QR so students can directly access the quiz "${q.title}"` })}>📱 QR Code</Btn>
                      </div>
                    </Card>
                  );
                })}
              </div>
            }
          </>
        )}

        {/* ── Credentials tab — admin only, post-login ── */}
        {tab === "credentials" && user.role === "admin" && (
          <>
            <h2 style={{ margin: "0 0 24px", fontWeight: 800, fontSize: 26, color: "#0f172a" }}>🔑 Login Credentials</h2>
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
            options={[{ value: "", label: "— Select Teacher —" }, ...teachers.map(t => ({ value: t.id, label: t.name }))]} />
          {err && <p style={{ color: "#dc2626", fontSize: 13 }}>{err}</p>}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <Btn variant="ghost" onClick={closeModal}>Cancel</Btn>
            <Btn onClick={saveCourse}>{form.id ? "Save Changes" : "Create Course"}</Btn>
          </div>
        </Modal>
      )}

      {qrTarget && <QRModal title={qrTarget.title} code={qrTarget.code} description={qrTarget.description} onClose={() => setQrTarget(null)} />}
    </div>
  );
};

// ─── TEACHER MODULE ───────────────────────────────────────────────────────────
const TeacherApp = ({ db, setDb, user, onLogout }) => {
  const [tab, setTab]           = useState("overview");
  const [modal, setModal]       = useState(null);
  const [form, setForm]         = useState({});
  const [err, setErr]           = useState("");
  const [editingQuiz, setEditingQuiz] = useState(null);
  const [questionForm, setQuestionForm] = useState({ text: "", options: ["", "", "", ""], correctAnswer: 0 });
  const [qrTarget, setQrTarget] = useState(null);
  const [selectedQuizId, setSelectedQuizId] = useState("all");

  const myCourses   = db.courses.filter(c => c.teacherId === user.id);
  const myCourseIds = myCourses.map(c => c.id);
  const myQuizzes   = db.quizzes.filter(q => myCourseIds.includes(q.courseId));
  const myQuizIds   = myQuizzes.map(q => q.id);
  const teacherAttempts = db.attempts.filter(a => myQuizIds.includes(a.quizId));

  const tabs = [
    { id: "overview", label: "Overview",   icon: "🏠" },
    { id: "courses",  label: "My Courses", icon: "📚" },
    { id: "quizzes",  label: "My Quizzes", icon: "📝" },
    { id: "results",  label: "Results",    icon: "📊" },
    ...(editingQuiz ? [{ id: "editor", label: "Quiz Editor", icon: "✏️" }] : []),
  ];

  const openQuizModal = (data = {}) => {
    setModal("quiz");
    setForm(data.id ? { ...data } : { courseId: myCourseIds[0] || "", title: "", description: "" });
    setErr("");
  };

  const saveQuiz = () => {
    if (!form.title || !form.courseId) return setErr("Title and course required.");
    setDb(d => ({
      ...d,
      quizzes: form.id
        ? d.quizzes.map(q => q.id === form.id ? { ...q, ...form } : q)
        : [...d.quizzes, { ...form, id: genId(), joinCode: genCode("QZ-"), questions: [] }]
    }));
    setModal(null);
  };

  const deleteQuiz = (id) => {
    if (!window.confirm("Delete this quiz?")) return;
    setDb(d => ({ ...d, quizzes: d.quizzes.filter(q => q.id !== id) }));
    if (editingQuiz?.id === id) { setEditingQuiz(null); setTab("quizzes"); }
  };

  const openEditor = (quiz) => {
    setEditingQuiz(quiz);
    setTab("editor");
    setQuestionForm({ text: "", options: ["", "", "", ""], correctAnswer: 0 });
    setErr("");
  };

  const addQuestion = () => {
    if (!questionForm.text || questionForm.options.some(o => !o)) return setErr("Fill all question fields.");
    const newQ = { id: genId(), ...questionForm };
    setDb(d => ({ ...d, quizzes: d.quizzes.map(q => q.id === editingQuiz.id ? { ...q, questions: [...q.questions, newQ] } : q) }));
    setEditingQuiz(prev => ({ ...prev, questions: [...prev.questions, newQ] }));
    setQuestionForm({ text: "", options: ["", "", "", ""], correctAnswer: 0 });
    setErr("");
  };

  const deleteQuestion = (qid) => {
    setDb(d => ({ ...d, quizzes: d.quizzes.map(q => q.id === editingQuiz.id ? { ...q, questions: q.questions.filter(qq => qq.id !== qid) } : q) }));
    setEditingQuiz(prev => ({ ...prev, questions: prev.questions.filter(qq => qq.id !== qid) }));
  };

  const currentQuiz = editingQuiz ? db.quizzes.find(q => q.id === editingQuiz.id) : null;

  // ── Results helpers ──────────────────────────────────────────────────────
  const filteredAttempts = selectedQuizId === "all"
    ? teacherAttempts
    : teacherAttempts.filter(a => a.quizId === selectedQuizId);

  const getScorePercent = (attempt) => {
    const quiz = db.quizzes.find(q => q.id === attempt.quizId);
    if (!quiz || !quiz.questions.length) return 0;
    const num = typeof attempt.score === "number" ? attempt.score : parseInt(attempt.score, 10);
    return Math.round((num / quiz.questions.length) * 100);
  };

  const getScoreColor = (pct) => {
    if (pct >= 80) return { color: "#065f46", bg: "#d1fae5" };
    if (pct >= 50) return { color: "#92400e", bg: "#fef3c7" };
    return { color: "#991b1b", bg: "#fee2e2" };
  };

  const exportResults = () => {
    const BOM  = "\uFEFF"; // UTF-8 BOM so Excel opens file correctly
    const rows = [["Name", "USN", "Quiz", "Course", "Score", "Score %"]];
    filteredAttempts.forEach(a => {
      const quiz   = db.quizzes.find(q => q.id === a.quizId);
      const course = db.courses.find(c => c.id === quiz?.courseId);
      const pct    = getScorePercent(a);
      const total  = quiz?.questions?.length ?? "?";
      const num    = typeof a.score === "number" ? a.score : parseInt(a.score, 10);
      // "X out of Y" format — plain words that Excel will never misread as a date
      const scoreCell = `${isNaN(num) ? "?" : num} out of ${total}`;
      rows.push([
        a.studentName || "—",
        a.studentUSN  || "—",
        quiz?.title   || "—",
        course?.name  || "—",
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

  // Per-quiz summary cards for the results header
  const quizSummaries = myQuizzes.map(q => {
    const attempts = teacherAttempts.filter(a => a.quizId === q.id);
    const avg = attempts.length
      ? Math.round(attempts.reduce((s, a) => s + getScorePercent(a), 0) / attempts.length)
      : null;
    return { quiz: q, attempts, avg };
  }).filter(s => s.attempts.length > 0);

  return (
    <div style={{ display: "flex" }}>
      <Sidebar user={user} activeTab={tab} setTab={t => { setTab(t); if (t !== "editor") setEditingQuiz(null); }} tabs={tabs} onLogout={onLogout} />
      <main style={{ flex: 1, padding: 32, background: "#f8fafc", minHeight: "100vh" }}>

        {tab === "overview" && (
          <>
            <h2 style={{ margin: "0 0 24px", fontWeight: 800, fontSize: 26, color: "#0f172a" }}>Welcome, {user.name.split(" ")[0]} 👋</h2>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 32 }}>
              <Stat icon="📚" label="My Courses"     value={myCourses.length}      color="#2563eb" />
              <Stat icon="📝" label="My Quizzes"     value={myQuizzes.length}      color="#7c3aed" />
              <Stat icon="✅" label="Total Attempts" value={teacherAttempts.length} color="#059669" />
            </div>
            <Card>
              <h3 style={{ margin: "0 0 8px", fontWeight: 700 }}>Share Course Access via QR</h3>
              <p style={{ color: "#64748b", fontSize: 14, margin: "0 0 16px" }}>Go to <strong>My Courses</strong> or <strong>My Quizzes</strong> to generate QR codes. Students must scan or enter the code to join.</p>
              <div style={{ display: "flex", gap: 10 }}>
                <Btn onClick={() => setTab("courses")} variant="outline">My Courses →</Btn>
                <Btn onClick={() => { setTab("quizzes"); openQuizModal(); }}>+ New Quiz</Btn>
              </div>
            </Card>
          </>
        )}

        {tab === "courses" && (
          <>
            <h2 style={{ margin: "0 0 24px", fontWeight: 800, fontSize: 26, color: "#0f172a" }}>My Courses</h2>
            {myCourses.length === 0
              ? <Card><p style={{ color: "#94a3b8", textAlign: "center" }}>No courses assigned yet.</p></Card>
              : <div style={{ display: "grid", gap: 14 }}>
                {myCourses.map(c => {
                  const qz       = myQuizzes.filter(q => q.courseId === c.id);
                  const enrolled = db.enrollments.filter(e => e.courseId === c.id).length;
                  return (
                    <Card key={c.id}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 700, fontSize: 16, color: "#1e293b", marginBottom: 4 }}>{c.name}</div>
                          <div style={{ fontSize: 13, color: "#64748b", marginBottom: 10 }}>{c.description}</div>
                          <div style={{ fontSize: 12, color: "#94a3b8", display: "flex", gap: 12, alignItems: "center" }}>
                            <span>📝 {qz.length} quiz{qz.length !== 1 ? "zes" : ""}</span>
                            <span>🎓 {enrolled} students enrolled</span>
                            <span style={{ background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 6, padding: "2px 8px", fontFamily: "monospace", fontWeight: 700, color: "#475569" }}>{c.joinCode}</span>
                          </div>
                        </div>
                        <Btn size="sm" variant="purple" onClick={() => setQrTarget({ title: c.name, code: c.joinCode, description: `Share this QR to give students access to "${c.name}"` })}>📱 QR Code</Btn>
                      </div>
                    </Card>
                  );
                })}
              </div>
            }
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
                            <span>📚 {course?.name}</span>
                            <span>❓ {q.questions.length} questions</span>
                            <span>🎯 {attempts.length} attempts</span>
                            <span style={{ background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 6, padding: "2px 8px", fontFamily: "monospace", fontWeight: 700, color: "#475569" }}>{q.joinCode}</span>
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <Btn size="sm" variant="purple"  onClick={() => setQrTarget({ title: q.title, code: q.joinCode, description: `Share this QR so students can directly access "${q.title}"` })}>📱 QR</Btn>
                          <Btn size="sm" variant="outline" onClick={() => openEditor(q)}>✏️ Questions</Btn>
                          <Btn size="sm" variant="ghost"   onClick={() => openQuizModal(q)}>Edit</Btn>
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
            <button onClick={() => { setTab("quizzes"); setEditingQuiz(null); }} style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontWeight: 600, padding: 0, fontSize: 14, marginBottom: 12 }}>← Back to Quizzes</button>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
              <div>
                <h2 style={{ margin: "0 0 4px", fontWeight: 800, fontSize: 24, color: "#0f172a" }}>✏️ {currentQuiz.title}</h2>
                <p style={{ margin: 0, color: "#64748b", fontSize: 14 }}>{currentQuiz.questions.length} question{currentQuiz.questions.length !== 1 ? "s" : ""} added</p>
              </div>
              <Btn variant="purple" size="sm" onClick={() => setQrTarget({ title: currentQuiz.title, code: currentQuiz.joinCode, description: `Share this QR so students can directly access "${currentQuiz.title}"` })}>📱 QR Code</Btn>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
              <Card>
                <h3 style={{ margin: "0 0 16px", fontWeight: 700, fontSize: 15 }}>Add New Question</h3>
                <Textarea label="Question Text" value={questionForm.text} onChange={e => setQuestionForm({ ...questionForm, text: e.target.value })} placeholder="Enter your question..." />
                {[0,1,2,3].map(i => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                    <input type="radio" name="correct" checked={questionForm.correctAnswer === i} onChange={() => setQuestionForm({ ...questionForm, correctAnswer: i })} style={{ accentColor: "#059669", width: 16, height: 16 }} />
                    <input value={questionForm.options[i]} onChange={e => { const opts = [...questionForm.options]; opts[i] = e.target.value; setQuestionForm({ ...questionForm, options: opts }); }} placeholder={`Option ${String.fromCharCode(65+i)}`}
                      style={{ flex: 1, padding: "7px 10px", border: "1.5px solid #d1d5db", borderRadius: 8, fontSize: 13, fontFamily: "inherit" }} />
                  </div>
                ))}
                <p style={{ fontSize: 12, color: "#059669", margin: "0 0 12px" }}>● Select radio = correct answer</p>
                {err && <p style={{ color: "#dc2626", fontSize: 13, margin: "0 0 10px" }}>{err}</p>}
                <Btn onClick={addQuestion} variant="success">+ Add Question</Btn>
              </Card>

              <div>
                <h3 style={{ margin: "0 0 16px", fontWeight: 700, fontSize: 15 }}>Questions ({currentQuiz.questions.length})</h3>
                {currentQuiz.questions.length === 0
                  ? <Card><p style={{ color: "#94a3b8", textAlign: "center", margin: 0 }}>No questions yet.</p></Card>
                  : currentQuiz.questions.map((q, i) => (
                    <Card key={q.id} style={{ marginBottom: 12, padding: "14px 16px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 700, fontSize: 14, color: "#1e293b", marginBottom: 8 }}>Q{i+1}. {q.text}</div>
                          {q.options.map((opt, oi) => (
                            <div key={oi} style={{ fontSize: 13, padding: "4px 8px", borderRadius: 6, marginBottom: 4, background: oi === q.correctAnswer ? "#d1fae5" : "#f8fafc", color: oi === q.correctAnswer ? "#065f46" : "#475569", fontWeight: oi === q.correctAnswer ? 700 : 400 }}>
                              {oi === q.correctAnswer ? "✓ " : `${String.fromCharCode(65+oi)}. `}{opt}
                            </div>
                          ))}
                        </div>
                        <Btn size="sm" variant="danger" onClick={() => deleteQuestion(q.id)} style={{ marginLeft: 8 }}>×</Btn>
                      </div>
                    </Card>
                  ))
                }
              </div>
            </div>
          </>
        )}

        {/* ── Results Tab ─────────────────────────────────────────────────── */}
        {tab === "results" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <h2 style={{ margin: 0, fontWeight: 800, fontSize: 26, color: "#0f172a" }}>📊 Student Results</h2>
              <Btn variant="success" onClick={exportResults}>⬇ Export CSV</Btn>
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
                    <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>attempt{attempts.length !== 1 ? "s" : ""}{avg !== null ? ` · Avg ${avg}%` : ""}</div>
                  </div>
                ))}
                {selectedQuizId !== "all" && (
                  <div onClick={() => setSelectedQuizId("all")} style={{ flex: "0 0 auto", display: "flex", alignItems: "center", padding: "0 16px", background: "#f1f5f9", border: "1.5px solid #e2e8f0", borderRadius: 12, cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#475569" }}>
                    Show All
                  </div>
                )}
              </div>
            )}

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
                      {["#", "Name", "USN", "Quiz", "Course", "Score", "Score %"].map(h => (
                        <th key={h} style={{ padding: "11px 14px", textAlign: "left", fontWeight: 700, fontSize: 12, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAttempts.map((a, i) => {
                      const quiz   = db.quizzes.find(q => q.id === a.quizId);
                      const course = db.courses.find(c => c.id === quiz?.courseId);
                      const pct    = getScorePercent(a);
                      const { color, bg } = getScoreColor(pct);
                      return (
                        <tr key={a.id} style={{ borderBottom: "1px solid #f1f5f9", background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                          <td style={{ padding: "11px 14px", color: "#94a3b8", fontSize: 12 }}>{i + 1}</td>
                          <td style={{ padding: "11px 14px", fontWeight: 600, color: "#1e293b" }}>{a.studentName || "—"}</td>
                          <td style={{ padding: "11px 14px", fontFamily: "monospace", fontSize: 13, color: "#475569" }}>{a.studentUSN || "—"}</td>
                          <td style={{ padding: "11px 14px", color: "#1e293b" }}>{quiz?.title || "—"}</td>
                          <td style={{ padding: "11px 14px", color: "#64748b", fontSize: 13 }}>{course?.name || "—"}</td>
                          <td style={{ padding: "11px 14px", fontWeight: 700, color: "#1e293b" }}>
                            {typeof a.score === "number" ? a.score : parseInt(a.score, 10)} / {quiz?.questions?.length ?? "?"}
                          </td>
                          <td style={{ padding: "11px 14px" }}>
                            <span style={{ background: bg, color, borderRadius: 20, padding: "3px 10px", fontSize: 12, fontWeight: 700 }}>{pct}%</span>
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

      {modal === "quiz" && (
        <Modal title={form.id ? "Edit Quiz" : "New Quiz"} onClose={() => setModal(null)}>
          <Input    label="Quiz Title"   value={form.title       || ""} onChange={e => setForm({ ...form, title:       e.target.value })} />
          <Textarea label="Description"  value={form.description || ""} onChange={e => setForm({ ...form, description: e.target.value })} />
          <Select   label="Course"       value={form.courseId    || ""} onChange={e => setForm({ ...form, courseId:    e.target.value })} options={myCourses.map(c => ({ value: c.id, label: c.name }))} />
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

// ─── STUDENT MODULE ───────────────────────────────────────────────────────────
const StudentApp = ({ db, setDb, user, onLogout }) => {
  const [tab, setTab]             = useState("join");
  const [codeInput, setCodeInput] = useState("");
  const [codeError, setCodeError] = useState("");
  const [selectedCourse, setSelectedCourse]     = useState(null);
  const [activeQuiz, setActiveQuiz]             = useState(null);
  const [answers, setAnswers]                   = useState({});
  const [submitted, setSubmitted]               = useState(false);
  const [result, setResult]                     = useState(null);
  const [showRegistration, setShowRegistration] = useState(false);
  const [pendingQuiz, setPendingQuiz]           = useState(null);

  const [studentName, setStudentName] = useState(user.name || "");
  const [studentUSN, setStudentUSN]   = useState(user.usn  || "");

  const myEnrollments = db.enrollments.filter(e => e.studentId === user.id);
  const myCourseIds   = myEnrollments.map(e => e.courseId);
  const myAttempts    = db.attempts.filter(a => a.studentId === user.id);

  // ── Read QR code from URL once on mount only ──────────────────────────────
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

}, [db.quizzes]);// ← empty: run once on mount only

  const tabs = [
    { id: "join",      label: "Join via Code", icon: "📱" },
    { id: "mycourses", label: "My Courses",     icon: "📚" },
    { id: "myresults", label: "My Results",     icon: "🏆" },
  ];

  // ── Join via code ─────────────────────────────────────────────────────────
  const handleJoin = () => {
    const code = codeInput.trim().toUpperCase();
    if (!code) { setCodeError("Please enter a code."); return; }

    const course = db.courses.find(c => c.joinCode.toUpperCase() === code);
    if (course) {
      const already = myEnrollments.find(e => e.courseId === course.id);
      if (!already) {
        setDb(d => ({
          ...d,
          enrollments: [...d.enrollments, { id: genId(), studentId: user.id, courseId: course.id }],
        }));
      }
      alert(`Joined ${course.name}`);
      setCodeInput("");
      setCodeError("");
      return;
    }

    const quiz = db.quizzes.find(q => q.joinCode.toUpperCase() === code);
    if (quiz) {
      setPendingQuiz(quiz);
      setShowRegistration(true);
      setCodeInput("");
      setCodeError("");
      return;
    }

    setCodeError("Invalid code.");
  };

  // ── Launch quiz (after registration) ─────────────────────────────────────
  const launchQuiz = (quiz) => {
    const alreadyAttempted = db.attempts.find(
      a => a.studentId === user.id && a.quizId === quiz.id
    );
    if (alreadyAttempted) {
      alert("You have already attempted this quiz.");
      return;
    }
    setActiveQuiz(quiz);
    setAnswers({});
    setSubmitted(false);
    setResult(null);
  };

  // ── Registration screen handler ───────────────────────────────────────────
  const startRegisteredQuiz = () => {
    if (!studentName.trim()) { alert("Please enter your name."); return; }
    if (!studentUSN.trim())  { alert("Please enter your USN.");  return; }
    setShowRegistration(false);
    launchQuiz(pendingQuiz);
  };

  // ── Open registration before launching from course view ──────────────────
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

  // ── Submit quiz ───────────────────────────────────────────────────────────
  const submitQuiz = () => {
    if (Object.keys(answers).length < activeQuiz.questions.length) {
      alert("Please answer all questions before submitting.");
      return;
    }
    let score = 0;
    activeQuiz.questions.forEach((q, i) => {
      if (answers[i] === q.correctAnswer) score++;
    });
    const attempt = {
      id:          genId(),
      studentId:   user.id,
      studentName: studentName,
      studentUSN:  studentUSN,
      quizId:      activeQuiz.id,
      answers:     { ...answers },
      score,                          // plain number e.g. 4
      completedAt: new Date().toISOString(),
    };
    setDb(d => ({ ...d, attempts: [...d.attempts, attempt] }));
    setResult({ score, total: activeQuiz.questions.length });
    setSubmitted(true);
  };

  // ── Registration screen ───────────────────────────────────────────────────
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
            <Btn onClick={startRegisteredQuiz}>Start Quiz →</Btn>
          </div>
        </Card>
      </div>
    );
  }

  // ── Quiz taking / results screen ──────────────────────────────────────────
  if (activeQuiz) {
    const pct        = submitted ? Math.round((result.score / result.total) * 100) : 0;
    const grade      = pct >= 90 ? "A" : pct >= 75 ? "B" : pct >= 60 ? "C" : pct >= 50 ? "D" : "F";
    const gradeColor = pct >= 75 ? "#059669" : pct >= 50 ? "#d97706" : "#dc2626";

    return (
      <div style={{ minHeight: "100vh", background: "#f8fafc" }}>
        <div style={{ background: "#0f172a", padding: "16px 32px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ color: "#fff", fontWeight: 800, fontSize: 18 }}>📋 Quizly — {activeQuiz.title}</div>
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
                <p style={{ margin: "0 0 12px", color: "#64748b" }}>{activeQuiz.description} · {activeQuiz.questions.length} questions</p>
                <div style={{ background: "#e2e8f0", borderRadius: 20, height: 6 }}>
                  <div style={{ height: 6, borderRadius: 20, background: "#1e40af", width: `${(Object.keys(answers).length / activeQuiz.questions.length) * 100}%`, transition: "width .3s" }} />
                </div>
                <p style={{ margin: "6px 0 0", fontSize: 13, color: "#64748b" }}>{Object.keys(answers).length} / {activeQuiz.questions.length} answered</p>
              </div>

              {activeQuiz.questions.map((q, qi) => (
                <Card key={q.id} style={{ marginBottom: 16, border: answers[qi] !== undefined ? "2px solid #bfdbfe" : "1.5px solid #e2e8f0" }}>
                  <div style={{ fontWeight: 700, marginBottom: 14, color: "#1e293b" }}>
                    <span style={{ color: "#2563eb", marginRight: 8 }}>Q{qi + 1}.</span>{q.text}
                  </div>
                  <div style={{ display: "grid", gap: 8 }}>
                    {q.options.map((opt, oi) => (
                      <label key={oi} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 8, cursor: "pointer", background: answers[qi] === oi ? "#eff6ff" : "#f8fafc", border: answers[qi] === oi ? "2px solid #2563eb" : "1.5px solid #e2e8f0", transition: "all .15s" }}>
                        <input type="radio" name={`q${qi}`} checked={answers[qi] === oi} onChange={() => setAnswers({ ...answers, [qi]: oi })} style={{ accentColor: "#2563eb" }} />
                        <span style={{ fontWeight: answers[qi] === oi ? 600 : 400, fontSize: 14 }}>{String.fromCharCode(65 + oi)}. {opt}</span>
                      </label>
                    ))}
                  </div>
                </Card>
              ))}

              <div style={{ textAlign: "center", marginTop: 32 }}>
                <Btn size="lg" variant="success" onClick={submitQuiz}>Submit Quiz ✓</Btn>
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
                <p style={{ margin: "0 0 24px", fontSize: 14, color: "#64748b" }}>
                  {pct === 100 ? "🎉 Perfect!" : pct >= 75 ? "Great job!" : pct >= 50 ? "Keep practicing!" : "Better luck next time."}
                </p>
                <Btn onClick={() => setActiveQuiz(null)} variant="outline">Back to My Courses</Btn>
              </Card>

              <h3 style={{ fontWeight: 800, fontSize: 18, marginBottom: 16 }}>Answer Review</h3>
              {activeQuiz.questions.map((q, qi) => {
                const correct = answers[qi] === q.correctAnswer;
                return (
                  <Card key={q.id} style={{ marginBottom: 12, border: `2px solid ${correct ? "#bbf7d0" : "#fecaca"}` }}>
                    <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
                      <span style={{ fontSize: 18 }}>{correct ? "✅" : "❌"}</span>
                      <span style={{ fontWeight: 700, color: "#1e293b" }}>Q{qi + 1}. {q.text}</span>
                    </div>
                    <div style={{ paddingLeft: 28, display: "grid", gap: 6 }}>
                      {q.options.map((opt, oi) => {
                        const isCorrect  = oi === q.correctAnswer;
                        const isSelected = oi === answers[qi];
                        return (
                          <div key={oi} style={{ fontSize: 13, padding: "5px 10px", borderRadius: 6, background: isCorrect ? "#d1fae5" : isSelected ? "#fee2e2" : "#f8fafc", color: isCorrect ? "#065f46" : isSelected ? "#991b1b" : "#64748b", fontWeight: isCorrect || isSelected ? 600 : 400 }}>
                            {isCorrect ? "✓ " : isSelected ? "✗ " : `${String.fromCharCode(65 + oi)}. `}{opt}
                            {isCorrect && <span style={{ marginLeft: 8, fontSize: 11 }}>(Correct Answer)</span>}
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                );
              })}
            </>
          )}
        </div>
      </div>
    );
  }

  // ── Main student dashboard ────────────────────────────────────────────────
  return (
    <div style={{ display: "flex" }}>
      <Sidebar user={user} activeTab={tab} setTab={t => { setTab(t); setSelectedCourse(null); }} tabs={tabs} onLogout={onLogout} />
      <main style={{ flex: 1, padding: 32, background: "#f8fafc", minHeight: "100vh" }}>

        {/* ── JOIN TAB ── */}
        {tab === "join" && (
          <div style={{ maxWidth: 520, margin: "0 auto" }}>
            <h2 style={{ margin: "0 0 6px", fontWeight: 800, fontSize: 26, color: "#0f172a" }}>Join via QR Code</h2>
            <p style={{ margin: "0 0 32px", color: "#64748b" }}>Scan the QR code shared by your teacher, or enter the code manually below.</p>

            <Card style={{ textAlign: "center", marginBottom: 28, padding: 36, background: "linear-gradient(135deg,#0f172a,#1e3a5f)", border: "none" }}>
              <div style={{ fontSize: 64, marginBottom: 12 }}>📱</div>
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
                <Btn size="md" onClick={handleJoin}>Join →</Btn>
              </div>
              {codeError && <p style={{ color: "#dc2626", fontSize: 13, margin: "10px 0 0" }}>⚠ {codeError}</p>}
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

        {/* ── MY COURSES TAB — course list ── */}
        {tab === "mycourses" && !selectedCourse && (
          <>
            <h2 style={{ margin: "0 0 6px", fontWeight: 800, fontSize: 26, color: "#0f172a" }}>My Courses</h2>
            <p style={{ margin: "0 0 24px", color: "#64748b" }}>Courses you have joined. Click a course to take its quizzes.</p>
            {myCourseIds.length === 0 ? (
              <Card style={{ textAlign: "center", padding: 48 }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>📱</div>
                <div style={{ fontWeight: 700, fontSize: 16, color: "#1e293b", marginBottom: 8 }}>No courses joined yet</div>
                <div style={{ color: "#64748b", marginBottom: 20 }}>Scan a QR code or enter a course code from your teacher.</div>
                <Btn onClick={() => setTab("join")}>Join a Course →</Btn>
              </Card>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px,1fr))", gap: 16 }}>
                {db.courses.filter(c => myCourseIds.includes(c.id)).map(c => {
                  const teacher = db.users.find(u => u.id === c.teacherId);
                  const qCount  = db.quizzes.filter(q => q.courseId === c.id).length;
                  const done    = myAttempts.filter(a => db.quizzes.find(q => q.id === a.quizId && q.courseId === c.id)).length;
                  return (
                    <Card key={c.id} style={{ cursor: "pointer" }} onClick={() => setSelectedCourse(c)}>
                      <div style={{ width: 44, height: 44, borderRadius: 10, background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, marginBottom: 12 }}>📚</div>
                      <div style={{ fontWeight: 700, fontSize: 16, color: "#1e293b", marginBottom: 4 }}>{c.name}</div>
                      <div style={{ fontSize: 13, color: "#64748b", marginBottom: 12 }}>{c.description}</div>
                      <div style={{ fontSize: 12, color: "#94a3b8" }}>👨‍🏫 {teacher?.name || "—"} · 📝 {qCount} quiz{qCount !== 1 ? "zes" : ""} · ✅ {done} done</div>
                    </Card>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* ── MY COURSES TAB — quiz list inside a course ── */}
        {tab === "mycourses" && selectedCourse && (
          <>
            <button onClick={() => setSelectedCourse(null)} style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontWeight: 600, padding: 0, fontSize: 14, marginBottom: 12 }}>← Back to My Courses</button>
            <h2 style={{ margin: "0 0 4px", fontWeight: 800, fontSize: 24, color: "#0f172a" }}>{selectedCourse.name}</h2>
            <p style={{ margin: "0 0 24px", color: "#64748b" }}>{selectedCourse.description}</p>
            {db.quizzes.filter(q => q.courseId === selectedCourse.id).length === 0
              ? <Card><p style={{ color: "#94a3b8", textAlign: "center" }}>No quizzes available yet.</p></Card>
              : (
                <div style={{ display: "grid", gap: 14 }}>
                  {db.quizzes.filter(q => q.courseId === selectedCourse.id).map(q => {
                    const attempt = [...myAttempts].reverse().find(a => a.quizId === q.id);
                    const score   = attempt ? (typeof attempt.score === "number" ? attempt.score : parseInt(attempt.score, 10)) : null;
                    const pct     = (attempt && score !== null) ? Math.round((score / q.questions.length) * 100) : null;
                    return (
                      <Card key={q.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 16, color: "#1e293b" }}>{q.title}</div>
                          <div style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>{q.description}</div>
                          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 6 }}>
                            ❓ {q.questions.length} questions
                            {pct !== null && (
                              <span style={{ color: pct >= 75 ? "#059669" : "#d97706", fontWeight: 700, marginLeft: 8 }}>
                                · Last: {pct}%
                              </span>
                            )}
                          </div>
                        </div>
                        {attempt ? (
                          <Btn size="sm" disabled variant="outline">Completed ✓</Btn>
                        ) : (
                          // ← goes through registration so name/USN are always captured
                          <Btn size="sm" onClick={() => openRegistrationFor(q)}>Start Quiz →</Btn>
                        )}
                      </Card>
                    );
                  })}
                </div>
              )
            }
          </>
        )}

        {/* ── MY RESULTS TAB ── */}
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
                    const total  = quiz?.questions?.length ?? 0;
                    const pct    = total > 0 ? Math.round((num / total) * 100) : 0;
                    const color  = pct >= 75 ? "#059669" : pct >= 50 ? "#d97706" : "#dc2626";
                    return (
                      <Card key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 15, color: "#1e293b" }}>{quiz?.title || "Deleted Quiz"}</div>
                          <div style={{ fontSize: 13, color: "#64748b" }}>📚 {course?.name || "—"}</div>
                          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>
                            {a.completedAt ? new Date(a.completedAt).toLocaleString() : "—"}
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

// ─── LOGIN PAGE ───────────────────────────────────────────────────────────────
const LoginPage = ({ db, onLogin }) => {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr]           = useState("");

  const demos = [
    { label: "Admin",                role: "admin"   },
    { label: "Teacher (Dr. Sharma)", role: "teacher" },
    { label: "Teacher (Prof. Mehta)",role: "teacher" },
    { label: "Student (Priya)",      role: "student" },
    { label: "Student (Arjun)",      role: "student" },
  ];

  // ── Fix 1: handleLogin defined inside the component ───────────────────────
 

  // ── Fix 2: demo buttons auto-fill from db, not hardcoded — no email shown ─
  const handleDemoClick = (label) => {
    const roleMap = {
      "Admin":                 "admin",
      "Teacher (Dr. Sharma)":  "teacher",
      "Teacher (Prof. Mehta)": "teacher",
      "Student (Priya)":       "student",
      "Student (Arjun)":       "student",
    };
    const nameMap = {
      "Admin":                 "Super Admin",
      "Teacher (Dr. Sharma)":  "Dr. Ananya Sharma",
      "Teacher (Prof. Mehta)": "Prof. Rahul Mehta",
      "Student (Priya)":       "Priya Patel",
      "Student (Arjun)":       "Arjun Nair",
    };
    const user = db.users.find(u => u.name === nameMap[label] && u.role === roleMap[label]);
    if (user) {
      setEmail(user.email);
      setPassword(user.password);
      setErr("");
    }
  };
const handleLogin = async () => {

  try {

    console.log("Trying login...");
console.log("Email:", email);
console.log("Password:", password);

const cred = await signInWithEmailAndPassword(
  auth,
  email.trim(),
  password.trim()
);

console.log("LOGIN SUCCESS");
console.log("UID:", cred.user.uid);

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
  return (
    <div style={{ minHeight: "100vh", display: "flex", background: "#f1f5f9" }}>

      {/* ── Left panel ── */}
      <div style={{ flex: 1, background: "#0f172a", display: "flex", flexDirection: "column", justifyContent: "center", padding: "60px", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(circle at 30% 50%, #1e40af22 0%, transparent 60%), radial-gradient(circle at 80% 20%, #7c3aed22 0%, transparent 50%)" }} />
        <div style={{ position: "relative", zIndex: 1 }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>📋</div>
          <h1 style={{ color: "#fff", fontWeight: 900, fontSize: 40, margin: "0 0 16px", letterSpacing: -1 }}>Quizly</h1>
          <p style={{ color: "#94a3b8", fontSize: 16, lineHeight: 1.6, maxWidth: 380, marginBottom: 48 }}>
            QR-powered quiz platform. Teachers share QR codes — students scan to access only their assigned courses.
          </p>

          <p style={{ color: "#64748b", fontSize: 12, marginBottom: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>
            Quick Login
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {demos.map((d, i) => (
              <button
                key={i}
                onClick={() => handleDemoClick(d.label)}
                style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "10px 14px", cursor: "pointer", textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center", transition: "border-color .15s" }}
                onMouseEnter={e => e.currentTarget.style.borderColor = "#475569"}
                onMouseLeave={e => e.currentTarget.style.borderColor = "#334155"}
              >
                {/* ── Fix 2: only label shown, no email or password ── */}
                <span style={{ color: "#f1f5f9", fontWeight: 600, fontSize: 13 }}>{d.label}</span>
                <Badge role={d.role} />
              </button>
            ))}
          </div>

          <p style={{ color: "#334155", fontSize: 12, marginTop: 16 }}>
            Click any account above to auto-fill credentials.
          </p>
        </div>
      </div>

      {/* ── Right panel ── */}
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
            <p style={{ color: "#dc2626", fontSize: 13, margin: "-8px 0 12px" }}>⚠ {err}</p>
          )}

          <Btn size="lg" onClick={handleLogin} style={{ width: "100%", justifyContent: "center" }}>
            Sign In →
          </Btn>

          <p style={{ color: "#94a3b8", fontSize: 12, marginTop: 24, textAlign: "center" }}>
            Click a demo account on the left to auto-fill credentials.
          </p>
        </div>
      </div>
    </div>
  );
};

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function App() {

  const [db, setDb] = useState(() => {
    try {
      const saved = localStorage.getItem("quizly-db");
      if (!saved) return SEED;
      const parsed = JSON.parse(saved);
      // Ensure all SEED users still exist (guards against stale saves missing new fields)
      const hasAllUsers = SEED.users.every(su => parsed.users?.find(u => u.id === su.id));
      return hasAllUsers ? parsed : SEED;
    } catch {
      return SEED;
    }
  });

  useEffect(() => {
    localStorage.setItem("quizly-db", JSON.stringify(db));
  }, [db]);

  const [currentUser, setCurrentUser] = useState(null);

  const logout = () => setCurrentUser(null);

  // ── QR code from URL ──────────────────────────────────────────────────────
  const params = new URLSearchParams(window.location.search);
  const qrCode = params.get("code");

  // ── Fix 3: guest gets a unique id per session, not "guest" ────────────────
  if (!currentUser) {
    if (qrCode) {
      const quiz = db.quizzes.find(
        q => q.joinCode.toUpperCase() === qrCode.toUpperCase()
      );
      if (quiz) {
        const guestUser = {
          id:   genId(), // unique per session so attempts don't collide
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

    return <LoginPage db={db} onLogin={setCurrentUser} />;
  }

  // ── Route by role ─────────────────────────────────────────────────────────
  if (currentUser.role === "admin") {
    return <AdminApp   db={db} setDb={setDb} user={currentUser} onLogout={logout} />;
  }
  if (currentUser.role === "teacher") {
    return <TeacherApp db={db} setDb={setDb} user={currentUser} onLogout={logout} />;
  }
  return   <StudentApp db={db} setDb={setDb} user={currentUser} onLogout={logout} />;
}
