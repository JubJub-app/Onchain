// scripts/worker-launch-events-to-chain.js
// NOTE: This version uses paging with:
// orderBy(event_date ASC), orderBy(__name__ ASC)
// and startAfter(lastEventDateRaw, lastDocId)
//
// You will need a composite index for:
// events: event_type ASC, event_date ASC, __name__ ASC

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

// Solidity enum Role { Viewer=0, Editor=1, Publisher=2, Admin=3 }
// "owner" has no Solidity equivalent — mapped to Admin (3) as highest on-chain privilege.
function roleToUint8(role) {
  const map = { viewer: 0, editor: 1, publisher: 2, admin: 3, owner: 3 };
  return map[String(role || "").toLowerCase()] ?? 0;
}

// Privilege rank for deduplication (lower number = higher privilege)
const ROLE_PRIVILEGE = { owner: 0, admin: 1, publisher: 2, editor: 3, viewer: 4 };
function rolePriority(role) {
  return ROLE_PRIVILEGE[String(role || "").toLowerCase()] ?? 99;
}

// Resolve the real owner profileId from event data.
// Priority: ev.profileId > ev.metadata.profileId > ev.owner_profile_id > ev.creator_profile_id
// Falls back to previously-enriched staged doc value only if it is not a placeholder.
function resolveOwnerProfileId(ev, prev) {
  return (
    ev.profileId ||
    (ev.metadata && ev.metadata.profileId) ||
    ev.owner_profile_id ||
    ev.creator_profile_id ||
    (prev.owner_profile_id && prev.owner_profile_id !== "unknown_for_now"
      ? prev.owner_profile_id
      : null)
  );
}

// Build contributors array from the best available source.
// Returns array of { profileId, role } with no placeholders.
function buildContributors(prev, ev, ownerProfileId) {
  // Priority 1: staged doc already has real contributors
  if (Array.isArray(prev.contributors_jubjub) && prev.contributors_jubjub.length > 0) {
    const allReal = prev.contributors_jubjub.every(
      (c) => c.profileId && c.profileId !== "unknown_for_now"
    );
    if (allReal) return prev.contributors_jubjub;
  }

  // Priority 2: event doc has contributors/collaborators array
  const candidates =
    ev.contributors || ev.collaborators || (ev.metadata && ev.metadata.contributors);
  if (Array.isArray(candidates) && candidates.length > 0) {
    const filtered = candidates.filter(
      (c) => c.profileId && c.profileId !== "unknown_for_now"
    );
    if (filtered.length > 0) return filtered;
  }

  // Priority 3: fallback to owner as sole contributor
  return [{ profileId: ownerProfileId, role: "owner" }];
}

// Deduplicate by profileId, keeping the highest-privilege role per contributor.
function deduplicateContributors(contributors) {
  const map = new Map();
  for (const c of contributors) {
    if (!c.profileId) continue;
    const existing = map.get(c.profileId);
    if (!existing || rolePriority(c.role) < rolePriority(existing.role)) {
      map.set(c.profileId, c);
    }
  }
  return Array.from(map.values());
}

// Your Firestore stores: "YYYY-MM-DDTHH:mm:ss" (no timezone)
// We interpret it as Australia/Melbourne local time and convert to UTC ISO Z.
// This is ONLY for worker cursor comparisons.
function melbourneLocalToUtcIsoZ(localStr) {
  if (!localStr || typeof localStr !== "string") return null;

  // If it already has timezone (Z or +HH:MM), parse normally
  if (/[zZ]$/.test(localStr) || /[+-]\d\d:\d\d$/.test(localStr)) {
    const d = new Date(localStr);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
    return null;
  }

  const m = localStr.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?$/
  );
  if (!m) return null;

  const [_, y, mo, da, hh, mm, ss] = m;
  const approxUtc = new Date(Date.UTC(+y, +mo - 1, +da, +hh, +mm, +ss));

  const fmt = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const parts = fmt.formatToParts(approxUtc).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});

  const melbAsUtc = new Date(
    Date.UTC(
      +parts.year,
      +parts.month - 1,
      +parts.day,
      +parts.hour,
      +parts.minute,
      +parts.second
    )
  );

  const inputAsUtc = new Date(Date.UTC(+y, +mo - 1, +da, +hh, +mm, +ss));
  const deltaMs = melbAsUtc.getTime() - inputAsUtc.getTime();

  const correctedUtc = new Date(approxUtc.getTime() - deltaMs);
  if (Number.isNaN(correctedUtc.getTime())) return null;
  return correctedUtc.toISOString();
}

