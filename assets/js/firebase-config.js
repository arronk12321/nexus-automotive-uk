/* ================================================================
   NEXUS AUTOMOTIVE UK — Firebase Configuration
   ================================================================ */

window.NEXUS_FB_CONFIG = {
  apiKey: "AIzaSyAoMVPxA9T1MMD7dYm8jg5iH0yfCcdHtsA",
  authDomain: "nexus-automotive-uk.firebaseapp.com",
  projectId: "nexus-automotive-uk",
  storageBucket: "nexus-automotive-uk.firebasestorage.app",
  messagingSenderId: "1012966631321",
  appId: "1:1012966631321:web:7a02dcd3d10e8987e45508",
  measurementId: "G-S9YF1RHW63"
};

// Initialize Firebase immediately
if (!firebase.apps.length) {
  firebase.initializeApp(window.NEXUS_FB_CONFIG);
}

// Expose services globally
const db      = firebase.firestore();
const auth    = firebase.auth();
const storage = firebase.storage();

console.log("✅ Nexus Automotive UK — Firebase connected");
