require("dotenv").config();
const admin = require("firebase-admin");

// Uses GOOGLE_APPLICATION_CREDENTIALS from your .env
admin.initializeApp({
  credential: admin.credential.applicationDefault(),
});

const db = admin.firestore();

async function main() {
  const sourceCollection = process.env.SOURCE_EVENTS_COLLECTION || "events";
  const targetCollection = process.env.TARGET_ONCHAIN_COLLECTION || "onchain_publish_events";

  // Option A: pick a specific event by ID (recommended once you know one)
  const explicitId = process.env.EVENT_ID;

  let eventDoc;

  if (explicitId) {
    const snap = await db.collection(sourceCollection).doc(explicitId).get();
    if (!snap.exists) throw new Error(`No ${sourceCollection}/${explicitId} found`);
    eventDoc = { id: snap.id, data: snap.data() };
  } else {
    // Option B: grab any 1 launch event (avoids composite index requirements)
    const q = await db
      .collection(sourceCollection)
      .where("event_type", "==", "launch")
      .limit(1)
      .get();

    if (q.empty) throw new Error(`No launch events found in ${sourceCollection}`);

    const snap = q.docs[0];
    eventDoc = { id: snap.id, data: snap.data() };
  }

  const e = eventDoc.data || {};
  const m = e.metadata || {};

  const payload = {
    // provenance
    source_event_id: eventDoc.id,
    source_collection: sourceCollection,
    source_event_type: e.event_type || null,
    source_event_date: e.event_date || null,

    // jubjub identifiers (pulled from metadata in your schema)
    profileId: m.profileId || null,
    project_id: m.project_id || null,
    platform: m.platform || null,

    // onchain config context
    chain: process.env.CHAIN || "baseSepolia",
    ledger_address: process.env.LEDGER_ADDRESS || null,

    // onchain state (filled later by the hardhat script that submits tx)
    status: "staged",
    txHash: null,

    // timestamps
    created_at: admin.firestore.FieldValue.serverTimestamp(),
  };

  const ref = await db.collection(targetCollection).add(payload);

  console.log("✅ Read launch event:", `${sourceCollection}/${eventDoc.id}`);
  console.log("✅ Wrote staged onchain record:", `${targetCollection}/${ref.id}`);
  console.log("Payload:", payload);
}

main().catch((err) => {
  console.error("❌ seed-onchain-publish-event failed:", err.message);
  process.exit(1);
});
