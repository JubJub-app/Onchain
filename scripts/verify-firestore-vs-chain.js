require("dotenv").config();
const admin = require("firebase-admin");
const hre = require("hardhat");

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.applicationDefault() });
}

const { ethers } = hre;

function b32(str) {
  return ethers.keccak256(ethers.toUtf8Bytes(String(str)));
}

async function main() {
  const docId = process.env.STAGED_DOC_ID;
  const txHash = process.env.TX_HASH;
  if (!docId) throw new Error("Missing STAGED_DOC_ID");
  if (!txHash) throw new Error("Missing TX_HASH");

  const db = admin.firestore();
  const snap = await db.collection("onchain_publish_events").doc(docId).get();
  if (!snap.exists) throw new Error("Firestore doc not found");

  const data = snap.data();

  const derived = {
    projectIdB32: b32(data.project_id),
    platformB32: b32(data.platform),
    ownerProfileB32: b32(data.owner_profile_id || "unknown_for_now"),
  };

  const c = await hre.ethers.getContractAt("JubJubPublishLedger", process.env.LEDGER_ADDRESS);
  const receipt = await hre.ethers.provider.getTransactionReceipt(txHash);

  let parsedArgs = null;
  for (const log of receipt.logs) {
    try {
      const parsed = c.interface.parseLog(log);
      if (parsed && parsed.name === "PublishRecorded") {
        parsedArgs = parsed.args;
        break;
      }
    } catch {}
  }
  if (!parsedArgs) throw new Error("No PublishRecorded event found");

  console.log("\nFirestore (human):");
  console.log({
    project_id: data.project_id,
    platform: data.platform,
    owner_profile_id: data.owner_profile_id,
  });

  console.log("\nDerived (bytes32):");
  console.log(derived);

 const onchain = parsedArgs.map((x) => String(x).toLowerCase());

 console.log("\nOnchain raw args:");
 console.log(onchain);

 console.log("\nMatch results (value-based):");
 console.log({
  projectId_found: onchain.includes(derived.projectIdB32.toLowerCase()),
  platform_found: onchain.includes(derived.platformB32.toLowerCase()),
  owner_found: onchain.includes(derived.ownerProfileB32.toLowerCase()),
 });

}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
