require("dotenv").config();

const admin = require("firebase-admin");

async function main() {
  if (!admin.apps.length) {
    admin.initializeApp({
      projectId: process.env.FIREBASE_PROJECT_ID,
    });
  }

  const db = admin.firestore();

  const snap = await db
    .collection("events")
    .where("event_type", "==", "launch")
    .orderBy("event_date", "desc")
    .limit(5)
    .get();

  console.log(`Found ${snap.size} launch events`);

  snap.docs.forEach((doc) => {
    console.log({
      id: doc.id,
      ...doc.data(),
    });
  });
}

main().catch(console.error);
