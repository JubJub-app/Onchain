async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await deployer.provider.getBalance(deployer.address);

  console.log("Deploying with:", deployer.address);
  console.log("Balance:", balance.toString());

  const Ledger = await ethers.getContractFactory("JubJubPublishLedger");
  const ledger = await Ledger.deploy();

  await ledger.waitForDeployment();

  const addr = await ledger.getAddress();
  console.log("JubJubPublishLedger deployed to:", addr);
  console.log("BaseScan:", `https://sepolia.basescan.org/address/${addr}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
