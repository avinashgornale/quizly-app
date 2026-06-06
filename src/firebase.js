import { initializeApp } from "firebase/app";

import { getFirestore } from "firebase/firestore";

import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyAEd9Q2M6uGtOWvl0hZLzrO3WlKUqTh7ww",
  authDomain: "quizly-e95be.firebaseapp.com",
  projectId: "quizly-e95be",
  storageBucket: "quizly-e95be.firebasestorage.app",
  messagingSenderId: "299202181409",
  appId: "1:299202181409:web:e76d49901a73afb4302660"
};

const app = initializeApp(firebaseConfig);

export const firestore = getFirestore(app);

export const auth = getAuth(app);