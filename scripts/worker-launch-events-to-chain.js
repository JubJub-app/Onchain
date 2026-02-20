// scripts/worker-launch-events-to-chain.js
// v2: reads from launches_v2, calls recordLaunch with all successful platforms + contributors.
//
// Composite index required:
// launches_v2: created_at ASC, __name__ ASC

require("dotenv").config();
const admin = require("firebase-admin");
const hre = require("hardhat");

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.applicationDefault() });
}

const { ethers } = hre;
const { FieldValue } = admin.firestore;
const { FieldPath } = admin.firestore;

// ---- helpers ----
function b32(str) {
  return ethers.keccak256(ethers.toUtf8Bytes(String(str)));
}

// Compare (utcIso, id) tuples
function isAfterCursor(evIso, evId, curIso, curId) {
  if (evIso > curIso) return true;
  if (evIso < curIso) return false;
  return String(evId) > String(curId || "");
}

async function main() {
  const db = admin.firestore();

  if (!process.env.LEDGER_ADDRESS) throw new Error("Missing env var LEDGER_ADDRESS");

  const stateRef = db.collection("onchain_worker_state").doc("launch_to_chain");
  const stateSnap = await stateRef.get();
  if (!stateSnap.exists) throw new Error("Missing state doc onchain_worker_state/launch_to_chain");

  const state = stateSnap.data() || {};

  // Worker cursor (strong): created_at ISO + doc id
  const lastIso = state.last_event_date_utc || "1970-01-01T00:00:00.000Z";
  const lastDocId = state.last_event_id || "";

  console.log("⏱️ cursor:", lastIso, "id:", lastDocId);

  // Paging cursor
  let pageAfterCreatedAt = null;
  let pageAfterId = null;

  const PAGE_SIZE = 250;
  const MAX_TO_PROCESS = 10;
  const MAX_PAGES = 200;

  const batch = [];

  for (let page = 0; page < MAX_PAGES && batch.length < MAX_TO_PROCESS; page++) {
    let q = db
      .collection("launches_v2")
      .orderBy("created_at", "asc")
      .orderBy(FieldPath.documentId(), "asc")
      .limit(PAGE_SIZE);

    if (pageAfterCreatedAt && pageAfterId) {
      q = q.startAfter(pageAfterCreatedAt, pageAfterId);
    }

    const snap = await q.get();
    if (snap.empty) break;

    const lastDoc = snap.docs[snap.docs.length - 1];
    pageAfterCreatedAt = lastDoc.data().created_at || null;
    pageAfterId = lastDoc.id;

    for (const doc of snap.docs) {
      if (batch.length >= MAX_TO_PROCESS) break;

      const launch = doc.data();
      const createdAt = launch.created_at;
      if (!createdAt) continue;

      if (isAfterCursor(createdAt, doc.id, lastIso, lastDocId)) {
        batch.push({ doc, launch, createdAt });
      }
    }
  }

  console.log("🔎 new launches found:", batch.length);

  if (batch.length === 0) {
    console.log("✅ nothing to do");
    return;
  }

  const ledger = await hre.ethers.getContractAt(
    "JubJubPublishLedger",
    process.env.LEDGER_ADDRESS
  );

  const feeData = await hre.ethers.provider.getFeeData();
  const overrides = {
    maxFeePerGas: feeData.maxFeePerGas,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
  };

  let newestConfirmedIso = lastIso;
  let newestConfirmedId = lastDocId;

  for (const item of batch) {
    const doc = item.doc;
    const launch = item.launch;
    const launchId = doc.id;
    const workspaceId = launch.workspace_id;

    // Only record if at least one platform succeeded
    const platformsArr = Array.isArray(launch.platforms) ? launch.platforms : [];
    const successfulPlatforms = [
      ...new Set(
        platformsArr
          .filter((p) => p && p.status === "success")
          .map((p) => p.platform)
          .filter(Boolean)
      ),
    ].sort();

    if (successfulPlatforms.length === 0) {
      console.log("⚠️ no successful platforms, skipping:", launchId);
      continue;
    }

    if (!workspaceId) {
      console.log("⚠️ missing workspace_id, skipping:", launchId);
      continue;
    }

    const stageRef = db.collection("onchain_publish_events").doc(launchId);
    const stageSnap = await stageRef.get();

    if (stageSnap.exists && stageSnap.data().status === "confirmed") {
      console.log("↩️ already confirmed, skipping:", launchId);

      if (isAfterCursor(item.createdAt, doc.id, newestConfirmedIso, newestConfirmedId)) {
        newestConfirmedIso = item.createdAt;
        newestConfirmedId = doc.id;
      }
      continue;
    }

    if (stageSnap.exists && stageSnap.data().status === "pending" && stageSnap.data().txHash) {
      console.log("⏳ already pending, skipping:", launchId);
      continue;
    }

    const prev = stageSnap.exists ? stageSnap.data() : {};
    const attempts = Number(prev.attempts || 0);

    // Dead-letter: permanently mark launches that have exhausted retries
    if (attempts >= 5) {
      console.log("🛑 dead-letter: max attempts reached:", launchId);
      await stageRef.set(
        {
          status: "dead_letter",
          dead_letter_reason: "max_attempts_exceeded",
          dead_letter_at: FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      continue;
    }

    // Resolve contributors from workspace/team
    let contributors = [];
    let ownerProfileId = null;

    const workspaceSnap = await db.collection("workspaces_v2").doc(workspaceId).get();
    const workspace = workspaceSnap.exists ? workspaceSnap.data() : {};

    if (workspace.team_id) {
      const teamSnap = await db.collection("teams_v2").doc(workspace.team_id).get();
      const team = teamSnap.exists ? teamSnap.data() : {};

      ownerProfileId = team.owner_id || launch.created_by || null;

      const memberIds = Array.isArray(team.member_profile_ids) ? team.member_profile_ids : [];
      contributors = [...new Set([team.owner_id, ...memberIds].filter(Boolean))];
    } else {
      ownerProfileId = launch.created_by || null;
      contributors = launch.created_by ? [launch.created_by] : [];
    }

    // Remove nulls and dedupe (safety)
    contributors = [...new Set(contributors.filter(Boolean))];

    if (!ownerProfileId) {
      console.log("❌ no ownerProfileId for launch, marking failed:", launchId);
      await stageRef.set(
        {
          source_launch_id: launchId,
          source_collection: "launches_v2",
          workspace_id: workspaceId,
          status: "failed",
          last_error: "missing_profile_id",
          attempts: attempts + 1,
          updated_at: FieldValue.serverTimestamp(),
          created_at: prev.created_at || FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      continue;
    }

    if (contributors.length === 0) {
      console.log("❌ no contributors for launch, marking failed:", launchId);
      await stageRef.set(
        {
          source_launch_id: launchId,
          source_collection: "launches_v2",
          workspace_id: workspaceId,
          status: "failed",
          last_error: "no_contributors",
          attempts: attempts + 1,
          updated_at: FieldValue.serverTimestamp(),
          created_at: prev.created_at || FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      continue;
    }

    const contributorsJubjub = contributors.map((id) => ({ profileId: id, role: "member" }));

    await stageRef.set(
      {
        source_launch_id: launchId,
        source_collection: "launches_v2",
        workspace_id: workspaceId,
        platforms: successfulPlatforms,
        chain: process.env.CHAIN || "baseSepolia",
        ledger_address: process.env.LEDGER_ADDRESS,
        status: "staged",
        attempts: attempts,
        last_error: null,
        updated_at: FieldValue.serverTimestamp(),
        created_at: prev.created_at || FieldValue.serverTimestamp(),
        owner_profile_id: ownerProfileId,
        contributors_jubjub_profile_ids: contributors,
        contributors_jubjub: contributorsJubjub,
      },
      { merge: true }
    );

    try {
      console.log("⛓️ submitting onchain:", {
        launchId,
        workspaceId,
        ownerProfileId,
        platforms: successfulPlatforms,
        contributors,
      });

      const tx = await ledger.recordLaunch(
        b32(workspaceId),
        b32(launchId),
        b32(ownerProfileId),
        successfulPlatforms.map((p) => b32(p)),
        contributors.map((id) => b32(id)),
        contributors.map(() => 0),
        overrides
      );

      await stageRef.set(
        {
          status: "pending",
          txHash: tx.hash,
          attempts: attempts + 1,
          submitted_at: FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      const receipt = await tx.wait();

      await stageRef.set(
        {
          status: "confirmed",
          blockNumber: receipt.blockNumber,
          confirmed_at: FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      console.log("✅ confirmed:", launchId, "block:", receipt.blockNumber);

      if (isAfterCursor(item.createdAt, doc.id, newestConfirmedIso, newestConfirmedId)) {
        newestConfirmedIso = item.createdAt;
        newestConfirmedId = doc.id;
      }
    } catch (err) {
      const msg = err && err.message ? err.message.slice(0, 400) : String(err);
      console.log("❌ onchain submit failed:", launchId, msg);

      await stageRef.set(
        {
          status: "error",
          attempts: attempts + 1,
          last_error: msg,
          updated_at: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
  }

  // Persist worker cursor (strong)
  const workerCursorChanged =
    newestConfirmedIso !== lastIso || String(newestConfirmedId) !== String(lastDocId);

  await stateRef.set(
    {
      last_event_date_utc: newestConfirmedIso,
      last_event_id: newestConfirmedId,
      last_run_at: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  if (workerCursorChanged) {
    console.log("➡️ cursor advanced to:", newestConfirmedIso, "id:", newestConfirmedId);
  } else {
    console.log("↪️ cursor unchanged");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
