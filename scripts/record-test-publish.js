const { keccak256, toUtf8Bytes } = ethers;

function h(s) {
  return keccak256(toUtf8Bytes(s));
}

async function main() {
  const ledgerAddr = process.env.LEDGER_ADDRESS;
  if (!ledgerAddr) throw new Error("Set LEDGER_ADDRESS in .env");

  const ledger = await ethers.getContractAt("JubJubPublishLedger", ledgerAddr);

  // Example: choose a deterministic media fingerprint strategy for now
  const mediaHash = h("example-media-fingerprint-v1");

  // Platform + destination (hashed)
  const platform = h("farcaster");        // "youtube", "tiktok", "instagram"
  const destination = h("@jubjubapp");     // could be channelId, profile id, etc.

  // JubJub internal publish job id hash (lets you reconcile later)
  const publishId = h("jubjub_publish_job_0001");

  // Contributors are JubJub user ids hashed.
  // Roles: 0 Viewer, 1 Editor, 2 Publisher, 3 Admin
  const contributors = [
    h("jubjub_user_tom"),       // example
    h("jubjub_user_matheus"),
  ];
  const roles = [
    3, // Admin
    1, // Editor
  ];

  const tx = await ledger.recordPublish(
    mediaHash,
    platform,
    destination,
    publishId,
    contributors,
    roles
  );

  console.log("tx sent:", tx.hash);
  const receipt = await tx.wait();
  console.log("tx confirmed in block:", receipt.blockNumber);
  console.log("BaseScan tx:", `https://sepolia.basescan.org/tx/${tx.hash}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
