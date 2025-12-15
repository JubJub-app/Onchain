const fs = require("fs");
const path = require("path");

function h(s) {
  return ethers.keccak256(ethers.toUtf8Bytes(String(s)));
}

function roleToUint8(role) {
  const r = String(role || "").toLowerCase();
  // Must match your enum mapping:
  // 0 Viewer, 1 Editor, 2 Publisher, 3 Admin
  if (r === "viewer") return 0;
  if (r === "editor") return 1;
  if (r === "publisher") return 2;
  if (r === "admin") return 3;
  throw new Error(`Unknown role: ${role}`);
}

async function main() {
  const ledgerAddr = process.env.LEDGER_ADDRESS;
  if (!ledgerAddr) throw new Error("Set LEDGER_ADDRESS in .env");

const payloadPath = process.env.PAYLOAD_PATH;
if (!payloadPath) {
  throw new Error("Set PAYLOAD_PATH env var (e.g. payloads/example.publish.json)");
}

  const raw = fs.readFileSync(path.resolve(payloadPath), "utf8");
  const payload = JSON.parse(raw);

  if (!payload.contributors || payload.contributors.length === 0) {
    throw new Error("contributors must be a non-empty array");
  }

  const mediaHash = h(payload.mediaFingerprint);
  const platform = h(payload.platform);
  const destination = h(payload.destination);
  const publishId = h(payload.publishId);

  const contributors = payload.contributors.map((c) => h(c.userId));
  const roles = payload.contributors.map((c) => roleToUint8(c.role));

  const ledger = await ethers.getContractAt("JubJubPublishLedger", ledgerAddr);

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
