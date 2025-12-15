require("dotenv").config();
const admin = require("firebase-admin");
const hre = require("hardhat");

const { ethers } = hre;

// convert any string/uuid to bytes32
function b32(str) {
  return ethers.keccak256(
    ethers.toUtf8Bytes(String(str))
  );
}

// map JubJub roles to uint8 enum values
function roleToUint8(role) {
  const map = {
    owner: 0,
    admin: 1,
    editor: 2,
    publisher: 3,
    viewer: 4,
  };
  return map[String(role || "").toLowerCase()] ?? 255;
}

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.applicationDefault() });
}

async function main() {
  const db = admin.firestore();

  const docId = process.env.STAGED_DOC_ID; // we’ll pass this in
  if (!docId) throw new Error("Missing STAGED_DOC_ID env var");

  const ref = db.collection("onchain_publish_events").doc(docId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`No staged doc found: ${docId}`);

  const data = snap.data();

  // Basic guards for the onchain pipeline (safe)
  if (data.status !== "staged") throw new Error(`Doc not staged, status=${data.status}`);
  if (!data.project_id) throw new Error("Missing project_id");
  if (!data.platform) throw new Error("Missing platform");
  if (!Array.isArray(data.contributors_jubjub) || data.contributors_jubjub.length === 0) {
    throw new Error("Missing contributors_jubjub");
  }

  const [signer] = await hre.ethers.getSigners();
  const signerAddr = await signer.getAddress();

  // v0: centralized contributor = JubJub org wallet
  const contributors = [signerAddr];

  // v0: role codes must be numbers; use 0 as placeholder until we map enum properly
  const roles = [0];


  const Ledger = await hre.ethers.getContractFactory("JubJubPublishLedger");
  const ledger = Ledger.attach(process.env.LEDGER_ADDRESS);

  // IMPORTANT: keep this small and deterministic for now
  // recordPublish(projectId, platform, ownerProfileId, contributors[], roles[], contentUri)
  const contentUri = data.content_uri || ""; // you can keep empty for now
  const ownerProfileId = data.owner_profile_id || "unknown_for_now";

  console.log("📦 Writing onchain for doc:", docId);
  console.log("project:", data.project_id, "platform:", data.platform);

const projectIdB32 = b32(data.project_id);
const platformB32 = b32(data.platform);
const sourceEventIdB32 = b32(data.source_event_id);
const ownerProfileB32 = b32(data.owner_profile_id || "unknown_for_now");

const contributorsB32 = (data.contributors_jubjub || []).map(
  c => b32(c.profileId || "unknown_for_now")
);

const rolesU8 = (data.contributors_jubjub || []).map(
  c => roleToUint8(c.role)
);

if (contributorsB32.length === 0) {
  throw new Error("contributors_jubjub empty (would revert EmptyContributors)");
}

 const tx = await ledger.recordPublish(
  projectIdB32,
  platformB32,
  sourceEventIdB32,
  ownerProfileB32,
  contributorsB32,
  rolesU8
 );


  console.log("⛓️ tx sent:", tx.hash);

  await ref.set(
    {
      status: "pending",
      txHash: tx.hash,
      submitted_at: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  const receipt = await tx.wait();
  console.log("✅ confirmed in block:", receipt.blockNumber);

  await ref.set(
    {
      status: "confirmed",
      confirmed_at: admin.firestore.FieldValue.serverTimestamp(),
      blockNumber: receipt.blockNumber,
    },
    { merge: true }
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
