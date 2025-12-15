# Onchain
Toms experiment with the Base Blockchain

##Onchain experiments for JubJub – Base testnet prototypes for media metadata and payments##

## Deployments

### Base Sepolia

- Dummy contract  
  Address: `0x3Ffa2042C01dC1CB353e1f5b6342F4c8917D2b59`  
  Explorer: https://sepolia.basescan.org/address/0x3Ffa2042C01dC1CB353e1f5b6342F4c8917D2b59

This repository contains early onchain experiments for JubJub, starting with a simple Base Sepolia deployment to validate tooling and workflow.

## Firestore: events collection

The `events` collection is used for multiple event domains.

### Publish lifecycle events
- `event_type: "launch"`
- Meaning: a publish has actually fired (immediate or scheduled)

### Onchain publish mirror events
- `event_type: "launch"`
- `event_subtype: "publish_recorded_onchain"`
- `onchain.source: "onchain-ledger"`

These events are write-only mirrors used to anchor publish metadata to Base.
They must never trigger publishing or scheduling logic.
