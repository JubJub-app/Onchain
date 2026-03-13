require("dotenv").config();
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

(async () => {
  const launchId = "lch_efcca7a0b2a4";
  const ref = db.collection("onchain_publish_events").doc(launchId);
  const snap = await ref.get();

  if (!snap.exists) {
    console.log("❌ No onchain_publish_events doc found for", launchId);
    process.exit(1);
  }

  const data = snap.data() || {};
  console.log("✅ onchain_publish_events doc exists:", launchId);
  console.log("platforms:", data.platforms);
  console.log("publish_proofs:", data.publish_proofs);
  console.log("tx_hash:", data.tx_hash || data.txHash || data.transaction_hash);
})();
