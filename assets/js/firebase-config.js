/* ================================================================
   NEXUS AUTOMOTIVE UK — FIREBASE CONFIGURATION
   Replace the placeholder values below with your Firebase project config.
   Get these from: Firebase Console > Project Settings > Your Apps
   ================================================================ */

const FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// Firebase will be initialised by portal.js / admin.js
// Do not initialise here to avoid duplicate app errors
window.NEXUS_FB_CONFIG = FIREBASE_CONFIG;
