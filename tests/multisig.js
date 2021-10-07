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
    await assertCreateMultisig(program, multisig.publicKey, owners);
  
    // proposal information (target program, accounts, params)
    const pid = program.programId;
    const accounts = [
      account(multisig.publicKey, true, false),
      account(multisigSigner, false, true),
    ];
    const newOwners = [ownerA.publicKey, ownerB.publicKey, ownerD.publicKey];
    const data = program.coder.instruction.encode("set_owners", {
      owners: newOwners,
    });

    const { proposal } = await createProposal(program, multisig, ownerA, { pid, accounts, data });
    await assertCreateProposal(program, proposal.publicKey, pid, accounts, data, multisig.publicKey);


    // other owner approves transactoin
    await approve(program, multisig, proposal, ownerB);

    // Now that we've reached the threshold, send the transactoin.
    await program.rpc.executeTransaction({
      accounts: {
        multisig: multisig.publicKey,
        multisigSigner,
        transaction: proposal.publicKey,
      },
      remainingAccounts: [
        account(multisig.publicKey, true, false),
        account(multisigSigner, false, false),
        account(program.programId, false, false),
      ]
    });
    await assertExecuteTransaction(program, multisig.publicKey, newOwners);
  });
});

const account = (pubkey, isWritable, isSigner) => ({
  pubkey, isWritable, isSigner,
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

const approve = async (program, multisig, proposal, voter) => {
  await program.rpc.approve({
    accounts: {
      multisig: multisig.publicKey,
      transaction: proposal.publicKey,
      owner: voter.publicKey,
    },
    signers: [voter],
  });
}

const assertCreateMultisig = async (program, multisig, owners) => {
  let multisigAccount = await program.account.multisig.fetch(multisig);
  assert.ok(multisigAccount.threshold.eq(new anchor.BN(2)));
  assert.deepStrictEqual(multisigAccount.owners, owners);
  assert.ok(multisigAccount.ownerSetSeqno === 0);
}

const assertCreateProposal = async (program, proposal, pid, accounts, data, multisig) => {
  const txAccount = await program.account.transaction.fetch(proposal);
  assert.ok(txAccount.programId.equals(pid));
  assert.deepStrictEqual(txAccount.accounts, accounts);
  assert.deepStrictEqual(txAccount.data, data);
  assert.ok(txAccount.multisig.equals(multisig));
  assert.deepStrictEqual(txAccount.didExecute, false);
  assert.ok(txAccount.ownerSetSeqno === 0);
}

const assertExecuteTransaction = async (program, multisig, newOwners) => {
  multisigAccount = await program.account.multisig.fetch(multisig);
  assert.ok(multisigAccount.threshold.eq(new anchor.BN(2)));
  assert.deepStrictEqual(multisigAccount.owners, newOwners);
  assert.ok(multisigAccount.ownerSetSeqno === 1);
}
