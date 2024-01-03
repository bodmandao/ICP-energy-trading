import {
  Canister,
  query,
  update,
  Result,
  text,
  float64,
  Principal,
  Err,
  Ok,
  Record,
  Vec,
  nat64,
  StableBTreeMap,
  ic,
} from 'azle';

import { v4 as uuidv4 } from 'uuid';

const EnergyTransaction = Record({
  id: Principal,
  amount: float64,
  timestamp: nat64,
  buyerID: Principal,
  sellerID: Principal,
  operation: text,
});

const EnergyParticipant = Record({
  id: Principal,
  username: text,
  password: text,
  energyBalance: float64,
});

const EnergyMarket = Record({
  totalEnergyTraded: float64,
  transactions: Vec(EnergyTransaction),
  participants: Vec(EnergyParticipant),
});

const energyMarketStorage: typeof EnergyMarket = {
  totalEnergyTraded: 0,
  transactions: [],
  participants: [],
};

const participantStorage = StableBTreeMap(Principal, EnergyParticipant, 1);
const transactionStorage = StableBTreeMap(Principal, EnergyTransaction, 2);
let currentParticipant: typeof EnergyParticipant | null;

export default Canister({
  getEnergyMarketDetails: query([], Result(EnergyMarket, text), () => {
    return Ok(energyMarketStorage);
  }),
  getEnergyBalance: query([], Result(text, text), () => {
    if (!currentParticipant) {
      return Err('There is no logged-in participant');
    }
    return Ok(`Your energy balance is ${currentParticipant.energyBalance}`);
  }),

  // TRANSACTIONS
  getParticipantTransactions: query([], Result(Vec(EnergyTransaction), text), () => {
    if (!currentParticipant) {
      return Err('Only logged-in participants can perform this operation.');
    }
    const transactions = transactionStorage.values();
    const participantTransactions = transactions.filter(
      (transaction: typeof EnergyTransaction) =>
        transaction.buyerID.equals(currentParticipant.id) || transaction.sellerID.equals(currentParticipant.id)
    );
    return Ok(participantTransactions);
  }),
  createTransaction: update(
    [float64, text, text],
    Result(text, text),
    (amount, operation, sellerUsername) => {
      if (!currentParticipant) {
        return Err('Only logged-in participants can perform this operation.');
      }

      const seller = participantStorage
        .values()
        .filter((p: typeof EnergyParticipant) => p.username === sellerUsername)[0];

      if (!seller) {
        return Err('Seller does not exist.');
      }

      if (operation === 'buy') {
        if (currentParticipant.energyBalance < amount) {
          return Err('Insufficient energy balance for buying.');
        }

        currentParticipant.energyBalance -= amount;
        seller.energyBalance += amount;
        energyMarketStorage.totalEnergyTraded += amount;
      } else if (operation === 'sell') {
        if (seller.energyBalance < amount) {
          return Err('Insufficient energy balance for selling.');
        }

        currentParticipant.energyBalance += amount;
        seller.energyBalance -= amount;
        energyMarketStorage.totalEnergyTraded += amount;
      } else {
        return Err('Invalid operation type.');
      }

      const newTransaction: typeof EnergyTransaction = {
        id: generateId(),
        amount,
        operation,
        timestamp: ic.time(),
        buyerID: currentParticipant.id,
        sellerID: seller.id,
      };
      transactionStorage.insert(newTransaction.id, newTransaction);
      participantStorage.insert(currentParticipant.id, { ...currentParticipant });
      participantStorage.insert(seller.id, { ...seller });
      return Ok('Transaction successful.');
    }
  ),

  // PARTICIPANT
  createParticipant: update(
    [text, text, float64],
    Result(text, text),
    (username, password, energyBalance) => {
      const participant = participantStorage
        .values()
        .filter((p: typeof EnergyParticipant) => p.username === username)[0];
      if (participant) {
        return Err('Participant already exists.');
      }
      const newParticipant: typeof EnergyParticipant = {
        id: generateId(),
        username,
        password,
        energyBalance,
      };
      participantStorage.insert(newParticipant.id, newParticipant);
      return Ok(`Participant ${newParticipant.username} added successfully.`);
    }
  ),

  authenticateParticipant: update(
    [text, text],
    Result(text, text),
    (username, password) => {
      const participant = participantStorage
        .values()
        .find((p: typeof EnergyParticipant) => p.username === username);
      if (!participant || participant.password !== password) {
        return Err('Participant does not exist or incorrect password.');
      }
      currentParticipant = participant;
      return Ok('Logged in');
    }
  ),
  signOut: update([], Result(text, text), () => {
    if (!currentParticipant) {
      return Err('There is no logged-in participant.');
    }
    currentParticipant = null;
    return Ok('Logged out.');
  }),

  getAuthenticatedParticipant: query([], Result(text, text), () => {
    if (!currentParticipant) {
      return Err('There is no logged-in participant.');
    }
    return Ok(currentParticipant.username);
  }),
});

function generateId(): Principal {
  return Principal.fromText(uuidv4());
}

// a workaround to make uuid package work with Azle
globalThis.crypto = {
  // @ts-ignore
  getRandomValues: () => {
    let array = new Uint8Array(32);

    for (let i = 0; i < array.length; i++) {
      array[i] = Math.floor(Math.random() * 256);
    }

    return array;
  },
};
