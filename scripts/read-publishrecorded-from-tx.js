require("dotenv").config();
const hre = require("hardhat");

async function main() {
  const txHash = process.env.TX_HASH;
  if (!txHash) throw new Error("Missing TX_HASH");

  const receipt = await hre.ethers.provider.getTransactionReceipt(txHash);
  if (!receipt) throw new Error("No receipt found yet");

  const c = await hre.ethers.getContractAt(
    "JubJubPublishLedger",
    process.env.LEDGER_ADDRESS
  );

  for (const log of receipt.logs) {
    try {
      const parsed = c.interface.parseLog(log);
      if (parsed && parsed.name === "PublishRecorded") {
        console.log("✅ PublishRecorded event:");
        console.log(parsed.args);
        return;
      }
    } catch (e) {}
  }

  console.log("No PublishRecorded event found in receipt logs.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
