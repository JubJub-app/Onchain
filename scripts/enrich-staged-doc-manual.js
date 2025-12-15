require("dotenv").config();
const admin = require("firebase-admin");

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
});

async function main() {
  const db = admin.firestore();
  const col = "onchain_publish_events";
  const id = "MDnSnhtFovFZnjOQH3cA";

  await db.collection(col).doc(id).set(
    {
      payload_version: 1,
      owner_profile_id: "unknown_for_now",
      contributors_jubjub: [
        { profileId: "unknown_for_now", role: "owner" }
      ],
      enriched_at: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  console.log("✅ Updated staged doc with contributors:", `${col}/${id}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
