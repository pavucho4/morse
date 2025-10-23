// Replace config with your Firebase project's config
import { initializeApp } from 'firebase/app'
import { getDatabase } from 'firebase/database'

const firebaseConfig = {
  apiKey: "AIzaSyBXPlLcuCHOLsFnQiUoptPOyIkFGfAOxoE",
  authDomain: "morse-768e2.firebaseapp.com",
  databaseURL: "https://morse-768e2-default-rtdb.firebaseio.com",
  projectId: "morse-768e2",
  storageBucket: "morse-768e2.firebasestorage.app",
  messagingSenderId: "303029676623",
  appId: "1:303029676623:web:e1585a1e7ca6818abc983a"
}

const app = initializeApp(firebaseConfig)
export const db = getDatabase(app)