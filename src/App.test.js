import { fireEvent, render, screen } from "@testing-library/react";
import App from "./App";
import { isQuizAccessValid } from "./QuizApp";

jest.mock("./firebase", () => ({ auth: {}, firestore: {}, functions: {} }));

jest.mock("firebase/auth", () => ({
  onAuthStateChanged: (_auth, callback) => {
    callback(null);
    return jest.fn();
  },
  signInWithEmailAndPassword: jest.fn(),
  sendPasswordResetEmail: jest.fn(),
  signOut: jest.fn()
}));

jest.mock("firebase/functions", () => ({ httpsCallable: jest.fn() }));

jest.mock("firebase/firestore", () => ({
  collection: jest.fn(),
  getDocs: jest.fn(),
  getDoc: jest.fn(),
  addDoc: jest.fn(),
  doc: jest.fn(),
  setDoc: jest.fn(),
  deleteDoc: jest.fn(),
  updateDoc: jest.fn(),
  onSnapshot: jest.fn(),
  query: jest.fn(),
  where: jest.fn()
}));

test("renders the secure sign-in screen for a signed-out visitor", async () => {
  render(<App />);

  expect(await screen.findByRole("heading", { name: /welcome back/i })).toBeInTheDocument();
  expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
});

test("accepts only the current unexpired quiz access token", () => {
  const now = Date.parse("2026-09-02T10:00:00.000Z");
  const quiz = {
    accessToken: "QZ-CURRENT123",
    accessExpiresAt: "2026-09-02T10:10:00.000Z"
  };

  expect(isQuizAccessValid(quiz, "qz-current123", now)).toBe(true);
  expect(isQuizAccessValid(quiz, "QZ-OLDTOKEN", now)).toBe(false);
  expect(isQuizAccessValid(quiz, "QZ-CURRENT123", Date.parse("2026-09-02T10:10:00.000Z"))).toBe(false);
});

test("does not expose public institution onboarding", async () => {
  render(<App />);
  expect(await screen.findByRole("heading", { name: /welcome back/i })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /onboard a new college/i })).not.toBeInTheDocument();
});

test("opens individual faculty subscription signup", async () => {
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: /sign up as individual faculty/i }));
  expect(screen.getByRole("heading", { name: /individual faculty signup/i })).toBeInTheDocument();
  expect(screen.getByLabelText(/subscription/i)).toHaveValue("monthly");
});
