// scripts/backfill-onchain-platform-urls.js
// One-off backfill: populates `platform` and `published_url` on existing
// onchain_publish_events documents that are missing them.
//
// Only touches V2 launches (those with a matching launches_v2 document).
// V1 launches (no launches_v2 match) are skipped.
//
// Usage:
//   node scripts/backfill-onchain-platform-urls.js
//
// Set DRY_RUN = false below to commit writes.

const DRY_RUN = true;

require("dotenv").config();
const admin = require("firebase-admin");

if (admin.apps.length === 0) {
  admin.initializeApp({ credential: admin.credential.applicationDefault() });
}

const db = admin.firestore();

async function main() {
  console.log(DRY_RUN ? "🔍 DRY RUN — no writes" : "✏️  LIVE RUN — will update documents");

  const allSnap = await db.collection("onchain_publish_events").get();
  console.log("Total onchain_publish_events docs:", allSnap.size);

  let skippedOk = 0;
  let skippedV1 = 0;
  let skippedNoSuccessful = 0;
  let updated = 0;
  let errors = 0;

  for (const doc of allSnap.docs) {
    const data = doc.data();
    const launchId = doc.id;

    // Check if platform is missing, null, or "unknown"
    const platformVal = data.platform;
    const needsPlatform =
      platformVal === undefined ||
      platformVal === null ||
      platformVal === "unknown" ||
      platformVal === "";

    // Check if published_url is missing or null
    const urlVal = data.published_url;
    const needsUrl =
      urlVal === undefined ||
      urlVal === null ||
      urlVal === "";

    if (!needsPlatform && !needsUrl) {
      skippedOk++;
      continue;
    }

    // Look up the corresponding launches_v2 document
    const launchSnap = await db.collection("launches_v2").doc(launchId).get();

    if (!launchSnap.exists) {
      // V1 launch — skip
      skippedV1++;
      console.log("  ⏭️  V1 (no launches_v2 doc), skipping:", launchId);
      continue;
    }

    const launch = launchSnap.data();
    const platformsArr = Array.isArray(launch.platforms) ? launch.platforms : [];

    // Find first successful platform
    const firstSuccess = platformsArr.find((p) => p && p.status === "success");

    if (!firstSuccess) {
      skippedNoSuccessful++;
      console.log("  ⚠️  no successful platforms in launch, skipping:", launchId);
      continue;
    }

    const updates = {};

    if (needsPlatform && firstSuccess.platform) {
      updates.platform = firstSuccess.platform;
    }

    if (
      needsUrl &&
      typeof firstSuccess.published_url === "string" &&
      firstSuccess.published_url.trim().length > 0
    ) {
      updates.published_url = firstSuccess.published_url.trim();
    }

    if (Object.keys(updates).length === 0) {
      skippedOk++;
      continue;
    }

    console.log(
      DRY_RUN ? "  [DRY]" : "  [WRITE]",
      launchId,
      "→",
      JSON.stringify(updates)
    );

    if (!DRY_RUN) {
      try {
        await db.collection("onchain_publish_events").doc(launchId).set(
          {
            ...updates,
            updated_at: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        updated++;
      } catch (err) {
        errors++;
        console.error("  ❌ write failed:", launchId, err.message);
      }
    } else {
      updated++;
    }
  }

  console.log("\n--- Summary ---");
  console.log("Already correct:", skippedOk);
  console.log("Skipped V1 (no launches_v2 doc):", skippedV1);
  console.log("Skipped (no successful platforms):", skippedNoSuccessful);
  console.log(DRY_RUN ? "Would update:" : "Updated:", updated);
  if (errors > 0) console.log("Errors:", errors);
  if (DRY_RUN) console.log("\n💡 Set DRY_RUN = false to commit writes.");
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
