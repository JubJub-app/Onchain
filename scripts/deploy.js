async function main() {
  const [deployer] = await ethers.getSigners();

  const balance = await deployer.provider.getBalance(deployer.address);

  console.log("Deploying with:", deployer.address);
  console.log("Balance:", balance.toString());

  const Dummy = await ethers.getContractFactory("Dummy");
  const dummy = await Dummy.deploy();

  await dummy.waitForDeployment();

  console.log("Dummy deployed to:", await dummy.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