// Compare (utcIso, id) tuples
function isAfterCursor(evUtcIso, evId, curUtcIso, curId) {
  if (evUtcIso > curUtcIso) return true;
  if (evUtcIso < curUtcIso) return false;
  return String(evId) > String(curId || "");
}

async function main() {
  const db = admin.firestore();

  if (!process.env.LEDGER_ADDRESS) throw new Error("Missing env var LEDGER_ADDRESS");

  const stateRef = db.collection("onchain_worker_state").doc("launch_to_chain");
  const stateSnap = await stateRef.get();
  if (!stateSnap.exists) throw new Error("Missing state doc onchain_worker_state/launch_to_chain");

  const state = stateSnap.data() || {};

  // Worker cursor (strong): UTC + id
  const lastUtcIso = state.last_event_date_utc || "1970-01-01T00:00:00.000Z";
  const lastEventId = state.last_event_id || "";

  console.log("⏱️ cursor utc:", lastUtcIso, "cursor id:", lastEventId);

  // Paging cursor (for Firestore query ordering)
  let pageAfterRaw = null;
  let pageAfterId = null;

  const PAGE_SIZE = 250;
  const MAX_TO_PROCESS = 10;
  const MAX_PAGES = 200; // safety valve (250 * 200 = 50,000 docs max scan)

  // Gather up to MAX_TO_PROCESS events after strong cursor
  const batch = [];

  for (let page = 0; page < MAX_PAGES && batch.length < MAX_TO_PROCESS; page++) {
    let q = db
      .collection("events")
      .where("event_type", "==", "launch")
      .orderBy("event_date", "asc")
      .orderBy(FieldPath.documentId(), "asc")
      .limit(PAGE_SIZE);

    if (pageAfterRaw && pageAfterId) {
      q = q.startAfter(pageAfterRaw, pageAfterId);
    }

    const snap = await q.get();
    if (snap.empty) break;

    // Update paging cursor to last doc in this page
    const lastDoc = snap.docs[snap.docs.length - 1];
    pageAfterRaw = lastDoc.data().event_date || null;
    pageAfterId = lastDoc.id;

    for (const doc of snap.docs) {
      if (batch.length >= MAX_TO_PROCESS) break;

      const ev = doc.data();
      const raw = ev.event_date;
      const utcIso = melbourneLocalToUtcIsoZ(raw);
      if (!raw || !utcIso) continue;

      if (isAfterCursor(utcIso, doc.id, lastUtcIso, lastEventId)) {
        batch.push({ doc, ev, raw, utcIso });
      }
    }
  }

  console.log("🔎 new launch events found:", batch.length);

  if (batch.length === 0) {
    console.log("✅ nothing to do");
    return;
  }

  const ledger = await hre.ethers.getContractAt(
    "JubJubPublishLedger",
    process.env.LEDGER_ADDRESS
  );

  let newestConfirmedUtcIso = lastUtcIso;
  let newestConfirmedId = lastEventId;

  for (const item of batch) {
    const doc = item.doc;
    const ev = item.ev;
    const eventId = doc.id;

    const platform = ev?.metadata?.platform || ev?.platform || null;
    const projectId = ev?.metadata?.project_id || ev?.project_id || null;

    if (!platform || !projectId) {
      console.log("⚠️ skipping event missing platform/project:", { eventId, platform, projectId });
      continue;
    }

    const stageRef = db.collection("onchain_publish_events").doc(eventId);
    const stageSnap = await stageRef.get();

    if (stageSnap.exists && stageSnap.data().status === "confirmed") {
      console.log("↩️ already confirmed, skipping:", eventId);

      if (isAfterCursor(item.utcIso, eventId, newestConfirmedUtcIso, newestConfirmedId)) {
        newestConfirmedUtcIso = item.utcIso;
        newestConfirmedId = eventId;
      }
      continue;
    }

    if (stageSnap.exists && stageSnap.data().status === "pending" && stageSnap.data().txHash) {
      console.log("⏳ already pending, skipping:", eventId);
      continue;
    }

    const prev = stageSnap.exists ? stageSnap.data() : {};
    const attempts = Number(prev.attempts || 0);

    // Dead-letter: permanently mark events that have exhausted retries
    if (attempts >= 5) {
      console.log("🛑 dead-letter: max attempts reached:", eventId);
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

    // Resolve real owner profileId — refuse to write on-chain with a placeholder
    const ownerProfileId = resolveOwnerProfileId(ev, prev);
    if (!ownerProfileId) {
      console.log("❌ no profileId found for event, marking failed:", eventId);
      await stageRef.set(
        {
          source_event_id: eventId,
          source_collection: "events",
          source_event_type: "launch",
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

    // Build and deduplicate contributor list — no placeholders allowed
    const rawContributors = buildContributors(prev, ev, ownerProfileId);
    const contributors = deduplicateContributors(rawContributors);

    await stageRef.set(
      {
        source_event_id: eventId,
        source_collection: "events",
        source_event_type: "launch",
        source_event_date_raw: item.raw,
        source_event_date_utc: item.utcIso,
        project_id: projectId,
        platform: platform,
        chain: "baseSepolia",
        ledger_address: process.env.LEDGER_ADDRESS,
        status: "staged",
        attempts: attempts,
        last_error: null,
        updated_at: FieldValue.serverTimestamp(),
        created_at: prev.created_at || FieldValue.serverTimestamp(),
        owner_profile_id: ownerProfileId,
        contributors_jubjub: contributors,
      },
      { merge: true }
    );

    const projectIdB32 = b32(projectId);
    const platformB32 = b32(platform);
    const sourceEventIdB32 = b32(eventId);
    const ownerProfileB32 = b32(ownerProfileId);

    const contributorsB32 = contributors.map((c) => b32(c.profileId));
    const rolesU8 = contributors.map((c) => roleToUint8(c.role));

    try {
      console.log("⛓️ submitting onchain:", { eventId, platform, projectId, ownerProfileId });

      const tx = await ledger.recordPublish(
        projectIdB32,
        platformB32,
        sourceEventIdB32,
        ownerProfileB32,
        contributorsB32,
        rolesU8
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

      console.log("✅ confirmed:", eventId, "block:", receipt.blockNumber);

      if (isAfterCursor(item.utcIso, eventId, newestConfirmedUtcIso, newestConfirmedId)) {
        newestConfirmedUtcIso = item.utcIso;
        newestConfirmedId = eventId;
      }
    } catch (err) {
      const msg = err && err.message ? err.message.slice(0, 400) : String(err);
      console.log("❌ onchain submit failed:", eventId, msg);

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
    newestConfirmedUtcIso !== lastUtcIso || String(newestConfirmedId) !== String(lastEventId);

  await stateRef.set(
    {
      last_event_date_utc: newestConfirmedUtcIso,
      last_event_id: newestConfirmedId,
      last_run_at: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  if (workerCursorChanged) {
    console.log("➡️ cursor advanced to:", newestConfirmedUtcIso, "id:", newestConfirmedId);
  } else {
    console.log("↪️ cursor unchanged");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
