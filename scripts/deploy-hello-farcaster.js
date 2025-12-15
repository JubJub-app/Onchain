async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await deployer.provider.getBalance(deployer.address);

  console.log("Deploying with:", deployer.address);
  console.log("Balance:", balance.toString());

  const HelloFarcaster = await ethers.getContractFactory("HelloFarcaster");
  const hello = await HelloFarcaster.deploy();

  await hello.waitForDeployment();

  const addr = await hello.getAddress();
  console.log("HelloFarcaster deployed to:", addr);
  console.log("BaseScan:", `https://sepolia.basescan.org/address/${addr}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
