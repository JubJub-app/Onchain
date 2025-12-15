async function main() {
  const ledgerAddr = process.env.LEDGER_ADDRESS;
  if (!ledgerAddr) throw new Error("Set LEDGER_ADDRESS in .env");

  const ledger = await ethers.getContractAt("JubJubPublishLedger", ledgerAddr);

  const filter = ledger.filters.PublishRecorded();
  const events = await ledger.queryFilter(filter, -5000);

  console.log("Found events:", events.length);

  for (const e of events) {
    const args = e.args;
    console.log({
      tx: e.transactionHash,
      mediaHash: args.mediaHash,
      publisher: args.publisher,
      platform: args.platform,
      destination: args.destination,
      publishId: args.publishId,
      contributorsCount: args.contributors.length,
      roles: args.roles.map((r) => Number(r)),
      timestamp: args.timestamp.toString(),
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
