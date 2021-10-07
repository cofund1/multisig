const anchor = require("@project-serum/anchor");
const assert = require("assert");

describe("multisig", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.Provider.env());

  const program = anchor.workspace.SerumMultisig;

  it("Tests the multisig program", async () => {
    // multisig owners, need 2/4 to pass
    const ownerA = anchor.web3.Keypair.generate();
    const ownerB = anchor.web3.Keypair.generate();
    const ownerC = anchor.web3.Keypair.generate();
    const ownerD = anchor.web3.Keypair.generate();
    const owners = [ownerA.publicKey, ownerB.publicKey, ownerC.publicKey];
    const threshold = 2;

    // create multisig
    const { multisig, multisigSigner } = await createMultisig(program, owners, threshold);
  
    // proposal information (target program, accounts, params)
    const pid = program.programId;
    const accounts = [
      {
        pubkey: multisig.publicKey,
        isWritable: true,
        isSigner: false,
      },
      {
        pubkey: multisigSigner,
        isWritable: false,
        isSigner: true,
      },
    ];
    const newOwners = [ownerA.publicKey, ownerB.publicKey, ownerD.publicKey];
    const data = program.coder.instruction.encode("set_owners", {
      owners: newOwners,
    });

    // create the proposal
    const { proposal } = await createProposal(program, multisig, ownerA, { pid, accounts, data });

    // Other owner approves transactoin.
    await program.rpc.approve({
      accounts: {
        multisig: multisig.publicKey,
        transaction: proposal.publicKey,
        owner: ownerB.publicKey,
      },
      signers: [ownerB],
    });

    // Now that we've reached the threshold, send the transactoin.
    await program.rpc.executeTransaction({
      accounts: {
        multisig: multisig.publicKey,
        multisigSigner,
        transaction: proposal.publicKey,
      },
      remainingAccounts: program.instruction.setOwners
        .accounts({
          multisig: multisig.publicKey,
          multisigSigner,
        })
        // Change the signer status on the vendor signer since it's signed by the program, not the client.
        .map((meta) =>
          meta.pubkey.equals(multisigSigner)
            ? { ...meta, isSigner: false }
            : meta
        )
        .concat({
          pubkey: program.programId,
          isWritable: false,
          isSigner: false,
        }),
    });
  });
});

const createMultisig = async (program, owners, threshold) => {
  const multisig = anchor.web3.Keypair.generate();
  const [
    multisigSigner,
    nonce,
  ] = await anchor.web3.PublicKey.findProgramAddress(
    [multisig.publicKey.toBuffer()],
    program.programId
  );
  const multisigSize = 200; // Big enough.

  await program.rpc.createMultisig(owners, new anchor.BN(threshold), nonce, {
    accounts: {
      multisig: multisig.publicKey,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    },
    instructions: [
      await program.account.multisig.createInstruction(
        multisig,
        multisigSize
      ),
    ],
    signers: [multisig],
  });

  return { multisig, multisigSigner };
}

const createProposal = async (program, multisig, proposer, proposedTransaction) => {
  const { pid, accounts, data } = proposedTransaction;
  const transaction = anchor.web3.Keypair.generate();
  const txSize = 1000; // Big enough, cuz I'm lazy.
  await program.rpc.createTransaction(pid, accounts, data, {
    accounts: {
      multisig: multisig.publicKey,
      transaction: transaction.publicKey,
      proposer: proposer.publicKey,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    },
    instructions: [
      await program.account.transaction.createInstruction(
        transaction,
        txSize
      ),
    ],
    signers: [transaction, proposer],
  });

  return { proposal: transaction };
}
